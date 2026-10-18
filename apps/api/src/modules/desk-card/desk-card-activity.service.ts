import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, Priority, RecurrenceFrequency, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";

export interface CreateActivityInput {
  deskCardId: string;
  title: string;
  description?: string;
  taskTypeId: string;
  priority: Priority;
  reviewerEmployeeId?: string | null;
  estimatedMinutes: number;
  frequency?: RecurrenceFrequency | null;
  interval?: number;
  daysOfWeek?: number[];
  dayOfMonth?: number | null;
  leadTimeDays?: number;
  startDate?: Date | null;
  endDate?: Date | null;
}

/**
 * Desk Card Activities: the unit that is costed, scheduled, controlled and
 * audited.
 *
 * This is also the recurrence definition. Addendum 01 Section 3.3 establishes
 * that an Activity SUPERSEDES the BRS's free-standing Recurring Task Template -
 * there is exactly one recurrence engine, and it reads from here. Do not add a
 * second generator.
 */
@Injectable()
export class DeskCardActivityService {
  constructor(private readonly audit: AuditService) {}

  private canGovern(actor: AuthenticatedUser): boolean {
    return (
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD)
    );
  }

  async create(actor: AuthenticatedUser, input: CreateActivityInput) {
    if (!this.canGovern(actor)) {
      throw new ForbiddenException("Adding an activity may only be done by a Department Head or System Admin");
    }
    this.validateRecurrence(input);
    if (input.estimatedMinutes <= 0) {
      throw new BadRequestException("Estimated effort must be greater than zero");
    }

    const card = await prisma.deskCard.findUnique({ where: { id: input.deskCardId } });
    if (!card) throw new NotFoundException(`Desk card ${input.deskCardId} not found`);
    if (card.status === ApprovalStatus.RETIRED) {
      throw new BadRequestException("Cannot add activities to a retired desk card");
    }

    const activity = await prisma.deskCardActivity.create({
      data: {
        deskCardId: input.deskCardId,
        title: input.title.trim(),
        description: input.description?.trim(),
        taskTypeId: input.taskTypeId,
        priority: input.priority,
        reviewerEmployeeId: input.reviewerEmployeeId ?? null,
        estimatedMinutes: input.estimatedMinutes,
        frequency: input.frequency ?? null,
        interval: input.interval ?? 1,
        daysOfWeek: input.daysOfWeek ?? [],
        dayOfMonth: input.dayOfMonth ?? null,
        leadTimeDays: input.leadTimeDays ?? 0,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        status: ApprovalStatus.DRAFT,
      },
    });

    await this.audit.record({
      entityType: "DeskCardActivity",
      entityId: activity.id,
      action: "created",
      actorId: actor.id,
      after: {
        deskCardId: activity.deskCardId,
        title: activity.title,
        priority: activity.priority,
        reviewerEmployeeId: activity.reviewerEmployeeId,
        estimatedMinutes: activity.estimatedMinutes,
        frequency: activity.frequency,
      },
    });

    return activity;
  }

  /**
   * TM-FR-076, and the reason it exists.
   *
   * Estimated effort is the input to capacity and to Weighted Task Units. If
   * the person being measured could set their own, inflating it would make them
   * look fully loaded on no extra work. So it is governed: Department Head or
   * System Admin only, and every change carries a reason into the audit trail.
   *
   * The holder is not powerless - they raise a revision request, which is a
   * notification, not a write. That path is deliberately not a mutation here.
   */
  /**
   * Amend an activity.
   *
   * Nothing here touches tasks that already exist. A task was generated under
   * the definition in force at the time, the same way its workflow version is
   * pinned at creation - an auditor must see the obligation that actually
   * applied, not whatever it was later revised to. Amendments take effect on
   * work generated from now on.
   *
   * Changes are sorted by what they do, not by which field they touch:
   *
   *   Wording      title and description. A typo fix is not a governance event.
   *   Substance    priority, effort, task type, reviewer. These change how the
   *                work is weighted and who checks it, so they need a reason.
   *   Definition   anything recurrence. These change WHAT WORK EXISTS, which is
   *                the thing approval was granted for - so the activity returns
   *                to draft and somebody has to approve it again.
   */
  async amend(
    actor: AuthenticatedUser,
    activityId: string,
    changes: {
      title?: string;
      description?: string | null;
      priority?: Priority;
      estimatedMinutes?: number;
      taskTypeId?: string;
      reviewerEmployeeId?: string | null;
      frequency?: RecurrenceFrequency | null;
      interval?: number;
      daysOfWeek?: number[];
      dayOfMonth?: number | null;
      leadTimeDays?: number;
    },
    reason?: string,
  ) {
    if (!this.canGovern(actor)) {
      throw new ForbiddenException(
        "Activities may only be amended by a Department Head or System Admin.",
      );
    }

    const before = await prisma.deskCardActivity.findUnique({ where: { id: activityId } });
    if (!before) throw new NotFoundException(`Activity ${activityId} not found`);

    const SUBSTANCE = ["priority", "estimatedMinutes", "taskTypeId", "reviewerEmployeeId"] as const;
    const DEFINITION = ["frequency", "interval", "daysOfWeek", "dayOfMonth", "leadTimeDays"] as const;

    const touched = (keys: readonly string[]) =>
      keys.some((k) => {
        const next = (changes as Record<string, unknown>)[k];
        if (next === undefined) return false;
        const current = (before as unknown as Record<string, unknown>)[k];
        return JSON.stringify(next) !== JSON.stringify(current);
      });

    const changesSubstance = touched(SUBSTANCE);
    const changesDefinition = touched(DEFINITION);

    if ((changesSubstance || changesDefinition) && !reason?.trim()) {
      throw new BadRequestException(
        "Changing what the work is, how it is weighted or when it recurs requires a reason.",
      );
    }

    if (changes.estimatedMinutes !== undefined && changes.estimatedMinutes <= 0) {
      throw new BadRequestException("Estimated effort must be greater than zero");
    }

    const returnsToDraft = changesDefinition && before.status === ApprovalStatus.APPROVED;

    const after = await prisma.deskCardActivity.update({
      where: { id: activityId },
      data: {
        ...(changes.title !== undefined ? { title: changes.title.trim() } : {}),
        ...(changes.description !== undefined
          ? { description: changes.description?.trim() || null }
          : {}),
        ...(changes.priority !== undefined ? { priority: changes.priority } : {}),
        ...(changes.estimatedMinutes !== undefined
          ? { estimatedMinutes: changes.estimatedMinutes }
          : {}),
        ...(changes.taskTypeId !== undefined ? { taskTypeId: changes.taskTypeId } : {}),
        ...(changes.reviewerEmployeeId !== undefined
          ? { reviewerEmployeeId: changes.reviewerEmployeeId }
          : {}),
        ...(changes.frequency !== undefined ? { frequency: changes.frequency } : {}),
        ...(changes.interval !== undefined ? { interval: changes.interval } : {}),
        ...(changes.daysOfWeek !== undefined ? { daysOfWeek: changes.daysOfWeek } : {}),
        ...(changes.dayOfMonth !== undefined ? { dayOfMonth: changes.dayOfMonth } : {}),
        ...(changes.leadTimeDays !== undefined ? { leadTimeDays: changes.leadTimeDays } : {}),
        ...(returnsToDraft ? { status: ApprovalStatus.DRAFT } : {}),
      },
    });

    await this.audit.record({
      entityType: "DeskCardActivity",
      entityId: activityId,
      action: changesDefinition
        ? "definition_amended"
        : changesSubstance
          ? "amended"
          : "wording_amended",
      actorId: actor.id,
      before: {
        title: before.title,
        priority: before.priority,
        estimatedMinutes: before.estimatedMinutes,
        taskTypeId: before.taskTypeId,
        reviewerEmployeeId: before.reviewerEmployeeId,
        frequency: before.frequency,
        interval: before.interval,
        daysOfWeek: before.daysOfWeek,
        dayOfMonth: before.dayOfMonth,
        leadTimeDays: before.leadTimeDays,
        status: before.status,
      },
      after: {
        title: after.title,
        priority: after.priority,
        estimatedMinutes: after.estimatedMinutes,
        taskTypeId: after.taskTypeId,
        reviewerEmployeeId: after.reviewerEmployeeId,
        frequency: after.frequency,
        interval: after.interval,
        daysOfWeek: after.daysOfWeek,
        dayOfMonth: after.dayOfMonth,
        leadTimeDays: after.leadTimeDays,
        status: after.status,
        returnedToDraft: returnsToDraft,
      },
      reason,
    });

    return { activity: after, returnedToDraft: returnsToDraft };
  }

  async amendEstimatedMinutes(
    actor: AuthenticatedUser,
    activityId: string,
    estimatedMinutes: number,
    reason: string,
  ) {
    if (!this.canGovern(actor)) {
      throw new ForbiddenException(
        "Estimated effort may only be changed by a Department Head or System Admin. " +
          "Raise a revision request instead.",
      );
    }
    if (!reason?.trim()) {
      throw new BadRequestException("Changing estimated effort requires a reason");
    }
    if (estimatedMinutes <= 0) {
      throw new BadRequestException("Estimated effort must be greater than zero");
    }

    const before = await prisma.deskCardActivity.findUnique({ where: { id: activityId } });
    if (!before) throw new NotFoundException(`Activity ${activityId} not found`);
    if (before.estimatedMinutes === estimatedMinutes) {
      throw new BadRequestException("Estimated effort is already that value");
    }

    const after = await prisma.deskCardActivity.update({
      where: { id: activityId },
      data: { estimatedMinutes },
    });

    await this.audit.record({
      entityType: "DeskCardActivity",
      entityId: activityId,
      action: "estimated_effort_changed",
      actorId: actor.id,
      before: { estimatedMinutes: before.estimatedMinutes },
      after: { estimatedMinutes: after.estimatedMinutes },
      reason,
    });

    return after;
  }

  async setStatus(actor: AuthenticatedUser, activityId: string, to: ApprovalStatus, reason?: string) {
    if (!this.canGovern(actor)) {
      throw new ForbiddenException("Changing activity status requires Department Head or System Admin");
    }

    const before = await prisma.deskCardActivity.findUnique({
      where: { id: activityId },
      include: { taskType: true },
    });
    if (!before) throw new NotFoundException(`Activity ${activityId} not found`);
    if (before.status === to) throw new BadRequestException(`Activity is already ${to}`);

    // Phase 3 gates, now live.
    if (to === ApprovalStatus.APPROVED) {
      // TM-FR-088 / Addendum 01 Section 4 rule 6: an activity that serves no
      // named control cannot be approved. This is what makes process coverage
      // meaningful rather than aspirational.
      if (!before.processId) {
        throw new BadRequestException(
          "This activity needs a Process before it can be approved - it must serve a named control",
        );
      }

      // TM-FR-081: Critical and Compliance work cannot be approved without a
      // documented, approved procedure. Everything else may be approved
      // uncovered and is reported as such - blocking all of it would stall
      // adoption across hundreds of activities (decision F2-03).
      const needsWorkflow =
        before.priority === Priority.CRITICAL || before.taskType.requiresVerification;
      if (needsWorkflow) {
        const workflow = await prisma.workflow.findUnique({
          where: { deskCardActivityId: activityId },
          select: { id: true },
        });
        const approved = workflow
          ? await prisma.workflowVersion.findFirst({
              where: { workflowId: workflow.id, status: ApprovalStatus.APPROVED },
              select: { id: true },
            })
          : null;
        if (!approved) {
          throw new BadRequestException(
            `"${before.title}" is ${before.priority === Priority.CRITICAL ? "Critical" : "a verified task type"}, ` +
              "so it needs an approved workflow before it can be approved",
          );
        }
      }
    }

    const after = await prisma.deskCardActivity.update({
      where: { id: activityId },
      data: { status: to },
    });

    await this.audit.record({
      entityType: "DeskCardActivity",
      entityId: activityId,
      action: to === ApprovalStatus.APPROVED ? "approved" : `status_changed_to_${to.toLowerCase()}`,
      actorId: actor.id,
      before: { status: before.status },
      after: { status: after.status },
      reason,
    });

    return after;
  }

  /**
   * TM-FR-002 / TM-FR-079. Pausing and deactivating both stop FUTURE generation
   * and neither touches instances already generated - a task someone is midway
   * through does not vanish because the obligation was paused.
   */
  async setPaused(actor: AuthenticatedUser, activityId: string, isPaused: boolean, reason?: string) {
    if (!this.canGovern(actor)) {
      throw new ForbiddenException("Pausing an activity requires Department Head or System Admin");
    }

    const before = await prisma.deskCardActivity.findUnique({ where: { id: activityId } });
    if (!before) throw new NotFoundException(`Activity ${activityId} not found`);

    const after = await prisma.deskCardActivity.update({
      where: { id: activityId },
      data: { isPaused },
    });

    await this.audit.record({
      entityType: "DeskCardActivity",
      entityId: activityId,
      action: isPaused ? "paused" : "resumed",
      actorId: actor.id,
      before: { isPaused: before.isPaused },
      after: { isPaused: after.isPaused },
      reason,
    });

    return after;
  }

  async setActive(actor: AuthenticatedUser, activityId: string, isActive: boolean, reason?: string) {
    if (!this.canGovern(actor)) {
      throw new ForbiddenException("Deactivating an activity requires Department Head or System Admin");
    }
    if (!isActive && !reason?.trim()) {
      throw new BadRequestException("Deactivating an activity requires a reason");
    }

    const before = await prisma.deskCardActivity.findUnique({ where: { id: activityId } });
    if (!before) throw new NotFoundException(`Activity ${activityId} not found`);

    const after = await prisma.deskCardActivity.update({
      where: { id: activityId },
      data: { isActive },
    });

    await this.audit.record({
      entityType: "DeskCardActivity",
      entityId: activityId,
      action: isActive ? "reactivated" : "deactivated",
      actorId: actor.id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
      reason,
    });

    return after;
  }

  private validateRecurrence(input: CreateActivityInput): void {
    if (!input.frequency) return;

    if ((input.interval ?? 1) < 1) {
      throw new BadRequestException("Recurrence interval must be at least 1");
    }
    if (input.frequency === RecurrenceFrequency.WEEKLY && !(input.daysOfWeek ?? []).length) {
      throw new BadRequestException("A weekly activity needs at least one day of the week");
    }
    if ((input.daysOfWeek ?? []).some((d) => d < 1 || d > 7)) {
      throw new BadRequestException("Days of the week must be 1 (Monday) to 7 (Sunday)");
    }
    const monthly: RecurrenceFrequency[] = [
      RecurrenceFrequency.MONTHLY,
      RecurrenceFrequency.QUARTERLY,
      RecurrenceFrequency.YEARLY,
    ];
    if (monthly.includes(input.frequency) && input.dayOfMonth == null) {
      throw new BadRequestException(`A ${input.frequency.toLowerCase()} activity needs a day of the month`);
    }
    if (input.dayOfMonth != null && (input.dayOfMonth < 1 || input.dayOfMonth > 31)) {
      throw new BadRequestException("Day of the month must be between 1 and 31");
    }
    if (input.endDate && input.startDate && input.endDate < input.startDate) {
      throw new BadRequestException("End date cannot be before start date");
    }
    if ((input.leadTimeDays ?? 0) < 0) {
      throw new BadRequestException("Lead time cannot be negative");
    }
  }
}
