import { Priority, TaskStatus } from "@workpulse/db";
import {
  assessSla,
  computeActiveTime,
  dueEscalations,
  isMutableFor,
  resolveSla,
  specificityOf,
  type SlaCandidate,
} from "./sla-core";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 14, h, m, 0));

function sla(over: Partial<SlaCandidate> = {}): SlaCandidate {
  return {
    id: "s1",
    taskTypeId: null,
    priority: null,
    departmentId: null,
    sourceSystemId: null,
    resolutionMinutes: 480,
    responseMinutes: null,
    ...over,
  };
}

describe("the pausable clock (TM-FR-040)", () => {
  it("counts straightforward active time", () => {
    const r = computeActiveTime(
      [
        { toStatus: TaskStatus.ASSIGNED, createdAt: at(9) },
        { toStatus: TaskStatus.IN_PROGRESS, createdAt: at(10) },
      ],
      at(12),
    );
    expect(r.activeMinutes).toBe(180);
    expect(r.pausedMinutes).toBe(0);
  });

  it("excludes time spent Blocked", () => {
    // 09:00 assigned, 10:00 blocked, 12:00 back in progress, measured at 13:00.
    // Active = 1h before + 1h after = 120. Blocked 2h does not count.
    const r = computeActiveTime(
      [
        { toStatus: TaskStatus.ASSIGNED, createdAt: at(9) },
        { toStatus: TaskStatus.BLOCKED, createdAt: at(10) },
        { toStatus: TaskStatus.IN_PROGRESS, createdAt: at(12) },
      ],
      at(13),
    );
    expect(r.activeMinutes).toBe(120);
    expect(r.pausedMinutes).toBe(120);
    expect(r.totalMinutes).toBe(240);
  });

  it("excludes time On Hold too", () => {
    const r = computeActiveTime(
      [
        { toStatus: TaskStatus.ASSIGNED, createdAt: at(9) },
        { toStatus: TaskStatus.ON_HOLD, createdAt: at(9, 30) },
        { toStatus: TaskStatus.IN_PROGRESS, createdAt: at(11, 30) },
      ],
      at(12),
    );
    expect(r.activeMinutes).toBe(60);
    expect(r.pausedMinutes).toBe(120);
  });

  it("handles several pause periods", () => {
    const r = computeActiveTime(
      [
        { toStatus: TaskStatus.IN_PROGRESS, createdAt: at(9) }, // 1h active
        { toStatus: TaskStatus.BLOCKED, createdAt: at(10) }, //    1h paused
        { toStatus: TaskStatus.IN_PROGRESS, createdAt: at(11) }, // 1h active
        { toStatus: TaskStatus.ON_HOLD, createdAt: at(12) }, //     2h paused
        { toStatus: TaskStatus.IN_PROGRESS, createdAt: at(14) }, // 1h active
      ],
      at(15),
    );
    expect(r.activeMinutes).toBe(180);
    expect(r.pausedMinutes).toBe(180);
  });

  it("stops the clock at the settle time it is given", () => {
    const closed = computeActiveTime(
      [{ toStatus: TaskStatus.IN_PROGRESS, createdAt: at(9) }],
      at(11), // closedAt
    );
    expect(closed.activeMinutes).toBe(120);
  });

  it("returns zero for a task with no history", () => {
    expect(computeActiveTime([], at(12))).toEqual({ activeMinutes: 0, pausedMinutes: 0, totalMinutes: 0 });
  });

  it("sorts unordered history rather than producing negative time", () => {
    const r = computeActiveTime(
      [
        { toStatus: TaskStatus.IN_PROGRESS, createdAt: at(10) },
        { toStatus: TaskStatus.ASSIGNED, createdAt: at(9) },
      ],
      at(11),
    );
    expect(r.activeMinutes).toBe(120);
  });
});

describe("definition precedence (TM-FR-039)", () => {
  const subject = { taskTypeId: "t1", priority: Priority.CRITICAL, departmentId: "d1", sourceSystemId: "s1" };

  it("picks the most specific of several matches", () => {
    const generic = sla({ id: "a", resolutionMinutes: 2880 });
    const byType = sla({ id: "b", taskTypeId: "t1", resolutionMinutes: 1440 });
    const byTypeAndPriority = sla({ id: "c", taskTypeId: "t1", priority: Priority.CRITICAL, resolutionMinutes: 240 });

    expect(resolveSla([generic, byType, byTypeAndPriority], subject)?.id).toBe("c");
  });

  it("ignores definitions that do not match", () => {
    const wrongPriority = sla({ id: "x", priority: Priority.LOW });
    const generic = sla({ id: "a" });
    expect(resolveSla([wrongPriority, generic], subject)?.id).toBe("a");
  });

  it("returns null when nothing applies, rather than inventing a default", () => {
    // Not all work is SLA-tracked. A default would put every task on a clock
    // nobody agreed to.
    expect(resolveSla([sla({ taskTypeId: "other" })], subject)).toBeNull();
  });

  it("ranks task type above priority above department above source", () => {
    expect(specificityOf(sla({ taskTypeId: "t1" }))).toBeGreaterThan(specificityOf(sla({ priority: Priority.HIGH })));
    expect(specificityOf(sla({ priority: Priority.HIGH }))).toBeGreaterThan(specificityOf(sla({ departmentId: "d1" })));
    expect(specificityOf(sla({ departmentId: "d1" }))).toBeGreaterThan(specificityOf(sla({ sourceSystemId: "s1" })));
  });

  it("breaks ties deterministically", () => {
    const a = sla({ id: "zzz", taskTypeId: "t1" });
    const b = sla({ id: "aaa", taskTypeId: "t1" });
    expect(resolveSla([a, b], subject)?.id).toBe("aaa");
    expect(resolveSla([b, a], subject)?.id).toBe("aaa");
  });

  it("matches a definition scoped only by source system", () => {
    expect(resolveSla([sla({ id: "src", sourceSystemId: "s1" })], subject)?.id).toBe("src");
  });
});

describe("breach assessment", () => {
  const active = (m: number) => ({ activeMinutes: m, pausedMinutes: 0, totalMinutes: m });

  it("is OK well within the allowance", () => {
    expect(assessSla(active(120), 480).state).toBe("OK");
  });

  it("is at risk from 80%", () => {
    expect(assessSla(active(384), 480).state).toBe("AT_RISK");
  });

  it("is still OK just below 80%", () => {
    expect(assessSla(active(383), 480).state).toBe("OK");
  });

  it("is not breached at exactly 100%", () => {
    const a = assessSla(active(480), 480);
    expect(a.percentUsed).toBe(100);
    expect(a.state).toBe("AT_RISK");
  });

  it("is breached past 100%", () => {
    expect(assessSla(active(481), 480).state).toBe("BREACHED");
  });

  it("reports remaining time, floored at zero", () => {
    expect(assessSla(active(600), 480).minutesRemaining).toBe(0);
    expect(assessSla(active(180), 480).minutesRemaining).toBe(300);
  });

  it("does not divide by zero on a malformed definition", () => {
    expect(assessSla(active(100), 0).percentUsed).toBe(0);
  });

  it("a heavily blocked task is not breached by its blocked time", () => {
    // 8h of a 8h SLA elapsed, but 6h of it was blocked.
    const r = assessSla({ activeMinutes: 120, pausedMinutes: 360, totalMinutes: 480 }, 480);
    expect(r.state).toBe("OK");
    expect(r.percentUsed).toBe(25);
  });
});

describe("escalation chains (TM-FR-041)", () => {
  const rules = [
    { level: 1, thresholdPercent: 50 },
    { level: 2, thresholdPercent: 100 },
    { level: 3, thresholdPercent: 150 },
  ];

  it("fires nothing below the first threshold", () => {
    expect(dueEscalations(rules, 40, [])).toEqual([]);
  });

  it("fires the first level when passed", () => {
    expect(dueEscalations(rules, 60, []).map((r) => r.level)).toEqual([1]);
  });

  it("fires every unfired level passed during an outage, not just the highest", () => {
    // Each level notifies a different person; skipping one means somebody never
    // hears about it.
    expect(dueEscalations(rules, 200, []).map((r) => r.level)).toEqual([1, 2, 3]);
  });

  it("does not refire a level already fired", () => {
    expect(dueEscalations(rules, 200, [1, 2]).map((r) => r.level)).toEqual([3]);
  });

  it("returns levels in order", () => {
    const shuffled = [rules[2], rules[0], rules[1]];
    expect(dueEscalations(shuffled, 200, []).map((r) => r.level)).toEqual([1, 2, 3]);
  });

  describe("the non-mutable floor", () => {
    it("cannot be muted for Critical, High or Urgent however the rule is configured", () => {
      for (const p of [Priority.CRITICAL, Priority.HIGH, Priority.URGENT]) {
        expect(isMutableFor(p, true)).toBe(false);
      }
    });

    it("respects the rule for Medium and Low", () => {
      expect(isMutableFor(Priority.MEDIUM, true)).toBe(true);
      expect(isMutableFor(Priority.LOW, false)).toBe(false);
    });
  });
});
