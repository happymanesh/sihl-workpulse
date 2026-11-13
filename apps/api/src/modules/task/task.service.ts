import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  ActorType,
  Complexity,
  Priority,
  TaskCommentKind,
  TaskOrigin,
  TaskStatus,
  WorkPulseRole,
  prisma,
} from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import { IntakeService } from "../intake/intake.service";
import type { AuthenticatedUser } from "../auth/identity.service";
import { ProjectService } from "../project/project.service";
import { canViewTask } from "../analytics/visibility-core";
import { NotificationService } from "../notification/notification.service";
import { canTransition, isReviewRequired, isTerminal } from "./task-lifecycle";

export interface CreateTaskInput {
  title: string;
  description?: string;
  taskTypeId: string;
  priority: Priority;
  assigneeEmployeeId: string;
  reviewerEmployeeId?: string;
  departmentId?: string;
  dueDate: Date;
  estimatedMinutes?: number;
  /// TM-FR-061. Captured at creation; NOT yet a term in the WTU formula -
  /// that needs an Addendum 02 amendment. Recorded now so the history exists
  /// when the amendment lands.
  complexity?: Complexity;
  checklist?: string[];
  /// Earlier work this follows on from. Reference only - see Task.relatedTaskId.
  relatedTaskId?: string;
}

export interface TransitionInput {
  taskId: string;
  to: TaskStatus;
  reason?: string;
  blockedReason?: string;
  /**
   * A note to record alongside the move. Distinct from `reason`, which the
   * state machine demands for certain transitions and which explains WHY the
   * move was allowed; a remark is the person's own account of what they did.
   */
  remark?: string;
  remarkWasDictated?: boolean;
  remarkLanguage?: string | null;
  blockingOwnerEmployeeId?: string;
}

/**
 * Which kind of note a remark becomes, by the move it accompanied. The kind is
 * not decoration: the closure-evidence check looks for COMPLETION and REVIEW
 * notes specifically, so a remark left at the right moment is what keeps a
 * genuine closure from being flagged.
 */
const COMMENT_KIND_FOR: Partial<Record<TaskStatus, TaskCommentKind>> = {
  [TaskStatus.ACCEPTED]: TaskCommentKind.ACCEPTANCE,
  [TaskStatus.IN_PROGRESS]: TaskCommentKind.PROGRESS,
  [TaskStatus.COMPLETED]: TaskCommentKind.COMPLETION,
  [TaskStatus.PENDING_REVIEW]: TaskCommentKind.COMPLETION,
  [TaskStatus.VERIFIED]: TaskCommentKind.REVIEW,
  [TaskStatus.REJECTED]: TaskCommentKind.REVIEW,
};

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly projects: ProjectService,
    private readonly intake: IntakeService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Human-facing reference, e.g. WP-000042.
   *
   * Derived from a sequence rather than a count, so concurrent creation cannot
   * hand two tasks the same number. The unique constraint on Task.reference is
   * the backstop if this is ever changed carelessly.
   */
  private async nextReference(): Promise<string> {
    const [{ nextval }] = await prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('task_reference_seq') AS nextval
    `;
    return `WP-${String(nextval).padStart(6, "0")}`;
  }

  async create(actor: AuthenticatedUser, input: CreateTaskInput, origin: TaskOrigin = TaskOrigin.ADHOC) {
    if (!input.title?.trim()) throw new BadRequestException("A task needs a title");

    // Section 27: a Critical task cannot be saved without a due date. The type
    // system already requires dueDate; this catches the "critical with a date in
    // the past" case, which is the same mistake wearing a disguise.
    if (input.priority === Priority.CRITICAL && input.dueDate.getTime() < Date.now() - 86_400_000) {
      throw new BadRequestException("A Critical task cannot be created with a due date in the past");
    }

    const assignee = await prisma.employee.findUnique({ where: { id: input.assigneeEmployeeId } });
    if (!assignee) throw new NotFoundException("Assignee not found");
    if (!assignee.isActive) throw new BadRequestException("Cannot assign a task to an inactive employee");

    const reference = await this.nextReference();

    // Self-assigned work skips Accept (TM-FR-023): the person creating it has
    // already accepted it by definition.
    const selfAssigned = actor.employeeId === input.assigneeEmployeeId;
    const initialStatus = selfAssigned ? TaskStatus.ACCEPTED : TaskStatus.ASSIGNED;

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          reference,
          title: input.title.trim(),
          description: input.description?.trim(),
          taskTypeId: input.taskTypeId,
          priority: input.priority,
          origin,
          status: initialStatus,
          assigneeEmployeeId: input.assigneeEmployeeId,
          reviewerEmployeeId: input.reviewerEmployeeId,
          relatedTaskId: input.relatedTaskId,
          departmentId: input.departmentId ?? assignee.departmentId,
          dueDate: input.dueDate,
          estimatedMinutes: input.estimatedMinutes,
          complexity: input.complexity,
          checklistItems: input.checklist?.length
            ? { create: input.checklist.map((label, i) => ({ label: label.trim(), position: i })) }
            : undefined,
        },
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId: created.id,
          fromStatus: null,
          toStatus: initialStatus,
          actorUserId: actor.id,
          actorType: ActorType.USER,
        },
      });

      return created;
    });

    await this.audit.record({
      entityType: "Task",
      entityId: task.id,
      action: "created",
      actorId: actor.id,
      after: {
        reference: task.reference,
        title: task.title,
        status: task.status,
        priority: task.priority,
        assigneeEmployeeId: task.assigneeEmployeeId,
        dueDate: task.dueDate,
      },
    });

    // Creating a task for somebody else hands it to them, so they are told the
    // same way a transition into Assigned would tell them. Self-assigned work
    // starts Accepted and announces nothing - the core rule drops the actor,
    // and there is nobody else to inform.
    await this.notifications.announceTransition({
      task: {
        id: task.id,
        reference: task.reference,
        title: task.title,
        assigneeEmployeeId: task.assigneeEmployeeId,
        reviewerEmployeeId: task.reviewerEmployeeId,
      },
      to: TaskStatus.ASSIGNED,
      actorEmployeeId: actor.employeeId ?? null,
    });

    return task;
  }

  /**
   * The only path that changes a task's status.
   *
   * Every rule about *whether* a move is legal lives in task-lifecycle.ts; this
   * method is about *performing* it — permissions, side effects, history and
   * audit. Keeping the two apart is what lets the rules be tested exhaustively
   * without a database.
   */
  async transition(actor: AuthenticatedUser, input: TransitionInput) {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      include: { taskType: true, checklistItems: true },
    });
    if (!task) throw new NotFoundException(`Task ${input.taskId} not found`);

    this.assertMayAct(actor, task, input.to);

    const checklistSatisfied = task.checklistItems.every((i) => i.isDone || Boolean(i.waivedReason));
    // Evidence in Phase 1 means a completed checklist. Comments and attachments
    // join this test when they land; the shape of the check does not change.
    const hasEvidence = task.checklistItems.some((i) => i.isDone) || Boolean(task.description?.trim());

    const verdict = canTransition({
      from: task.status,
      to: input.to,
      reason: input.reason ?? input.blockedReason,
      checklistSatisfied,
      requiresVerification: task.taskType.requiresVerification,
      hasNamedReviewer: Boolean(task.reviewerEmployeeId),
      hasEvidence,
      requiresEvidence: task.taskType.requiresEvidence,
    });

    if (!verdict.ok) throw new BadRequestException(verdict.message);

    // TM-FR-029: a dependent task cannot enter In Progress while a blocking
    // predecessor is open. Checked here rather than in the state machine
    // because it needs the database - the machine stays pure.
    if (input.to === TaskStatus.IN_PROGRESS) {
      const unmet = await this.projects.unmetPredecessors(task.id);
      if (unmet.length > 0) {
        throw new BadRequestException(
          `This task is waiting on ${unmet.map((p) => p.reference).join(", ")}. ` +
            "Those must finish first.",
        );
      }
    }

    // Sending work for review when nobody is named to review it parks the task
    // where only a manager can rescue it - and the assignee cannot verify their
    // own work, so for them it is simply stuck.
    if (input.to === TaskStatus.PENDING_REVIEW && !task.reviewerEmployeeId) {
      throw new BadRequestException(
        "This task has no reviewer, so there is nobody to send it to. Assign one first.",
      );
    }

    if (input.to === TaskStatus.BLOCKED) {
      if (!input.blockedReason?.trim()) {
        throw new BadRequestException("A blocked task must record why it is blocked");
      }
      if (!input.blockingOwnerEmployeeId) {
        throw new BadRequestException("A blocked task must name who owns resolving the block");
      }
    }

    const now = new Date();
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: task.id },
        data: {
          status: input.to,
          startedAt: input.to === TaskStatus.IN_PROGRESS && !task.startedAt ? now : task.startedAt,
          completedAt: input.to === TaskStatus.COMPLETED ? now : task.completedAt,
          // Reopening undoes the verification. Leaving verifiedAt set would
          // have the screen still claim the work was checked, when what is
          // being checked no longer exists in that form.
          verifiedAt:
            input.to === TaskStatus.VERIFIED
              ? now
              : input.to === TaskStatus.REOPENED
                ? null
                : task.verifiedAt,
          closedAt: input.to === TaskStatus.CLOSED ? now : task.closedAt,
          blockedReason: input.to === TaskStatus.BLOCKED ? input.blockedReason : null,
          blockingOwnerEmployeeId:
            input.to === TaskStatus.BLOCKED ? input.blockingOwnerEmployeeId : null,
          // Reopening clears the missed flag: the work is live again.
          isMissed: input.to === TaskStatus.REOPENED ? false : task.isMissed,
        },
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId: task.id,
          fromStatus: task.status,
          toStatus: input.to,
          actorUserId: actor.id,
          actorType: ActorType.USER,
          reason: input.reason ?? input.blockedReason,
        },
      });

      return updated;
    });

    // A remark the person wrote about what they did, kept as a note on the task
    // rather than buried in the audit trail - the trail records that a move
    // happened, the note records what the work actually was. Added after the
    // transaction so a failed note cannot roll back a legitimate status change.
    if (input.remark?.trim() && actor.employeeId) {
      await prisma.taskComment.create({
        data: {
          taskId: task.id,
          authorEmployeeId: actor.employeeId,
          authorUserId: actor.id,
          body: input.remark.trim(),
          kind: COMMENT_KIND_FOR[input.to] ?? TaskCommentKind.GENERAL,
          relatedStatus: input.to,
          wasDictated: input.remarkWasDictated ?? false,
          dictatedLanguage: input.remarkLanguage ?? null,
        },
      });
    }

    await this.audit.record({
      entityType: "Task",
      entityId: task.id,
      action: "status_changed",
      actorId: actor.id,
      before: { status: task.status },
      after: {
        status: after.status,
        flaggedForReview: verdict.flagForReview,
        remarkRecorded: Boolean(input.remark?.trim()),
      },
      reason: input.reason ?? input.blockedReason,
    });

    if (verdict.flagForReview) {
      // TM-FR-062. Recorded as its own audit entry so the manager review queue
      // in Phase 6 can be built from the audit trail rather than a status flag
      // that someone could clear without a trace.
      await this.audit.record({
        entityType: "Task",
        entityId: task.id,
        action: "flagged_closed_without_evidence",
        actorId: actor.id,
        actorType: ActorType.SYSTEM,
        after: { status: after.status },
      });
    }

    // Tell the originating system where its ticket got to. Deliberately not
    // awaited into the caller's result and never allowed to throw: a tracker
    // being down must not fail somebody's attempt to move their own task. The
    // service logs a failed delivery, and the next transition pushes again.
    if (after.sourceSystemId) {
      void this.intake
        .pushStatus(after.id)
        .catch((err) =>
          this.logger.warn(`Status push-back for ${after.reference} failed: ${(err as Error).message}`),
        );
    }

    // Told after the move has committed, never before: an announcement about
    // something that then failed to happen is worse than no announcement. The
    // service swallows its own failures for the same reason the push-back
    // above does - the transition is the event, this is the courtesy.
    await this.notifications.announceTransition({
      task: {
        id: after.id,
        reference: after.reference,
        title: after.title,
        assigneeEmployeeId: after.assigneeEmployeeId,
        reviewerEmployeeId: after.reviewerEmployeeId,
      },
      to: input.to,
      actorEmployeeId: actor.employeeId ?? null,
      reason: input.reason ?? input.blockedReason,
    });

    return { task: after, flaggedForReview: verdict.flagForReview };
  }

  /**
   * Who may drive a given transition.
   *
   * Verification is the one that matters: a reviewer confirms someone else's
   * work, so the assignee can never verify their own. That is the segregation
   * of duties Addendum 01 Section 9 formalises as maker-checker, and it has no
   * override - not for a manager, not for System Admin.
   */
  private assertMayAct(
    actor: AuthenticatedUser,
    task: { assigneeEmployeeId: string; reviewerEmployeeId: string | null; status: TaskStatus },
    to: TaskStatus,
  ): void {
    const isAssignee = actor.employeeId === task.assigneeEmployeeId;
    const isReviewer = actor.employeeId === task.reviewerEmployeeId;
    const isManager =
      actor.roles.includes(WorkPulseRole.MANAGER) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD) ||
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN);

    if (to === TaskStatus.VERIFIED) {
      if (isAssignee) {
        throw new ForbiddenException(
          "You cannot verify your own work. Verification requires a different person.",
        );
      }
      if (!isReviewer && !isManager) {
        throw new ForbiddenException("Only the named reviewer or a manager can verify this task");
      }
      return;
    }

    if (to === TaskStatus.CANCELLED && !isManager && !isAssignee) {
      throw new ForbiddenException("Only the assignee or a manager can cancel a task");
    }

    if (to === TaskStatus.REOPENED && !isManager && !isReviewer) {
      throw new ForbiddenException("Only a reviewer or manager can reopen a closed task");
    }

    if (!isAssignee && !isReviewer && !isManager) {
      throw new ForbiddenException("You are not involved in this task");
    }
  }

  /**
   * Overdue is decided here, by the server's clock, not in the browser.
   *
   * Two reasons. It must not depend on the viewer's device clock - "was this
   * late" is a compliance question with one answer, not one per laptop. And
   * computing it during render makes the server and client disagree across
   * hydration, which is a real defect rather than a lint preference.
   */
  private static settled: TaskStatus[] = [TaskStatus.CLOSED, TaskStatus.CANCELLED, TaskStatus.VERIFIED];

  private static withDerived<T extends { dueDate: Date; status: TaskStatus }>(task: T, now: Date) {
    return {
      ...task,
      isOverdue: !TaskService.settled.includes(task.status) && task.dueDate.getTime() < now.getTime(),
    };
  }

  /**
   * Work that is finished with. A task here needs nobody's attention.
   *
   * Rejected is deliberately NOT in this list: rejected work is waiting on the
   * assignee to pick it back up, which is the most urgent state there is.
   */
  private static closedOut: TaskStatus[] = [TaskStatus.CLOSED, TaskStatus.CANCELLED];

  /**
   * What "Open" means on the list.
   *
   * Rejected is excluded so it stops hiding inside the Open count, and gets its
   * own filter instead - it is a distinct thing to do, not ordinary work in
   * flight.
   */
  private static notOpen: TaskStatus[] = [...TaskService.closedOut, TaskStatus.REJECTED];

  async findMine(
    actor: AuthenticatedUser,
    params: {
      includeClosed?: boolean;
      statuses?: TaskStatus[];
      from?: Date;
      to?: Date;
      search?: string;
    } = {},
  ) {
    if (!actor.employeeId) return [];

    const status = params.statuses?.length
      ? { in: params.statuses }
      : params.includeClosed
        ? undefined
        : { notIn: TaskService.notOpen };

    // The date range narrows history, never live work. A task created four
    // months ago that is still open is still yours to do, and a filter that
    // hid it would be a filter that loses work.
    const dateRange =
      params.from || params.to
        ? [
            {
              OR: [
                {
                  createdAt: {
                    ...(params.from ? { gte: params.from } : {}),
                    ...(params.to ? { lte: params.to } : {}),
                  },
                },
                { status: { notIn: TaskService.closedOut } },
              ],
            },
          ]
        : [];

    const term = params.search?.trim();
    const search = term
      ? [
          {
            OR: [
              { title: { contains: term, mode: "insensitive" as const } },
              { reference: { contains: term, mode: "insensitive" as const } },
              { description: { contains: term, mode: "insensitive" as const } },
            ],
          },
        ]
      : [];

    const rows = await prisma.task.findMany({
      where: {
        assigneeEmployeeId: actor.employeeId,
        status,
        AND: [...dateRange, ...search],
      },
      include: {
        taskType: { select: { code: true, name: true, requiresVerification: true } },
        deskCardActivity: { select: { id: true, title: true } },
      },
      orderBy: [{ dueDate: "asc" }, { priority: "asc" }],
    });
    const now = new Date();
    return rows.map((t) => TaskService.withDerived(t, now));
  }

  /**
   * How many of my tasks sit in each status, for the filter chips.
   *
   * Counted over everything assigned to me, ignoring the date range and the
   * search box on purpose: a chip that changed its number as you typed would
   * be useless for deciding which chip to press.
   */
  async myStatusCounts(actor: AuthenticatedUser) {
    if (!actor.employeeId) return { byStatus: {} as Record<string, number>, open: 0, total: 0 };

    const grouped = await prisma.task.groupBy({
      by: ["status"],
      where: { assigneeEmployeeId: actor.employeeId },
      _count: { _all: true },
    });

    const byStatus: Record<string, number> = {};
    let open = 0;
    let total = 0;
    for (const g of grouped) {
      byStatus[g.status] = g._count._all;
      total += g._count._all;
      if (!TaskService.notOpen.includes(g.status)) open += g._count._all;
    }
    return { byStatus, open, total };
  }

  async findById(actor: AuthenticatedUser, id: string) {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        taskType: true,
        assignee: { select: { id: true, name: true, email: true } },
        reviewer: { select: { id: true, name: true, email: true } },
        department: { select: { id: true, name: true } },
        deskCardActivity: {
          select: {
            id: true,
            title: true,
            deskCardId: true,
            // Who owns the obligation this task came from. For generated work
            // that is the accountable name, which the assignee may not be.
            deskCard: { select: { code: true, name: true, holder: { select: { name: true } } } },
          },
        },
        checklistItems: { orderBy: { position: "asc" } },
        statusHistory: { orderBy: { createdAt: "asc" } },
        relatedTask: { select: { id: true, reference: true, title: true, status: true } },
        relatedFrom: { select: { id: true, reference: true, title: true, status: true } },
      },
    });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    // Derived here rather than in the screen, so "Review pending" on the page
    // and the refusal from the API are the same rule and cannot disagree.
    return {
      ...task,
      reviewRequired: isReviewRequired({
        requiresVerification: task.taskType.requiresVerification,
        hasNamedReviewer: Boolean(task.reviewerEmployeeId),
      }),
    };
  }

  /**
   * Stages at which the checklist is fixed.
   *
   * The checklist gate is what stands between "I say it is done" and Completed,
   * so the list of steps has to be settled before that assertion is made.
   * Adding a step after the work was declared complete would quietly change
   * what "complete" meant, after the fact.
   */
  private static checklistFrozen: TaskStatus[] = [
    TaskStatus.COMPLETED,
    TaskStatus.VERIFIED,
    TaskStatus.CLOSED,
    TaskStatus.CANCELLED,
  ];

  /**
   * Point a task at earlier work it follows on from, or clear the pointer.
   *
   * Reference only. Nothing about this link gates a transition - see the note
   * on Task.relatedTaskId. A task cannot point at itself, and the target has
   * to be one the actor can already see, so the link cannot be used to probe
   * for the existence of work they have no access to.
   */
  async setRelatedTask(actor: AuthenticatedUser, taskId: string, relatedTaskId: string | null) {
    if (taskId === relatedTaskId) {
      throw new BadRequestException("A task cannot be linked to itself");
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, status: true, assigneeEmployeeId: true, reviewerEmployeeId: true, relatedTaskId: true },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);

    const isAssignee = actor.employeeId === task.assigneeEmployeeId;
    const isReviewer = actor.employeeId === task.reviewerEmployeeId;
    if (!isAssignee && !isReviewer && !this.canDirect(actor)) {
      throw new ForbiddenException("Only the assignee, the reviewer or a manager can link this task");
    }

    let reference: string | null = null;
    if (relatedTaskId) {
      const target = await prisma.task.findUnique({
        where: { id: relatedTaskId },
        select: { id: true, reference: true, isConfidential: true, assigneeEmployeeId: true, reviewerEmployeeId: true },
      });
      if (!target) throw new NotFoundException("That task does not exist");

      const verdict = canViewTask(
        { employeeId: actor.employeeId, roles: actor.roles, managedEmployeeIds: [] },
        {
          isConfidential: target.isConfidential,
          assigneeEmployeeId: target.assigneeEmployeeId,
          reviewerEmployeeId: target.reviewerEmployeeId,
        },
      );
      if (!verdict.canView) {
        throw new ForbiddenException("You cannot see that task, so you cannot link to it");
      }
      reference = target.reference;
    }

    const after = await prisma.task.update({
      where: { id: taskId },
      data: { relatedTaskId },
      include: { relatedTask: { select: { id: true, reference: true, title: true, status: true } } },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: taskId,
      action: relatedTaskId ? "related_task_set" : "related_task_cleared",
      actorId: actor.id,
      before: { relatedTaskId: task.relatedTaskId },
      after: { relatedTaskId, reference },
    });

    return after;
  }

  /** Tasks this person could link to: theirs, newest first, never this one. */
  async linkable(actor: AuthenticatedUser, taskId?: string, search?: string) {
    if (!actor.employeeId) return [];
    const term = search?.trim();
    return prisma.task.findMany({
      where: {
        ...(taskId ? { id: { not: taskId } } : {}),
        OR: [{ assigneeEmployeeId: actor.employeeId }, { reviewerEmployeeId: actor.employeeId }],
        ...(term
          ? {
              AND: [
                {
                  OR: [
                    { title: { contains: term, mode: "insensitive" as const } },
                    { reference: { contains: term, mode: "insensitive" as const } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: { id: true, reference: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
  }

  /** Add a step to a running task's checklist. */
  async addChecklistItem(actor: AuthenticatedUser, taskId: string, label: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, status: true, assigneeEmployeeId: true, reviewerEmployeeId: true },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);

    if (TaskService.checklistFrozen.includes(task.status)) {
      throw new BadRequestException(
        `This task is ${task.status.replace("_", " ").toLowerCase()}, so its checklist is fixed. Reopen it to add a step.`,
      );
    }

    const isAssignee = actor.employeeId === task.assigneeEmployeeId;
    const isReviewer = actor.employeeId === task.reviewerEmployeeId;
    if (!isAssignee && !isReviewer && !this.canDirect(actor)) {
      throw new ForbiddenException("Only the assignee, the reviewer or a manager can change this checklist");
    }

    const trimmed = label.trim();
    if (!trimmed) throw new BadRequestException("A checklist step needs some text");

    const last = await prisma.taskChecklistItem.findFirst({
      where: { taskId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const created = await prisma.taskChecklistItem.create({
      data: { taskId, label: trimmed, position: (last?.position ?? -1) + 1 },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: taskId,
      action: "checklist_item_added",
      actorId: actor.id,
      after: { label: created.label, position: created.position },
    });

    return created;
  }

  /**
   * Remove a step.
   *
   * Only one that was never acted on. A step already done or waived is part of
   * the record of what happened, and deleting it would let somebody tick three
   * items, delete the fourth and present that as a complete checklist. Waiving
   * exists for a step that turned out not to apply, and it carries a reason.
   */
  async removeChecklistItem(actor: AuthenticatedUser, itemId: string) {
    const item = await prisma.taskChecklistItem.findUnique({
      where: { id: itemId },
      include: { task: { select: { id: true, status: true, assigneeEmployeeId: true, reviewerEmployeeId: true } } },
    });
    if (!item) throw new NotFoundException(`Checklist item ${itemId} not found`);

    if (TaskService.checklistFrozen.includes(item.task.status)) {
      throw new BadRequestException("This task's checklist is fixed and can no longer be changed");
    }
    if (item.isDone || item.waivedReason) {
      throw new BadRequestException(
        "This step has already been done or waived, so it stays on the record. Waive it with a reason instead of removing it.",
      );
    }

    const isAssignee = actor.employeeId === item.task.assigneeEmployeeId;
    const isReviewer = actor.employeeId === item.task.reviewerEmployeeId;
    if (!isAssignee && !isReviewer && !this.canDirect(actor)) {
      throw new ForbiddenException("Only the assignee, the reviewer or a manager can change this checklist");
    }

    await prisma.taskChecklistItem.delete({ where: { id: itemId } });

    await this.audit.record({
      entityType: "Task",
      entityId: item.task.id,
      action: "checklist_item_removed",
      actorId: actor.id,
      before: { label: item.label, position: item.position },
    });

    return { id: itemId };
  }

  async setChecklistItem(
    actor: AuthenticatedUser,
    itemId: string,
    update: { isDone?: boolean; waivedReason?: string },
  ) {
    const item = await prisma.taskChecklistItem.findUnique({
      where: { id: itemId },
      include: { task: { select: { id: true, status: true, assigneeEmployeeId: true } } },
    });
    if (!item) throw new NotFoundException(`Checklist item ${itemId} not found`);

    if (isTerminal(item.task.status)) {
      throw new BadRequestException("This task is closed; its checklist can no longer be changed");
    }
    if (update.waivedReason !== undefined && !update.waivedReason.trim()) {
      throw new BadRequestException("Waiving a checklist item requires a reason");
    }

    const after = await prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: {
        isDone: update.isDone ?? item.isDone,
        completedAt: update.isDone ? new Date() : update.isDone === false ? null : item.completedAt,
        completedByUserId: update.isDone ? actor.id : item.completedByUserId,
        waivedReason: update.waivedReason ?? item.waivedReason,
      },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: item.task.id,
      action: update.waivedReason ? "checklist_item_waived" : "checklist_item_updated",
      actorId: actor.id,
      before: { label: item.label, isDone: item.isDone },
      after: { label: after.label, isDone: after.isDone },
      reason: update.waivedReason,
    });

    return after;
  }

  // ---- Reassignment and correction --------------------------------------

  /** Managers and above. The assignee moving their own work away is the thing
   *  this is designed to make visible, not a convenience to offer them. */
  private canDirect(actor: AuthenticatedUser): boolean {
    return (
      actor.roles.includes(WorkPulseRole.MANAGER) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD) ||
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN)
    );
  }

  private static readonly SETTLED: TaskStatus[] = [TaskStatus.CLOSED, TaskStatus.CANCELLED];

  /**
   * Work that has been handed on for checking, or finished. Reassigning any of
   * these would send the task back to Assigned and quietly undo a completion
   * somebody has already put their name to - so it is refused, and the manager
   * is told to reopen it first. Reopening is itself recorded, which is the
   * point: undoing a completion should leave a mark.
   */
  private static readonly HANDED_ON: TaskStatus[] = [
    TaskStatus.PENDING_REVIEW,
    TaskStatus.COMPLETED,
    TaskStatus.VERIFIED,
  ];

  /**
   * Move a task to somebody else.
   *
   * The audit row is deliberately shaped for the anti-gaming detector, which
   * has always read `action: "REASSIGN"` with the previous assignee in
   * `before` and has never had anything to find: repeatedly pushing overdue
   * work off one person and onto another is a pattern worth seeing, and it is
   * only visible if reassignment is recorded rather than done by hand in the
   * database.
   *
   * The task returns to Assigned. Whoever receives it has not accepted it, and
   * carrying the previous holder's acceptance across would put their name
   * against a commitment they never made.
   */
  async reassign(
    actor: AuthenticatedUser,
    input: { taskId: string; toEmployeeId: string; reason: string },
  ) {
    if (!this.canDirect(actor)) {
      throw new ForbiddenException(
        "Reassigning work requires a manager or above. Ask yours rather than moving it yourself.",
      );
    }
    if (!input.reason?.trim()) {
      throw new BadRequestException("Reassigning needs a reason — it is recorded against both people");
    }

    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        reference: true,
        status: true,
        assigneeEmployeeId: true,
        reviewerEmployeeId: true,
      },
    });
    if (!task) throw new NotFoundException("Task not found");

    if (TaskService.SETTLED.includes(task.status)) {
      throw new BadRequestException(
        `${task.reference} is ${task.status.toLowerCase()}, so there is nothing to reassign.`,
      );
    }
    if (TaskService.HANDED_ON.includes(task.status)) {
      throw new BadRequestException(
        `${task.reference} has already been completed or sent for review. Reopen it first — moving it now would undo a completion somebody signed their name to.`,
      );
    }
    if (task.assigneeEmployeeId === input.toEmployeeId) {
      throw new BadRequestException("That is already the assignee");
    }

    const to = await prisma.employee.findUnique({
      where: { id: input.toEmployeeId },
      select: { id: true, name: true, isActive: true },
    });
    if (!to) throw new NotFoundException("That employee does not exist");
    if (!to.isActive) {
      throw new BadRequestException(`${to.name} is no longer active, so work cannot be moved to them.`);
    }
    if (task.reviewerEmployeeId === input.toEmployeeId) {
      throw new BadRequestException(
        `${to.name} reviews this task. The same person cannot do the work and check it — change the reviewer first.`,
      );
    }

    const wasStarted = task.status !== TaskStatus.ASSIGNED && task.status !== TaskStatus.DRAFT;

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: input.taskId },
        data: {
          assigneeEmployeeId: input.toEmployeeId,
          status: TaskStatus.ASSIGNED,
          startedAt: null,
        },
      });

      // The lifecycle trail has to show the step back to Assigned, or the
      // history reads as if the new holder accepted work they never saw.
      if (wasStarted) {
        await tx.taskStatusHistory.create({
          data: {
            taskId: input.taskId,
            fromStatus: task.status,
            toStatus: TaskStatus.ASSIGNED,
            actorUserId: actor.id,
            reason: `Reassigned to ${to.name}: ${input.reason.trim()}`,
          },
        });
      }

      return updated;
    });

    await this.audit.record({
      entityType: "Task",
      entityId: input.taskId,
      action: "REASSIGN",
      actorId: actor.id,
      before: { assigneeEmployeeId: task.assigneeEmployeeId, status: task.status },
      after: { assigneeEmployeeId: input.toEmployeeId, status: after.status },
      reason: input.reason.trim(),
    });

    return after;
  }

  /**
   * Correct a task that is already running.
   *
   * Due date is singled out: moving it is the simplest way to make overdue
   * work stop looking overdue, so it always needs a reason and the old date is
   * kept beside the new one. Everything else here is ordinary correction, and
   * all of it is refused once the task is closed - editing a settled record is
   * rewriting what happened.
   */
  async update(
    actor: AuthenticatedUser,
    input: {
      taskId: string;
      dueDate?: Date;
      priority?: Priority;
      complexity?: Complexity | null;
      reviewerEmployeeId?: string | null;
      reason?: string;
    },
  ) {
    if (!this.canDirect(actor)) {
      throw new ForbiddenException("Changing a task requires a manager or above");
    }

    const before = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        reference: true,
        status: true,
        dueDate: true,
        priority: true,
        complexity: true,
        assigneeEmployeeId: true,
        reviewerEmployeeId: true,
      },
    });
    if (!before) throw new NotFoundException("Task not found");

    if (TaskService.SETTLED.includes(before.status)) {
      throw new BadRequestException(
        `${before.reference} is ${before.status.toLowerCase()}. A settled task is not edited — reopen it if it was wrong.`,
      );
    }

    const movesDueDate =
      input.dueDate !== undefined && input.dueDate.getTime() !== before.dueDate.getTime();
    if (movesDueDate && !input.reason?.trim()) {
      throw new BadRequestException(
        "Moving a due date needs a reason. It is the easiest way to make late work look on time, so it is never silent.",
      );
    }

    if (input.reviewerEmployeeId && input.reviewerEmployeeId === before.assigneeEmployeeId) {
      throw new BadRequestException(
        "The assignee cannot review their own work. Choose somebody else.",
      );
    }

    const after = await prisma.task.update({
      where: { id: input.taskId },
      data: {
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.complexity !== undefined ? { complexity: input.complexity } : {}),
        ...(input.reviewerEmployeeId !== undefined
          ? { reviewerEmployeeId: input.reviewerEmployeeId }
          : {}),
      },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: input.taskId,
      action: movesDueDate ? "due_date_moved" : "updated",
      actorId: actor.id,
      before: {
        dueDate: before.dueDate,
        priority: before.priority,
        complexity: before.complexity,
        reviewerEmployeeId: before.reviewerEmployeeId,
      },
      after: {
        dueDate: after.dueDate,
        priority: after.priority,
        complexity: after.complexity,
        reviewerEmployeeId: after.reviewerEmployeeId,
      },
      reason: input.reason?.trim(),
    });

    return after;
  }
}
