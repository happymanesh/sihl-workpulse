import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DaciRole, DecisionStatus, Priority, ProjectStatus, RaciRole, TaskStatus, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { ProjectService } from "../src/modules/project/project.service";
import { TaskService } from "../src/modules/task/task.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * The BRS's own worked example: the "New NRI F&O Product" project, with the
 * A -> B -> C -> D -> E dependency chain from the wireframes.
 *
 * Four rules carry real weight here:
 *   - exactly one Accountable, and replacing them is explicit (TM-FR-033)
 *   - only the named DACI Approver can decide (TM-FR-036)
 *   - cycles are refused on save (TM-FR-030)
 *   - a task cannot start while a predecessor is open (TM-FR-029)
 */

const RUN = `proj-${Date.now()}`;
const canRun = Boolean(process.env.DATABASE_URL);

function actor(id: string, employeeId: string | null, roles: string[] = ["PROJECT_MANAGER"]): AuthenticatedUser {
  return {
    id,
    synapseUserUid: 1,
    username: id,
    fullName: id,
    companyCode: "SIHL",
    hierarchyCode: "9999",
    roles,
    employeeId,
    isEmployeeUnlinked: false,
  } as AuthenticatedUser;
}

(canRun ? describe : describe.skip)("Projects, RACI, DACI and dependencies (e2e)", () => {
  let app: INestApplication;
  let projects: ProjectService;
  let tasks: TaskService;

  let projectId: string;
  let empA: string;
  let empB: string;
  let taskTypeId: string;
  const created: string[] = [];

  const pm = () => actor("pm-user", empA);

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    projects = app.get(ProjectService);
    tasks = app.get(TaskService);

    const emps = await prisma.employee.findMany({ where: { isActive: true }, take: 2, orderBy: { name: "asc" } });
    const type = await prisma.taskType.findUnique({ where: { code: "PROJECT" } });
    if (emps.length < 2 || !type) throw new Error("fixtures missing");
    empA = emps[0].id;
    empB = emps[1].id;
    taskTypeId = type.id;

    const p = await projects.create(pm(), {
      code: `${RUN}-NRI`,
      name: `${RUN} New NRI F&O Product`,
      ownerEmployeeId: empA,
      projectManagerEmployeeId: empA,
    });
    projectId = p.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.taskDependency.deleteMany({ where: { predecessorTaskId: { in: created } } });
    await prisma.taskStatusHistory.deleteMany({ where: { taskId: { in: created } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Task", entityId: { in: created } } });
    await prisma.task.deleteMany({ where: { id: { in: created } } });
    await prisma.daciAssignment.deleteMany({ where: { decision: { projectId } } });
    await prisma.decision.deleteMany({ where: { projectId } });
    await prisma.raciAssignment.deleteMany({ where: { projectId } });
    await prisma.projectRisk.deleteMany({ where: { projectId } });
    await prisma.milestone.deleteMany({ where: { projectId } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Project", entityId: projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await app?.close();
  }, 60_000);

  async function makeTask(title: string) {
    const t = await tasks.create(pm(), {
      title: `${RUN} ${title}`,
      taskTypeId,
      priority: Priority.HIGH,
      assigneeEmployeeId: empA,
      dueDate: new Date(Date.now() + 30 * 86_400_000),
    });
    await prisma.task.update({ where: { id: t.id }, data: { projectId } });
    created.push(t.id);
    return t;
  }

  describe("RACI: exactly one Accountable", () => {
    it("accepts the first Accountable", async () => {
      const a = await projects.assignRaci(pm(), projectId, empA, RaciRole.ACCOUNTABLE);
      expect(a.role).toBe(RaciRole.ACCOUNTABLE);
    });

    it("refuses a second Accountable without explicit replacement", async () => {
      // "Everyone is accountable" means nobody is - so the replacement has to
      // be a deliberate act, not a side effect of adding someone.
      await expect(projects.assignRaci(pm(), projectId, empB, RaciRole.ACCOUNTABLE)).rejects.toThrow(
        /already Accountable/,
      );
    });

    it("replaces when told to, leaving exactly one", async () => {
      await projects.assignRaci(pm(), projectId, empB, RaciRole.ACCOUNTABLE, true);
      const all = await prisma.raciAssignment.findMany({ where: { projectId, role: RaciRole.ACCOUNTABLE } });
      expect(all).toHaveLength(1);
      expect(all[0].employeeId).toBe(empB);
    });

    it("allows any number of Responsible", async () => {
      await projects.assignRaci(pm(), projectId, empA, RaciRole.RESPONSIBLE);
      await projects.assignRaci(pm(), projectId, empB, RaciRole.RESPONSIBLE);
      const all = await prisma.raciAssignment.findMany({ where: { projectId, role: RaciRole.RESPONSIBLE } });
      expect(all).toHaveLength(2);
    });
  });

  describe("DACI: only the named Approver decides", () => {
    let decisionId: string;

    it("requires exactly one Approver to raise a decision", async () => {
      await expect(
        projects.createDecision(pm(), {
          projectId,
          title: `${RUN} No approver`,
          assignments: [{ employeeId: empA, role: DaciRole.DRIVER }],
        }),
      ).rejects.toThrow(/exactly one named Approver/);
    });

    it("creates a decision with a Driver and an Approver", async () => {
      const d = await projects.createDecision(pm(), {
        projectId,
        title: `${RUN} Vendor selection`,
        assignments: [
          { employeeId: empA, role: DaciRole.DRIVER },
          { employeeId: empB, role: DaciRole.APPROVER },
        ],
      });
      decisionId = d.id;
      expect(d.status).toBe(DecisionStatus.OPEN);
    });

    it("refuses the Driver, even though they did the work", async () => {
      await expect(
        projects.decide(actor("driver", empA), decisionId, "Looks fine to me", true),
      ).rejects.toThrow(/Only the named Approver/);
    });

    it("refuses a System Admin - sign-off cannot be overridden", async () => {
      await expect(
        projects.decide(actor("admin", empA, ["SYSTEM_ADMIN"]), decisionId, "Approving on their behalf", true),
      ).rejects.toThrow(/Only the named Approver/);
    });

    it("requires an outcome to be recorded", async () => {
      await expect(projects.decide(actor("appr", empB), decisionId, "   ", true)).rejects.toThrow(
        /what was decided/,
      );
    });

    it("lets the named Approver decide", async () => {
      const d = await projects.decide(actor("appr", empB), decisionId, "Vendor B selected on cost and SLA", true);
      expect(d.status).toBe(DecisionStatus.DECIDED);
      expect(d.outcome).toContain("Vendor B");
    });

    it("refuses to decide an already-decided decision", async () => {
      await expect(projects.decide(actor("appr", empB), decisionId, "Changed my mind", true)).rejects.toThrow(
        /already decided/,
      );
    });
  });

  describe("dependencies", () => {
    let a: { id: string; reference: string };
    let b: { id: string; reference: string };
    let c: { id: string; reference: string };

    it("builds the A -> B -> C chain", async () => {
      a = await makeTask("A API development");
      b = await makeTask("B UI development");
      c = await makeTask("C UAT");

      await projects.addDependency(pm(), a.id, b.id);
      await projects.addDependency(pm(), b.id, c.id);

      expect(await prisma.taskDependency.count({ where: { successorTaskId: c.id } })).toBe(1);
    });

    it("refuses a cycle closed through the chain", async () => {
      await expect(projects.addDependency(pm(), c.id, a.id)).rejects.toThrow(/neither could ever start/);
    });

    it("refuses a self-dependency", async () => {
      await expect(projects.addDependency(pm(), a.id, a.id)).rejects.toThrow(/cannot depend on itself/);
    });

    it("will not let a task start while its predecessor is open", async () => {
      // Self-assigned tasks are created ACCEPTED already (TM-FR-023), so B is
      // sitting ready to start - and must still be refused.
      const me = actor("pm-user", empA, ["PROJECT_MANAGER", "MANAGER"]);
      expect((await prisma.task.findUnique({ where: { id: b.id } }))!.status).toBe(TaskStatus.ACCEPTED);

      await expect(tasks.transition(me, { taskId: b.id, to: TaskStatus.IN_PROGRESS })).rejects.toThrow(
        /waiting on/,
      );
    });

    it("lets it start once the predecessor is complete", async () => {
      const me = actor("pm-user", empA, ["PROJECT_MANAGER", "MANAGER"]);
      await tasks.transition(me, { taskId: a.id, to: TaskStatus.IN_PROGRESS });
      await tasks.transition(me, { taskId: a.id, to: TaskStatus.COMPLETED });

      const started = await tasks.transition(me, { taskId: b.id, to: TaskStatus.IN_PROGRESS });
      expect(started.task.status).toBe(TaskStatus.IN_PROGRESS);
    });
  });

  describe("project completion and health", () => {
    it("refuses to complete while open tasks remain, and says which", async () => {
      await expect(projects.setStatus(pm(), projectId, ProjectStatus.COMPLETED)).rejects.toThrow(
        /open task\(s\).*WP-/s,
      );
    });

    it("refuses to complete while a blocking issue is unresolved", async () => {
      await prisma.projectRisk.create({
        data: { projectId, title: `${RUN} Compliance sign-off outstanding`, isBlocking: true },
      });
      await expect(projects.setStatus(pm(), projectId, ProjectStatus.COMPLETED)).rejects.toThrow(
        /blocking issue/,
      );
    });

    it("recalculates health from underlying data", async () => {
      const result = await projects.recalculateHealth(projectId);
      // One unresolved blocking risk = Amber at minimum.
      expect(["AMBER", "RED"]).toContain(result.health);
      expect(result.reasons.join(" ")).toContain("blocking issue");
    });

    it("requires a reason to override health", async () => {
      await expect(projects.overrideHealth(pm(), projectId, "GREEN", "  ")).rejects.toThrow(/requires a reason/);
    });

    it("records an override as an override, keeping the calculation", async () => {
      const p = await projects.overrideHealth(pm(), projectId, "GREEN", "Mitigation agreed with Compliance");
      expect(p.healthOverride).toBe("GREEN");
      // The computed value is preserved alongside, so the disagreement is visible.
      expect(p.health).not.toBeNull();
      expect(p.healthOverrideReason).toContain("Mitigation agreed");
    });
  });
});
