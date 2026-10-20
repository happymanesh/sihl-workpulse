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
import { canTransition, isTerminal } from "./task-lifecycle";

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

  async findMine(actor: AuthenticatedUser, params: { includeClosed?: boolean } = {}) {
    if (!actor.employeeId) return [];
    const rows = await prisma.task.findMany({
      where: {
        assigneeEmployeeId: actor.employeeId,
        status: params.includeClosed
          ? undefined
          : { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] },
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

  async findById(actor: AuthenticatedUser, id: string) {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        taskType: true,
        assignee: { select: { id: true, name: true, email: true } },
        reviewer: { select: { id: true, name: true, email: true } },
        department: { select: { id: true, name: true } },
        deskCardActivity: { select: { id: true, title: true, deskCardId: true } },
        checklistItems: { orderBy: { position: "asc" } },
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
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
