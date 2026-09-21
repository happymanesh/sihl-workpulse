import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ApprovalStatus, Priority, TaskOrigin, TaskStatus, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { RecurrenceService } from "../src/modules/recurrence/recurrence.service";

/**
 * Generation against the real database. The properties that matter are
 * idempotency and eligibility - a generator that double-creates, or that keeps
 * generating for a paused activity, is worse than none.
 */

const RUN = `rec-${Date.now()}`;
const canRun = Boolean(process.env.DATABASE_URL);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

(canRun ? describe : describe.skip)("Recurrence generation (e2e)", () => {
  let app: INestApplication;
  let recurrence: RecurrenceService;
  let deskCardId: string;
  let activityId: string;
  let employeeId: string;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    recurrence = app.get(RecurrenceService);

    const dept = await prisma.department.findFirst();
    const emp = await prisma.employee.findFirst({ where: { isActive: true } });
    const type = await prisma.taskType.findUnique({ where: { code: "COMPLIANCE" } });
    if (!dept || !emp || !type) throw new Error("Fixtures missing; run db:seed and sync:frappe-hr");
    employeeId = emp.id;

    const card = await prisma.deskCard.create({
      data: {
        code: `${RUN}-CARD`,
        name: `${RUN} Compliance Officer`,
        departmentId: dept.id,
        status: ApprovalStatus.APPROVED,
        holderEmployeeId: emp.id,
        holderSince: new Date(),
      },
    });
    deskCardId = card.id;

    const activity = await prisma.deskCardActivity.create({
      data: {
        deskCardId: card.id,
        title: `${RUN} Monthly SEBI filing`,
        taskTypeId: type.id,
        priority: Priority.CRITICAL,
        estimatedMinutes: 90,
        status: ApprovalStatus.APPROVED,
        isActive: true,
        isPaused: false,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 22,
        leadTimeDays: 0,
        startDate: d("2026-01-01"),
      },
    });
    activityId = activity.id;
  }, 60_000);

  afterAll(async () => {
    const ids = (await prisma.task.findMany({ where: { deskCardActivityId: activityId }, select: { id: true } })).map(
      (t) => t.id,
    );
    if (ids.length) {
      await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: ids } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "Task", entityId: { in: ids } } });
      await prisma.task.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.deskCardActivity.deleteMany({ where: { deskCardId } });
    await prisma.deskCard.deleteMany({ where: { id: deskCardId } });
    await app?.close();
  }, 60_000);

  it("generates an instance assigned to the card holder", async () => {
    const result = await recurrence.generateDue(d("2026-02-01"));
    expect(result.errors).toEqual([]);

    const tasks = await prisma.task.findMany({ where: { deskCardActivityId: activityId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigneeEmployeeId).toBe(employeeId);
    expect(tasks[0].origin).toBe(TaskOrigin.DESK_CARD);
    expect(tasks[0].status).toBe(TaskStatus.ASSIGNED);
    // Inherits the governed effort estimate rather than re-deriving it.
    expect(tasks[0].estimatedMinutes).toBe(90);
    expect(tasks[0].reference).toMatch(/^WP-\d{6}$/);
  });

  it("is idempotent - a second pass on the same day creates nothing", async () => {
    const before = await prisma.task.count({ where: { deskCardActivityId: activityId } });
    await recurrence.generateDue(d("2026-02-01"));
    await recurrence.generateDue(d("2026-02-01"));
    const after = await prisma.task.count({ where: { deskCardActivityId: activityId } });
    expect(after).toBe(before);
  });

  it("records the generation in the audit trail as a SYSTEM action", async () => {
    const task = await prisma.task.findFirst({ where: { deskCardActivityId: activityId } });
    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "Task", entityId: task!.id, action: "generated_from_activity" },
    });
    expect(entry).not.toBeNull();
    expect(entry!.actorType).toBe("SYSTEM");
    expect(entry!.actorId).toBeNull();
  });

  it("catches up missed periods after an outage, once each", async () => {
    await recurrence.generateDue(d("2026-06-01"));
    const dues = (
      await prisma.task.findMany({
        where: { deskCardActivityId: activityId },
        select: { dueDate: true },
        orderBy: { dueDate: "asc" },
      })
    ).map((t) => t.dueDate.toISOString().slice(0, 10));

    // Jan..May, with weekend dates pulled back onto a working day.
    expect(new Set(dues).size).toBe(dues.length);
    expect(dues).toContain("2026-01-22");
    expect(dues).toContain("2026-05-22");
  });

  it("stops generating while paused, and does not touch existing instances", async () => {
    const before = await prisma.task.count({ where: { deskCardActivityId: activityId } });
    await prisma.deskCardActivity.update({ where: { id: activityId }, data: { isPaused: true } });

    await recurrence.generateDue(d("2026-12-31"));

    const after = await prisma.task.count({ where: { deskCardActivityId: activityId } });
    expect(after).toBe(before);

    await prisma.deskCardActivity.update({ where: { id: activityId }, data: { isPaused: false } });
  });

  it("stops generating when the card has no holder", async () => {
    await prisma.deskCard.update({ where: { id: deskCardId }, data: { holderEmployeeId: null } });
    const before = await prisma.task.count({ where: { deskCardActivityId: activityId } });

    await recurrence.generateDue(d("2026-12-31"));

    expect(await prisma.task.count({ where: { deskCardActivityId: activityId } })).toBe(before);
    await prisma.deskCard.update({ where: { id: deskCardId }, data: { holderEmployeeId: employeeId } });
  });

  it("flags an unstarted overdue instance as Missed (TM-FR-003)", async () => {
    await recurrence.generateDue(d("2026-07-01"));
    const result = await recurrence.generateDue(d("2026-08-01"));
    expect(result.tasksMarkedMissed).toBeGreaterThan(0);

    const missed = await prisma.task.count({ where: { deskCardActivityId: activityId, isMissed: true } });
    expect(missed).toBeGreaterThan(0);
  });
});
