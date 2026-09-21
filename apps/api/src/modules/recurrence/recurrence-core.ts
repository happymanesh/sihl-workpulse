import { RecurrenceFrequency } from "@workpulse/db";

/**
 * Recurrence date arithmetic. Pure - no Prisma, no Nest, no clock reads beyond
 * what is passed in - so every rule below can be tested exhaustively.
 *
 * This is the ONLY recurrence engine. Addendum 01 Section 3.3 establishes that
 * a Desk Card Activity supersedes the BRS's free-standing Recurring Task
 * Template; building a second generator would duplicate the holiday handling,
 * the missed-instance detection and the pause semantics, and the two would
 * drift. If you need recurrence somewhere else, call this.
 *
 * All dates are handled in UTC and normalised to midnight. Recurrence is a
 * calendar concept, not a wall-clock one: "the 22nd" must mean the 22nd
 * regardless of the server's timezone or daylight saving.
 */

export interface RecurrenceRule {
  frequency: RecurrenceFrequency | null;
  interval: number;
  /** ISO days, 1 = Monday .. 7 = Sunday. Weekly only. */
  daysOfWeek: number[];
  /** Monthly/quarterly/yearly. 31 clamps to the last day of shorter months. */
  dayOfMonth: number | null;
  startDate: Date | null;
  endDate: Date | null;
}

/** Dates on which no work is expected. Compared by calendar day, not instant. */
export type HolidaySet = ReadonlySet<string>;

export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** ISO weekday: 1 = Monday .. 7 = Sunday. */
export function isoDayOfWeek(date: Date): number {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

export function isWorkingDay(date: Date, holidays: HolidaySet = new Set()): boolean {
  const dow = isoDayOfWeek(date);
  if (dow === 6 || dow === 7) return false;
  return !holidays.has(toDayKey(date));
}

export function addDays(date: Date, days: number): Date {
  const d = atUtcMidnight(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Steps `count` working days in either direction, skipping weekends and
 * holidays. Used for lead time: "generate ten working days before it is due".
 */
export function addWorkingDays(date: Date, count: number, holidays: HolidaySet = new Set()): Date {
  if (count === 0) return atUtcMidnight(date);
  const step = count > 0 ? 1 : -1;
  let remaining = Math.abs(count);
  let cursor = atUtcMidnight(date);

  // Bounded so a pathological holiday set cannot spin forever.
  let guard = 0;
  while (remaining > 0 && guard++ < 10_000) {
    cursor = addDays(cursor, step);
    if (isWorkingDay(cursor, holidays)) remaining--;
  }
  return cursor;
}

/**
 * Moves a due date off a non-working day.
 *
 * Backwards, deliberately: a filing due on a Saturday is due by Friday, not the
 * following Monday. Pushing it forward would silently move a deadline past the
 * date the obligation actually falls on, which for a regulatory filing is the
 * difference between on time and late.
 */
export function adjustToWorkingDay(date: Date, holidays: HolidaySet = new Set()): Date {
  let cursor = atUtcMidnight(date);
  let guard = 0;
  while (!isWorkingDay(cursor, holidays) && guard++ < 400) {
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

/** Last calendar day of the month containing `date`. */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Builds a date in a given month, clamping the day to the month's length.
 * Day 31 in February becomes the 28th or 29th rather than rolling into March.
 */
function dateInMonth(year: number, monthIndex: number, day: number): Date {
  const clamped = Math.min(day, lastDayOfMonth(year, monthIndex));
  return new Date(Date.UTC(year, monthIndex, clamped));
}

const MONTH_STEP: Partial<Record<RecurrenceFrequency, number>> = {
  [RecurrenceFrequency.MONTHLY]: 1,
  [RecurrenceFrequency.QUARTERLY]: 3,
  [RecurrenceFrequency.YEARLY]: 12,
};

/**
 * An occurrence has two dates and both matter.
 *
 * `nominal` is where the rule says it falls - the 22nd. `due` is that date
 * pulled onto a working day. They differ whenever the 22nd is a weekend or a
 * holiday.
 *
 * Iteration MUST advance on `nominal`. Advancing on `due` loops forever: from
 * an adjusted Friday the 21st, the next "22nd strictly after" is the same
 * Saturday the 22nd, which adjusts back to the 21st, and so on. That bug
 * generates the same task endlessly.
 */
export interface Occurrence {
  nominal: Date;
  due: Date;
}

/**
 * The next due date strictly after `after`, or null when the rule has no more
 * occurrences (past its end date, or not a recurring rule at all).
 *
 * The returned date is holiday-adjusted, so it is the date the work is actually
 * due rather than a nominal calendar date nobody works on. Callers that iterate
 * should use nextOccurrenceDetailed and advance on `nominal`.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  after: Date,
  holidays: HolidaySet = new Set(),
): Date | null {
  return nextOccurrenceDetailed(rule, after, holidays)?.due ?? null;
}

export function nextOccurrenceDetailed(
  rule: RecurrenceRule,
  after: Date,
  holidays: HolidaySet = new Set(),
): Occurrence | null {
  if (!rule.frequency) return null;

  const interval = Math.max(rule.interval, 1);
  const start = rule.startDate ? atUtcMidnight(rule.startDate) : null;
  const end = rule.endDate ? atUtcMidnight(rule.endDate) : null;
  // Never generate before the rule starts.
  const cursor = start && start > atUtcMidnight(after) ? addDays(start, -1) : atUtcMidnight(after);

  let candidate: Date | null = null;

  if (rule.frequency === RecurrenceFrequency.DAILY) {
    candidate = addDays(cursor, interval);
  } else if (rule.frequency === RecurrenceFrequency.WEEKLY) {
    const days = [...rule.daysOfWeek].sort((a, b) => a - b);
    if (days.length === 0) return null;

    // Walk forward day by day to the next selected weekday. Interval counts
    // weeks, so with interval 2 only every second week is eligible.
    const anchor = start ?? cursor;
    let guard = 0;
    let probe = addDays(cursor, 1);
    while (guard++ < 3_000) {
      if (days.includes(isoDayOfWeek(probe))) {
        const weeksSinceAnchor = Math.floor(
          (startOfIsoWeek(probe).getTime() - startOfIsoWeek(anchor).getTime()) / (7 * 86_400_000),
        );
        if (weeksSinceAnchor % interval === 0) {
          candidate = probe;
          break;
        }
      }
      probe = addDays(probe, 1);
    }
  } else {
    const step = MONTH_STEP[rule.frequency];
    const day = rule.dayOfMonth;
    if (!step || day == null) return null;

    // Try this month, then step forward until strictly after the cursor.
    let year = cursor.getUTCFullYear();
    let month = cursor.getUTCMonth();
    let guard = 0;
    while (guard++ < 240) {
      const probe = dateInMonth(year, month, day);
      if (probe > cursor && withinInterval(probe, start, step, interval, rule.frequency)) {
        candidate = probe;
        break;
      }
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
  }

  if (!candidate) return null;
  if (end && candidate > end) return null;

  const adjusted = adjustToWorkingDay(candidate, holidays);
  // The adjustment can pull a date back before the start; that occurrence is
  // not valid, so look for the one after it instead. Search from the NOMINAL
  // date, never the adjusted one, or this recurses on the same occurrence.
  if (start && adjusted < start) return nextOccurrenceDetailed(rule, candidate, holidays);
  return { nominal: candidate, due: adjusted };
}

function startOfIsoWeek(date: Date): Date {
  return addDays(date, -(isoDayOfWeek(date) - 1));
}

/**
 * For monthly-family rules with an interval > 1, only every Nth period counts.
 * Measured from the rule's start month so "every 2 months from March" means
 * March, May, July - not whichever months happen to be even.
 */
function withinInterval(
  candidate: Date,
  start: Date | null,
  monthStep: number,
  interval: number,
  frequency: RecurrenceFrequency,
): boolean {
  if (interval === 1) return true;
  const anchor = start ?? candidate;
  const months =
    (candidate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (candidate.getUTCMonth() - anchor.getUTCMonth());
  const periods = months / monthStep;
  if (!Number.isInteger(periods)) return frequency === RecurrenceFrequency.MONTHLY ? false : false;
  return periods % interval === 0;
}

/**
 * When an instance for `dueDate` should be created: `leadTimeDays` working days
 * beforehand (TM-FR-001). Lead time zero means generate on the due date.
 */
export function generationDateFor(dueDate: Date, leadTimeDays: number, holidays: HolidaySet = new Set()): Date {
  if (leadTimeDays <= 0) return atUtcMidnight(dueDate);
  return addWorkingDays(dueDate, -leadTimeDays, holidays);
}

/**
 * Every due date that should have an instance created by `asOf`, given what was
 * last generated.
 *
 * Driven by `lastGeneratedFor` rather than by the current date alone, which is
 * what makes the job idempotent: running it twice, or after an outage, produces
 * each occurrence exactly once. `maxPerRun` bounds a long catch-up so a rule
 * dormant for a year cannot flood the queue in one pass.
 */
export function dueDatesToGenerate(
  rule: RecurrenceRule,
  lastGeneratedFor: Date | null,
  asOf: Date,
  leadTimeDays: number,
  holidays: HolidaySet = new Set(),
  maxPerRun = 24,
): Date[] {
  if (!rule.frequency) return [];

  const out: Date[] = [];
  // Start from the last generated occurrence, or just before the rule's start.
  let cursor = lastGeneratedFor
    ? atUtcMidnight(lastGeneratedFor)
    : addDays(rule.startDate ? atUtcMidnight(rule.startDate) : atUtcMidnight(asOf), -1);

  while (out.length < maxPerRun) {
    const occurrence = nextOccurrenceDetailed(rule, cursor, holidays);
    if (!occurrence) break;

    const generateOn = generationDateFor(occurrence.due, leadTimeDays, holidays);
    if (generateOn > atUtcMidnight(asOf)) break;

    out.push(occurrence.due);
    // Advance on the NOMINAL date. Using occurrence.due here loops forever
    // whenever a due date was adjusted backwards off a weekend.
    cursor = occurrence.nominal;
  }

  return out;
}
