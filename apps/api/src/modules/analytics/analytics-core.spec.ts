import { Priority, TaskFlagType, WorkPulseRole } from "@workpulse/db";
import {
  computeComponents,
  hasSufficientVolume,
  isPriorityInflated,
  normalisationFactor,
  sumWtu,
  wtu,
  type ComponentInputs,
} from "./analytics-core";
import {
  flagAbnormalSplitting,
  flagClosuresWithoutEvidence,
  flagReassignmentPatterns,
} from "./antigaming-core";
import { canViewAuditTrail, canViewTask, excludeConfidentialFromAggregate } from "./visibility-core";

// ---------------------------------------------------------------------------

describe("Weighted Task Units", () => {
  it("weights a 30-minute Medium task at its priority weight", () => {
    expect(wtu({ priority: Priority.MEDIUM, estimatedMinutes: 30 })).toBeCloseTo(1.2, 5);
  });

  it("scales with effort", () => {
    expect(wtu({ priority: Priority.CRITICAL, estimatedMinutes: 90 })).toBeCloseTo(9.0, 5);
  });

  it("is splitting-neutral", () => {
    // The property the whole model rests on: no arithmetic advantage to
    // carving one task into four.
    const one = wtu({ priority: Priority.HIGH, estimatedMinutes: 120 });
    const four = sumWtu(Array.from({ length: 4 }, () => ({ priority: Priority.HIGH, estimatedMinutes: 30 })));
    expect(four).toBeCloseTo(one, 5);
  });

  it("falls back to the baseline for unestimated work rather than zero", () => {
    // Unestimated work is still work; zero would erase it.
    expect(wtu({ priority: Priority.MEDIUM, estimatedMinutes: null })).toBeCloseTo(1.2, 5);
  });

  it("ranks a Critical task above several trivial ones", () => {
    const critical = wtu({ priority: Priority.CRITICAL, estimatedMinutes: 90 });
    const trivial = sumWtu(Array.from({ length: 5 }, () => ({ priority: Priority.LOW, estimatedMinutes: 5 })));
    expect(critical).toBeGreaterThan(trivial);
  });
});

describe("the five components", () => {
  const base: ComponentInputs = {
    wtuDue: 100,
    wtuClosed: 100,
    wtuOnTimeOfSlaTracked: 100,
    wtuSlaTracked: 100,
    wtuReopened: 0,
    wtuRejected: 0,
    wtuEvidenceFlagged: 0,
    controlObligationsOwed: 10,
    controlObligationsMet: 10,
    wtuBeyondDeskCard: 0,
  };

  it("is perfect when everything was delivered on time", () => {
    const c = computeComponents(base);
    expect(c.execution).toBe(1);
    expect(c.timeliness).toBe(1);
    expect(c.quality).toBe(1);
    expect(c.governance).toBe(1);
  });

  it("measures execution against committed load", () => {
    expect(computeComponents({ ...base, wtuClosed: 75 }).execution).toBeCloseTo(0.75, 5);
  });

  it("penalises reopened and rejected work in quality", () => {
    const c = computeComponents({ ...base, wtuReopened: 10, wtuRejected: 5 });
    expect(c.quality).toBeCloseTo(0.85, 5);
  });

  it("never returns a negative quality", () => {
    expect(computeComponents({ ...base, wtuReopened: 500 }).quality).toBe(0);
  });

  it("caps contribution at 1 so stepping up cannot excuse abandoning your own work", () => {
    expect(computeComponents({ ...base, wtuBeyondDeskCard: 400 }).contribution).toBe(1);
  });

  describe("absent obligations score 1, not 0", () => {
    it("no SLA-tracked work is not a timeliness failure", () => {
      expect(computeComponents({ ...base, wtuSlaTracked: 0, wtuOnTimeOfSlaTracked: 0 }).timeliness).toBe(1);
    });

    it("no control obligations is not a governance failure", () => {
      expect(computeComponents({ ...base, controlObligationsOwed: 0, controlObligationsMet: 0 }).governance).toBe(1);
    });

    it("nothing closed is not a quality failure", () => {
      expect(computeComponents({ ...base, wtuClosed: 0 }).quality).toBe(1);
    });
  });

  it("does not divide by zero anywhere", () => {
    const c = computeComponents({
      wtuDue: 0, wtuClosed: 0, wtuOnTimeOfSlaTracked: 0, wtuSlaTracked: 0,
      wtuReopened: 0, wtuRejected: 0, wtuEvidenceFlagged: 0,
      controlObligationsOwed: 0, controlObligationsMet: 0, wtuBeyondDeskCard: 0,
    });
    for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
  });

  it("exposes no composite score", () => {
    // Addendum 02 stages the weighted score behind a shadow quarter. Having one
    // available is how it ships early by accident.
    const core = jest.requireActual("./analytics-core");
    expect(Object.keys(core)).not.toContain("computeScore");
    expect(Object.keys(core)).not.toContain("compositeScore");
  });
});

describe("the volume floor", () => {
  it("reports insufficient data below the floor rather than a low result", () => {
    // Someone on leave and someone performing badly look identical on a chart
    // and mean opposite things.
    expect(hasSufficientVolume(19)).toBe(false);
    expect(hasSufficientVolume(20)).toBe(true);
  });
});

describe("priority-inflation normalisation", () => {
  const mix = (critical: number, others: number) => [
    ...Array.from({ length: critical }, () => Priority.CRITICAL),
    ...Array.from({ length: others }, () => Priority.MEDIUM),
  ];

  it("accepts a normal distribution", () => {
    expect(isPriorityInflated(mix(2, 8))).toBe(false);
  });

  it("flags a manager marking most work Critical", () => {
    expect(isPriorityInflated(mix(8, 2))).toBe(true);
  });

  it("scales an inflated distribution back to the ceiling", () => {
    expect(normalisationFactor(mix(8, 2))).toBeCloseTo(0.3125, 4);
  });

  it("leaves a normal distribution untouched", () => {
    expect(normalisationFactor(mix(2, 8))).toBe(1);
  });

  it("handles an empty period", () => {
    expect(isPriorityInflated([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("anti-gaming flags", () => {
  it("flags closure with no evidence on a type that requires it", () => {
    const flags = flagClosuresWithoutEvidence([
      { taskId: "t1", reference: "WP-1", assigneeEmployeeId: "e1", requiresEvidence: true, hasChecklistCompletion: false, hasAttachment: false, hasComment: false },
      { taskId: "t2", reference: "WP-2", assigneeEmployeeId: "e1", requiresEvidence: true, hasChecklistCompletion: true, hasAttachment: false, hasComment: false },
      { taskId: "t3", reference: "WP-3", assigneeEmployeeId: "e1", requiresEvidence: false, hasChecklistCompletion: false, hasAttachment: false, hasComment: false },
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0].taskId).toBe("t1");
    expect(flags[0].flagType).toBe(TaskFlagType.CLOSED_WITHOUT_EVIDENCE);
  });

  describe("reassignment patterns", () => {
    const ev = (from: string, by: string, overdue = true) => ({ taskId: "x", fromEmployeeId: from, byUserId: by, wasOverdue: overdue });

    it("flags three or more overdue reassignments from the same pair", () => {
      const flags = flagReassignmentPatterns([ev("e1", "m1"), ev("e1", "m1"), ev("e1", "m1")]);
      expect(flags).toHaveLength(1);
      expect(flags[0].subjectEmployeeId).toBe("e1");
    });

    it("does not flag below the threshold", () => {
      expect(flagReassignmentPatterns([ev("e1", "m1"), ev("e1", "m1")])).toHaveLength(0);
    });

    it("ignores reassignments of work that was not overdue", () => {
      expect(flagReassignmentPatterns([ev("e1", "m1", false), ev("e1", "m1", false), ev("e1", "m1", false)])).toHaveLength(0);
    });

    it("does not aggregate across different managers", () => {
      expect(flagReassignmentPatterns([ev("e1", "m1"), ev("e1", "m2"), ev("e1", "m3")])).toHaveLength(0);
    });
  });

  describe("abnormal splitting", () => {
    const made = (n: number, minutes: number, day = "2026-09-14") =>
      Array.from({ length: n }, (_, i) => ({ taskId: `t${i}`, createdByEmployeeId: "e1", dayKey: day, estimatedMinutes: minutes }));

    it("flags ten trivial tasks in one day", () => {
      expect(flagAbnormalSplitting(made(10, 5))).toHaveLength(1);
    });

    it("ignores substantive work however much of it there is", () => {
      expect(flagAbnormalSplitting(made(20, 60))).toHaveLength(0);
    });

    it("does not aggregate across days", () => {
      expect(flagAbnormalSplitting([...made(6, 5, "2026-09-14"), ...made(6, 5, "2026-09-15")])).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------

describe("confidential-task visibility (BRS 18.1)", () => {
  const confidential = { isConfidential: true, assigneeEmployeeId: "e1", reviewerEmployeeId: "e2", governanceEmployeeIds: ["e3"] };
  const open = { ...confidential, isConfidential: false };
  const viewer = (employeeId: string | null, roles: WorkPulseRole[] = [WorkPulseRole.EMPLOYEE], managed: string[] = []) =>
    ({ employeeId, roles, managedEmployeeIds: managed });

  it("shows non-confidential work to anyone", () => {
    expect(canViewTask(viewer("e9"), open).canView).toBe(true);
  });

  it("hides confidential work from a peer", () => {
    expect(canViewTask(viewer("e9"), confidential)).toEqual({ canView: false, reason: "DENIED" });
  });

  it("shows it to the assignee and the reviewer", () => {
    expect(canViewTask(viewer("e1"), confidential).reason).toBe("ASSIGNEE");
    expect(canViewTask(viewer("e2"), confidential).reason).toBe("REVIEWER");
  });

  it("shows it to a governance role holder", () => {
    expect(canViewTask(viewer("e3"), confidential).reason).toBe("GOVERNANCE_ROLE");
  });

  it("shows it up the assignee's management chain", () => {
    expect(canViewTask(viewer("m1", [WorkPulseRole.MANAGER], ["e1"]), confidential).reason).toBe("MANAGEMENT_CHAIN");
  });

  it("does NOT show it to a manager of someone else", () => {
    // Being a manager somewhere in the business grants nothing here.
    expect(canViewTask(viewer("m2", [WorkPulseRole.MANAGER], ["e7"]), confidential).canView).toBe(false);
  });

  describe("the Audit role", () => {
    const audit = viewer("a1", [WorkPulseRole.AUDIT]);

    it("sees confidential work", () => {
      // Restricting visibility must never blind the compliance function.
      expect(canViewTask(audit, confidential)).toEqual({ canView: true, reason: "AUDIT_ROLE" });
    });

    it("sees the audit trail of confidential work", () => {
      expect(canViewAuditTrail(audit, confidential)).toBe(true);
    });

    it("is not excluded from aggregates", () => {
      expect(excludeConfidentialFromAggregate(audit)).toBe(false);
      expect(excludeConfidentialFromAggregate(viewer("e9"))).toBe(true);
    });

    it("sees it even with no employee record", () => {
      expect(canViewTask(viewer(null, [WorkPulseRole.AUDIT]), confidential).canView).toBe(true);
    });
  });

  it("does NOT grant SYSTEM_ADMIN access to confidential work", () => {
    // Administering the system is not a reason to read HR, legal or
    // disciplinary matters.
    expect(canViewTask(viewer("admin", [WorkPulseRole.SYSTEM_ADMIN]), confidential).canView).toBe(false);
  });

  it("grants EXECUTIVE_RESTRICTED but not plain EXECUTIVE", () => {
    expect(canViewTask(viewer("ceo", [WorkPulseRole.EXECUTIVE_RESTRICTED]), confidential).canView).toBe(true);
    expect(canViewTask(viewer("cxo", [WorkPulseRole.EXECUTIVE]), confidential).canView).toBe(false);
  });

  it("denies a viewer with no employee record and no special role", () => {
    expect(canViewTask(viewer(null), confidential).canView).toBe(false);
  });
});
