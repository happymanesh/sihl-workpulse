import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ActorType, EscalationTarget, Priority, TaskStatus, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";
import { isTerminal } from "../task/task-lifecycle";
import { assessSla, computeActiveTime, dueEscalations, isMutableFor, resolveSla, type SlaAssessment } from "./sla-core";

export interface EscalationRunResult {
  startedAt: string;
  finishedAt: string;
  tasksAssessed: number;
  escalationsFired: number;
  breaches: number;
  errors: string[];
}

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(private readonly audit: AuditService) {}

  /**
   * The SLA position of one task, or null when no definition applies.
   *
   * Null is meaningful: not all work is SLA-tracked, and the UI should say
   * "no SLA" rather than showing a clock nobody agreed to.
   */
  async assess(taskId: string, asOf: Date = new Date()): Promise<(SlaAssessment & { definitionId: string }) | null> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        priority: true,
        taskTypeId: true,
        departmentId: true,
        sourceSystemId: true,
        closedAt: true,
        statusHistory: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!task) return null;

    const definitions = await prisma.slaDefinition.findMany({
      where: { isActive: true },
      select: {
        id: true,
        taskTypeId: true,
        priority: true,
        departmentId: true,
        sourceSystemId: true,
        resolutionMinutes: true,
        responseMinutes: true,
      },
    });

    const definition = resolveSla(definitions, {
      taskTypeId: task.taskTypeId,
      priority: task.priority,
      departmentId: task.departmentId,
      sourceSystemId: task.sourceSystemId,
    });
    if (!definition) return null;

    // A settled task's clock stops when it settled, not now - otherwise every
    // closed task eventually shows as breached.
    const until = isTerminal(task.status) ? (task.closedAt ?? asOf) : asOf;
    const active = computeActiveTime(task.statusHistory, until);

    return { ...assessSla(active, definition.resolutionMinutes), definitionId: definition.id };
  }

  /**
   * Resolves an escalation target to a person.
   *
   * Targets are relationships, not names, so the chain keeps working when
   * people change roles. An unresolvable target returns null and the escalation
   * is still recorded - a notification nobody receives is a gap worth seeing,
   * not something to swallow.
   */
  private async resolveTarget(
    target: EscalationTarget,
    task: { assigneeEmployeeId: string; reviewerEmployeeId: string | null; departmentId: string | null },
  ): Promise<string | null> {
    switch (target) {
      case EscalationTarget.ASSIGNEE:
        return task.assigneeEmployeeId;
      case EscalationTarget.REVIEWER:
        return task.reviewerEmployeeId;
      case EscalationTarget.LINE_MANAGER: {
        const e = await prisma.employee.findUnique({
          where: { id: task.assigneeEmployeeId },
          select: { managerId: true },
        });
        return e?.managerId ?? null;
      }
      case EscalationTarget.DEPARTMENT_HEAD: {
        if (!task.departmentId) return null;
        // The department head is modelled as the employee in that department
        // with no manager inside it. Frappe HR has no explicit head field.
        const head = await prisma.employee.findFirst({
          where: { departmentId: task.departmentId, isActive: true, managerId: null },
          select: { id: true },
        });
        return head?.id ?? null;
      }
      default:
        return null;
    }
  }

  /**
   * One escalation pass over live, SLA-tracked work.
   *
   * Escalation NOTIFIES; it never reassigns (TM-FR-042). Auto-reassignment on
   * breach is opt-in per Task Type and deliberately not implemented here -
   * silently moving someone's work because a clock expired is how a system
   * loses people's trust.
   */
  async runEscalations(asOf: Date = new Date()): Promise<EscalationRunResult> {
    const startedAt = new Date().toISOString();
    const errors: string[] = [];
    let escalationsFired = 0;
    let breaches = 0;

    const tasks = await prisma.task.findMany({
      where: {
        status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED, TaskStatus.VERIFIED] },
      },
      select: {
        id: true,
        reference: true,
        priority: true,
        assigneeEmployeeId: true,
        reviewerEmployeeId: true,
        departmentId: true,
        escalations: { select: { level: true } },
      },
    });

    for (const task of tasks) {
      try {
        const assessment = await this.assess(task.id, asOf);
        if (!assessment) continue;
        if (assessment.state === "BREACHED") breaches++;

        const rules = await prisma.escalationRule.findMany({
          where: { slaDefinitionId: assessment.definitionId },
          orderBy: { level: "asc" },
        });

        const due = dueEscalations(
          rules.map((r) => ({ level: r.level, thresholdPercent: r.thresholdPercent })),
          assessment.percentUsed,
          task.escalations.map((e) => e.level),
        );

        for (const level of due) {
          const rule = rules.find((r) => r.level === level.level)!;
          const notifyEmployeeId = await this.resolveTarget(rule.notifyTarget, task);

          await prisma.taskEscalation.create({
            data: {
              taskId: task.id,
              level: rule.level,
              thresholdPercent: rule.thresholdPercent,
              notifyTarget: rule.notifyTarget,
              notifiedEmployeeId: notifyEmployeeId,
              activeMinutesAtFire: assessment.activeMinutes,
            },
          });

          await this.audit.record({
            entityType: "Task",
            entityId: task.id,
            action: "sla_escalated",
            actorType: ActorType.SYSTEM,
            after: {
              level: rule.level,
              thresholdPercent: rule.thresholdPercent,
              target: rule.notifyTarget,
              notifiedEmployeeId: notifyEmployeeId,
              percentUsed: assessment.percentUsed,
              mutable: isMutableFor(task.priority, rule.isMutable),
            },
          });

          escalationsFired++;
        }
      } catch (err) {
        const message = `Task ${task.reference}: ${(err as Error).message}`;
        this.logger.error(message);
        errors.push(message);
      }
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tasksAssessed: tasks.length,
      escalationsFired,
      breaches,
      errors,
    };
  }

  // ---- Administration ----------------------------------------------------

  /**
   * Targets are configuration, and until there was a way to write one the
   * engine ran every thirty minutes over an empty table. Nothing below changes
   * how the clock works - that is sla-core's job, and it was already right.
   */
  async listDefinitions() {
    return prisma.slaDefinition.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        taskType: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, name: true } },
        sourceSystem: { select: { id: true, code: true } },
        escalationRules: { orderBy: { level: "asc" } },
      },
    });
  }

  private assertAdmin(actor: AuthenticatedUser, what: string): void {
    const allowed =
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD);
    if (!allowed) throw new ForbiddenException(`${what} requires a Department Head or System Admin`);
  }

  /**
   * A definition constrains any combination of task type, priority, department
   * and source system; everything it leaves null means "any". Overlap is
   * expected rather than guarded against - the most specific match wins, and
   * that ordering is strict, so two definitions can never tie.
   */
  async createDefinition(
    actor: AuthenticatedUser,
    input: {
      name: string;
      resolutionMinutes: number;
      responseMinutes?: number | null;
      taskTypeId?: string | null;
      priority?: Priority | null;
      departmentId?: string | null;
      sourceSystemId?: string | null;
    },
  ) {
    this.assertAdmin(actor, "Setting an SLA target");
    this.validateTargets(input);

    const created = await prisma.slaDefinition.create({
      data: {
        name: input.name.trim(),
        resolutionMinutes: input.resolutionMinutes,
        responseMinutes: input.responseMinutes ?? null,
        taskTypeId: input.taskTypeId ?? null,
        priority: input.priority ?? null,
        departmentId: input.departmentId ?? null,
        sourceSystemId: input.sourceSystemId ?? null,
      },
    });

    await this.audit.record({
      entityType: "SlaDefinition",
      entityId: created.id,
      action: "created",
      actorId: actor.id,
      after: {
        name: created.name,
        resolutionMinutes: created.resolutionMinutes,
        responseMinutes: created.responseMinutes,
        taskTypeId: created.taskTypeId,
        priority: created.priority,
        departmentId: created.departmentId,
        sourceSystemId: created.sourceSystemId,
      },
      reason: `${created.name}: ${created.resolutionMinutes} minutes to resolve`,
    });

    return created;
  }

  async updateDefinition(
    actor: AuthenticatedUser,
    input: {
      id: string;
      name?: string;
      resolutionMinutes?: number;
      responseMinutes?: number | null;
      isActive?: boolean;
      reason?: string;
    },
  ) {
    this.assertAdmin(actor, "Changing an SLA target");

    const before = await prisma.slaDefinition.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundException("SLA definition not found");

    const resolution = input.resolutionMinutes ?? before.resolutionMinutes;
    const response =
      input.responseMinutes === undefined ? before.responseMinutes : input.responseMinutes;
    this.validateTargets({
      name: input.name ?? before.name,
      resolutionMinutes: resolution,
      responseMinutes: response,
    });

    // Loosening a target changes what counts as late, including for work that
    // is already running, so it is never silent.
    if (input.resolutionMinutes !== undefined && input.resolutionMinutes > before.resolutionMinutes) {
      if (!input.reason?.trim()) {
        throw new BadRequestException(
          "Extending an SLA target needs a reason - it changes what counts as late for work already in flight.",
        );
      }
    }

    const after = await prisma.slaDefinition.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.resolutionMinutes !== undefined
          ? { resolutionMinutes: input.resolutionMinutes }
          : {}),
        ...(input.responseMinutes !== undefined ? { responseMinutes: input.responseMinutes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.record({
      entityType: "SlaDefinition",
      entityId: input.id,
      action: input.isActive === false ? "deactivated" : "updated",
      actorId: actor.id,
      before: {
        name: before.name,
        resolutionMinutes: before.resolutionMinutes,
        responseMinutes: before.responseMinutes,
        isActive: before.isActive,
      },
      after: {
        name: after.name,
        resolutionMinutes: after.resolutionMinutes,
        responseMinutes: after.responseMinutes,
        isActive: after.isActive,
      },
      reason: input.reason?.trim(),
    });

    return after;
  }

  /**
   * A level in the chain. Escalation notifies by RELATIONSHIP - assignee, line
   * manager, department head - never by named person, so the chain keeps
   * working when people move between roles.
   */
  async addEscalationRule(
    actor: AuthenticatedUser,
    input: {
      slaDefinitionId: string;
      level: number;
      thresholdPercent: number;
      notifyTarget: EscalationTarget;
      isMutable?: boolean;
    },
  ) {
    this.assertAdmin(actor, "Changing an escalation chain");

    const definition = await prisma.slaDefinition.findUnique({
      where: { id: input.slaDefinitionId },
      include: { escalationRules: true },
    });
    if (!definition) throw new NotFoundException("SLA definition not found");

    if (definition.escalationRules.some((r) => r.level === input.level)) {
      throw new BadRequestException(`Level ${input.level} already exists on this target`);
    }
    if (input.thresholdPercent < 1 || input.thresholdPercent > 500) {
      throw new BadRequestException("A threshold is a percentage of the target, between 1 and 500");
    }

    const created = await prisma.escalationRule.create({
      data: {
        slaDefinitionId: input.slaDefinitionId,
        level: input.level,
        thresholdPercent: input.thresholdPercent,
        notifyTarget: input.notifyTarget,
        isMutable: input.isMutable ?? true,
      },
    });

    await this.audit.record({
      entityType: "SlaDefinition",
      entityId: input.slaDefinitionId,
      action: "escalation_level_added",
      actorId: actor.id,
      after: {
        level: created.level,
        thresholdPercent: created.thresholdPercent,
        notifyTarget: created.notifyTarget,
      },
      reason: `${definition.name}: level ${created.level} at ${created.thresholdPercent}%`,
    });

    return created;
  }

  async removeEscalationRule(actor: AuthenticatedUser, ruleId: string) {
    this.assertAdmin(actor, "Changing an escalation chain");

    const rule = await prisma.escalationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException("Escalation level not found");

    await prisma.escalationRule.delete({ where: { id: ruleId } });
    await this.audit.record({
      entityType: "SlaDefinition",
      entityId: rule.slaDefinitionId,
      action: "escalation_level_removed",
      actorId: actor.id,
      before: {
        level: rule.level,
        thresholdPercent: rule.thresholdPercent,
        notifyTarget: rule.notifyTarget,
      },
    });

    return { id: ruleId };
  }

  private validateTargets(input: {
    name: string;
    resolutionMinutes: number;
    responseMinutes?: number | null;
  }): void {
    if (!input.name?.trim()) throw new BadRequestException("An SLA target needs a name");
    if (input.resolutionMinutes <= 0) {
      throw new BadRequestException("The resolution target must be greater than zero");
    }
    if (input.responseMinutes != null && input.responseMinutes >= input.resolutionMinutes) {
      throw new BadRequestException(
        "The response target must be shorter than the resolution target - it is the first action, not the finish.",
      );
    }
  }
}
