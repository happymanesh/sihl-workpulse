import { TaskStatus } from "@workpulse/db";
import { aggregate, aggregateBy, MIS_STAGES, stageOf, toCsv, type MisTaskRow } from "./mis-core";

const NOW = new Date("2026-11-13T12:00:00Z");
const PERIOD_START = new Date("2026-11-01T00:00:00Z");
const PERIOD_END = new Date("2026-11-30T23:59:59Z");
const OPTS = { now: NOW, periodStart: PERIOD_START, periodEnd: PERIOD_END };

function row(overrides: Partial<MisTaskRow> = {}): MisTaskRow {
  return {
    status: TaskStatus.IN_PROGRESS,
    dueDate: new Date("2026-11-20T00:00:00Z"),
    completedAt: null,
    isMissed: false,
    priority: "MEDIUM",
    ...overrides,
  };
}

describe("stage mapping", () => {
  it("places every status that belongs in a stage exactly once", () => {
    const seen = new Map<TaskStatus, string>();
    for (const stage of MIS_STAGES) {
      for (const s of stage.statuses) {
        expect(seen.has(s)).toBe(false);
        seen.set(s, stage.key);
      }
    }
  });

  it("covers every status except Cancelled", () => {
    const all = Object.values(TaskStatus);
    const unplaced = all.filter((s) => stageOf(s) === null);
    // Cancelled work was called off. Putting it in a stage would inflate it.
    expect(unplaced).toEqual([TaskStatus.CANCELLED]);
  });
});

describe("counting", () => {
  it("counts a task into its stage", () => {
    const c = aggregate([row({ status: TaskStatus.PENDING_REVIEW })], OPTS);
    expect(c.stages.pendingReview).toBe(1);
    expect(c.total).toBe(1);
  });

  it("keeps Cancelled out of every stage but still in the total", () => {
    const c = aggregate([row({ status: TaskStatus.CANCELLED })], OPTS);
    expect(Object.values(c.stages).reduce((a, b) => a + b, 0)).toBe(0);
    expect(c.total).toBe(1);
  });

  describe("overdue", () => {
    const past = new Date("2026-11-01T00:00:00Z");

    it("counts open work past its date", () => {
      expect(aggregate([row({ dueDate: past })], OPTS).overdue).toBe(1);
    });

    it("does not chase settled work", () => {
      for (const status of [TaskStatus.CLOSED, TaskStatus.CANCELLED]) {
        expect(aggregate([row({ status, dueDate: past })], OPTS).overdue).toBe(0);
      }
    });

    it("does not chase verified work waiting on a formality", () => {
      expect(aggregate([row({ status: TaskStatus.VERIFIED, dueDate: past })], OPTS).overdue).toBe(0);
    });
  });

  describe("on time", () => {
    it("is null rather than 0% when nothing finished in the period", () => {
      expect(aggregate([row()], OPTS).onTimePercent).toBeNull();
    });

    it("measures only work finished inside the period", () => {
      const c = aggregate(
        [
          // Finished in the period, on time.
          row({
            status: TaskStatus.CLOSED,
            dueDate: new Date("2026-11-10T00:00:00Z"),
            completedAt: new Date("2026-11-09T00:00:00Z"),
          }),
          // Finished in the period, late.
          row({
            status: TaskStatus.CLOSED,
            dueDate: new Date("2026-11-05T00:00:00Z"),
            completedAt: new Date("2026-11-08T00:00:00Z"),
          }),
          // Finished BEFORE the period - must not move this month's figure.
          row({
            status: TaskStatus.CLOSED,
            dueDate: new Date("2026-10-05T00:00:00Z"),
            completedAt: new Date("2026-10-04T00:00:00Z"),
          }),
        ],
        OPTS,
      );
      expect(c.completedInPeriod).toBe(2);
      expect(c.onTimeInPeriod).toBe(1);
      expect(c.onTimePercent).toBe(50);
    });

    it("treats finishing exactly on the due date as on time", () => {
      const d = new Date("2026-11-10T00:00:00Z");
      const c = aggregate([row({ status: TaskStatus.CLOSED, dueDate: d, completedAt: d })], OPTS);
      expect(c.onTimePercent).toBe(100);
    });
  });

  it("counts never-started separately from overdue", () => {
    const c = aggregate(
      [row({ isMissed: true, dueDate: new Date("2026-11-01T00:00:00Z") })],
      OPTS,
    );
    // The same task is both: it is late, AND it was never opened at all.
    expect(c.neverStarted).toBe(1);
    expect(c.overdue).toBe(1);
  });

  it("counts critical only while the work is live", () => {
    expect(aggregate([row({ priority: "CRITICAL" })], OPTS).critical).toBe(1);
    expect(
      aggregate([row({ priority: "CRITICAL", status: TaskStatus.CLOSED })], OPTS).critical,
    ).toBe(0);
  });

  it("returns zeroes, not NaN, for an empty scope", () => {
    const c = aggregate([], OPTS);
    expect(c.total).toBe(0);
    expect(c.onTimePercent).toBeNull();
    expect(Object.values(c.stages).every((v) => v === 0)).toBe(true);
  });
});

describe("grouping", () => {
  it("keeps a key with no rows, so the row still appears with zeroes", () => {
    const out = aggregateBy(
      [{ ...row(), key: "a" as const }],
      [
        { id: "a" as const, label: "Alice" },
        { id: "b" as const, label: "Bob" },
      ],
      OPTS,
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ label: "Bob" });
    expect(out[1].counts.total).toBe(0);
  });

  it("drops rows whose key is null rather than inventing a bucket", () => {
    const out = aggregateBy(
      [
        { ...row(), key: null },
        { ...row(), key: "a" as const },
      ],
      [{ id: "a" as const, label: "Alice" }],
      OPTS,
    );
    expect(out[0].counts.total).toBe(1);
  });

  it("does not let one group's rows leak into another", () => {
    const out = aggregateBy(
      [
        { ...row({ status: TaskStatus.BLOCKED }), key: "a" as const },
        { ...row({ status: TaskStatus.BLOCKED }), key: "b" as const },
        { ...row({ status: TaskStatus.BLOCKED }), key: "b" as const },
      ],
      [
        { id: "a" as const, label: "A" },
        { id: "b" as const, label: "B" },
      ],
      OPTS,
    );
    expect(out[0].counts.stages.blocked).toBe(1);
    expect(out[1].counts.stages.blocked).toBe(2);
  });
});

describe("csv", () => {
  it("quotes a value containing a comma, so later columns do not shift", () => {
    const csv = toCsv(["Department", "Total"], [["Sales, North", 4]]);
    expect(csv).toBe('Department,Total\r\n"Sales, North",4');
  });

  it("doubles an embedded quote", () => {
    expect(toCsv(["Name"], [['He said "no"']])).toContain('"He said ""no"""');
  });

  it("quotes a value containing a newline", () => {
    expect(toCsv(["Note"], [["line one\nline two"]])).toContain('"line one\nline two"');
  });

  it("writes an empty cell for null rather than the word null", () => {
    expect(toCsv(["A", "B"], [[null, 1]])).toBe("A,B\r\n,1");
  });
});
