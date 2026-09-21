import { Priority } from "@workpulse/db";

/**
 * Operational Task Analytics, per Addendum 02.
 *
 * Pure, and deliberately incomplete: this module computes the five COMPONENTS
 * and stops there. There is no composite score function, because Addendum 02
 * stages the weighted score behind a shadow quarter and HR sign-off, and the
 * easiest way to accidentally ship a score early is to have one lying around.
 *
 * Every component is a ratio against the individual's OWN governed obligations,
 * never against a peer's volume. That is what makes the numbers comparable
 * between a compliance officer filing twelve returns a year and a support
 * executive closing three hundred tickets a month.
 */

// ---------------------------------------------------------------------------
// Weighted Task Units (Addendum 02 Section 2)
// ---------------------------------------------------------------------------

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  CRITICAL: 3.0,
  URGENT: 2.4,
  HIGH: 1.8,
  MEDIUM: 1.2,
  LOW: 1.0,
};

/** One WTU is one priority-neutral half-hour of committed work. */
export const WTU_BASELINE_MINUTES = 30;

export interface WeightedTask {
  priority: Priority;
  estimatedMinutes: number | null;
}

/**
 * Effort sums linearly, which makes WTU splitting-neutral: one 120-minute task
 * and four 30-minute tasks are worth exactly the same. There is no arithmetic
 * advantage to task-splitting, so the heuristic in antigaming-core exists to
 * catch the reporting distortion, not an exploit in the maths.
 *
 * A task with no estimate falls back to the baseline rather than counting as
 * zero - unestimated work is still work.
 */
export function wtu(task: WeightedTask): number {
  const minutes = task.estimatedMinutes ?? WTU_BASELINE_MINUTES;
  return PRIORITY_WEIGHT[task.priority] * (minutes / WTU_BASELINE_MINUTES);
}

export function sumWtu(tasks: WeightedTask[]): number {
  return tasks.reduce((total, t) => total + wtu(t), 0);
}

// ---------------------------------------------------------------------------
// The five components
// ---------------------------------------------------------------------------

export interface ComponentInputs {
  /** Everything due in the period, flagged work already removed. */
  wtuDue: number;
  wtuClosed: number;
  /** Closed within SLA on the paused-adjusted clock. */
  wtuOnTimeOfSlaTracked: number;
  wtuSlaTracked: number;
  wtuReopened: number;
  wtuRejected: number;
  wtuEvidenceFlagged: number;
  /** Control obligations: maker-checker, approvals, reviews. */
  controlObligationsOwed: number;
  controlObligationsMet: number;
  /** Work closed that was not on the person's own desk card. */
  wtuBeyondDeskCard: number;
}

export interface Components {
  execution: number;
  timeliness: number;
  quality: number;
  governance: number;
  contribution: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Division that yields null rather than NaN or Infinity when there is nothing to divide by. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return clamp01(numerator / denominator);
}

/**
 * The five components. Any that cannot be computed comes back as 1 - a person
 * with no SLA-tracked work has not failed at timeliness, and scoring them zero
 * for the absence of an obligation would be nonsense.
 */
export function computeComponents(i: ComponentInputs): Components {
  return {
    // Of what you committed to, how much did you deliver?
    execution: ratio(i.wtuClosed, i.wtuDue) ?? 1,

    // Of what you delivered, how much was on time - excluding paused time?
    timeliness: ratio(i.wtuOnTimeOfSlaTracked, i.wtuSlaTracked) ?? 1,

    // Did the work hold up? A task reopened twice counts once; repeated
    // reopening says something about the review process, not the performer.
    quality: i.wtuClosed <= 0 ? 1 : clamp01(1 - (i.wtuReopened + i.wtuRejected + i.wtuEvidenceFlagged) / i.wtuClosed),

    // Did you meet the control obligations attached to your role?
    governance: ratio(i.controlObligationsMet, i.controlObligationsOwed) ?? 1,

    // Beyond-KRA, capped at 1 so stepping up cannot excuse abandoning your own
    // obligations.
    contribution: Math.min(ratio(i.wtuBeyondDeskCard, i.wtuDue) ?? 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Volume floor (Addendum 02 Section 4.1)
// ---------------------------------------------------------------------------

export const DEFAULT_VOLUME_FLOOR_WTU = 20;

/**
 * Below the floor the components are not meaningful.
 *
 * Someone on extended leave, newly joined, or holding a handful of very large
 * items must be reported as "insufficient data" - NOT as a low result. Those
 * two look identical on a chart and mean opposite things.
 */
export function hasSufficientVolume(wtuDue: number, floor = DEFAULT_VOLUME_FLOOR_WTU): boolean {
  return wtuDue >= floor;
}

// ---------------------------------------------------------------------------
// Priority-distribution normalisation (Addendum 02 Section 6.2)
// ---------------------------------------------------------------------------

export const DEFAULT_CRITICAL_URGENT_CEILING = 0.25;

/**
 * Whether an assigner's priority mix is abnormal enough to normalise.
 *
 * If a manager marks everything Critical, their team's weights inflate against
 * everyone else's. Detected on the ASSIGNER, never on the performer - the
 * person receiving inflated work did not choose its priority.
 */
export function isPriorityInflated(
  priorities: Priority[],
  ceiling = DEFAULT_CRITICAL_URGENT_CEILING,
): boolean {
  if (priorities.length === 0) return false;
  const elevated = priorities.filter((p) => p === Priority.CRITICAL || p === Priority.URGENT).length;
  return elevated / priorities.length > ceiling;
}

/** Scale factor bringing an inflated distribution back to the ceiling. */
export function normalisationFactor(
  priorities: Priority[],
  ceiling = DEFAULT_CRITICAL_URGENT_CEILING,
): number {
  if (!isPriorityInflated(priorities, ceiling)) return 1;
  const elevated = priorities.filter((p) => p === Priority.CRITICAL || p === Priority.URGENT).length;
  return (ceiling * priorities.length) / elevated;
}
