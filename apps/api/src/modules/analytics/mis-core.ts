import { TaskStatus } from "@workpulse/db";

/**
 * Turning task rows into the MIS figures.
 *
 * Pure, and separate from the service, for two reasons. The obvious one is
 * that counting rules deserve tests. The less obvious one is that the previous
 * shape ran seven COUNT queries per row - seven per department, seven per
 * employee - and adding a column per stage would have multiplied that. One
 * query fetches the rows, this counts them, and the screen gets wider without
 * getting slower.
 */

/**
 * The fourteen statuses, grouped into stages people recognise.
 *
 * Fourteen columns is not a table anybody reads. The grouping follows what a
 * reader would do about each: work not started, work in hand, work stuck, work
 * waiting on someone else, and work finished at its three distinct degrees.
 *
 * Cancelled is in no stage: it is not work, it is work that was called off,
 * and leaving it in a stage column would inflate whichever one it landed in.
 */
export const MIS_STAGES = [
  { key: "notStarted", label: "Not started", statuses: [TaskStatus.DRAFT, TaskStatus.ASSIGNED, TaskStatus.ACCEPTED] },
  { key: "inProgress", label: "In progress", statuses: [TaskStatus.IN_PROGRESS, TaskStatus.REOPENED] },
  { key: "blocked", label: "Blocked", statuses: [TaskStatus.BLOCKED, TaskStatus.ON_HOLD, TaskStatus.DEFERRED] },
  { key: "pendingReview", label: "Pending review", statuses: [TaskStatus.PENDING_REVIEW] },
  { key: "rejected", label: "Rejected", statuses: [TaskStatus.REJECTED] },
  { key: "completed", label: "Completed", statuses: [TaskStatus.COMPLETED] },
  { key: "verified", label: "Verified", statuses: [TaskStatus.VERIFIED] },
  { key: "closed", label: "Closed", statuses: [TaskStatus.CLOSED] },
] as const;

export type MisStageKey = (typeof MIS_STAGES)[number]["key"];

/** Which stage a status belongs to, or null for one that belongs to none. */
export function stageOf(status: TaskStatus): MisStageKey | null {
  const stage = MIS_STAGES.find((s) => (s.statuses as readonly TaskStatus[]).includes(status));
  return stage ? stage.key : null;
}

export interface MisTaskRow {
  status: TaskStatus;
  dueDate: Date;
  completedAt: Date | null;
  isMissed: boolean;
  priority: string;
}

export interface MisCounts {
  total: number;
  stages: Record<MisStageKey, number>;
  overdue: number;
  critical: number;
  /** Recurring instances that came due and were never opened at all. */
  neverStarted: number;
  completedInPeriod: number;
  onTimeInPeriod: number;
  onTimePercent: number | null;
}

/** Statuses that are no longer anybody's to act on. */
const SETTLED: readonly TaskStatus[] = [TaskStatus.CLOSED, TaskStatus.CANCELLED];
/** Statuses where the work is asserted done, for the on-time measure. */
const DONE: readonly TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.VERIFIED, TaskStatus.CLOSED];

function emptyStages(): Record<MisStageKey, number> {
  return Object.fromEntries(MIS_STAGES.map((s) => [s.key, 0])) as Record<MisStageKey, number>;
}

export function emptyCounts(): MisCounts {
  return {
    total: 0,
    stages: emptyStages(),
    overdue: 0,
    critical: 0,
    neverStarted: 0,
    completedInPeriod: 0,
    onTimeInPeriod: 0,
    onTimePercent: null,
  };
}

/**
 * Count one scope's rows.
 *
 * On-time is measured only over work finished IN the period, because that is
 * the only set where the question has an answer: an open task has no
 * completion date to compare, and counting it as late would make the figure
 * move for reasons that have nothing to do with performance.
 */
export function aggregate(
  rows: readonly MisTaskRow[],
  opts: { now: Date; periodStart: Date; periodEnd: Date },
): MisCounts {
  const counts = emptyCounts();

  for (const r of rows) {
    counts.total += 1;

    const stage = stageOf(r.status);
    if (stage) counts.stages[stage] += 1;

    const settled = SETTLED.includes(r.status);
    // Verified work is done and waiting on a formality, so it is not chased.
    if (!settled && r.status !== TaskStatus.VERIFIED && r.dueDate < opts.now) counts.overdue += 1;
    if (!settled && r.priority === "CRITICAL") counts.critical += 1;
    if (r.isMissed) counts.neverStarted += 1;

    if (
      r.completedAt &&
      DONE.includes(r.status) &&
      r.completedAt >= opts.periodStart &&
      r.completedAt <= opts.periodEnd
    ) {
      counts.completedInPeriod += 1;
      if (r.completedAt <= r.dueDate) counts.onTimeInPeriod += 1;
    }
  }

  counts.onTimePercent =
    counts.completedInPeriod === 0
      ? null
      : Math.round((counts.onTimeInPeriod / counts.completedInPeriod) * 100);

  return counts;
}

/** Group rows by a key, then count each group. Used for every row-level view. */
export function aggregateBy<K extends string>(
  rows: readonly (MisTaskRow & { key: K | null })[],
  keys: readonly { id: K; label: string }[],
  opts: { now: Date; periodStart: Date; periodEnd: Date },
): { id: K; label: string; counts: MisCounts }[] {
  const buckets = new Map<K, MisTaskRow[]>();
  for (const k of keys) buckets.set(k.id, []);
  for (const r of rows) {
    if (r.key === null) continue;
    buckets.get(r.key)?.push(r);
  }
  return keys.map((k) => ({
    id: k.id,
    label: k.label,
    counts: aggregate(buckets.get(k.id) ?? [], opts),
  }));
}

/**
 * CSV, built here so the same numbers the screen shows are the ones exported.
 *
 * Quoting is not optional: department and people's names contain commas and
 * apostrophes, and a name with a comma silently shifts every later column.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const cell = (v: string | number | null): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
