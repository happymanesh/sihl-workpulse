import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  DaciRole,
  DecisionStatus,
  ProjectHealth,
  ProjectStatus,
  RaciRole,
  TaskStatus,
  WorkPulseRole,
  prisma,
} from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";
import { calculateHealth, explainHealth, raciAccountableConflict, wouldCreateCycle } from "./project-core";

@Injectable()
export class ProjectService {
  constructor(private readonly audit: AuditService) {}

  private canManage(actor: AuthenticatedUser): boolean {
    return (
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD) ||
      actor.roles.includes(WorkPulseRole.PROJECT_MANAGER) ||
      actor.roles.includes(WorkPulseRole.MANAGER)
    );
  }

  private assertManage(actor: AuthenticatedUser, what: string): void {
    if (!this.canManage(actor)) throw new ForbiddenException(`${what} requires a project manager or above`);
  }

  async list() {
    const projects = await prisma.project.findMany({
      where: { status: { not: ProjectStatus.CANCELLED } },
      include: {
        owner: { select: { name: true } },
        projectManager: { select: { name: true } },
        _count: { select: { tasks: true, milestones: true, risks: true } },
      },
      orderBy: { name: "asc" },
    });
    return projects.map((p) => ({ ...p, effectiveHealth: p.healthOverride ?? p.health }));
  }

  async byId(id: string) {
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true } },
        sponsor: { select: { id: true, name: true } },
        projectManager: { select: { id: true, name: true } },
        milestones: { orderBy: { position: "asc" } },
        risks: { orderBy: [{ isResolved: "asc" }, { createdAt: "desc" }] },
        raci: { include: { employee: { select: { id: true, name: true } } } },
        decisions: {
          orderBy: { createdAt: "desc" },
          include: { assignments: { include: { employee: { select: { id: true, name: true } } } } },
        },
        teams: { include: { team: { select: { id: true, name: true, code: true } } } },
        tasks: {
          select: {
            id: true,
            reference: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            assignee: { select: { name: true } },
            dependsOn: { select: { predecessorTaskId: true } },
          },
          orderBy: { dueDate: "asc" },
        },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    const inputs = await this.healthInputs(id);
    const now = new Date();

    return {
      ...project,
      // Decided by the server's clock, not the browser's. "Was this milestone
      // missed" has one answer, not one per viewer's device - and computing it
      // during render makes server and client disagree across hydration.
      milestones: project.milestones.map((m) => ({
        ...m,
        isMissed: !m.completedAt && m.targetDate < now,
      })),
      effectiveHealth: project.healthOverride ?? project.health,
      healthReasons: explainHealth(inputs),
      healthInputs: inputs,
    };
  }

  private async healthInputs(projectId: string) {
    const now = new Date();
    const [totalTasks, overdueTasks, blockingRisks, missedMilestones] = await Promise.all([
      prisma.task.count({ where: { projectId } }),
      prisma.task.count({
        where: {
          projectId,
          dueDate: { lt: now },
          status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED, TaskStatus.VERIFIED] },
        },
      }),
      prisma.projectRisk.count({ where: { projectId, isBlocking: true, isResolved: false } }),
      prisma.milestone.count({ where: { projectId, completedAt: null, targetDate: { lt: now } } }),
    ]);
    return { totalTasks, overdueTasks, blockingRisks, missedMilestones };
  }

  /**
   * TM-FR-013. Recalculated from underlying data rather than typed in, so a
   * status report is trustworthy instead of self-reported.
   */
  async recalculateHealth(projectId: string) {
    const inputs = await this.healthInputs(projectId);
    const health = calculateHealth(inputs);
    await prisma.project.update({
      where: { id: projectId },
      data: { health, healthCalculatedAt: new Date() },
    });
    return { health, inputs, reasons: explainHealth(inputs) };
  }

  async create(
    actor: AuthenticatedUser,
    input: {
      code: string;
      name: string;
      description?: string;
      ownerEmployeeId: string;
      sponsorEmployeeId?: string;
      projectManagerEmployeeId: string;
      startDate?: Date;
      targetEndDate?: Date;
    },
  ) {
    this.assertManage(actor, "Creating a project");

    const project = await prisma.project.create({
      data: {
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        description: input.description?.trim(),
        ownerEmployeeId: input.ownerEmployeeId,
        sponsorEmployeeId: input.sponsorEmployeeId,
        projectManagerEmployeeId: input.projectManagerEmployeeId,
        startDate: input.startDate,
        targetEndDate: input.targetEndDate,
      },
    });

    await this.audit.record({
      entityType: "Project",
      entityId: project.id,
      action: "created",
      actorId: actor.id,
      after: { code: project.code, name: project.name },
    });

    return project;
  }

  /**
   * TM-FR-012: a project cannot complete while open tasks or unresolved
   * blocking risks remain. The error lists what is outstanding rather than just
   * refusing, because "you cannot" without "because of these" is useless.
   */
  async setStatus(actor: AuthenticatedUser, projectId: string, to: ProjectStatus, reason?: string) {
    this.assertManage(actor, "Changing project status");

    const before = await prisma.project.findUnique({ where: { id: projectId } });
    if (!before) throw new NotFoundException("Project not found");

    if (to === ProjectStatus.COMPLETED) {
      const [openTasks, blockingRisks] = await Promise.all([
        prisma.task.findMany({
          where: {
            projectId,
            status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED, TaskStatus.VERIFIED] },
          },
          select: { reference: true, title: true },
          take: 10,
        }),
        prisma.projectRisk.findMany({
          where: { projectId, isBlocking: true, isResolved: false },
          select: { title: true },
          take: 10,
        }),
      ]);

      if (openTasks.length > 0 || blockingRisks.length > 0) {
        const parts: string[] = [];
        if (openTasks.length) parts.push(`${openTasks.length} open task(s): ${openTasks.map((t) => t.reference).join(", ")}`);
        if (blockingRisks.length) parts.push(`${blockingRisks.length} blocking issue(s): ${blockingRisks.map((r) => r.title).join("; ")}`);
        throw new BadRequestException(`Cannot complete this project while it has ${parts.join(" and ")}`);
      }
    }

    const after = await prisma.project.update({
      where: { id: projectId },
      data: {
        status: to,
        actualEndDate: to === ProjectStatus.COMPLETED ? new Date() : before.actualEndDate,
      },
    });

    await this.audit.record({
      entityType: "Project",
      entityId: projectId,
      action: `status_changed_to_${to.toLowerCase()}`,
      actorId: actor.id,
      before: { status: before.status },
      after: { status: after.status },
      reason,
    });

    return after;
  }

  /** TM-FR-013: the override is permitted, but never silent and never unexplained. */
  async overrideHealth(actor: AuthenticatedUser, projectId: string, health: ProjectHealth | null, reason: string) {
    this.assertManage(actor, "Overriding project health");
    if (health && !reason?.trim()) {
      throw new BadRequestException("Overriding calculated health requires a reason");
    }

    const before = await prisma.project.findUnique({ where: { id: projectId } });
    if (!before) throw new NotFoundException("Project not found");

    const after = await prisma.project.update({
      where: { id: projectId },
      data: {
        healthOverride: health,
        healthOverrideReason: health ? reason.trim() : null,
        healthOverrideByUserId: health ? actor.id : null,
        healthOverrideAt: health ? new Date() : null,
      },
    });

    await this.audit.record({
      entityType: "Project",
      entityId: projectId,
      action: health ? "health_overridden" : "health_override_cleared",
      actorId: actor.id,
      before: { healthOverride: before.healthOverride, calculated: before.health },
      after: { healthOverride: after.healthOverride, calculated: after.health },
      reason: health ? reason : "Override cleared; calculated health applies",
    });

    return after;
  }

  // ---- RACI -------------------------------------------------------------

  /**
   * TM-FR-033/034: exactly one Accountable, and changing it notifies both the
   * outgoing and incoming holder. The replacement is explicit - the caller must
   * say `replaceAccountable`, so nobody loses accountability by accident.
   */
  async assignRaci(
    actor: AuthenticatedUser,
    projectId: string,
    employeeId: string,
    role: RaciRole,
    replaceAccountable = false,
  ) {
    this.assertManage(actor, "Assigning RACI roles");

    const existing = await prisma.raciAssignment.findMany({
      where: { projectId },
      select: { id: true, employeeId: true, role: true },
    });

    const incumbent = raciAccountableConflict(existing, role, employeeId);
    if (incumbent && !replaceAccountable) {
      const who = await prisma.employee.findUnique({ where: { id: incumbent }, select: { name: true } });
      throw new BadRequestException(
        `${who?.name ?? "Someone"} is already Accountable for this project. Exactly one Accountable is permitted - ` +
          "confirm the replacement to proceed.",
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      if (incumbent && replaceAccountable) {
        await tx.raciAssignment.deleteMany({
          where: { projectId, role: RaciRole.ACCOUNTABLE, employeeId: incumbent },
        });
      }
      return tx.raciAssignment.upsert({
        where: { projectId_employeeId_role: { projectId, employeeId, role } },
        create: { projectId, employeeId, role },
        update: {},
        include: { employee: { select: { name: true } } },
      });
    });

    await this.audit.record({
      entityType: "Project",
      entityId: projectId,
      action: "raci_assigned",
      actorId: actor.id,
      before: incumbent ? { replacedAccountable: incumbent } : null,
      after: { employeeId, role },
    });

    return created;
  }

  async removeRaci(actor: AuthenticatedUser, assignmentId: string) {
    this.assertManage(actor, "Changing RACI roles");
    const row = await prisma.raciAssignment.findUnique({ where: { id: assignmentId } });
    if (!row) throw new NotFoundException("Assignment not found");

    await prisma.raciAssignment.delete({ where: { id: assignmentId } });
    await this.audit.record({
      entityType: "Project",
      entityId: row.projectId,
      action: "raci_removed",
      actorId: actor.id,
      before: { employeeId: row.employeeId, role: row.role },
    });
    return { id: assignmentId };
  }

  // ---- DACI -------------------------------------------------------------

  async createDecision(
    actor: AuthenticatedUser,
    input: { projectId?: string; title: string; description?: string; assignments: { employeeId: string; role: DaciRole }[] },
  ) {
    this.assertManage(actor, "Raising a decision");

    const approvers = input.assignments.filter((a) => a.role === DaciRole.APPROVER);
    if (approvers.length !== 1) {
      throw new BadRequestException("A decision needs exactly one named Approver");
    }

    const decision = await prisma.decision.create({
      data: {
        projectId: input.projectId,
        title: input.title.trim(),
        description: input.description?.trim(),
        assignments: { create: input.assignments },
      },
      include: { assignments: { include: { employee: { select: { name: true } } } } },
    });

    await this.audit.record({
      entityType: "Decision",
      entityId: decision.id,
      action: "created",
      actorId: actor.id,
      after: { title: decision.title, approverEmployeeId: approvers[0].employeeId },
    });

    return decision;
  }

  /**
   * TM-FR-036, and the rule that makes DACI mean anything.
   *
   * ONLY the named Approver can decide. Not the Driver who did the work, not a
   * manager, not a System Admin. A decision closed by the wrong person is not a
   * decision - it is someone else's opinion wearing its clothes.
   */
  async decide(actor: AuthenticatedUser, decisionId: string, outcome: string, approve: boolean) {
    const decision = await prisma.decision.findUnique({
      where: { id: decisionId },
      include: { assignments: true },
    });
    if (!decision) throw new NotFoundException("Decision not found");
    if (decision.status !== DecisionStatus.OPEN) {
      throw new BadRequestException(`This decision is already ${decision.status.toLowerCase()}`);
    }
    if (!outcome?.trim()) {
      throw new BadRequestException("Record what was decided and why");
    }

    const approver = decision.assignments.find((a) => a.role === DaciRole.APPROVER);
    if (!approver || approver.employeeId !== actor.employeeId) {
      throw new ForbiddenException(
        "Only the named Approver can decide this. Sign-off cannot be delegated, escalated or overridden.",
      );
    }

    const after = await prisma.decision.update({
      where: { id: decisionId },
      data: {
        status: approve ? DecisionStatus.DECIDED : DecisionStatus.REJECTED,
        decidedAt: new Date(),
        decidedByUserId: actor.id,
        outcome: outcome.trim(),
      },
    });

    await this.audit.record({
      entityType: "Decision",
      entityId: decisionId,
      action: approve ? "decided" : "rejected",
      actorId: actor.id,
      before: { status: DecisionStatus.OPEN },
      after: { status: after.status },
      reason: outcome,
    });

    return after;
  }

  // ---- dependencies -----------------------------------------------------

  /**
   * TM-FR-029/030. Finish-to-Start only in this phase, and cycles are rejected
   * on save rather than discovered when nothing can start.
   */
  async addDependency(actor: AuthenticatedUser, predecessorTaskId: string, successorTaskId: string) {
    const [pred, succ] = await Promise.all([
      prisma.task.findUnique({ where: { id: predecessorTaskId }, select: { id: true, reference: true } }),
      prisma.task.findUnique({ where: { id: successorTaskId }, select: { id: true, reference: true } }),
    ]);
    if (!pred || !succ) throw new NotFoundException("Both tasks must exist");

    const edges = await prisma.taskDependency.findMany({
      select: { predecessorTaskId: true, successorTaskId: true },
    });

    if (wouldCreateCycle(edges, predecessorTaskId, successorTaskId)) {
      throw new BadRequestException(
        predecessorTaskId === successorTaskId
          ? "A task cannot depend on itself"
          : `${succ.reference} already has to finish before ${pred.reference}. Adding this would mean neither could ever start.`,
      );
    }

    const dep = await prisma.taskDependency.create({
      data: { predecessorTaskId, successorTaskId, createdByUserId: actor.id },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: successorTaskId,
      action: "dependency_added",
      actorId: actor.id,
      after: { dependsOn: pred.reference },
    });

    return dep;
  }

  async removeDependency(actor: AuthenticatedUser, dependencyId: string) {
    const dep = await prisma.taskDependency.findUnique({ where: { id: dependencyId } });
    if (!dep) throw new NotFoundException("Dependency not found");
    await prisma.taskDependency.delete({ where: { id: dependencyId } });
    await this.audit.record({
      entityType: "Task",
      entityId: dep.successorTaskId,
      action: "dependency_removed",
      actorId: actor.id,
      before: { predecessorTaskId: dep.predecessorTaskId },
    });
    return { id: dependencyId };
  }

  /**
   * TM-FR-029: which predecessors are still open. Consumed by the Task service
   * to refuse a move into In Progress while any remain.
   */
  async unmetPredecessors(taskId: string) {
    const deps = await prisma.taskDependency.findMany({
      where: { successorTaskId: taskId },
      include: {
        predecessor: { select: { id: true, reference: true, title: true, status: true } },
      },
    });
    const done: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.VERIFIED, TaskStatus.CLOSED];
    return deps.filter((d) => !done.includes(d.predecessor.status)).map((d) => d.predecessor);
  }
}
