import { TaskStatus } from "@workpulse/db";

/**
 * The Task lifecycle as an explicit state machine (BRS Section 14).
 *
 * This module is deliberately pure - no Prisma, no Nest, no I/O - so the rules
 * can be unit tested exhaustively without a database. The service layer applies
 * the decisions made here; it does not re-implement them.
 *
 * The default/maximal flow:
 *
 *   Draft -> Assigned -> Accepted -> In Progress -> Pending Review
 *         -> Completed -> Verified -> Closed
 *
 * with Blocked reachable from In Progress and back, and the side-states
 * Rejected / Reopened / Cancelled / On Hold / Deferred reachable from the
 * relevant points. Completed, Verified and Closed are three distinct things and
 * collapsing them would lose the distinction the BRS is built on:
 *
 *   Completed - the assignee asserts the work is done
 *   Verified  - a reviewer confirms it meets the requirement
 *   Closed    - formally closed; no further edits except comments
 */

/** Which transitions exist at all. Anything absent here is rejected. */
const ALLOWED: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  [TaskStatus.DRAFT]: [TaskStatus.ASSIGNED, TaskStatus.CANCELLED],

  [TaskStatus.ASSIGNED]: [
    TaskStatus.ACCEPTED,
    TaskStatus.REJECTED,
    // Self-assigned work skips Accept (TM-FR-023); the service decides whether
    // that applies, the machine simply permits it.
    TaskStatus.IN_PROGRESS,
    TaskStatus.CANCELLED,
    TaskStatus.ON_HOLD,
    TaskStatus.DEFERRED,
  ],

  [TaskStatus.ACCEPTED]: [
    TaskStatus.IN_PROGRESS,
    TaskStatus.BLOCKED,
    TaskStatus.CANCELLED,
    TaskStatus.ON_HOLD,
    TaskStatus.DEFERRED,
  ],

  [TaskStatus.IN_PROGRESS]: [
    TaskStatus.BLOCKED,
    TaskStatus.PENDING_REVIEW,
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
    TaskStatus.ON_HOLD,
    TaskStatus.DEFERRED,
  ],

  // Blocked is a round trip, not a dead end.
  [TaskStatus.BLOCKED]: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED, TaskStatus.ON_HOLD],

  [TaskStatus.PENDING_REVIEW]: [
    TaskStatus.COMPLETED,
    TaskStatus.VERIFIED,
    // A reviewer sending work back is a Rejection, and needs a reason.
    TaskStatus.REJECTED,
    TaskStatus.IN_PROGRESS,
  ],

  [TaskStatus.COMPLETED]: [
    TaskStatus.VERIFIED,
    // Types that do not require verification auto-close after a grace period.
    TaskStatus.CLOSED,
    TaskStatus.REJECTED,
    TaskStatus.REOPENED,
  ],

  [TaskStatus.VERIFIED]: [TaskStatus.CLOSED, TaskStatus.REOPENED],

  // Closed is terminal except for reopening, which is itself audited and feeds
  // the anti-gaming view (Section 15.18).
  [TaskStatus.CLOSED]: [TaskStatus.REOPENED],

  [TaskStatus.REJECTED]: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  [TaskStatus.REOPENED]: [TaskStatus.IN_PROGRESS, TaskStatus.ASSIGNED, TaskStatus.CANCELLED],

  // Terminal.
  [TaskStatus.CANCELLED]: [],

  [TaskStatus.ON_HOLD]: [TaskStatus.IN_PROGRESS, TaskStatus.ASSIGNED, TaskStatus.CANCELLED],
  [TaskStatus.DEFERRED]: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
};

/**
 * Transitions that cannot be made without a recorded reason.
 *
 * BRS Section 19: a reason is mandatory for reassignment, reopening,
 * cancellation and priority escalation. Rejection and blocking join that list
 * because both assert something about another person's work or availability,
 * and an unexplained one is useless to the person receiving it.
 */
const REASON_REQUIRED: readonly TaskStatus[] = [
  TaskStatus.REJECTED,
  TaskStatus.REOPENED,
  TaskStatus.CANCELLED,
  TaskStatus.BLOCKED,
  TaskStatus.ON_HOLD,
  TaskStatus.DEFERRED,
];

/** States in which a task is no longer active work. */
const TERMINAL: readonly TaskStatus[] = [TaskStatus.CLOSED, TaskStatus.CANCELLED];

/**
 * States where the SLA clock pauses (TM-FR-040). Time spent here is outside the
 * assignee's control and must never count against them - this is the rule that
 * keeps Addendum 02's Timeliness component fair, so it is defined once, here.
 */
const CLOCK_PAUSED: readonly TaskStatus[] = [TaskStatus.BLOCKED, TaskStatus.ON_HOLD];

export interface TransitionRequest {
  from: TaskStatus;
  to: TaskStatus;
  reason?: string | null;
  /** Every checklist item is done or explicitly waived. */
  checklistSatisfied: boolean;
  /** The Task Type demands a reviewer confirm the work. */
  requiresVerification: boolean;
  /** Some evidence exists: a comment, an attachment, or a completed checklist. */
  hasEvidence: boolean;
  /** The Task Type demands evidence before closure. */
  requiresEvidence: boolean;
}

export type TransitionResult =
  | { ok: true; flagForReview: boolean }
  | { ok: false; code: TransitionErrorCode; message: string };

export type TransitionErrorCode =
  | "NOT_ALLOWED"
  | "REASON_REQUIRED"
  | "CHECKLIST_INCOMPLETE"
  | "VERIFICATION_REQUIRED";

export function canTransition(req: TransitionRequest): TransitionResult {
  const { from, to } = req;

  if (from === to) {
    return { ok: false, code: "NOT_ALLOWED", message: `Task is already ${to}` };
  }

  if (!ALLOWED[from].includes(to)) {
    return {
      ok: false,
      code: "NOT_ALLOWED",
      message: `Cannot move a task from ${from} to ${to}`,
    };
  }

  if (REASON_REQUIRED.includes(to) && !req.reason?.trim()) {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      message: `Moving a task to ${to} requires a reason`,
    };
  }

  // TM-FR-006: the checklist gate. Waiving an item counts as satisfying it, but
  // the waiver carries its own reason on the item.
  if (to === TaskStatus.COMPLETED && !req.checklistSatisfied) {
    return {
      ok: false,
      code: "CHECKLIST_INCOMPLETE",
      message: "Every checklist item must be completed or waived before the task can be completed",
    };
  }

  // Section 14.1: types requiring verification cannot jump Completed -> Closed.
  if (to === TaskStatus.CLOSED && req.requiresVerification && from !== TaskStatus.VERIFIED) {
    return {
      ok: false,
      code: "VERIFICATION_REQUIRED",
      message: "This task type must be Verified before it can be Closed",
    };
  }

  // TM-FR-062: closing without evidence on a type that requires it does not
  // block the person - it flags the task so a manager reviews it before it
  // counts in analytics. A flag is a prompt for attention, never a penalty.
  const flagForReview =
    (to === TaskStatus.COMPLETED || to === TaskStatus.CLOSED) && req.requiresEvidence && !req.hasEvidence;

  return { ok: true, flagForReview };
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.includes(status);
}

export function isClockPaused(status: TaskStatus): boolean {
  return CLOCK_PAUSED.includes(status);
}

export function allowedNextStates(from: TaskStatus): readonly TaskStatus[] {
  return ALLOWED[from];
}

/**
 * The transition table, for the UI.
 *
 * Served to the client rather than duplicated there. A Kanban board that offers
 * a drop the API will refuse is worse than one that offers fewer - and a second
 * copy of these rules in the frontend would drift from this one the first time
 * either changed.
 */
export function transitionMap(): {
  allowed: Record<TaskStatus, TaskStatus[]>;
  reasonRequired: TaskStatus[];
} {
  const allowed = {} as Record<TaskStatus, TaskStatus[]>;
  for (const status of Object.values(TaskStatus)) {
    allowed[status] = [...ALLOWED[status]];
  }
  return { allowed, reasonRequired: [...REASON_REQUIRED] };
}

export function reasonRequiredFor(to: TaskStatus): boolean {
  return REASON_REQUIRED.includes(to);
}
