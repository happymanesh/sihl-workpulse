import { RecurrenceFrequency } from "@workpulse/db";
import {
  addWorkingDays,
  adjustToWorkingDay,
  dueDatesToGenerate,
  generationDateFor,
  isWorkingDay,
  nextOccurrence,
  toDayKey,
  type RecurrenceRule,
} from "./recurrence-core";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    daysOfWeek: [],
    dayOfMonth: 22,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

describe("recurrence core", () => {
  describe("working days", () => {
    it("treats weekends as non-working", () => {
      expect(isWorkingDay(d("2026-09-12"))).toBe(false); // Saturday
      expect(isWorkingDay(d("2026-09-13"))).toBe(false); // Sunday
      expect(isWorkingDay(d("2026-09-14"))).toBe(true); // Monday
    });

    it("treats holidays as non-working", () => {
      const holidays = new Set([toDayKey(d("2026-09-14"))]);
      expect(isWorkingDay(d("2026-09-14"), holidays)).toBe(false);
    });

    it("steps forward over a weekend", () => {
      // Friday + 1 working day = Monday
      expect(toDayKey(addWorkingDays(d("2026-09-11"), 1))).toBe("2026-09-14");
    });

    it("steps backwards over a weekend", () => {
      // Monday - 1 working day = Friday
      expect(toDayKey(addWorkingDays(d("2026-09-14"), -1))).toBe("2026-09-11");
    });

    it("skips holidays while stepping", () => {
      const holidays = new Set([toDayKey(d("2026-09-14")), toDayKey(d("2026-09-15"))]);
      expect(toDayKey(addWorkingDays(d("2026-09-11"), 1, holidays))).toBe("2026-09-16");
    });
  });

  describe("adjusting a due date off a non-working day", () => {
    it("moves BACKWARDS, not forwards", () => {
      // A filing due on Saturday is due by Friday. Pushing it forward would
      // silently move a regulatory deadline past the date it actually falls on.
      expect(toDayKey(adjustToWorkingDay(d("2026-09-12")))).toBe("2026-09-11");
      expect(toDayKey(adjustToWorkingDay(d("2026-09-13")))).toBe("2026-09-11");
    });

    it("leaves a working day alone", () => {
      expect(toDayKey(adjustToWorkingDay(d("2026-09-11")))).toBe("2026-09-11");
    });

    it("skips back over a holiday too", () => {
      const holidays = new Set([toDayKey(d("2026-09-11"))]);
      expect(toDayKey(adjustToWorkingDay(d("2026-09-12"), holidays))).toBe("2026-09-10");
    });
  });

  describe("monthly", () => {
    it("finds the next 22nd", () => {
      const next = nextOccurrence(rule(), d("2026-09-01"));
      expect(toDayKey(next!)).toBe("2026-09-22");
    });

    it("rolls to next month once past", () => {
      const next = nextOccurrence(rule(), d("2026-09-22"));
      expect(toDayKey(next!)).toBe("2026-10-22");
    });

    it("clamps day 31 to the end of a short month rather than rolling over", () => {
      // February 31st does not exist; it must not become March 3rd.
      const next = nextOccurrence(rule({ dayOfMonth: 31 }), d("2026-02-01"));
      expect(toDayKey(next!)).toBe("2026-02-27"); // 28th is a Saturday, adjusted back
    });

    it("honours an interval of 2 from the start month", () => {
      const r = rule({ interval: 2, startDate: d("2026-03-22"), dayOfMonth: 22 });
      const first = nextOccurrence(r, d("2026-03-23"));
      expect(toDayKey(first!)).toBe("2026-05-22");
    });

    it("stops after the end date", () => {
      const r = rule({ endDate: d("2026-09-30") });
      expect(nextOccurrence(r, d("2026-09-22"))).toBeNull();
    });

    it("never generates before the start date", () => {
      const r = rule({ startDate: d("2026-12-01") });
      const next = nextOccurrence(r, d("2026-09-01"));
      expect(toDayKey(next!)).toBe("2026-12-22");
    });
  });

  describe("weekly", () => {
    const weekly = rule({
      frequency: RecurrenceFrequency.WEEKLY,
      dayOfMonth: null,
      daysOfWeek: [1, 4], // Monday and Thursday
    });

    it("finds the next selected weekday", () => {
      // Friday 11 Sep 2026 -> next Monday
      expect(toDayKey(nextOccurrence(weekly, d("2026-09-11"))!)).toBe("2026-09-14");
    });

    it("walks through both selected days", () => {
      const mon = nextOccurrence(weekly, d("2026-09-11"))!;
      const thu = nextOccurrence(weekly, mon)!;
      expect(toDayKey(thu)).toBe("2026-09-17");
    });

    it("returns null with no days selected", () => {
      expect(nextOccurrence({ ...weekly, daysOfWeek: [] }, d("2026-09-11"))).toBeNull();
    });

    it("honours a fortnightly interval", () => {
      const fortnightly = { ...weekly, interval: 2, daysOfWeek: [1], startDate: d("2026-09-07") };
      const first = nextOccurrence(fortnightly, d("2026-09-07"))!;
      expect(toDayKey(first)).toBe("2026-09-21");
    });
  });

  describe("daily", () => {
    it("advances by the interval", () => {
      const daily = rule({ frequency: RecurrenceFrequency.DAILY, dayOfMonth: null });
      expect(toDayKey(nextOccurrence(daily, d("2026-09-10"))!)).toBe("2026-09-11");
    });

    it("pulls a weekend occurrence back to Friday", () => {
      const daily = rule({ frequency: RecurrenceFrequency.DAILY, dayOfMonth: null });
      // 11th is Friday; +1 lands on Saturday, adjusted back to Friday.
      expect(toDayKey(nextOccurrence(daily, d("2026-09-11"))!)).toBe("2026-09-11");
    });
  });

  describe("lead time", () => {
    it("generates N working days before the due date", () => {
      // 10 working days before Tue 22 Sep 2026
      expect(toDayKey(generationDateFor(d("2026-09-22"), 10))).toBe("2026-09-08");
    });

    it("generates on the due date when lead time is zero", () => {
      expect(toDayKey(generationDateFor(d("2026-09-22"), 0))).toBe("2026-09-22");
    });
  });

  describe("dueDatesToGenerate is idempotent and bounded", () => {
    it("generates nothing when the lead time has not been reached", () => {
      const out = dueDatesToGenerate(rule(), null, d("2026-09-01"), 10);
      // 10 working days before 22 Sep is 8 Sep, so on 1 Sep nothing is due yet.
      expect(out).toHaveLength(0);
    });

    it("generates once the lead time is reached", () => {
      const out = dueDatesToGenerate(rule(), null, d("2026-09-08"), 10);
      expect(out.map(toDayKey)).toEqual(["2026-09-22"]);
    });

    it("does not regenerate what was already generated", () => {
      const out = dueDatesToGenerate(rule(), d("2026-09-22"), d("2026-09-23"), 0);
      // The September instance exists; October is not due for generation yet.
      expect(out.map(toDayKey)).toEqual([]);
    });

    it("catches up after an outage without duplicating", () => {
      // Nothing generated since June; asOf is November.
      const out = dueDatesToGenerate(rule(), d("2026-06-22"), d("2026-11-30"), 0);
      expect(out.map(toDayKey)).toEqual([
        "2026-07-22",
        "2026-08-21", // 22nd is a Saturday
        "2026-09-22",
        "2026-10-22",
        "2026-11-20", // 22nd is a Sunday
      ]);
    });

    it("bounds a long catch-up so a dormant rule cannot flood the queue", () => {
      const daily = rule({ frequency: RecurrenceFrequency.DAILY, dayOfMonth: null });
      const out = dueDatesToGenerate(daily, d("2020-01-01"), d("2026-09-11"), 0, new Set(), 24);
      expect(out).toHaveLength(24);
    });

    it("returns nothing for a non-recurring activity", () => {
      expect(dueDatesToGenerate(rule({ frequency: null }), null, d("2026-09-11"), 0)).toEqual([]);
    });
  });
});
