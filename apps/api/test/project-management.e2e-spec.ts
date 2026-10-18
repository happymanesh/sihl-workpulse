import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Priority, ProjectHealth, ProjectStatus, TaskStatus, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { ProjectService } from "../src/modules/project/project.service";
import { TaskService } from "../src/modules/task/task.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * Running a project: milestones, risks and the tasks that count towards it.
 *
 * The thread running through these is that health is derived, not declared. A
 * milestone slips and the project goes Red without anybody typing Red; a
 * blocking risk stops it closing. That only works if the three inputs can
 * actually be populated, which is what this covers.
 */

const RUN = `e2e-prj-${Date.now()}`;

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

const DAY = 86_400_000;

d("Running a project (e2e)", () => {
  let app: INestApplication;
  let projects: ProjectService;
  let tasks: TaskService;

  let projectId: string;
  let employeeA: string;
  let employeeB: string;
  let routineTypeId: string;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();

    projects = app.get(ProjectService);
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

    const project = await projects.create(actor(), {
      code: `${RUN}`.slice(0, 40),
      name: `${RUN} Gateway upgrade`,
      ownerEmployeeId: employeeA,
      projectManagerEmployeeId: employeeB,
      startDate: new Date(),
      targetEndDate: new Date(Date.now() + 60 * DAY),
    });
    projectId = project.id;
  }, 90_000);

  afterAll(async () => {
    if (projectId) {
      await prisma.task.updateMany({ where: { projectId }, data: { projectId: null } });
      await prisma.milestone.deleteMany({ where: { projectId } });
      await prisma.projectRisk.deleteMany({ where: { projectId } });
      await prisma.raciAssignment.deleteMany({ where: { projectId } });
      await prisma.daciAssignment.deleteMany({ where: { decision: { projectId } } });
      await prisma.decision.deleteMany({ where: { projectId } });
      await prisma.project.delete({ where: { id: projectId } }).catch(() => null);
    }
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

  describe("milestones", () => {
    let milestoneId: string;
    let missedId: string;

    it("refuses anybody below a project manager", async () => {
      await expect(
        projects.addMilestone(actor({ roles: ["EMPLOYEE"] }), {
          projectId,
          name: `${RUN} nope`,
          targetDate: new Date(Date.now() + DAY),
        }),
      ).rejects.toThrow(/project manager or above/);
    });

    it("adds one and leaves a project with nothing wrong with it green", async () => {
      const m = await projects.addMilestone(actor(), {
        projectId,
        name: `${RUN} UAT sign-off`,
        targetDate: new Date(Date.now() + 20 * DAY),
      });
      milestoneId = m.id;

      const p = await projects.byId(projectId);
      expect(p.health).toBe(ProjectHealth.GREEN);
      expect(p.milestones.some((x) => x.id === milestoneId)).toBe(true);
    });

    it("turns the project red the moment a committed date is past", async () => {
      const m = await projects.addMilestone(actor(), {
        projectId,
        name: `${RUN} exchange certification`,
        targetDate: new Date(Date.now() - 2 * DAY),
      });
      missedId = m.id;

      const p = await projects.byId(projectId);
      expect(p.health).toBe(ProjectHealth.RED);
      expect(p.milestones.find((x) => x.id === missedId)?.isMissed).toBe(true);
      expect(p.healthReasons.join(" ")).toMatch(/milestone/i);
    });

    it("recovers when the milestone is reported met", async () => {
      await projects.setMilestoneComplete(actor(), missedId, true);
      const p = await projects.byId(projectId);
      expect(p.health).toBe(ProjectHealth.GREEN);
    });

    it("will not delete a milestone that was reported met", async () => {
      await expect(projects.removeMilestone(actor(), missedId)).rejects.toThrow(/reported as met/);
    });

    it("deletes one that was never met", async () => {
      await projects.removeMilestone(actor(), milestoneId);
      const p = await projects.byId(projectId);
      expect(p.milestones.some((x) => x.id === milestoneId)).toBe(false);
    });
  });

  describe("risks and issues", () => {
    let riskId: string;

    it("goes amber on one blocking issue", async () => {
      const r = await projects.raiseRisk(actor(), {
        projectId,
        title: `${RUN} exchange has not confirmed the test window`,
        isBlocking: true,
      });
      riskId = r.id;

      const p = await projects.byId(projectId);
      expect(p.health).toBe(ProjectHealth.AMBER);
    });

    it("goes red on two", async () => {
      const second = await projects.raiseRisk(actor(), {
        projectId,
        title: `${RUN} vendor licence not signed`,
        isBlocking: true,
      });

      let p = await projects.byId(projectId);
      expect(p.health).toBe(ProjectHealth.RED);

      await projects.resolveRisk(actor(), second.id, `${RUN} licence signed on the 14th`);
      p = await projects.byId(projectId);
      expect(p.health).toBe(ProjectHealth.AMBER);
    });

    it("stops the project being completed while one is open, and says which", async () => {
      await expect(
        projects.setStatus(actor(), projectId, ProjectStatus.COMPLETED, `${RUN} trying to close`),
      ).rejects.toThrow(/test window/);
    });

    it("needs a reason to escalate or stand down, and a note to resolve", async () => {
      await expect(projects.setRiskBlocking(actor(), riskId, false, "  ")).rejects.toThrow(/why this is/);
      await expect(projects.resolveRisk(actor(), riskId, " ")).rejects.toThrow(/how it was resolved/);
    });

    it("records how it was resolved, and lets the project close", async () => {
      await projects.resolveRisk(actor(), riskId, `${RUN} window confirmed for the 3rd`);

      const p = await projects.byId(projectId);
      expect(p.health).toBe(ProjectHealth.GREEN);
      expect(p.risks.find((r) => r.id === riskId)?.resolutionNote).toContain("window confirmed");

      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "Project", entityId: projectId, action: "risk_resolved" },
        orderBy: { createdAt: "desc" },
      });
      expect(entry?.reason).toContain("window confirmed");
    });
  });

  describe("the tasks that count towards it", () => {
    let taskId: string;
    let statusBeforeDetach: TaskStatus;

    it("attaches an existing task, and the project's figures move", async () => {
      const t = await tasks.create(actor({ employeeId: employeeA }), {
        title: `${RUN} Write the FIX conformance pack`,
        taskTypeId: routineTypeId,
        priority: Priority.HIGH,
        assigneeEmployeeId: employeeA,
        dueDate: new Date(Date.now() + 5 * DAY),
      });
      taskId = t.id;

      await projects.attachTask(actor(), projectId, taskId);

      const p = await projects.byId(projectId);
      expect(p.tasks.some((x) => x.id === taskId)).toBe(true);
      expect(p.healthInputs.totalTasks).toBe(1);
    });

    it("does not offer a task that is already in a project", async () => {
      const offered = await projects.unassignedTasks();
      expect(offered.some((t) => t.id === taskId)).toBe(false);
    });

    it("refuses to take a task that belongs to another project", async () => {
      const other = await projects.create(actor(), {
        code: `${RUN}-2`.slice(0, 40),
        name: `${RUN} second`,
        ownerEmployeeId: employeeA,
        projectManagerEmployeeId: employeeB,
      });
      await expect(projects.attachTask(actor(), other.id, taskId)).rejects.toThrow(
        /already belongs to another project/,
      );
      await prisma.project.delete({ where: { id: other.id } });
    });

    it("turns the project red when enough of its work is overdue", async () => {
      await prisma.task.update({
        where: { id: taskId },
        data: { dueDate: new Date(Date.now() - DAY) },
      });
      const { health } = await projects.recalculateHealth(projectId);
      expect(health).toBe(ProjectHealth.RED);
    });

    it("needs a reason to take a task back out", async () => {
      await expect(projects.detachTask(actor(), taskId, " ")).rejects.toThrow(/why it is coming out/);

      // Captured before, so the next test compares against what the task
      // actually was rather than against an assumption about where a
      // self-assigned task starts.
      statusBeforeDetach = (await prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true },
      }))!.status;

      await projects.detachTask(actor(), taskId, `${RUN} belongs to BAU, not the project`);
      const p = await projects.byId(projectId);
      expect(p.tasks.some((x) => x.id === taskId)).toBe(false);
      expect(p.healthInputs.totalTasks).toBe(0);
    });

    it("leaves the task itself alone when it comes out", async () => {
      const t = await prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true, assigneeEmployeeId: true, projectId: true },
      });
      expect(t?.projectId).toBeNull();
      expect(t?.status).toBe(statusBeforeDetach);
      expect(t?.assigneeEmployeeId).toBe(employeeA);
    });
  });
});
