import { TaskStatus } from "@workpulse/db";
import {
  allowedNextStates,
  canTransition,
  isClockPaused,
  isTerminal,
  reasonRequiredFor,
  type TransitionRequest,
} from "./task-lifecycle";

/** A permissive baseline; each test tightens only what it is about. */
function req(overrides: Partial<TransitionRequest> & Pick<TransitionRequest, "from" | "to">): TransitionRequest {
  return {
    reason: "because",
    checklistSatisfied: true,
    requiresVerification: false,
    hasEvidence: true,
    requiresEvidence: false,
    ...overrides,
  };
}

describe("task lifecycle", () => {
  describe("the happy path", () => {
    const path: [TaskStatus, TaskStatus][] = [
      [TaskStatus.DRAFT, TaskStatus.ASSIGNED],
      [TaskStatus.ASSIGNED, TaskStatus.ACCEPTED],
      [TaskStatus.ACCEPTED, TaskStatus.IN_PROGRESS],
      [TaskStatus.IN_PROGRESS, TaskStatus.PENDING_REVIEW],
      [TaskStatus.PENDING_REVIEW, TaskStatus.COMPLETED],
      [TaskStatus.COMPLETED, TaskStatus.VERIFIED],
      [TaskStatus.VERIFIED, TaskStatus.CLOSED],
    ];

    it.each(path)("allows %s -> %s", (from, to) => {
      expect(canTransition(req({ from, to })).ok).toBe(true);
    });
  });

  describe("rejects transitions that do not exist", () => {
    it("cannot skip from Draft straight to Closed", () => {
      const r = canTransition(req({ from: TaskStatus.DRAFT, to: TaskStatus.CLOSED }));
      expect(r).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    });

    it("cannot move backwards from Closed to In Progress", () => {
      // Reopened is the only way out of Closed, and it is audited.
      const r = canTransition(req({ from: TaskStatus.CLOSED, to: TaskStatus.IN_PROGRESS }));
      expect(r).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    });

    it("Cancelled is terminal", () => {
      expect(allowedNextStates(TaskStatus.CANCELLED)).toHaveLength(0);
      expect(isTerminal(TaskStatus.CANCELLED)).toBe(true);
    });

    it("rejects a no-op transition to the same state", () => {
      const r = canTransition(req({ from: TaskStatus.IN_PROGRESS, to: TaskStatus.IN_PROGRESS }));
      expect(r).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    });
  });

  describe("Completed vs Verified vs Closed are distinct", () => {
    it("a type requiring verification cannot go Completed -> Closed", () => {
      const r = canTransition(
        req({ from: TaskStatus.COMPLETED, to: TaskStatus.CLOSED, requiresVerification: true }),
      );
      expect(r).toMatchObject({ ok: false, code: "VERIFICATION_REQUIRED" });
    });

    it("a type not requiring verification may auto-close from Completed", () => {
      const r = canTransition(
        req({ from: TaskStatus.COMPLETED, to: TaskStatus.CLOSED, requiresVerification: false }),
      );
      expect(r.ok).toBe(true);
    });

    it("Verified -> Closed is allowed even when verification is required", () => {
      const r = canTransition(
        req({ from: TaskStatus.VERIFIED, to: TaskStatus.CLOSED, requiresVerification: true }),
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("the checklist gate (TM-FR-006)", () => {
    it("blocks Completion while an item is neither done nor waived", () => {
      const r = canTransition(
        req({ from: TaskStatus.IN_PROGRESS, to: TaskStatus.COMPLETED, checklistSatisfied: false }),
      );
      expect(r).toMatchObject({ ok: false, code: "CHECKLIST_INCOMPLETE" });
    });

    it("does not block other transitions", () => {
      const r = canTransition(
        req({ from: TaskStatus.IN_PROGRESS, to: TaskStatus.BLOCKED, checklistSatisfied: false }),
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("mandatory reasons (Section 19)", () => {
    const needReason = [
      TaskStatus.REJECTED,
      TaskStatus.REOPENED,
      TaskStatus.CANCELLED,
      TaskStatus.BLOCKED,
      TaskStatus.ON_HOLD,
      TaskStatus.DEFERRED,
    ];

    it.each(needReason)("%s requires a reason", (to) => {
      expect(reasonRequiredFor(to)).toBe(true);
    });

    it("rejects Blocked with no reason", () => {
      const r = canTransition(req({ from: TaskStatus.IN_PROGRESS, to: TaskStatus.BLOCKED, reason: "" }));
      expect(r).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    });

    it("rejects a whitespace-only reason", () => {
      const r = canTransition(req({ from: TaskStatus.CLOSED, to: TaskStatus.REOPENED, reason: "   " }));
      expect(r).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    });

    it("accepts a real reason", () => {
      const r = canTransition(
        req({ from: TaskStatus.CLOSED, to: TaskStatus.REOPENED, reason: "Filing rejected by the exchange" }),
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("Blocked is a round trip, and pauses the SLA clock", () => {
    it("can return to In Progress", () => {
      expect(canTransition(req({ from: TaskStatus.BLOCKED, to: TaskStatus.IN_PROGRESS })).ok).toBe(true);
    });

    it("pauses the clock in Blocked and On Hold, and nowhere else", () => {
      expect(isClockPaused(TaskStatus.BLOCKED)).toBe(true);
      expect(isClockPaused(TaskStatus.ON_HOLD)).toBe(true);
      expect(isClockPaused(TaskStatus.IN_PROGRESS)).toBe(false);
      expect(isClockPaused(TaskStatus.PENDING_REVIEW)).toBe(false);
    });
  });

  describe("evidence flagging (TM-FR-062) flags, it does not block", () => {
    it("flags closure with no evidence on a type that requires it", () => {
      const r = canTransition(
        req({
          from: TaskStatus.IN_PROGRESS,
          to: TaskStatus.COMPLETED,
          requiresEvidence: true,
          hasEvidence: false,
        }),
      );
      // The point: allowed, but flagged. A flag is a prompt for a manager to
      // look, never an automatic penalty on the person.
      expect(r).toEqual({ ok: true, flagForReview: true });
    });

    it("does not flag when evidence is present", () => {
      const r = canTransition(
        req({
          from: TaskStatus.IN_PROGRESS,
          to: TaskStatus.COMPLETED,
          requiresEvidence: true,
          hasEvidence: true,
        }),
      );
      expect(r).toEqual({ ok: true, flagForReview: false });
    });

    it("does not flag when the type does not require evidence", () => {
      const r = canTransition(
        req({
          from: TaskStatus.IN_PROGRESS,
          to: TaskStatus.COMPLETED,
          requiresEvidence: false,
          hasEvidence: false,
        }),
      );
      expect(r).toEqual({ ok: true, flagForReview: false });
    });
  });

  describe("rejection returns work to the assigner", () => {
    it("a reviewer can reject from Pending Review", () => {
      expect(canTransition(req({ from: TaskStatus.PENDING_REVIEW, to: TaskStatus.REJECTED })).ok).toBe(true);
    });

    it("an assignee can reject an assignment", () => {
      expect(canTransition(req({ from: TaskStatus.ASSIGNED, to: TaskStatus.REJECTED })).ok).toBe(true);
    });

    it("rejected work can be picked back up", () => {
      expect(canTransition(req({ from: TaskStatus.REJECTED, to: TaskStatus.IN_PROGRESS })).ok).toBe(true);
    });
  });

  it("every status has an entry in the transition table", () => {
    // Guards against a status being added to the enum without anyone deciding
    // what it can transition to - which would throw at runtime, not compile.
    for (const status of Object.values(TaskStatus)) {
      expect(allowedNextStates(status)).toBeDefined();
    }
  });
});
