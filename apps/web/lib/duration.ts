/**
 * Durations, written the way people say them.
 *
 * Everything is STORED as a whole number of minutes and always has been -
 * capacity, the SLA clock and the analytics weighting all count in minutes, so
 * changing the unit would ripple through calculations that have nothing to do
 * with how a figure is typed. This module changes only what is shown and what
 * is typed; nothing downstream sees anything different.
 */

/** The step the +/- buttons move by, in minutes. */
export const DURATION_STEP = 30;

/**
 * `h:mm`, as testing asked for: 90 -> "1:30", 45 -> "0:45", 600 -> "10:00".
 *
 * Not "1h 30m". A column of h:mm aligns and can be scanned down; a column of
 * mixed "45m" and "1h 30m" cannot.
 */
export function formatHhMm(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

/** The same figure in words, for a tooltip or a sentence. */
export function describeDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "not set";
  const total = Math.abs(Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"} ${m} minute${m === 1 ? "" : "s"}`;
}

/**
 * Read a typed duration back to minutes.
 *
 * Accepts what people actually type: "1:30", "90", "1h30", "1h 30m", "45m".
 * Returns null for anything it cannot read, so the caller can leave the field
 * alone rather than silently substituting a number nobody entered.
 */
export function parseHhMm(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;

  const colon = s.match(/^(\d+):([0-5]?\d)$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  const hm = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m?)?$/);
  if (hm && (hm[1] || hm[2])) {
    const h = Number(hm[1] ?? 0);
    const m = Number(hm[2] ?? 0);
    // A bare number is minutes, which is what the field held before this
    // change - somebody typing "90" out of habit should still get 90 minutes.
    if (!hm[1]) return m;
    if (m > 59) return null;
    return h * 60 + m;
  }

  return null;
}

/** Step a value, never below the floor and never off the 30-minute grid. */
export function stepDuration(minutes: number, direction: 1 | -1, min = 0): number {
  const next = minutes + direction * DURATION_STEP;
  return Math.max(min, next);
}
