import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Priority, TaskStatus, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { TaskService } from "../src/modules/task/task.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * Reassigning and correcting a task.
 *
 * Both were missing entirely, which left two dead ends in the product: work
 * could not move between people, and a task created without a reviewer could
 * never be sent for review. The rules below are what stops either becoming a
 * way to make late work look on time.
 */

const RUN = `e2e-dir-${Date.now()}`;

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

d("Reassigning and correcting a task (e2e)", () => {
  let app: INestApplication;
  let tasks: TaskService;

  let employeeA: string;
  let employeeB: string;
  let employeeC: string;
  let routineTypeId: string;
  let taskId: string;

  const makeTask = async (title: string, reviewer?: string) =>
    tasks.create(actor({ employeeId: employeeC }), {
      title: `${RUN} ${title}`,
      taskTypeId: routineTypeId,
      priority: Priority.MEDIUM,
      assigneeEmployeeId: employeeA,
      reviewerEmployeeId: reviewer,
      dueDate: new Date(Date.now() + 3 * 86_400_000),
    });

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    tasks = app.get(TaskService);

    const emps = await prisma.employee.findMany({
      where: { isActive: true },
      take: 3,
      orderBy: { name: "asc" },
    });
    const routine = await prisma.taskType.findUnique({ where: { code: "ROUTINE" } });
    if (emps.length < 3 || !routine) {
      throw new Error("Fixtures missing. Run `npm run db:seed` and `npm run sync:frappe-hr` first.");
    }
    [employeeA, employeeB, employeeC] = emps.map((e) => e.id);
    routineTypeId = routine.id;

    taskId = (await makeTask("Reconcile the suspense account")).id;
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
    await prisma.auditLog.deleteMany({ where: { reason: { contains: RUN } } });
    await app?.close();
  }, 60_000);

  describe("reassignment", () => {
    it("refuses the assignee moving their own work away", async () => {
      await expect(
        tasks.reassign(actor({ roles: ["EMPLOYEE"], employeeId: employeeA }), {
          taskId,
          toEmployeeId: employeeB,
          reason: `${RUN} too busy`,
        }),
      ).rejects.toThrow(/manager or above/);
    });

    it("needs a reason", async () => {
      await expect(
        tasks.reassign(actor(), { taskId, toEmployeeId: employeeB, reason: "  " }),
      ).rejects.toThrow(/needs a reason/);
    });

    it("refuses moving work to the person who reviews it", async () => {
      const t = await makeTask("Has a reviewer", employeeB);
      await expect(
        tasks.reassign(actor(), { taskId: t.id, toEmployeeId: employeeB, reason: `${RUN} swap` }),
      ).rejects.toThrow(/cannot do the work and check it/);
    });

    it("moves the task and sends it back to Assigned", async () => {
      await tasks.transition(actor({ employeeId: employeeA }), { taskId, to: TaskStatus.ACCEPTED });
      await tasks.transition(actor({ employeeId: employeeA }), { taskId, to: TaskStatus.IN_PROGRESS });

      const after = await tasks.reassign(actor(), {
        taskId,
        toEmployeeId: employeeB,
        reason: `${RUN} moved while A is on leave`,
      });

      expect(after.assigneeEmployeeId).toBe(employeeB);
      // Not carried across: the new holder has not accepted anything.
      expect(after.status).toBe(TaskStatus.ASSIGNED);
      expect(after.startedAt).toBeNull();

      const history = await prisma.taskStatusHistory.findFirst({
        where: { taskId, toStatus: TaskStatus.ASSIGNED },
        orderBy: { createdAt: "desc" },
      });
      expect(history?.fromStatus).toBe(TaskStatus.IN_PROGRESS);
      expect(history?.reason).toContain("on leave");
    });

    it("writes the audit row the anti-gaming detector reads", async () => {
      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "Task", entityId: taskId, action: "REASSIGN" },
        orderBy: { createdAt: "desc" },
      });
      expect(entry).not.toBeNull();
      // The detector reads the previous assignee out of `before`; without this
      // exact shape the reassignment-pattern check finds nothing.
      expect(entry?.beforeJson).toMatchObject({ assigneeEmployeeId: employeeA });
      expect(entry?.actorId).toBe("test-user");
    });

    it("refuses to move work that has already been completed", async () => {
      const t = await makeTask("Completed then moved", employeeB);
      await tasks.transition(actor({ employeeId: employeeA }), { taskId: t.id, to: TaskStatus.ACCEPTED });
      await tasks.transition(actor({ employeeId: employeeA }), { taskId: t.id, to: TaskStatus.IN_PROGRESS });
      await tasks.transition(actor({ employeeId: employeeA }), { taskId: t.id, to: TaskStatus.COMPLETED });

      await expect(
        tasks.reassign(actor(), { taskId: t.id, toEmployeeId: employeeC, reason: `${RUN} move it` }),
      ).rejects.toThrow(/Reopen it first/);
    });

    it("refuses once the task is settled", async () => {
      const t = await makeTask("Already cancelled");
      await tasks.transition(actor(), {
        taskId: t.id,
        to: TaskStatus.CANCELLED,
        reason: `${RUN} not needed`,
      });
      await expect(
        tasks.reassign(actor(), { taskId: t.id, toEmployeeId: employeeB, reason: `${RUN} late` }),
      ).rejects.toThrow(/nothing to reassign/);
    });
  });

  describe("correction", () => {
    it("assigns a reviewer to a task that had none, which unblocks review", async () => {
      const t = await makeTask("Needs a reviewer");
      expect(t.reviewerEmployeeId).toBeNull();

      await tasks.transition(actor({ employeeId: employeeA }), { taskId: t.id, to: TaskStatus.ACCEPTED });
      await tasks.transition(actor({ employeeId: employeeA }), { taskId: t.id, to: TaskStatus.IN_PROGRESS });
      await expect(
        tasks.transition(actor({ employeeId: employeeA }), { taskId: t.id, to: TaskStatus.PENDING_REVIEW }),
      ).rejects.toThrow(/no reviewer/);

      await tasks.update(actor(), { taskId: t.id, reviewerEmployeeId: employeeB });
      const moved = await tasks.transition(actor({ employeeId: employeeA }), {
        taskId: t.id,
        to: TaskStatus.PENDING_REVIEW,
      });
      expect(moved.task.status).toBe(TaskStatus.PENDING_REVIEW);
    });

    it("refuses to make the assignee their own reviewer", async () => {
      const t = await makeTask("Self review");
      await expect(
        tasks.update(actor(), { taskId: t.id, reviewerEmployeeId: employeeA }),
      ).rejects.toThrow(/cannot review their own work/);
    });

    it("will not move a due date without a reason", async () => {
      const t = await makeTask("Date move");
      await expect(
        tasks.update(actor(), { taskId: t.id, dueDate: new Date(Date.now() + 30 * 86_400_000) }),
      ).rejects.toThrow(/needs a reason/);
    });

    it("moves it with one, and keeps the old date beside the new", async () => {
      const t = await makeTask("Date move with reason");
      const newDue = new Date(Date.now() + 30 * 86_400_000);

      await tasks.update(actor(), {
        taskId: t.id,
        dueDate: newDue,
        reason: `${RUN} exchange moved the filing window`,
      });

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "Task", entityId: t.id, action: "due_date_moved" },
        orderBy: { createdAt: "desc" },
      });
      expect(entry?.beforeJson).toMatchObject({ dueDate: t.dueDate.toISOString() });
      expect(entry?.reason).toContain("filing window");
    });

    it("changes priority without demanding a reason", async () => {
      const t = await makeTask("Priority change");
      const after = await tasks.update(actor(), { taskId: t.id, priority: Priority.HIGH });
      expect(after.priority).toBe(Priority.HIGH);
    });

    it("refuses to edit a settled task", async () => {
      const t = await makeTask("Settled edit");
      await tasks.transition(actor(), {
        taskId: t.id,
        to: TaskStatus.CANCELLED,
        reason: `${RUN} dropped`,
      });
      await expect(
        tasks.update(actor(), { taskId: t.id, priority: Priority.LOW }),
      ).rejects.toThrow(/not edited/);
    });

    it("refuses anybody below a manager", async () => {
      await expect(
        tasks.update(actor({ roles: ["EMPLOYEE"], employeeId: employeeA }), {
          taskId,
          priority: Priority.LOW,
        }),
      ).rejects.toThrow(/manager or above/);
    });
  });
});
