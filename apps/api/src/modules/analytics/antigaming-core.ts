import { TaskFlagType } from "@workpulse/db";

/**
 * Anti-gaming heuristics (TM-FR-062 to 064).
 *
 * Every function here produces a FLAG, never a penalty. Addendum 02 Section 4.7
 * is explicit: flagged work leaves both numerator and denominator until a human
 * reviews it. A heuristic that quietly docked someone's numbers would be worse
 * than having none, because it would be wrong invisibly.
 *
 * All thresholds are parameters with documented defaults, so SIHL can calibrate
 * them against real behaviour rather than arguing about them in the abstract.
 */

export interface FlagCandidate {
  flagType: TaskFlagType;
  subjectEmployeeId: string | null;
  taskId: string | null;
  detail: string;
}

// ---------------------------------------------------------------------------
// TM-FR-062: closure without evidence
// ---------------------------------------------------------------------------

export interface ClosureEvidence {
  taskId: string;
  reference: string;
  assigneeEmployeeId: string;
  requiresEvidence: boolean;
  hasChecklistCompletion: boolean;
  hasAttachment: boolean;
  hasComment: boolean;
}

export function flagClosuresWithoutEvidence(closures: ClosureEvidence[]): FlagCandidate[] {
  return closures
    .filter((c) => c.requiresEvidence && !c.hasChecklistCompletion && !c.hasAttachment && !c.hasComment)
    .map((c) => ({
      flagType: TaskFlagType.CLOSED_WITHOUT_EVIDENCE,
      subjectEmployeeId: c.assigneeEmployeeId,
      taskId: c.taskId,
      detail: `${c.reference} was closed with no checklist completion, attachment or comment, on a task type that requires evidence`,
    }));
}

// ---------------------------------------------------------------------------
// TM-FR-063: reassignment patterns
// ---------------------------------------------------------------------------

export interface ReassignmentEvent {
  taskId: string;
  fromEmployeeId: string;
  byUserId: string;
  wasOverdue: boolean;
}

export const DEFAULT_REASSIGNMENT_THRESHOLD = 3;

/**
 * Repeated reassignment of OVERDUE work away from one person by one manager.
 *
 * Surfaced to the Department Head rather than buried in individual task
 * history, because the pattern is invisible one task at a time - which is
 * exactly what makes it worth detecting.
 *
 * Deliberately ambiguous by design: this can mean someone is struggling and
 * being quietly relieved, or a manager is massaging a team member's numbers.
 * The flag says "look at this", not which.
 */
export function flagReassignmentPatterns(
  events: ReassignmentEvent[],
  threshold = DEFAULT_REASSIGNMENT_THRESHOLD,
): FlagCandidate[] {
  const groups = new Map<string, ReassignmentEvent[]>();

  for (const e of events) {
    if (!e.wasOverdue) continue;
    const key = `${e.byUserId}::${e.fromEmployeeId}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  const out: FlagCandidate[] = [];
  for (const [key, group] of groups) {
    if (group.length < threshold) continue;
    const [, fromEmployeeId] = key.split("::");
    out.push({
      flagType: TaskFlagType.REASSIGNMENT_PATTERN,
      subjectEmployeeId: fromEmployeeId,
      taskId: null,
      detail: `${group.length} overdue tasks were reassigned away from this employee by the same manager in the period`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// TM-FR-064: abnormal task splitting
// ---------------------------------------------------------------------------

export interface CreatedTask {
  taskId: string;
  createdByEmployeeId: string;
  dayKey: string;
  estimatedMinutes: number | null;
}

export const DEFAULT_SPLIT_COUNT = 10;
export const DEFAULT_TRIVIAL_MINUTES = 10;

/**
 * Many trivial tasks created by one person in one day.
 *
 * Heuristic, and weak on its own - a support desk genuinely closes many small
 * items. It is volume AND triviality AND a short window together that is worth
 * a second look, and even then it surfaces for review rather than counting
 * against anyone.
 */
export function flagAbnormalSplitting(
  created: CreatedTask[],
  countThreshold = DEFAULT_SPLIT_COUNT,
  trivialMinutes = DEFAULT_TRIVIAL_MINUTES,
): FlagCandidate[] {
  const groups = new Map<string, CreatedTask[]>();

  for (const t of created) {
    const minutes = t.estimatedMinutes ?? 0;
    if (minutes > trivialMinutes) continue;
    const key = `${t.createdByEmployeeId}::${t.dayKey}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const out: FlagCandidate[] = [];
  for (const [key, group] of groups) {
    if (group.length < countThreshold) continue;
    const [employeeId, day] = key.split("::");
    out.push({
      flagType: TaskFlagType.ABNORMAL_TASK_SPLITTING,
      subjectEmployeeId: employeeId,
      taskId: null,
      detail: `${group.length} tasks of ${trivialMinutes} minutes or less were created by this employee on ${day}`,
    });
  }
  return out;
}
