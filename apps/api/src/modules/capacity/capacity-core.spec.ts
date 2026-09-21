import {
  blockMinutes,
  endOfWeek,
  overlaps,
  startOfWeek,
  totalBlockedMinutes,
  utilisation,
  weeklyCommittedMinutes,
} from "./capacity-core";

const t = (iso: string) => new Date(`2026-09-14T${iso}:00.000Z`); // Monday

describe("capacity core", () => {
  describe("weekly committed minutes", () => {
    it("counts a daily activity as five occurrences, not seven", () => {
      // Daily means every WORKING day. Seven would inflate the committed load
      // of the people with the most routine work by 40%.
      expect(weeklyCommittedMinutes([{ estimatedMinutes: 10, frequency: "DAILY", interval: 1 }])).toBe(50);
    });

    it("counts weekly once", () => {
      expect(weeklyCommittedMinutes([{ estimatedMinutes: 60, frequency: "WEEKLY", interval: 1 }])).toBe(60);
    });

    it("amortises monthly across the year", () => {
      const minutes = weeklyCommittedMinutes([{ estimatedMinutes: 90, frequency: "MONTHLY", interval: 1 }]);
      expect(minutes).toBeCloseTo(90 * (12 / 52), 5);
    });

    it("halves for an interval of 2", () => {
      const every = weeklyCommittedMinutes([{ estimatedMinutes: 60, frequency: "WEEKLY", interval: 1 }]);
      const other = weeklyCommittedMinutes([{ estimatedMinutes: 60, frequency: "WEEKLY", interval: 2 }]);
      expect(other).toBeCloseTo(every / 2, 5);
    });

    it("ignores one-off activities entirely", () => {
      // A one-off is not a standing weekly load; counting it would overstate
      // capacity permanently.
      expect(weeklyCommittedMinutes([{ estimatedMinutes: 500, frequency: null, interval: 1 }])).toBe(0);
    });

    it("ignores an unrecognised frequency rather than guessing", () => {
      expect(weeklyCommittedMinutes([{ estimatedMinutes: 60, frequency: "FORTNIGHTLY", interval: 1 }])).toBe(0);
    });

    it("sums a realistic desk card", () => {
      const total = weeklyCommittedMinutes([
        { estimatedMinutes: 10, frequency: "DAILY", interval: 1 }, // 50
        { estimatedMinutes: 45, frequency: "WEEKLY", interval: 1 }, // 45
        { estimatedMinutes: 90, frequency: "MONTHLY", interval: 1 }, // ~20.8
      ]);
      expect(total).toBeGreaterThan(115);
      expect(total).toBeLessThan(116);
    });
  });

  describe("block minutes", () => {
    it("measures a range", () => {
      expect(blockMinutes({ startAt: t("09:00"), endAt: t("10:30") })).toBe(90);
    });

    it("floors an inverted range at zero rather than going negative", () => {
      expect(blockMinutes({ startAt: t("10:00"), endAt: t("09:00") })).toBe(0);
    });

    it("sums several blocks", () => {
      expect(
        totalBlockedMinutes([
          { startAt: t("09:00"), endAt: t("10:00") },
          { startAt: t("11:00"), endAt: t("11:30") },
        ]),
      ).toBe(90);
    });
  });

  describe("overlap detection", () => {
    it("detects a genuine clash", () => {
      expect(
        overlaps({ startAt: t("09:00"), endAt: t("10:00") }, { startAt: t("09:30"), endAt: t("10:30") }),
      ).toBe(true);
    });

    it("treats touching endpoints as adjacent, not conflicting", () => {
      expect(
        overlaps({ startAt: t("09:00"), endAt: t("10:00") }, { startAt: t("10:00"), endAt: t("11:00") }),
      ).toBe(false);
    });

    it("detects full containment", () => {
      expect(
        overlaps({ startAt: t("09:00"), endAt: t("12:00") }, { startAt: t("10:00"), endAt: t("11:00") }),
      ).toBe(true);
    });

    it("is symmetric", () => {
      const a = { startAt: t("09:00"), endAt: t("10:00") };
      const b = { startAt: t("09:30"), endAt: t("10:30") };
      expect(overlaps(a, b)).toBe(overlaps(b, a));
    });
  });

  describe("utilisation", () => {
    it("computes a percentage against the budget", () => {
      expect(utilisation(2400, 1200, 600)).toMatchObject({ percent: 50, isOverAllocated: false });
    });

    it("flags over-allocation without blocking anything", () => {
      const u = utilisation(2400, 3360, 0);
      expect(u.percent).toBe(140);
      expect(u.isOverAllocated).toBe(true);
    });

    it("does not treat exactly at budget as over", () => {
      expect(utilisation(2400, 2400, 0).isOverAllocated).toBe(false);
    });

    it("returns 0% for a missing budget rather than dividing by zero", () => {
      const u = utilisation(0, 1200, 0);
      expect(u.percent).toBe(0);
      expect(u.isOverAllocated).toBe(false);
      expect(Number.isFinite(u.percent)).toBe(true);
    });
  });

  describe("week boundaries", () => {
    it("starts the week on Monday", () => {
      // 2026-09-14 is a Monday; 09-17 a Thursday.
      expect(startOfWeek(new Date("2026-09-17T15:00:00.000Z")).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    });

    it("treats Sunday as the end of the preceding week, not the start of a new one", () => {
      expect(startOfWeek(new Date("2026-09-20T23:00:00.000Z")).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    });

    it("ends exactly seven days after it starts", () => {
      const d = new Date("2026-09-17T15:00:00.000Z");
      expect(endOfWeek(d).getTime() - startOfWeek(d).getTime()).toBe(7 * 86_400_000);
    });
  });
});
