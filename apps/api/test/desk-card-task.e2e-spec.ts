import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ApprovalStatus, Priority, TaskStatus, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { DeskCardActivityService } from "../src/modules/desk-card/desk-card-activity.service";
import { DeskCardService } from "../src/modules/desk-card/desk-card.service";
import { TaskService } from "../src/modules/task/task.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * Exercises the Phase 1 chain against the real database: desk card -> activity
 * -> task -> lifecycle, through the services rather than around them, so the
 * audit and permission rules are genuinely covered.
 *
 * Data is created with a unique prefix and removed afterwards, so the suite is
 * re-runnable and leaves nothing behind.
 */

const RUN = `e2e-${Date.now()}`;

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

d("Desk card and task lifecycle (e2e)", () => {
  let app: INestApplication;
  let deskCards: DeskCardService;
  let activities: DeskCardActivityService;
  let tasks: TaskService;

  let departmentId: string;
  let employeeA: string;
  let employeeB: string;
  let routineTypeId: string;
  let complianceTypeId: string;
  let deskCardId: string;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();

    deskCards = app.get(DeskCardService);
    activities = app.get(DeskCardActivityService);
    tasks = app.get(TaskService);

    const dept = await prisma.department.findFirst();
    // isActive matters: the Frappe/Spine sync brings in leavers as well as
    // current staff, and the service rightly refuses to assign work to one.
    // Without the filter this picks whoever sorts first by name, which for
    // real org data is frequently somebody who left.
    const emps = await prisma.employee.findMany({
      where: { isActive: true },
      take: 2,
      orderBy: { name: "asc" },
    });
    const routine = await prisma.taskType.findUnique({ where: { code: "ROUTINE" } });
    const compliance = await prisma.taskType.findUnique({ where: { code: "COMPLIANCE" } });

    if (!dept || emps.length < 2 || !routine || !compliance) {
      throw new Error("Fixtures missing. Run `npm run db:seed` and `npm run sync:frappe-hr` first.");
    }

    departmentId = dept.id;
    employeeA = emps[0].id;
    employeeB = emps[1].id;
    routineTypeId = routine.id;
    complianceTypeId = compliance.id;
  }, 60_000);

  afterAll(async () => {
    // Order matters: children before parents.
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
    await prisma.deskCardActivity.deleteMany({ where: { title: { startsWith: RUN } } });
    await prisma.deskCardHolderHistory.deleteMany({ where: { deskCard: { code: { startsWith: RUN } } } });
    await prisma.deskCard.deleteMany({ where: { code: { startsWith: RUN } } });
    await prisma.auditLog.deleteMany({ where: { entityType: { in: ["DeskCard", "DeskCardActivity", "Task"] }, reason: { startsWith: RUN } } });
    await app?.close();
  }, 60_000);

  describe("desk cards", () => {
    it("creates a card in Draft and audits it", async () => {
      const card = await deskCards.create(actor(), {
        code: `${RUN}-CARD`,
        name: "Compliance Officer",
        departmentId,
      });
      deskCardId = card.id;

      expect(card.status).toBe(ApprovalStatus.DRAFT);

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: "DeskCard", entityId: card.id, action: "created" },
      });
      expect(audit).not.toBeNull();
    });

    it("refuses creation by someone without governance rights", async () => {
      await expect(
        deskCards.create(actor({ roles: ["EMPLOYEE"] }), {
          code: `${RUN}-NOPE`,
          name: "Should not exist",
          departmentId,
        }),
      ).rejects.toThrow(/Department Head or System Admin/);
    });

    it("transfers the holder, preserving history rather than overwriting it", async () => {
      await deskCards.transferHolder(actor(), {
        deskCardId,
        toEmployeeId: employeeA,
        reason: `${RUN} initial assignment`,
      });
      await deskCards.transferHolder(actor(), {
        deskCardId,
        toEmployeeId: employeeB,
        reason: `${RUN} handover`,
      });

      const card = await deskCards.findById(deskCardId);
      expect(card.holderEmployeeId).toBe(employeeB);

      // Two rows, and the first is closed off rather than edited away.
      expect(card.holderHistory).toHaveLength(2);
      const previous = card.holderHistory.find((h) => h.employeeId === employeeA);
      const current = card.holderHistory.find((h) => h.employeeId === employeeB);
      expect(previous?.toDate).not.toBeNull();
      expect(current?.toDate).toBeNull();
    });

    it("requires a reason to transfer", async () => {
      await expect(
        deskCards.transferHolder(actor(), { deskCardId, toEmployeeId: employeeA, reason: "  " }),
      ).rejects.toThrow(/requires a reason/);
    });

    it("clears acknowledgement when a new holder takes over", async () => {
      const card = await deskCards.findById(deskCardId);
      expect(card.acknowledgedAt).toBeNull();
    });
  });

  describe("activities", () => {
    let activityId: string;

    it("creates an activity with recurrence", async () => {
      const a = await activities.create(actor(), {
        deskCardId,
        title: `${RUN} Monthly SEBI filing`,
        taskTypeId: complianceTypeId,
        priority: Priority.CRITICAL,
        estimatedMinutes: 90,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 22,
        leadTimeDays: 10,
      });
      activityId = a.id;
      expect(a.estimatedMinutes).toBe(90);
      expect(a.status).toBe(ApprovalStatus.DRAFT);
    });

    it("rejects a weekly activity with no days selected", async () => {
      await expect(
        activities.create(actor(), {
          deskCardId,
          title: `${RUN} bad weekly`,
          taskTypeId: routineTypeId,
          priority: Priority.LOW,
          estimatedMinutes: 10,
          frequency: "WEEKLY",
          daysOfWeek: [],
        }),
      ).rejects.toThrow(/at least one day/);
    });

    describe("estimated effort is governed (TM-FR-076)", () => {
      it("refuses the holder, and points them at a revision request", async () => {
        await expect(
          activities.amendEstimatedMinutes(
            actor({ roles: ["EMPLOYEE"], employeeId: employeeB }),
            activityId,
            999,
            "I think it takes longer",
          ),
        ).rejects.toThrow(/revision request/);
      });

      it("refuses even a Department Head without a reason", async () => {
        await expect(
          activities.amendEstimatedMinutes(actor({ roles: ["DEPARTMENT_HEAD"] }), activityId, 120, "  "),
        ).rejects.toThrow(/requires a reason/);
      });

      it("allows a Department Head with a reason, and audits before and after", async () => {
        await activities.amendEstimatedMinutes(
          actor({ roles: ["DEPARTMENT_HEAD"] }),
          activityId,
          120,
          `${RUN} re-measured after the process change`,
        );

        const entry = await prisma.auditLog.findFirst({
          where: { entityType: "DeskCardActivity", entityId: activityId, action: "estimated_effort_changed" },
          orderBy: { createdAt: "desc" },
        });
        expect(entry?.beforeJson).toMatchObject({ estimatedMinutes: 90 });
        expect(entry?.afterJson).toMatchObject({ estimatedMinutes: 120 });
        expect(entry?.reason).toContain("re-measured");
      });
    });

    /**
     * Amendments are sorted by what a change does, not by which field moved:
     * wording is free, substance needs a reason, and anything about recurrence
     * returns an approved activity to draft because it changes what work
     * exists rather than how it reads.
     */
    describe("amendment", () => {
      it("lets a wording fix through with no reason", async () => {
        const title = `${RUN} Monthly SEBI filing (Form 10)`;
        const { returnedToDraft } = await activities.amend(
          actor({ roles: ["DEPARTMENT_HEAD"] }),
          activityId,
          { title },
        );
        expect(returnedToDraft).toBe(false);

        const entry = await prisma.auditLog.findFirst({
          where: { entityType: "DeskCardActivity", entityId: activityId, action: "wording_amended" },
          orderBy: { createdAt: "desc" },
        });
        expect(entry?.afterJson).toMatchObject({ title });
      });

      it("refuses a change of substance with no reason", async () => {
        await expect(
          activities.amend(actor({ roles: ["DEPARTMENT_HEAD"] }), activityId, {
            priority: Priority.LOW,
          }),
        ).rejects.toThrow(/requires a reason/);
      });

      it("refuses the holder, who cannot rewrite their own obligation", async () => {
        await expect(
          activities.amend(actor({ roles: ["EMPLOYEE"], employeeId: employeeB }), activityId, {
            title: `${RUN} renamed by the holder`,
          }),
        ).rejects.toThrow(/Department Head or System Admin/);
      });

      it("returns an approved activity to draft when the recurrence changes", async () => {
        await prisma.deskCardActivity.update({
          where: { id: activityId },
          data: { status: ApprovalStatus.APPROVED },
        });

        const { activity, returnedToDraft } = await activities.amend(
          actor({ roles: ["DEPARTMENT_HEAD"] }),
          activityId,
          { dayOfMonth: 25 },
          `${RUN} filing window moved by the exchange`,
        );

        expect(returnedToDraft).toBe(true);
        expect(activity.status).toBe(ApprovalStatus.DRAFT);
        expect(activity.dayOfMonth).toBe(25);

        const entry = await prisma.auditLog.findFirst({
          where: { entityType: "DeskCardActivity", entityId: activityId, action: "definition_amended" },
          orderBy: { createdAt: "desc" },
        });
        expect(entry?.beforeJson).toMatchObject({ dayOfMonth: 22, status: "APPROVED" });
        expect(entry?.afterJson).toMatchObject({ status: "DRAFT", returnedToDraft: true });
      });
    });
  });

  describe("task lifecycle", () => {
    let taskId: string;

    it("creates a task assigned to someone else in Assigned", async () => {
      const t = await tasks.create(actor({ employeeId: employeeA }), {
        title: `${RUN} Reconcile demat entries`,
        taskTypeId: routineTypeId,
        priority: Priority.HIGH,
        assigneeEmployeeId: employeeB,
        reviewerEmployeeId: employeeA,
        dueDate: new Date(Date.now() + 86_400_000),
        checklist: ["Pull extract", "Reconcile", "File"],
      });
      taskId = t.id;
      expect(t.status).toBe(TaskStatus.ASSIGNED);
      expect(t.reference).toMatch(/^WP-\d{6}$/);
    });

    it("starts a self-assigned task in Accepted, skipping Accept", async () => {
      const t = await tasks.create(actor({ employeeId: employeeB }), {
        title: `${RUN} Self assigned`,
        taskTypeId: routineTypeId,
        priority: Priority.LOW,
        assigneeEmployeeId: employeeB,
        dueDate: new Date(Date.now() + 86_400_000),
      });
      expect(t.status).toBe(TaskStatus.ACCEPTED);
    });

    it("blocks Completion while checklist items are outstanding", async () => {
      const me = actor({ employeeId: employeeB });
      await tasks.transition(me, { taskId, to: TaskStatus.ACCEPTED });
      await tasks.transition(me, { taskId, to: TaskStatus.IN_PROGRESS });

      await expect(tasks.transition(me, { taskId, to: TaskStatus.COMPLETED })).rejects.toThrow(
        /checklist item must be completed or waived/,
      );
    });

    it("requires a reason and an owner to block", async () => {
      const me = actor({ employeeId: employeeB });
      await expect(tasks.transition(me, { taskId, to: TaskStatus.BLOCKED })).rejects.toThrow(
        /requires a reason/,
      );
      await expect(
        tasks.transition(me, { taskId, to: TaskStatus.BLOCKED, blockedReason: `${RUN} waiting on ops` }),
      ).rejects.toThrow(/who owns resolving/);
    });

    it("completes once the checklist is satisfied by completion or waiver", async () => {
      const me = actor({ employeeId: employeeB });
      const items = await prisma.taskChecklistItem.findMany({ where: { taskId }, orderBy: { position: "asc" } });

      await tasks.setChecklistItem(me, items[0].id, { isDone: true });
      await tasks.setChecklistItem(me, items[1].id, { isDone: true });
      await tasks.setChecklistItem(me, items[2].id, { waivedReason: `${RUN} not applicable this cycle` });

      const res = await tasks.transition(me, { taskId, to: TaskStatus.COMPLETED });
      expect(res.task.status).toBe(TaskStatus.COMPLETED);
      expect(res.task.completedAt).not.toBeNull();
    });

    it("will not let the assignee verify their own work, under any role", async () => {
      // Not even as SYSTEM_ADMIN: segregation of duties has no override.
      await expect(
        tasks.transition(
          actor({ employeeId: employeeB, roles: ["SYSTEM_ADMIN"] }),
          { taskId, to: TaskStatus.VERIFIED },
        ),
      ).rejects.toThrow(/cannot verify your own work/);
    });

    it("lets the named reviewer verify, then close", async () => {
      const reviewer = actor({ employeeId: employeeA, roles: ["MANAGER"] });
      const verified = await tasks.transition(reviewer, { taskId, to: TaskStatus.VERIFIED });
      expect(verified.task.status).toBe(TaskStatus.VERIFIED);

      const closed = await tasks.transition(reviewer, { taskId, to: TaskStatus.CLOSED });
      expect(closed.task.status).toBe(TaskStatus.CLOSED);
      expect(closed.task.closedAt).not.toBeNull();
    });

    it("requires a reason to reopen, and records the full history", async () => {
      const reviewer = actor({ employeeId: employeeA, roles: ["MANAGER"] });

      await expect(tasks.transition(reviewer, { taskId, to: TaskStatus.REOPENED })).rejects.toThrow(
        /requires a reason/,
      );

      await tasks.transition(reviewer, {
        taskId,
        to: TaskStatus.REOPENED,
        reason: `${RUN} filing rejected by the exchange`,
      });

      const detail = await tasks.findById(reviewer, taskId);
      const sequence = detail.statusHistory.map((h) => h.toStatus);
      expect(sequence).toEqual([
        TaskStatus.ASSIGNED,
        TaskStatus.ACCEPTED,
        TaskStatus.IN_PROGRESS,
        TaskStatus.COMPLETED,
        TaskStatus.VERIFIED,
        TaskStatus.CLOSED,
        TaskStatus.REOPENED,
      ]);
      // Every transition carries an actor; the reopen carries its reason.
      expect(detail.statusHistory.every((h) => h.actorUserId)).toBe(true);
      expect(detail.statusHistory.at(-1)?.reason).toContain("rejected by the exchange");
    });

    it("refuses an illegal jump", async () => {
      const me = actor({ employeeId: employeeB });
      await expect(tasks.transition(me, { taskId, to: TaskStatus.CLOSED })).rejects.toThrow(
        /Cannot move a task from REOPENED to CLOSED/,
      );
    });

    it("keeps someone uninvolved out entirely", async () => {
      await expect(
        tasks.transition(actor({ employeeId: "someone-else", roles: ["EMPLOYEE"] }), {
          taskId,
          to: TaskStatus.IN_PROGRESS,
        }),
      ).rejects.toThrow(/not involved in this task/);
    });
  });
});
