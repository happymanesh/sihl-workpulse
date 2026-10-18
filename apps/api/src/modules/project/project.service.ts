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

  // ---- Milestones -------------------------------------------------------

  /**
   * Milestones, risks and the tasks in a project were readable but had no way
   * in: the screen showed them, health was computed from them, and nothing
   * could create one. A health figure derived from three things that are
   * always empty reads GREEN forever and means nothing, which is worse than
   * having no figure at all.
   *
   * Every write below recalculates health, because that is the whole point of
   * recording them.
   */
  async addMilestone(
    actor: AuthenticatedUser,
    input: { projectId: string; name: string; targetDate: Date; position?: number },
  ) {
    this.assertManage(actor, "Adding a milestone");

    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, code: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (!input.name.trim()) throw new BadRequestException("A milestone needs a name");

    const last = await prisma.milestone.findFirst({
      where: { projectId: input.projectId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const milestone = await prisma.milestone.create({
      data: {
        projectId: input.projectId,
        name: input.name.trim(),
        targetDate: input.targetDate,
        position: input.position ?? (last ? last.position + 1 : 0),
      },
    });

    await this.audit.record({
      entityType: "Project",
      entityId: input.projectId,
      action: "milestone_added",
      actorId: actor.id,
      after: { milestoneId: milestone.id, name: milestone.name, targetDate: milestone.targetDate },
      reason: `${project.code}: ${milestone.name}`,
    });

    await this.recalculateHealth(input.projectId);
    return milestone;
  }

  /**
   * Marking a milestone met records WHEN, not just that it happened, and
   * un-marking is allowed because somebody will tick the wrong row. Both are
   * audited, so "this was reported as met on the 3rd and un-met on the 9th" is
   * answerable.
   */
  async setMilestoneComplete(actor: AuthenticatedUser, milestoneId: string, complete: boolean) {
    this.assertManage(actor, "Completing a milestone");

    const before = await prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!before) throw new NotFoundException("Milestone not found");

    const after = await prisma.milestone.update({
      where: { id: milestoneId },
      data: { completedAt: complete ? new Date() : null },
    });

    await this.audit.record({
      entityType: "Project",
      entityId: before.projectId,
      action: complete ? "milestone_met" : "milestone_reopened",
      actorId: actor.id,
      before: { milestoneId, completedAt: before.completedAt },
      after: { milestoneId, completedAt: after.completedAt },
      reason: before.name,
    });

    await this.recalculateHealth(before.projectId);
    return after;
  }

  /**
   * Removing a milestone is planning, not evidence - a date that was never
   * real can go. One that was already met cannot: reporting it as met and then
   * deleting it would quietly rewrite what was reported.
   */
  async removeMilestone(actor: AuthenticatedUser, milestoneId: string) {
    this.assertManage(actor, "Removing a milestone");

    const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!milestone) throw new NotFoundException("Milestone not found");
    if (milestone.completedAt) {
      throw new BadRequestException(
        "This milestone has been reported as met, so it cannot be deleted. Re-open it first if that was wrong.",
      );
    }

    await prisma.milestone.delete({ where: { id: milestoneId } });
    await this.audit.record({
      entityType: "Project",
      entityId: milestone.projectId,
      action: "milestone_removed",
      actorId: actor.id,
      before: { milestoneId, name: milestone.name, targetDate: milestone.targetDate },
    });

    await this.recalculateHealth(milestone.projectId);
    return { id: milestoneId };
  }

  // ---- Risks and issues -------------------------------------------------

  /**
   * TM-FR-014. A blocking risk is not a label - it stops the project being
   * completed until it is resolved, which is why raising one is an audited act
   * rather than a note somebody typed in a status report.
   */
  async raiseRisk(
    actor: AuthenticatedUser,
    input: { projectId: string; title: string; description?: string; isBlocking?: boolean },
  ) {
    this.assertManage(actor, "Raising a risk");

    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, code: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (!input.title.trim()) throw new BadRequestException("A risk needs a title");

    const risk = await prisma.projectRisk.create({
      data: {
        projectId: input.projectId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        isBlocking: input.isBlocking ?? false,
      },
    });

    await this.audit.record({
      entityType: "Project",
      entityId: input.projectId,
      action: "risk_raised",
      actorId: actor.id,
      after: { riskId: risk.id, title: risk.title, isBlocking: risk.isBlocking },
      reason: `${project.code}: ${risk.title}`,
    });

    await this.recalculateHealth(input.projectId);
    return risk;
  }

  /** Escalating a risk to blocking, or standing it down, always with a reason. */
  async setRiskBlocking(actor: AuthenticatedUser, riskId: string, isBlocking: boolean, reason: string) {
    this.assertManage(actor, "Changing a risk");

    const before = await prisma.projectRisk.findUnique({ where: { id: riskId } });
    if (!before) throw new NotFoundException("Risk not found");
    if (!reason?.trim()) {
      throw new BadRequestException(
        "Say why this is or is no longer blocking — a blocking risk stops the project closing, so the change needs to be explicable.",
      );
    }

    const after = await prisma.projectRisk.update({ where: { id: riskId }, data: { isBlocking } });

    await this.audit.record({
      entityType: "Project",
      entityId: before.projectId,
      action: isBlocking ? "risk_escalated_to_blocking" : "risk_stood_down",
      actorId: actor.id,
      before: { riskId, isBlocking: before.isBlocking },
      after: { riskId, isBlocking: after.isBlocking },
      reason: reason.trim(),
    });

    await this.recalculateHealth(before.projectId);
    return after;
  }

  /**
   * Resolving needs a note saying how. "Resolved" with no account of what was
   * done is the status report equivalent of a shrug, and this is the one that
   * unblocks project closure.
   */
  async resolveRisk(actor: AuthenticatedUser, riskId: string, resolutionNote: string) {
    this.assertManage(actor, "Resolving a risk");

    const before = await prisma.projectRisk.findUnique({ where: { id: riskId } });
    if (!before) throw new NotFoundException("Risk not found");
    if (before.isResolved) throw new BadRequestException("That risk is already resolved");
    if (!resolutionNote?.trim()) {
      throw new BadRequestException("Say how it was resolved — this is what lets the project close");
    }

    const after = await prisma.projectRisk.update({
      where: { id: riskId },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote.trim(),
      },
    });

    await this.audit.record({
      entityType: "Project",
      entityId: before.projectId,
      action: "risk_resolved",
      actorId: actor.id,
      before: { riskId, isResolved: false, isBlocking: before.isBlocking },
      after: { riskId, isResolved: true },
      reason: resolutionNote.trim(),
    });

    await this.recalculateHealth(before.projectId);
    return after;
  }

  // ---- Tasks in a project ------------------------------------------------

  /**
   * Put an existing task into a project, or take it out again.
   *
   * Tasks are not created here and are not owned here: a task in a project is
   * still somebody's task, with the same lifecycle, the same reviewer and the
   * same audit trail. The project link only says which body of work it counts
   * towards - which is what makes "this project has four overdue tasks" a fact
   * rather than a guess.
   */
  async attachTask(actor: AuthenticatedUser, projectId: string, taskId: string) {
    this.assertManage(actor, "Adding a task to a project");

    const [project, task] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true, code: true } }),
      prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, reference: true, projectId: true },
      }),
    ]);
    if (!project) throw new NotFoundException("Project not found");
    if (!task) throw new NotFoundException("Task not found");
    if (task.projectId === projectId) return task;
    if (task.projectId) {
      throw new BadRequestException(
        "That task already belongs to another project. Take it out of that one first — a task counts towards one project, or none.",
      );
    }

    const after = await prisma.task.update({
      where: { id: taskId },
      data: { projectId },
      select: { id: true, reference: true, projectId: true },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: taskId,
      action: "added_to_project",
      actorId: actor.id,
      before: { projectId: null },
      after: { projectId },
      reason: `${task.reference} added to ${project.code}`,
    });

    await this.recalculateHealth(projectId);
    return after;
  }

  async detachTask(actor: AuthenticatedUser, taskId: string, reason: string) {
    this.assertManage(actor, "Removing a task from a project");

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, reference: true, projectId: true },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (!task.projectId) throw new BadRequestException("That task is not in a project");
    if (!reason?.trim()) {
      throw new BadRequestException("Say why it is coming out — the project's figures change when it does");
    }

    const projectId = task.projectId;
    await prisma.task.update({ where: { id: taskId }, data: { projectId: null } });

    await this.audit.record({
      entityType: "Task",
      entityId: taskId,
      action: "removed_from_project",
      actorId: actor.id,
      before: { projectId },
      after: { projectId: null },
      reason: reason.trim(),
    });

    await this.recalculateHealth(projectId);
    return { id: taskId };
  }

  /**
   * Tasks that belong to no project, for the picker. Closed work is not
   * offered, and the list is the same whichever project is asking - a task
   * counts towards one project or none, so there is nothing to scope.
   */
  async unassignedTasks() {
    return prisma.task.findMany({
      where: {
        projectId: null,
        status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] },
      },
      select: {
        id: true,
        reference: true,
        title: true,
        dueDate: true,
        assignee: { select: { name: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 200,
    });
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
