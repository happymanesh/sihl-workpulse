import { Priority, TaskStatus } from "@workpulse/db";
import { isClockPaused } from "../task/task-lifecycle";

/**
 * SLA arithmetic. Pure - no Prisma, no clock beyond what is passed in.
 *
 * The pausable clock is the important part. Time a task spends Blocked or On
 * Hold is outside the assignee's control, so it must not count against them.
 * That rule is defined once in task-lifecycle.isClockPaused() and consumed
 * here, so the lifecycle, the SLA engine and Addendum 02's scoring can never
 * disagree about what "paused" means.
 */

export interface StatusEvent {
  toStatus: TaskStatus;
  createdAt: Date;
}

export interface ActiveTime {
  activeMinutes: number;
  pausedMinutes: number;
  totalMinutes: number;
}

/**
 * Splits a task's life into active and paused time.
 *
 * Walks the status history, treating each entry as the start of an interval
 * that ends at the next entry - or at `until` for the final one. A task that
 * has settled passes its close time as `until`, so the clock stops there rather
 * than running forever.
 */
export function computeActiveTime(history: StatusEvent[], until: Date): ActiveTime {
  if (history.length === 0) return { activeMinutes: 0, pausedMinutes: 0, totalMinutes: 0 };

  const ordered = [...history].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let active = 0;
  let paused = 0;

  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i].createdAt;
    const end = i + 1 < ordered.length ? ordered[i + 1].createdAt : until;

    // Defensive: out-of-order or future-dated rows contribute nothing rather
    // than subtracting time.
    const minutes = Math.max(0, (end.getTime() - start.getTime()) / 60_000);

    if (isClockPaused(ordered[i].toStatus)) paused += minutes;
    else active += minutes;
  }

  return {
    activeMinutes: Math.round(active),
    pausedMinutes: Math.round(paused),
    totalMinutes: Math.round(active + paused),
  };
}

// ---------------------------------------------------------------------------
// Definition precedence (TM-FR-039)
// ---------------------------------------------------------------------------

export interface SlaCandidate {
  id: string;
  taskTypeId: string | null;
  priority: Priority | null;
  departmentId: string | null;
  sourceSystemId: string | null;
  resolutionMinutes: number;
  responseMinutes: number | null;
}

export interface SlaSubject {
  taskTypeId: string;
  priority: Priority;
  departmentId: string | null;
  sourceSystemId: string | null;
}

/**
 * Weights are powers of two so specificity is a strict ordering, never a tie.
 * Task Type dominates because it is what determines the nature of the work;
 * Source System is the weakest signal.
 */
const SPECIFICITY = { taskType: 8, priority: 4, department: 2, sourceSystem: 1 };

/** A definition matches when every dimension it constrains agrees. Nulls mean "any". */
function matches(candidate: SlaCandidate, subject: SlaSubject): boolean {
  if (candidate.taskTypeId && candidate.taskTypeId !== subject.taskTypeId) return false;
  if (candidate.priority && candidate.priority !== subject.priority) return false;
  if (candidate.departmentId && candidate.departmentId !== subject.departmentId) return false;
  if (candidate.sourceSystemId && candidate.sourceSystemId !== subject.sourceSystemId) return false;
  return true;
}

export function specificityOf(candidate: SlaCandidate): number {
  return (
    (candidate.taskTypeId ? SPECIFICITY.taskType : 0) +
    (candidate.priority ? SPECIFICITY.priority : 0) +
    (candidate.departmentId ? SPECIFICITY.department : 0) +
    (candidate.sourceSystemId ? SPECIFICITY.sourceSystem : 0)
  );
}

/**
 * The most specific matching definition, or null when nothing applies.
 *
 * Null is a legitimate answer: not all work is SLA-tracked, and inventing a
 * default would silently put every task on a clock nobody agreed to.
 */
export function resolveSla(candidates: SlaCandidate[], subject: SlaSubject): SlaCandidate | null {
  const applicable = candidates.filter((c) => matches(c, subject));
  if (applicable.length === 0) return null;

  return applicable.reduce((best, c) => {
    const d = specificityOf(c) - specificityOf(best);
    // Deterministic tie-break on id, so the same inputs always give the same
    // answer even if two definitions are equally specific.
    if (d > 0) return c;
    if (d === 0 && c.id < best.id) return c;
    return best;
  });
}

// ---------------------------------------------------------------------------
// Breach state and escalation
// ---------------------------------------------------------------------------

export type SlaState = "OK" | "AT_RISK" | "BREACHED";

export interface SlaAssessment {
  state: SlaState;
  percentUsed: number;
  activeMinutes: number;
  pausedMinutes: number;
  resolutionMinutes: number;
  minutesRemaining: number;
}

/** At risk from 80% of the allowance, breached past 100%. */
export const AT_RISK_PERCENT = 80;

export function assessSla(active: ActiveTime, resolutionMinutes: number): SlaAssessment {
  // State is decided on the RAW ratio; the rounded figure is for display only.
  // Comparing the rounded value hides breaches at the boundary - 481 minutes
  // against a 480-minute SLA rounds to 100% and would read as "not breached".
  const ratio = resolutionMinutes <= 0 ? 0 : active.activeMinutes / resolutionMinutes;
  const percentUsed = Math.round(ratio * 100);

  return {
    state: ratio > 1 ? "BREACHED" : ratio >= AT_RISK_PERCENT / 100 ? "AT_RISK" : "OK",
    percentUsed,
    activeMinutes: active.activeMinutes,
    pausedMinutes: active.pausedMinutes,
    resolutionMinutes,
    minutesRemaining: Math.max(0, resolutionMinutes - active.activeMinutes),
  };
}

export interface EscalationCandidate {
  level: number;
  thresholdPercent: number;
}

/**
 * Which escalation levels are due but have not yet fired.
 *
 * Returns every unfired level whose threshold has been passed, not just the
 * highest: a task that blows through several levels during an outage should
 * produce the whole chain, because each level notifies a different person and
 * skipping one means somebody never hears about it.
 */
export function dueEscalations(
  rules: EscalationCandidate[],
  percentUsed: number,
  alreadyFiredLevels: number[],
): EscalationCandidate[] {
  const fired = new Set(alreadyFiredLevels);
  return rules
    .filter((r) => percentUsed >= r.thresholdPercent && !fired.has(r.level))
    .sort((a, b) => a.level - b.level);
}

/**
 * TM-FR-041: escalations at or above these priorities cannot be muted by the
 * recipient. A genuine escalation that can be silenced is not an escalation.
 */
export function isMutableFor(priority: Priority, ruleIsMutable: boolean): boolean {
  if (priority === Priority.CRITICAL || priority === Priority.HIGH || priority === Priority.URGENT) {
    return false;
  }
  return ruleIsMutable;
}
