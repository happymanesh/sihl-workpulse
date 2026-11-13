import { NotificationKind, TaskStatus } from "@workpulse/db";
import { notificationsForTransition, type TaskForNotification } from "./notification-core";

const ASSIGNEE = "emp-assignee";
const REVIEWER = "emp-reviewer";
const MANAGER = "emp-manager";

function task(overrides: Partial<TaskForNotification> = {}): TaskForNotification {
  return {
    reference: "WP-000123",
    title: "Reconcile the settlement account",
    assigneeEmployeeId: ASSIGNEE,
    reviewerEmployeeId: REVIEWER,
    ...overrides,
  };
}

describe("who gets told", () => {
  describe("the one testing asked for: review confirmed", () => {
    it("tells the assignee when their work is verified", () => {
      const out = notificationsForTransition({
        task: task(),
        to: TaskStatus.VERIFIED,
        actorEmployeeId: REVIEWER,
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        recipientEmployeeId: ASSIGNEE,
        kind: NotificationKind.TASK_VERIFIED,
      });
      expect(out[0].title).toContain("Review confirmed");
      expect(out[0].title).toContain("WP-000123");
    });

    it("says the task can now be closed", () => {
      const [n] = notificationsForTransition({
        task: task(),
        to: TaskStatus.VERIFIED,
        actorEmployeeId: MANAGER,
      });
      expect(n.body).toContain("closed");
    });
  });

  describe("review requested", () => {
    it("tells the named reviewer", () => {
      const out = notificationsForTransition({
        task: task(),
        to: TaskStatus.PENDING_REVIEW,
        actorEmployeeId: ASSIGNEE,
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        recipientEmployeeId: REVIEWER,
        kind: NotificationKind.TASK_REVIEW_REQUESTED,
      });
    });

    it("tells nobody when no reviewer is named", () => {
      const out = notificationsForTransition({
        task: task({ reviewerEmployeeId: null }),
        to: TaskStatus.PENDING_REVIEW,
        actorEmployeeId: ASSIGNEE,
      });
      expect(out).toEqual([]);
    });
  });

  describe("work coming back", () => {
    it.each([
      [TaskStatus.REJECTED, NotificationKind.TASK_REJECTED],
      [TaskStatus.REOPENED, NotificationKind.TASK_REOPENED],
    ])("tells the assignee on %s", (to, kind) => {
      const out = notificationsForTransition({
        task: task(),
        to,
        actorEmployeeId: REVIEWER,
        reason: "The closing balance does not tie out",
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ recipientEmployeeId: ASSIGNEE, kind });
      expect(out[0].body).toBe("The closing balance does not tie out");
    });

    it("says so plainly when no reason was recorded", () => {
      const [n] = notificationsForTransition({
        task: task(),
        to: TaskStatus.REJECTED,
        actorEmployeeId: REVIEWER,
        reason: "   ",
      });
      expect(n.body).toBe("No reason was recorded.");
    });
  });

  /**
   * The rule that keeps the bell worth looking at. A system that tells you
   * about your own actions trains people to dismiss it without reading, and
   * then the one that mattered goes with it.
   */
  describe("nobody is told about their own action", () => {
    it("does not tell an assignee who verified their own work", () => {
      // The lifecycle forbids this anyway; the core must not depend on that.
      const out = notificationsForTransition({
        task: task(),
        to: TaskStatus.VERIFIED,
        actorEmployeeId: ASSIGNEE,
      });
      expect(out).toEqual([]);
    });

    it("does not tell a reviewer who sent work to themselves", () => {
      const out = notificationsForTransition({
        task: task(),
        to: TaskStatus.PENDING_REVIEW,
        actorEmployeeId: REVIEWER,
      });
      expect(out).toEqual([]);
    });

    it("says nothing when somebody assigns work to themselves", () => {
      const out = notificationsForTransition({
        task: task({ assigneeEmployeeId: MANAGER }),
        to: TaskStatus.ASSIGNED,
        actorEmployeeId: MANAGER,
      });
      expect(out).toEqual([]);
    });

    it("still tells the assignee when somebody else assigns to them", () => {
      const out = notificationsForTransition({
        task: task(),
        to: TaskStatus.ASSIGNED,
        actorEmployeeId: MANAGER,
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        recipientEmployeeId: ASSIGNEE,
        kind: NotificationKind.TASK_ASSIGNED,
      });
    });
  });

  describe("one row per person", () => {
    it("does not tell the same person twice", () => {
      // Assignee and reviewer being the same person is refused elsewhere, but
      // the fan-out must not produce two rows if it ever happens.
      const out = notificationsForTransition({
        task: task({ reviewerEmployeeId: ASSIGNEE }),
        to: TaskStatus.VERIFIED,
        actorEmployeeId: MANAGER,
      });
      const recipients = out.map((o) => o.recipientEmployeeId);
      expect(new Set(recipients).size).toBe(recipients.length);
    });
  });

  describe("quiet by default", () => {
    it.each([
      TaskStatus.DRAFT,
      TaskStatus.ACCEPTED,
      TaskStatus.IN_PROGRESS,
      TaskStatus.BLOCKED,
      TaskStatus.COMPLETED,
      TaskStatus.CLOSED,
      TaskStatus.CANCELLED,
      TaskStatus.ON_HOLD,
      TaskStatus.DEFERRED,
    ])("says nothing on %s", (to) => {
      expect(
        notificationsForTransition({ task: task(), to, actorEmployeeId: MANAGER }),
      ).toEqual([]);
    });
  });

  describe("the message stands on its own", () => {
    it("names the task, because it will be read away from it", () => {
      const [n] = notificationsForTransition({
        task: task(),
        to: TaskStatus.VERIFIED,
        actorEmployeeId: REVIEWER,
      });
      expect(n.title).toContain("WP-000123");
      expect(n.title).toContain("Reconcile the settlement account");
    });
  });
});
