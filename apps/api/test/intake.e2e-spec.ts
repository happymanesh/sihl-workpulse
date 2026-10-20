import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { TaskOrigin, TaskStatus, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { IntakeService } from "../src/modules/intake/intake.service";
import { TaskService } from "../src/modules/task/task.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * Work arriving from another system, and its status going back.
 *
 * The service was complete from the start and unreachable: no endpoint, no way
 * to register a source, and nothing ever called the push-back. These cover the
 * parts that make it usable, and the rule that makes redelivery safe.
 */

const RUN = `e2e-intake-${Date.now()}`;
const CODE = `${RUN}`.slice(0, 40).toUpperCase();

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "test-user",
    synapseUserUid: 999,
    username: "tester",
    fullName: "Test User",
    companyCode: "SIHL",
    hierarchyCode: "0200",
    roles: ["SYSTEM_ADMIN"],
    employeeId: null,
    isEmployeeUnlinked: false,
    hiddenNavKeys: [],
    ...overrides,
  } as AuthenticatedUser;
}

const canRun = Boolean(process.env.DATABASE_URL);
const d = canRun ? describe : describe.skip;

d("Source system intake (e2e)", () => {
  let app: INestApplication;
  let intake: IntakeService;
  let tasks: TaskService;

  let sourceId: string;
  let departmentName: string;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();

    intake = app.get(IntakeService);
    tasks = app.get(TaskService);

    // A department with an active head, so the queue fallback has somewhere to go.
    const head = await prisma.employee.findFirst({
      where: { isActive: true, managerId: null, departmentId: { not: null } },
      include: { department: true },
    });
    if (!head?.department) {
      throw new Error("Fixtures missing. Run `npm run sync:frappe-hr` first.");
    }
    departmentName = head.department.name;
  }, 90_000);

  afterAll(async () => {
    const created = await prisma.task.findMany({
      where: { title: { startsWith: RUN } },
      select: { id: true },
    });
    const ids = created.map((t) => t.id);
    if (ids.length) {
      await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: ids } } });
      await prisma.taskChecklistItem.deleteMany({ where: { taskId: { in: ids } } });
      await prisma.task.deleteMany({ where: { id: { in: ids } } });
    }
    if (sourceId) await prisma.sourceSystem.delete({ where: { id: sourceId } }).catch(() => null);
    await prisma.auditLog.deleteMany({ where: { reason: { contains: RUN } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "SourceSystem", entityId: sourceId } });
    await app?.close();
  }, 60_000);

  describe("the registry", () => {
    it("refuses anybody but a system administrator", async () => {
      await expect(
        intake.registerSource(actor({ roles: ["DEPARTMENT_HEAD"] }), { code: `${CODE}X`, name: "Nope" }),
      ).rejects.toThrow(/system administrator/);
    });

    it("registers a system and audits it", async () => {
      const s = await intake.registerSource(actor(), {
        code: CODE,
        name: `${RUN} tracker`,
        referenceUrlTemplate: "https://tracker.example.internal/issues/{id}",
      });
      sourceId = s.id;
      expect(s.isActive).toBe(true);

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "SourceSystem", entityId: s.id, action: "registered" },
      });
      expect(entry).not.toBeNull();
    });

    it("refuses a duplicate code", async () => {
      await expect(
        intake.registerSource(actor(), { code: CODE, name: "Again" }),
      ).rejects.toThrow(/already registered/);
    });
  });

  describe("raising work", () => {
    const ref = `${RUN}-1001`;
    let taskId: string;

    it("refuses an unknown source system", async () => {
      await expect(
        intake.ingest({
          sourceSystemCode: "NOT-A-SYSTEM",
          sourceReference: "x",
          title: `${RUN} nope`,
          departmentName,
        }),
      ).rejects.toThrow(/Unknown source system/);
    });

    it("refuses an event with nobody and nowhere to send it", async () => {
      await expect(
        intake.ingest({
          sourceSystemCode: CODE,
          sourceReference: `${RUN}-orphan`,
          title: `${RUN} orphan`,
        }),
      ).rejects.toThrow(/assignee or a department queue/);
    });

    it("creates a task, queued to the department when no person matches", async () => {
      const { task, created } = await intake.ingest({
        sourceSystemCode: CODE,
        sourceReference: ref,
        title: `${RUN} Client reports a failed payout`,
        description: "Raised in the tracker by the support desk.",
        departmentName,
      });
      taskId = task.id;

      expect(created).toBe(true);
      expect(task.origin).toBe(TaskOrigin.SOURCE_SYSTEM);
      expect(task.sourceReference).toBe(ref);
      expect(task.reference).toMatch(/^WP-\d{6}$/);
    });

    it("returns the same task when the webhook is redelivered", async () => {
      const { task, created } = await intake.ingest({
        sourceSystemCode: CODE,
        sourceReference: ref,
        title: `${RUN} Client reports a failed payout`,
        departmentName,
      });

      // At-least-once delivery is the normal case. A caller that got an error
      // for a duplicate would retry it for ever.
      expect(created).toBe(false);
      expect(task.id).toBe(taskId);

      const count = await prisma.task.count({
        where: { sourceSystemId: sourceId, sourceReference: ref },
      });
      expect(count).toBe(1);
    });
  });

  describe("status going back", () => {
    it("reports no delivery when the source has no webhook", async () => {
      const t = await prisma.task.findFirst({
        where: { sourceSystemId: sourceId },
        select: { id: true },
      });
      const result = await intake.pushStatus(t!.id);
      expect(result).toMatchObject({ delivered: false, reason: "No webhook configured" });
    });

    it("posts the task's status to the configured webhook", async () => {
      const received: unknown[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        received.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      try {
        await intake.updateSource(actor(), {
          id: sourceId,
          webhookUrl: "https://tracker.example.internal/hooks/workpulse",
        });

        const task = await prisma.task.findFirst({
          where: { sourceSystemId: sourceId },
          select: { id: true, reference: true, sourceReference: true },
        });
        const result = await intake.pushStatus(task!.id);

        expect(result.delivered).toBe(true);
        expect(received[0]).toMatchObject({
          workPulseReference: task!.reference,
          sourceReference: task!.sourceReference,
          status: TaskStatus.ASSIGNED,
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not fail a transition when the tracker is unreachable", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error("tracker is down");
      }) as typeof fetch;

      try {
        const task = await prisma.task.findFirst({
          where: { sourceSystemId: sourceId },
          select: { id: true, assigneeEmployeeId: true },
        });

        // The person moving their own work must not be blocked by somebody
        // else's outage.
        const moved = await tasks.transition(actor({ employeeId: task!.assigneeEmployeeId }), {
          taskId: task!.id,
          to: TaskStatus.ACCEPTED,
        });
        expect(moved.task.status).toBe(TaskStatus.ACCEPTED);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("switching a source off", () => {
    it("stops it raising new work, and leaves what it raised alone", async () => {
      await intake.updateSource(actor(), { id: sourceId, isActive: false });

      await expect(
        intake.ingest({
          sourceSystemCode: CODE,
          sourceReference: `${RUN}-after-off`,
          title: `${RUN} too late`,
          departmentName,
        }),
      ).rejects.toThrow(/not active/);

      const still = await prisma.task.count({ where: { sourceSystemId: sourceId } });
      expect(still).toBeGreaterThan(0);
    });
  });
});
