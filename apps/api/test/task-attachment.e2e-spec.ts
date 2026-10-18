import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { Priority, TaskAttachmentKind, TaskStatus, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { AttachmentService } from "../src/modules/attachment/attachment.service";
import { TaskService } from "../src/modules/task/task.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * Attachments against the real database and a real directory.
 *
 * The storage root is a temporary directory created here and removed
 * afterwards, so a test run cannot write into the directory a developer's own
 * server is serving from.
 */

const RUN = `e2e-att-${Date.now()}`;

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
    ...overrides,
  } as AuthenticatedUser;
}

const canRun = Boolean(process.env.DATABASE_URL);
const d = canRun ? describe : describe.skip;

d("Task attachments (e2e)", () => {
  let app: INestApplication;
  let attachments: AttachmentService;
  let tasks: TaskService;

  let storageRoot: string;
  let employeeA: string;
  let employeeB: string;
  let routineTypeId: string;
  let taskId: string;

  const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "workpulse-att-"));

    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) => (key === "ATTACHMENT_DIR" ? storageRoot : process.env[key]),
      })
      .compile();
    app = fixture.createNestApplication();
    await app.init();

    attachments = app.get(AttachmentService);
    tasks = app.get(TaskService);

    const emps = await prisma.employee.findMany({
      where: { isActive: true },
      take: 2,
      orderBy: { name: "asc" },
    });
    const routine = await prisma.taskType.findUnique({ where: { code: "ROUTINE" } });
    if (emps.length < 2 || !routine) {
      throw new Error("Fixtures missing. Run `npm run db:seed` and `npm run sync:frappe-hr` first.");
    }
    employeeA = emps[0].id;
    employeeB = emps[1].id;
    routineTypeId = routine.id;

    const task = await tasks.create(actor({ employeeId: employeeA }), {
      title: `${RUN} Reconciliation needing evidence`,
      taskTypeId: routineTypeId,
      priority: Priority.MEDIUM,
      assigneeEmployeeId: employeeA,
      reviewerEmployeeId: employeeB,
      dueDate: new Date(Date.now() + 86_400_000),
    });
    taskId = task.id;
  }, 90_000);

  afterAll(async () => {
    const created = await prisma.task.findMany({
      where: { title: { startsWith: RUN } },
      select: { id: true },
    });
    const ids = created.map((t) => t.id);
    if (ids.length) {
      await prisma.taskAttachment.deleteMany({ where: { taskId: { in: ids } } });
      await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: ids } } });
      await prisma.taskChecklistItem.deleteMany({ where: { taskId: { in: ids } } });
      await prisma.task.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.auditLog.deleteMany({
      where: { entityType: "Task", reason: { contains: RUN } },
    });
    await app?.close();
    await rm(storageRoot, { recursive: true, force: true });
  }, 60_000);

  it("attaches a file and records what arrived", async () => {
    const a = await attachments.add(actor({ employeeId: employeeA }), {
      taskId,
      fileName: "Q4 reco.pdf",
      contentType: "application/pdf",
      bytes: pdf("reco"),
    });

    expect(a.fileName).toBe("Q4 reco.pdf");
    expect(a.kind).toBe(TaskAttachmentKind.EVIDENCE);
    expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sizeBytes).toBe(pdf("reco").byteLength);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Task", entityId: taskId, action: "attachment_added" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.afterJson).toMatchObject({ fileName: "Q4 reco.pdf", checksum: a.checksum });
  });

  it("stores identical bytes once, and says so", async () => {
    const first = await prisma.taskAttachment.findFirst({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });

    const again = await attachments.add(actor({ employeeId: employeeA }), {
      taskId,
      fileName: "Q4 reco (copy).pdf",
      contentType: "application/pdf",
      bytes: pdf("reco"),
    });

    // Two rows, one blob: the storage key is shared and the row is not.
    expect(again.id).not.toBe(first!.id);
    expect(again.storageKey).toBe(first!.storageKey);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Task", entityId: taskId, action: "attachment_added" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.afterJson).toMatchObject({ deduplicated: true });
  });

  it("refuses a file type that proves nothing", async () => {
    await expect(
      attachments.add(actor({ employeeId: employeeA }), {
        taskId,
        fileName: "evidence.zip",
        contentType: "application/zip",
        bytes: Buffer.from("PK\u0003\u0004"),
      }),
    ).rejects.toThrow(/cannot be attached/);
  });

  it("keeps a colleague who cannot see the task out entirely", async () => {
    await prisma.task.update({ where: { id: taskId }, data: { isConfidential: true } });
    await expect(
      attachments.list(actor({ roles: ["EMPLOYEE"], employeeId: "somebody-else" }), taskId),
    ).rejects.toThrow(/cannot see this task/);
    await prisma.task.update({ where: { id: taskId }, data: { isConfidential: false } });
  });

  it("will not withdraw a file without a reason", async () => {
    const a = await prisma.taskAttachment.findFirst({ where: { taskId } });
    await expect(
      attachments.remove(actor({ employeeId: employeeA }), { attachmentId: a!.id, reason: "  " }),
    ).rejects.toThrow(/needs a reason/);
  });

  it("marks a withdrawn file rather than deleting it, and stops serving it", async () => {
    const a = await prisma.taskAttachment.findFirst({ where: { taskId }, orderBy: { createdAt: "asc" } });

    const removed = await attachments.remove(actor({ employeeId: employeeA }), {
      attachmentId: a!.id,
      reason: `${RUN} wrong quarter`,
    });
    expect(removed.removedAt).not.toBeNull();

    // The row is still there, and still listed.
    const listed = await attachments.list(actor({ employeeId: employeeA }), taskId);
    expect(listed.some((x) => x.id === a!.id)).toBe(true);

    await expect(attachments.open(actor({ employeeId: employeeA }), a!.id)).rejects.toThrow(
      /was withdrawn/,
    );

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Task", entityId: taskId, action: "attachment_withdrawn" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.reason).toContain("wrong quarter");
  });

  it("hands the bytes back to somebody who may see the task, and audits the read", async () => {
    const a = await attachments.add(actor({ employeeId: employeeA }), {
      taskId,
      fileName: "margin statement.pdf",
      contentType: "application/pdf",
      bytes: pdf("statement"),
    });

    const opened = await attachments.open(actor({ employeeId: employeeB }), a.id);
    expect(opened.fileName).toBe("margin statement.pdf");

    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(pdf("statement"))).toBe(true);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Task", entityId: taskId, action: "attachment_downloaded" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.afterJson).toMatchObject({ attachmentId: a.id });
  });

  it("counts as the evidence the closure check looks for", async () => {
    expect(await attachments.hasEvidence(taskId)).toBe(true);
  });

  it("refuses to take anything off a task that has been verified", async () => {
    const a = await prisma.taskAttachment.findFirst({
      where: { taskId, removedAt: null },
      orderBy: { createdAt: "desc" },
    });
    await prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.VERIFIED } });

    await expect(
      attachments.remove(actor({ employeeId: employeeA }), {
        attachmentId: a!.id,
        reason: `${RUN} too late`,
      }),
    ).rejects.toThrow(/part of the record/);
  });
});
