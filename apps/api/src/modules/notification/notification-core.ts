import { NotificationKind, TaskStatus } from "@workpulse/db";

/**
 * Who should be told about a task moving, and what they should be told.
 *
 * Pure - no Prisma, no Nest - so the awkward part can be tested exhaustively.
 * The awkward part is not writing rows; it is deciding who hears about what,
 * and the two rules that are easy to get wrong:
 *
 *   1. Nobody is told about their own action. A notification that says "you
 *      verified this" is noise, and a system that produces noise gets ignored
 *      - which costs you the one notification that mattered.
 *
 *   2. The same person is told once. Where somebody is both assignee and, say,
 *      the one who reopened it, they fall out by rule 1 anyway; where they
 *      would be addressed twice for different reasons, the first wins.
 */

export interface TaskForNotification {
  reference: string;
  title: string;
  assigneeEmployeeId: string;
  reviewerEmployeeId: string | null;
}

export interface NotificationDraft {
  recipientEmployeeId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
}

/**
 * Which transitions are worth interrupting somebody for.
 *
 * Deliberately short. Every stage of a task is visible on the task itself, so
 * a notification is reserved for the moments where somebody else now has to do
 * something, or where the thing they were waiting for has happened.
 */
export function notificationsForTransition(input: {
  task: TaskForNotification;
  to: TaskStatus;
  actorEmployeeId: string | null;
  reason?: string | null;
}): NotificationDraft[] {
  const { task, to, actorEmployeeId } = input;
  const drafts: NotificationDraft[] = [];
  const what = `${task.reference} — ${task.title}`;

  switch (to) {
    // The work is now yours.
    case TaskStatus.ASSIGNED:
      drafts.push({
        recipientEmployeeId: task.assigneeEmployeeId,
        kind: NotificationKind.TASK_ASSIGNED,
        title: `Assigned to you: ${what}`,
        body: "Accept it to start, or reject it back with a reason.",
      });
      break;

    // Somebody is waiting on you to check their work.
    case TaskStatus.PENDING_REVIEW:
      if (task.reviewerEmployeeId) {
        drafts.push({
          recipientEmployeeId: task.reviewerEmployeeId,
          kind: NotificationKind.TASK_REVIEW_REQUESTED,
          title: `Ready for your review: ${what}`,
          body: "It cannot be closed until you verify it.",
        });
      }
      break;

    // The thing the assignee was waiting for. This is the one testing asked
    // for: the gate blocks the close, and this says when it has lifted.
    case TaskStatus.VERIFIED:
      drafts.push({
        recipientEmployeeId: task.assigneeEmployeeId,
        kind: NotificationKind.TASK_VERIFIED,
        title: `Review confirmed: ${what}`,
        body: "Your work has been verified. It can now be closed.",
      });
      break;

    // Sent back. The reason matters more than the fact, so it leads.
    case TaskStatus.REJECTED:
      drafts.push({
        recipientEmployeeId: task.assigneeEmployeeId,
        kind: NotificationKind.TASK_REJECTED,
        title: `Sent back to you: ${what}`,
        body: input.reason?.trim() || "No reason was recorded.",
      });
      break;

    // Settled work that is live again.
    case TaskStatus.REOPENED:
      drafts.push({
        recipientEmployeeId: task.assigneeEmployeeId,
        kind: NotificationKind.TASK_REOPENED,
        title: `Reopened: ${what}`,
        body: input.reason?.trim() || "No reason was recorded.",
      });
      break;

    default:
      break;
  }

  return dedupe(drafts.filter((d) => d.recipientEmployeeId !== actorEmployeeId));
}

/** First draft per recipient wins. */
function dedupe(drafts: NotificationDraft[]): NotificationDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    if (seen.has(d.recipientEmployeeId)) return false;
    seen.add(d.recipientEmployeeId);
    return true;
  });
}
