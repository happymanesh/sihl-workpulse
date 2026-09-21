/**
 * Capacity arithmetic. Pure - no Prisma, no clock reads - so it can be tested
 * exhaustively and so the same numbers appear on every screen.
 *
 * The point of this module is that capacity is *observed*, not self-reported:
 * committed minutes come from Desk Card Activities whose estimates are set by
 * the Department Head (Addendum 01 3.2b), and blocked minutes come from what
 * people actually put in their calendar.
 */

export interface TimeBlockLike {
  startAt: Date;
  endAt: Date;
}

export interface RecurringActivityLike {
  estimatedMinutes: number;
  frequency: string | null;
  interval: number;
}

/**
 * Occurrences per week by frequency.
 *
 * DAILY is 5, not 7: a daily obligation means every working day. Treating it as
 * 7 would inflate committed load by 40% for the people with the most routine
 * work, which is exactly the population this number exists to protect.
 */
const OCCURRENCES_PER_WEEK: Record<string, number> = {
  DAILY: 5,
  WEEKLY: 1,
  MONTHLY: 12 / 52,
  QUARTERLY: 4 / 52,
  YEARLY: 1 / 52,
};

/**
 * Standing commitment per week, in minutes, from a set of recurring activities.
 *
 * Non-recurring activities contribute nothing: a one-off obligation is not a
 * standing weekly load, and counting it would overstate capacity permanently.
 */
export function weeklyCommittedMinutes(activities: RecurringActivityLike[]): number {
  return activities.reduce((total, a) => {
    if (!a.frequency) return total;
    const per = OCCURRENCES_PER_WEEK[a.frequency];
    if (per == null) return total;
    return total + a.estimatedMinutes * (per / Math.max(a.interval, 1));
  }, 0);
}

/** Minutes in a block, floored at zero so a malformed range cannot subtract. */
export function blockMinutes(block: TimeBlockLike): number {
  return Math.max(0, Math.round((block.endAt.getTime() - block.startAt.getTime()) / 60_000));
}

export function totalBlockedMinutes(blocks: TimeBlockLike[]): number {
  return blocks.reduce((total, b) => total + blockMinutes(b), 0);
}

/**
 * Whether two ranges overlap. Touching endpoints do not: a block ending at
 * 10:00 and one starting at 10:00 are adjacent, not conflicting.
 */
export function overlaps(a: TimeBlockLike, b: TimeBlockLike): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

export interface Utilisation {
  budgetMinutes: number;
  committedMinutes: number;
  blockedMinutes: number;
  /** Committed against budget, as a percentage. */
  percent: number;
  isOverAllocated: boolean;
}

/**
 * TM-FR-052.
 *
 * Over-allocation is a FLAG, never a block on assignment. A manager who can see
 * someone is at 140% and assigns anyway has made a judgement; the system's job
 * is to make sure they could see it, not to overrule them.
 *
 * A zero or missing budget yields 0% rather than dividing by zero - reported as
 * "no budget set" upstream, which is a different problem from "no load".
 */
export function utilisation(
  budgetMinutes: number,
  committedMinutes: number,
  blockedMinutes: number,
): Utilisation {
  const percent = budgetMinutes > 0 ? Math.round((committedMinutes / budgetMinutes) * 100) : 0;
  return {
    budgetMinutes,
    committedMinutes: Math.round(committedMinutes),
    blockedMinutes,
    percent,
    isOverAllocated: budgetMinutes > 0 && committedMinutes > budgetMinutes,
  };
}

/** Monday 00:00 UTC of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (iso - 1));
  return d;
}

export function endOfWeek(date: Date): Date {
  const d = startOfWeek(date);
  d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

export function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}
