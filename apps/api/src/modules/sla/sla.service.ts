import { Injectable, Logger } from "@nestjs/common";
import { ActorType, EscalationTarget, TaskStatus, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
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
}
