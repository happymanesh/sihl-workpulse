import { ForbiddenException, INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Priority, TaskFlagType, TaskStatus, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { AnalyticsService } from "../src/modules/analytics/analytics.service";
import { FlagService } from "../src/modules/analytics/flag.service";
import { MisService } from "../src/modules/analytics/mis.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

const RUN = `ana-${Date.now()}`;
const canRun = Boolean(process.env.DATABASE_URL);

function actor(roles: string[], employeeId: string | null = null): AuthenticatedUser {
  return {
    id: `${RUN}-user-${roles.join("-")}`,
    synapseUserUid: 1,
    username: "tester",
    fullName: "Tester",
    companyCode: "SIHL",
    hierarchyCode: "9999",
    roles,
    employeeId,
    isEmployeeUnlinked: false,
  } as AuthenticatedUser;
}

const PERIOD_START = new Date("2026-03-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-03-31T23:59:59.999Z");

(canRun ? describe : describe.skip)("Analytics, confidentiality and flags (e2e)", () => {
  let app: INestApplication;
  let mis: MisService;
  let analytics: AnalyticsService;
  let flags: FlagService;

  let empId: string;
  let otherDeptEmpId: string;
  let deptId: string;
  let otherDeptId: string;
  let taskTypeId: string;
  const taskIds: string[] = [];
  const flagIds: string[] = [];

  const makeTask = async (over: Partial<{
    title: string;
    status: TaskStatus;
    priority: Priority;
    isConfidential: boolean;
    estimatedMinutes: number;
    completedAt: Date | null;
    assigneeEmployeeId: string;
    departmentId: string;
  }> = {}) => {
    const seq = taskIds.length + 1;
    const task = await prisma.task.create({
      data: {
        reference: `${RUN}-${seq}`,
        title: over.title ?? `${RUN} task ${seq}`,
        taskTypeId,
        assigneeEmployeeId: over.assigneeEmployeeId ?? empId,
        departmentId: over.departmentId ?? deptId,
        priority: over.priority ?? Priority.MEDIUM,
        status: over.status ?? TaskStatus.ASSIGNED,
        isConfidential: over.isConfidential ?? false,
        estimatedMinutes: over.estimatedMinutes ?? 60,
        dueDate: new Date("2026-03-15T12:00:00.000Z"),
        completedAt: over.completedAt ?? null,
      },
    });
    taskIds.push(task.id);
    return task;
  };

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    mis = app.get(MisService);
    analytics = app.get(AnalyticsService);
    flags = app.get(FlagService);

    const type = await prisma.taskType.findUnique({ where: { code: "OPERATIONAL" } });
    const dept = await prisma.department.findFirst();
    const emp = await prisma.employee.findFirst({ where: { isActive: true, departmentId: dept?.id } });
    if (!type || !dept || !emp) throw new Error("fixtures missing");
    taskTypeId = type.id;
    deptId = dept.id;
    empId = emp.id;

    const other = await prisma.department.findFirst({ where: { id: { not: dept.id } } });
    otherDeptId = other?.id ?? dept.id;
    const otherEmp = await prisma.employee.findFirst({
      where: { isActive: true, departmentId: otherDeptId, id: { not: emp.id } },
    });
    otherDeptEmpId = otherEmp?.id ?? emp.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.taskFlag.deleteMany({ where: { OR: [{ id: { in: flagIds } }, { taskId: { in: taskIds } }] } });
    await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Task", entityId: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.analyticsPeriod.deleteMany({
      where: { periodStart: PERIOD_START, periodEnd: PERIOD_END },
    });
    await app.close();
  }, 60_000);

  // -------------------------------------------------------------------------

  describe("confidential work in aggregates (TM-FR-058)", () => {
    it("is excluded for management, and the exclusion is disclosed", async () => {
      await makeTask({ isConfidential: false });
      await makeTask({ isConfidential: true });

      const asExec = await mis.enterprise(actor(["EXECUTIVE"]), PERIOD_START, PERIOD_END);
      const asAudit = await mis.enterprise(actor(["AUDIT"]), PERIOD_START, PERIOD_END);

      expect(asAudit.total).toBeGreaterThan(asExec.total);
      // A total that looks wrong must be explainable, not merely smaller.
      expect(asExec.confidentialExcluded).toBeGreaterThan(0);
      expect(asAudit.confidentialExcluded).toBe(0);
    });

    it("does not leak confidential tasks into the drill-down list", async () => {
      const secret = await makeTask({ isConfidential: true, title: `${RUN} secret` });

      const execRows = await mis.tasksFor(actor(["EXECUTIVE"]), { departmentId: deptId }, PERIOD_START, PERIOD_END);
      const auditRows = await mis.tasksFor(actor(["AUDIT"]), { departmentId: deptId }, PERIOD_START, PERIOD_END);

      expect(execRows.map((t) => t.id)).not.toContain(secret.id);
      expect(auditRows.map((t) => t.id)).toContain(secret.id);
    });

    it("hides confidential work from SYSTEM_ADMIN too", async () => {
      // Administering the system is not a reason to read HR or legal matters.
      const secret = await makeTask({ isConfidential: true });
      const rows = await mis.tasksFor(actor(["SYSTEM_ADMIN"]), { departmentId: deptId }, PERIOD_START, PERIOD_END);
      expect(rows.map((t) => t.id)).not.toContain(secret.id);
    });
  });

  describe("drill-down re-checks access at every level (TM-FR-055)", () => {
    it("refuses a Department Head drilling into another department", async () => {
      if (otherDeptId === deptId) return; // single-department fixture
      const head = actor(["DEPARTMENT_HEAD"], empId);
      await expect(mis.byEmployee(head, otherDeptId, PERIOD_START, PERIOD_END)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("allows a Department Head into their own department", async () => {
      const head = actor(["DEPARTMENT_HEAD"], empId);
      await expect(mis.byEmployee(head, deptId, PERIOD_START, PERIOD_END)).resolves.toBeDefined();
    });

    it("marks a limited scope as limited", async () => {
      const head = await mis.enterprise(actor(["DEPARTMENT_HEAD"], empId), PERIOD_START, PERIOD_END);
      const exec = await mis.enterprise(actor(["EXECUTIVE"]), PERIOD_START, PERIOD_END);
      expect(head.scopeIsLimited).toBe(true);
      expect(exec.scopeIsLimited).toBe(false);
    });
  });

  describe("flagged work leaves the calculation (Addendum 02 4.7)", () => {
    it("is excluded from both numerator and denominator while OPEN", async () => {
      const clean = await analytics.computeFor(empId, PERIOD_START, PERIOD_END);

      const t = await makeTask({ status: TaskStatus.ASSIGNED, estimatedMinutes: 600 });
      const withTask = await analytics.computeFor(empId, PERIOD_START, PERIOD_END);
      expect(withTask.wtuDue).toBeGreaterThan(clean.wtuDue);

      const flag = await prisma.taskFlag.create({
        data: {
          taskId: t.id,
          subjectEmployeeId: empId,
          flagType: TaskFlagType.CLOSED_WITHOUT_EVIDENCE,
          detail: `${RUN} test flag`,
        },
      });
      flagIds.push(flag.id);

      const flagged = await analytics.computeFor(empId, PERIOD_START, PERIOD_END);
      // The work is gone from the denominator, not counted as a failure.
      expect(flagged.wtuDue).toBeCloseTo(clean.wtuDue, 5);
      expect(flagged.wtuFlagged).toBeGreaterThan(0);
      expect(flagged.excludedFlaggedTasks).toBeGreaterThan(0);
    });

    it("restores the work when the flag is dismissed", async () => {
      const t = await makeTask({ estimatedMinutes: 600 });
      const flag = await prisma.taskFlag.create({
        data: {
          taskId: t.id,
          subjectEmployeeId: empId,
          flagType: TaskFlagType.ABNORMAL_TASK_SPLITTING,
          detail: `${RUN} dismissible`,
        },
      });
      flagIds.push(flag.id);

      const whileOpen = await analytics.computeFor(empId, PERIOD_START, PERIOD_END);

      await flags.review(actor(["DEPARTMENT_HEAD"], empId), flag.id, "DISMISS", "Reviewed, legitimate");

      const afterDismiss = await analytics.computeFor(empId, PERIOD_START, PERIOD_END);
      // Being wrongly suspected costs the employee nothing.
      expect(afterDismiss.wtuDue).toBeGreaterThan(whileOpen.wtuDue);
    });
  });

  describe("flag review", () => {
    const newFlag = async () => {
      const f = await prisma.taskFlag.create({
        data: {
          subjectEmployeeId: empId,
          flagType: TaskFlagType.REASSIGNMENT_PATTERN,
          detail: `${RUN} review case`,
        },
      });
      flagIds.push(f.id);
      return f;
    };

    it("requires a note in both directions", async () => {
      const f = await newFlag();
      await expect(
        flags.review(actor(["DEPARTMENT_HEAD"], empId), f.id, "DISMISS", "   "),
      ).rejects.toThrow();
    });

    it("refuses a second review of the same flag", async () => {
      const f = await newFlag();
      const head = actor(["DEPARTMENT_HEAD"], empId);
      await flags.review(head, f.id, "ACCEPT", "Upheld");
      await expect(flags.review(head, f.id, "DISMISS", "Changed my mind")).rejects.toThrow();
    });

    it("does not let SYSTEM_ADMIN adjudicate conduct", async () => {
      const f = await newFlag();
      await expect(
        flags.review(actor(["SYSTEM_ADMIN"]), f.id, "DISMISS", "Tidying up"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("writes an audit entry naming who decided and why", async () => {
      const f = await newFlag();
      await flags.review(actor(["AUDIT"], empId), f.id, "ACCEPT", "Pattern confirmed with the desk");

      const entries = await prisma.auditLog.findMany({ where: { entityType: "TaskFlag", entityId: f.id } });
      const upheld = entries.find((e) => e.action === "UPHOLD");
      expect(upheld).toBeDefined();
      expect(upheld?.reason).toBe("Pattern confirmed with the desk");

      await prisma.auditLog.deleteMany({ where: { entityType: "TaskFlag", entityId: f.id } });
    });

    it("lets an employee see flags about themselves without review standing", async () => {
      await newFlag();
      const own = await flags.list(actor(["EMPLOYEE"], empId), { subjectEmployeeId: empId });
      expect(own.length).toBeGreaterThan(0);
    });

    it("does not let an employee list flags about someone else", async () => {
      await expect(
        flags.list(actor(["EMPLOYEE"], empId), { subjectEmployeeId: otherDeptEmpId }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("the report card", () => {
    it("is symmetric: the subject sees exactly what a manager sees", async () => {
      await analytics.computeFor(empId, PERIOD_START, PERIOD_END);

      const asSelf = await analytics.reportCard(actor(["EMPLOYEE"], empId), empId, PERIOD_START, PERIOD_END);
      const asExec = await analytics.reportCard(actor(["EXECUTIVE"]), empId, PERIOD_START, PERIOD_END);

      expect(asSelf.period).toEqual(asExec.period);
      expect(asSelf.openFlags.length).toBe(asExec.openFlags.length);
    });

    it("ships the dispute route alongside the numbers (TM-FR-124)", async () => {
      const card = await analytics.reportCard(actor(["EMPLOYEE"], empId), empId, PERIOD_START, PERIOD_END);
      expect(card.disputeWindowDays).toBeGreaterThan(0);
    });

    it("refuses a peer with no standing", async () => {
      if (otherDeptEmpId === empId) return;
      await expect(
        analytics.reportCard(actor(["EMPLOYEE"], otherDeptEmpId), empId, PERIOD_START, PERIOD_END),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("reports insufficient data rather than a low result below the floor", async () => {
      const lonely = await prisma.employee.findFirst({
        where: { isActive: true, id: { notIn: [empId, otherDeptEmpId] } },
      });
      if (!lonely) return;

      await analytics.computeFor(lonely.id, PERIOD_START, PERIOD_END);
      const card = await analytics.reportCard(actor(["EXECUTIVE"]), lonely.id, PERIOD_START, PERIOD_END);
      // Someone on leave and someone performing badly must not look the same.
      expect(card.insufficientData).toBe(true);
    });
  });

  describe("stored periods", () => {
    it("stores the components but no composite score", async () => {
      const row = await analytics.computeFor(empId, PERIOD_START, PERIOD_END);
      expect(row.execution).not.toBeNull();
      expect(Object.keys(row)).not.toContain("score");
      expect(Object.keys(row)).not.toContain("compositeScore");
    });

    it("is idempotent - recomputing the same period updates one row", async () => {
      await analytics.computeFor(empId, PERIOD_START, PERIOD_END);
      await analytics.computeFor(empId, PERIOD_START, PERIOD_END);
      const rows = await prisma.analyticsPeriod.findMany({
        where: { employeeId: empId, periodStart: PERIOD_START, periodEnd: PERIOD_END },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("flag de-duplication", () => {
    it("does not raise the same finding twice for one window", async () => {
      const candidate = {
        flagType: TaskFlagType.ABNORMAL_TASK_SPLITTING,
        subjectEmployeeId: empId,
        taskId: null,
        detail: `${RUN} duplicate check`,
      };

      const first = await flags.raise([candidate], PERIOD_START, PERIOD_END);
      const second = await flags.raise([candidate], PERIOD_START, PERIOD_END);

      const raised = await prisma.taskFlag.findMany({ where: { detail: candidate.detail } });
      raised.forEach((f) => flagIds.push(f.id));

      expect(first.created).toBe(1);
      // A reviewer must not be buried under re-runs of a finding already shown.
      expect(second.created).toBe(0);
      expect(second.skipped).toBe(1);
    });
  });
});
