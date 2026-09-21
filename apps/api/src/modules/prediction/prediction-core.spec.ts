import { Priority, TaskStatus } from "@workpulse/db";
import {
  ELEVATED_BAND,
  assessAccuracy,
  assessRisk,
  isAssessable,
  type PredictionInputs,
} from "./prediction-core";

const base: PredictionInputs = {
  status: TaskStatus.IN_PROGRESS,
  priority: Priority.MEDIUM,
  activeMinutes: 60,
  resolutionMinutes: 480,
  hasStarted: true,
  reworkCount: 0,
  blockCount: 0,
  isBlockedWithoutOwner: false,
  assigneeOverdueCount: 0,
  taskTypeBreachRate: null,
  checklistProgress: null,
};

describe("SLA-breach risk", () => {
  it("is low for work that has barely started its window", () => {
    expect(assessRisk(base).band).toBe("LOW");
  });

  it("rises as the window is consumed", () => {
    const early = assessRisk({ ...base, activeMinutes: 60 }).risk;
    const late = assessRisk({ ...base, activeMinutes: 400 }).risk;
    expect(late).toBeGreaterThan(early);
  });

  it("treats not-started-and-late as its own signal", () => {
    const started = assessRisk({ ...base, activeMinutes: 300, hasStarted: true });
    const notStarted = assessRisk({ ...base, activeMinutes: 300, hasStarted: false });
    expect(notStarted.risk).toBeGreaterThan(started.risk);
    expect(notStarted.factors.map((f) => f.code)).toContain("NOT_STARTED");
  });

  it("does not penalise not-started work early in the window", () => {
    // Nothing has gone wrong yet. Flagging here would train people to ignore it.
    const factors = assessRisk({ ...base, activeMinutes: 60, hasStarted: false }).factors;
    expect(factors.map((f) => f.code)).not.toContain("NOT_STARTED");
  });

  it("treats blocked-with-nobody-to-unblock as worse than merely blocked", () => {
    const blocked = assessRisk({ ...base, blockCount: 1 }).risk;
    const orphaned = assessRisk({ ...base, blockCount: 1, isBlockedWithoutOwner: true }).risk;
    expect(orphaned).toBeGreaterThan(blocked);
  });

  it("lowers risk as the checklist progresses", () => {
    const none = assessRisk({ ...base, activeMinutes: 300, checklistProgress: 0 }).risk;
    const most = assessRisk({ ...base, activeMinutes: 300, checklistProgress: 0.9 }).risk;
    expect(most).toBeLessThan(none);
  });

  it("caps the assignee-load factor", () => {
    // Past a point, more overdue work says nothing new about THIS task.
    const six = assessRisk({ ...base, assigneeOverdueCount: 6 }).risk;
    const fifty = assessRisk({ ...base, assigneeOverdueCount: 50 }).risk;
    expect(fifty).toBeCloseTo(six, 10);
  });

  it("ignores task-type history when there is none", () => {
    const codes = assessRisk({ ...base, taskTypeBreachRate: null }).factors.map((f) => f.code);
    expect(codes).not.toContain("TYPE_HISTORY");
  });

  describe("explainability", () => {
    it("reports every factor that moved the number", () => {
      const r = assessRisk({
        ...base,
        activeMinutes: 400,
        hasStarted: false,
        reworkCount: 2,
        blockCount: 1,
        assigneeOverdueCount: 3,
        taskTypeBreachRate: 0.3,
      });
      const codes = r.factors.map((f) => f.code);
      expect(codes).toEqual(
        expect.arrayContaining(["ELAPSED", "NOT_STARTED", "REWORK", "BLOCKED_HISTORY", "ASSIGNEE_LOAD", "TYPE_HISTORY"]),
      );
    });

    it("puts the biggest contributor first", () => {
      const r = assessRisk({ ...base, activeMinutes: 460, reworkCount: 1 });
      const magnitudes = r.factors.map((f) => Math.abs(f.contribution));
      expect([...magnitudes].sort((a, b) => b - a)).toEqual(magnitudes);
    });

    it("omits factors that contributed nothing", () => {
      // A list padded with zero-weight entries is a list nobody reads.
      const r = assessRisk(base);
      expect(r.factors.every((f) => Math.abs(f.contribution) > 0)).toBe(true);
    });

    it("always produces a risk between 0 and 1", () => {
      const extreme = assessRisk({
        ...base,
        activeMinutes: 100_000,
        reworkCount: 20,
        blockCount: 20,
        isBlockedWithoutOwner: true,
        assigneeOverdueCount: 99,
        taskTypeBreachRate: 1,
      });
      expect(extreme.risk).toBeGreaterThan(0);
      expect(extreme.risk).toBeLessThanOrEqual(1);
    });

    it("survives a zero-length SLA without dividing by zero", () => {
      const r = assessRisk({ ...base, resolutionMinutes: 0 });
      expect(Number.isFinite(r.risk)).toBe(true);
    });
  });

  describe("what is not assessed", () => {
    it("skips settled work", () => {
      for (const s of [TaskStatus.CLOSED, TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.VERIFIED]) {
        expect(isAssessable(s)).toBe(false);
      }
    });

    it("skips paused work, which cannot breach while paused", () => {
      expect(isAssessable(TaskStatus.ON_HOLD)).toBe(false);
      expect(isAssessable(TaskStatus.DEFERRED)).toBe(false);
    });

    it("does assess blocked work, whose clock is paused but whose due date is not", () => {
      expect(isAssessable(TaskStatus.BLOCKED)).toBe(true);
    });
  });
});

describe("accuracy", () => {
  it("reports nothing for an empty set rather than dividing by zero", () => {
    const r = assessAccuracy([]);
    expect(r.count).toBe(0);
    expect(Number.isFinite(r.brierScore)).toBe(true);
  });

  it("scores a perfect model at zero Brier", () => {
    expect(
      assessAccuracy([
        { risk: 1, actuallyBreached: true },
        { risk: 0, actuallyBreached: false },
      ]).brierScore,
    ).toBeCloseTo(0, 10);
  });

  it("gives a model that beats the base rate positive skill", () => {
    const scored = [
      ...Array.from({ length: 8 }, () => ({ risk: 0.05, actuallyBreached: false })),
      ...Array.from({ length: 2 }, () => ({ risk: 0.95, actuallyBreached: true })),
    ];
    expect(assessAccuracy(scored).skill).toBeGreaterThan(0);
  });

  it("gives a model no better than the base rate zero or negative skill", () => {
    // The failure this is designed to catch: 95% "accurate" and useless.
    const scored = [
      ...Array.from({ length: 19 }, () => ({ risk: 0.5, actuallyBreached: false })),
      { risk: 0.5, actuallyBreached: true },
    ];
    expect(assessAccuracy(scored).skill).toBeLessThanOrEqual(0);
  });

  it("counts the confusion matrix at the flagging threshold", () => {
    const r = assessAccuracy(
      [
        { risk: 0.9, actuallyBreached: true },
        { risk: 0.9, actuallyBreached: false },
        { risk: 0.1, actuallyBreached: false },
        { risk: 0.1, actuallyBreached: true },
      ],
      ELEVATED_BAND,
    );
    expect(r).toMatchObject({ truePositives: 1, falsePositives: 1, trueNegatives: 1, falseNegatives: 1 });
  });
});
