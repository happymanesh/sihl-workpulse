import { Priority, TaskStatus } from "@workpulse/db";

/**
 * SLA-breach risk (BRS Appendix F: the first AI capability, chosen for
 * "clearest operational payoff, lowest governance risk").
 *
 * This is an EXPLAINABLE ADDITIVE MODEL, not a fitted one, and the naming says
 * so throughout: `risk`, never `confidence` or `probability`. Three reasons
 * that is the right starting point for SIHL rather than a placeholder for a
 * "real" model:
 *
 *   1. There is no training data yet. A model fitted on an empty history would
 *      be a confident-looking random number.
 *   2. A supervisor cannot act on "0.82". They can act on "not started, 70% of
 *      the window gone, and this task type breaches a third of the time".
 *      Every factor here carries its own contribution for exactly that reason.
 *   3. When SIHL does have history, `SlaPrediction.actuallyBreached` makes this
 *      model's accuracy measurable - which is what will justify replacing it,
 *      or retiring the idea honestly if it adds nothing.
 *
 * Weights are declared constants, not magic numbers buried in the arithmetic,
 * so calibrating them is a code review rather than an archaeology exercise.
 */

export interface PredictionInputs {
  status: TaskStatus;
  priority: Priority;
  /** Active minutes consumed, paused time already excluded. */
  activeMinutes: number;
  /** The resolution SLA in minutes. */
  resolutionMinutes: number;
  /** Has the assignee done anything at all - any transition past ACCEPTED. */
  hasStarted: boolean;
  /** Times this task has been to REJECTED or REOPENED. */
  reworkCount: number;
  /** Times this task has entered BLOCKED. */
  blockCount: number;
  /** Currently blocked with nobody named as owning the unblock. */
  isBlockedWithoutOwner: boolean;
  /** The assignee's other open work that is already overdue. */
  assigneeOverdueCount: number;
  /** Historic breach rate for this task type, 0..1. Null when unknown. */
  taskTypeBreachRate: number | null;
  /** Checklist progress, 0..1. Null when the task has no checklist. */
  checklistProgress: number | null;
}

export interface RiskFactor {
  code: string;
  /** Plain-language, written for the supervisor who has to act on it. */
  label: string;
  /** Log-odds contribution. Positive raises risk, negative lowers it. */
  contribution: number;
}

export interface RiskAssessment {
  risk: number;
  band: "LOW" | "ELEVATED" | "HIGH";
  factors: RiskFactor[];
}

// ---------------------------------------------------------------------------
// Weights. All in log-odds; 0.69 is roughly "doubles the odds".
// ---------------------------------------------------------------------------

export const WEIGHTS = {
  /** Baseline: most work does NOT breach, so the prior leans safe. */
  intercept: -2.2,
  /** Per unit of SLA consumed. The dominant term, as it should be. */
  elapsedFraction: 3.4,
  /** Nothing started yet, and the window is more than half gone. */
  notStartedLate: 1.6,
  /** Each trip through rejection or reopening. */
  perRework: 0.55,
  /** Each time it has been blocked. */
  perBlock: 0.35,
  /** Blocked right now with nobody named to unblock it. */
  blockedWithoutOwner: 1.1,
  /** Per other overdue task on the same person, capped below. */
  perAssigneeOverdue: 0.18,
  /** Scaled by the task type's historic breach rate. */
  taskTypeHistory: 1.3,
  /** Scaled by checklist completion - visible progress lowers risk. */
  checklistProgress: -1.2,
  /** Critical and Urgent work attracts attention, and attention helps. */
  elevatedPriority: -0.3,
} as const;

/** Beyond this, more overdue work says nothing new about THIS task. */
export const ASSIGNEE_OVERDUE_CAP = 6;

export const ELEVATED_BAND = 0.4;
export const HIGH_BAND = 0.7;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Tasks in a settled or paused state are not assessed.
 *
 * A paused clock cannot breach while it is paused, and predicting breach for
 * something already closed is noise a supervisor has to learn to ignore - which
 * is how a useful signal becomes a dismissed one.
 */
export const UNASSESSABLE: TaskStatus[] = [
  TaskStatus.DRAFT,
  TaskStatus.COMPLETED,
  TaskStatus.VERIFIED,
  TaskStatus.CLOSED,
  TaskStatus.CANCELLED,
  TaskStatus.ON_HOLD,
  TaskStatus.DEFERRED,
];

export function isAssessable(status: TaskStatus): boolean {
  return !UNASSESSABLE.includes(status);
}

export function assessRisk(i: PredictionInputs): RiskAssessment {
  const factors: RiskFactor[] = [];
  const push = (code: string, label: string, contribution: number) => {
    // Only factors that actually moved the number are reported. A list padded
    // with zero-weight entries is a list nobody reads.
    if (Math.abs(contribution) > 1e-9) factors.push({ code, label, contribution });
  };

  const elapsed =
    i.resolutionMinutes > 0 ? Math.min(i.activeMinutes / i.resolutionMinutes, 2) : 0;

  push(
    "ELAPSED",
    `${Math.round(elapsed * 100)}% of the SLA window consumed`,
    WEIGHTS.elapsedFraction * elapsed,
  );

  if (!i.hasStarted && elapsed > 0.5) {
    push("NOT_STARTED", "Not started, and more than half the window has gone", WEIGHTS.notStartedLate);
  }

  if (i.reworkCount > 0) {
    push(
      "REWORK",
      `Returned for rework ${i.reworkCount} time${i.reworkCount === 1 ? "" : "s"}`,
      WEIGHTS.perRework * i.reworkCount,
    );
  }

  if (i.blockCount > 0) {
    push(
      "BLOCKED_HISTORY",
      `Blocked ${i.blockCount} time${i.blockCount === 1 ? "" : "s"}`,
      WEIGHTS.perBlock * i.blockCount,
    );
  }

  if (i.isBlockedWithoutOwner) {
    push(
      "BLOCKED_NO_OWNER",
      "Currently blocked with nobody named to unblock it",
      WEIGHTS.blockedWithoutOwner,
    );
  }

  if (i.assigneeOverdueCount > 0) {
    const capped = Math.min(i.assigneeOverdueCount, ASSIGNEE_OVERDUE_CAP);
    push(
      "ASSIGNEE_LOAD",
      `Assignee already has ${i.assigneeOverdueCount} overdue task${i.assigneeOverdueCount === 1 ? "" : "s"}`,
      WEIGHTS.perAssigneeOverdue * capped,
    );
  }

  if (i.taskTypeBreachRate !== null && i.taskTypeBreachRate > 0) {
    push(
      "TYPE_HISTORY",
      `This task type breaches ${Math.round(i.taskTypeBreachRate * 100)}% of the time`,
      WEIGHTS.taskTypeHistory * i.taskTypeBreachRate,
    );
  }

  if (i.checklistProgress !== null && i.checklistProgress > 0) {
    push(
      "PROGRESS",
      `${Math.round(i.checklistProgress * 100)}% of the checklist done`,
      WEIGHTS.checklistProgress * i.checklistProgress,
    );
  }

  if (i.priority === Priority.CRITICAL || i.priority === Priority.URGENT) {
    push("PRIORITY_ATTENTION", "High-priority work attracts closer attention", WEIGHTS.elevatedPriority);
  }

  const logOdds = WEIGHTS.intercept + factors.reduce((sum, f) => sum + f.contribution, 0);
  const risk = logistic(logOdds);

  return {
    risk,
    band: risk >= HIGH_BAND ? "HIGH" : risk >= ELEVATED_BAND ? "ELEVATED" : "LOW",
    // Largest absolute contribution first: the supervisor reads the top line
    // and already knows the answer.
    factors: factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
  };
}

// ---------------------------------------------------------------------------
// Accuracy
// ---------------------------------------------------------------------------

export interface ScoredPrediction {
  risk: number;
  actuallyBreached: boolean;
}

export interface AccuracyReport {
  count: number;
  /** Mean squared error between risk and outcome. Lower is better. */
  brierScore: number;
  /** How a coin-flip-at-the-base-rate would have scored. */
  baselineBrier: number;
  /** Positive means the model beat simply predicting the base rate. */
  skill: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
}

/**
 * Scores the model against what actually happened.
 *
 * Brier against the base rate rather than raw accuracy, because if 5% of tasks
 * breach then "nothing will ever breach" is 95% accurate and completely
 * useless. `skill` is the number that matters: at or below zero, this model is
 * not earning its place and should be said so plainly.
 */
export function assessAccuracy(
  scored: ScoredPrediction[],
  threshold = ELEVATED_BAND,
): AccuracyReport {
  if (scored.length === 0) {
    return {
      count: 0,
      brierScore: 0,
      baselineBrier: 0,
      skill: 0,
      truePositives: 0,
      falsePositives: 0,
      trueNegatives: 0,
      falseNegatives: 0,
    };
  }

  const baseRate = scored.filter((s) => s.actuallyBreached).length / scored.length;

  let brier = 0;
  let baseline = 0;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (const s of scored) {
    const actual = s.actuallyBreached ? 1 : 0;
    brier += (s.risk - actual) ** 2;
    baseline += (baseRate - actual) ** 2;

    const flagged = s.risk >= threshold;
    if (flagged && s.actuallyBreached) tp += 1;
    else if (flagged && !s.actuallyBreached) fp += 1;
    else if (!flagged && !s.actuallyBreached) tn += 1;
    else fn += 1;
  }

  const brierScore = brier / scored.length;
  const baselineBrier = baseline / scored.length;

  return {
    count: scored.length,
    brierScore,
    baselineBrier,
    skill: baselineBrier === 0 ? 0 : 1 - brierScore / baselineBrier,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
  };
}
