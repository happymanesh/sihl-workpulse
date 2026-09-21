import { CommandCentreSeverity, Priority, ProjectHealth, TaskStatus } from "@workpulse/db";
import {
  blockedEvents,
  breachEvents,
  criticalOverdueEvents,
  missedComplianceEvents,
  projectHealthEvents,
  topLevelEscalationEvents,
  trendOf,
  type EnterprisePulse,
} from "./command-centre-core";

const breach = (priority: Priority) => ({
  taskId: "t1",
  reference: "WP-1",
  title: "Quarterly return",
  priority,
  departmentId: "d1",
  departmentName: "Compliance",
  assigneeEmployeeId: "e1",
  assigneeName: "Rohan Mehta",
  overdueMinutes: 300,
});

describe("what reaches a CEO", () => {
  describe("SLA breaches", () => {
    it("reports critical and urgent breaches", () => {
      expect(breachEvents([breach(Priority.CRITICAL)])).toHaveLength(1);
      expect(breachEvents([breach(Priority.URGENT)])).toHaveLength(1);
    });

    it("stays silent on lower-priority breaches", () => {
      // A real fact, and a line-manager matter. A CEO feed that fires on
      // everything is read once and then ignored.
      expect(breachEvents([breach(Priority.HIGH)])).toHaveLength(0);
      expect(breachEvents([breach(Priority.MEDIUM)])).toHaveLength(0);
      expect(breachEvents([breach(Priority.LOW)])).toHaveLength(0);
    });

    it("reserves URGENT severity for critical work", () => {
      expect(breachEvents([breach(Priority.CRITICAL)])[0].severity).toBe(CommandCentreSeverity.URGENT);
      expect(breachEvents([breach(Priority.URGENT)])[0].severity).toBe(CommandCentreSeverity.ATTENTION);
    });

    it("names the person and the department in the detail", () => {
      const e = breachEvents([breach(Priority.CRITICAL)])[0];
      expect(e.detail).toContain("Rohan Mehta");
      expect(e.detail).toContain("Compliance");
    });
  });

  describe("escalations", () => {
    const esc = (level: number, maxLevel: number) => ({
      taskId: "t1",
      reference: "WP-1",
      title: "Client complaint",
      level,
      maxLevel,
      departmentId: "d1",
      assigneeEmployeeId: "e1",
      assigneeName: "Ananya Desai",
    });

    it("reports only an escalation that ran out of chain", () => {
      expect(topLevelEscalationEvents([esc(3, 3)])).toHaveLength(1);
    });

    it("stays silent on intermediate levels, which are the chain working", () => {
      expect(topLevelEscalationEvents([esc(1, 3)])).toHaveLength(0);
      expect(topLevelEscalationEvents([esc(2, 3)])).toHaveLength(0);
    });

    it("stays silent when no chain is configured", () => {
      expect(topLevelEscalationEvents([esc(1, 0)])).toHaveLength(0);
    });
  });

  describe("critical overdue", () => {
    const overdue = (priority: Priority, hours: number) => ({
      taskId: "t1",
      reference: "WP-1",
      title: "Board pack",
      priority,
      status: TaskStatus.IN_PROGRESS,
      overdueHours: hours,
      departmentId: "d1",
      assigneeEmployeeId: "e1",
      assigneeName: "Rohan Mehta",
    });

    it("waits for the threshold before saying anything", () => {
      expect(criticalOverdueEvents([overdue(Priority.CRITICAL, 6)])).toHaveLength(0);
      expect(criticalOverdueEvents([overdue(Priority.CRITICAL, 25)])).toHaveLength(1);
    });

    it("applies only to critical work", () => {
      expect(criticalOverdueEvents([overdue(Priority.HIGH, 100)])).toHaveLength(0);
    });
  });

  describe("blocked work", () => {
    const blocked = (hours: number, owner: string | null) => ({
      taskId: "t1",
      reference: "WP-1",
      title: "Vendor onboarding",
      blockedHours: hours,
      blockedReason: "Awaiting legal sign-off",
      blockingOwnerEmployeeId: owner,
      blockingOwnerName: owner ? "Priya Nair" : null,
      departmentId: "d1",
      assigneeEmployeeId: "e1",
    });

    it("waits for the threshold", () => {
      expect(blockedEvents([blocked(24, "e2")])).toHaveLength(0);
      expect(blockedEvents([blocked(80, "e2")])).toHaveLength(1);
    });

    it("points at the person who can unblock it, not the assignee", () => {
      // The one case where the task-holder usually cannot act. Naming the
      // assignee here would point the CEO at the wrong desk.
      expect(blockedEvents([blocked(80, "e2")])[0].employeeId).toBe("e2");
    });

    it("falls back to the assignee when nobody owns the unblock", () => {
      const e = blockedEvents([blocked(80, null)])[0];
      expect(e.employeeId).toBe("e1");
      expect(e.detail).toContain("No owner named");
    });

    it("says so when no reason was recorded", () => {
      const subject = { ...blocked(80, "e2"), blockedReason: null };
      expect(blockedEvents([subject])[0].detail).toContain("No reason recorded");
    });
  });

  describe("missed compliance", () => {
    it("is always urgent, whatever the task priority said", () => {
      // For a BFSI entity approaching listing, a missed filing is not a
      // productivity metric.
      const events = missedComplianceEvents([
        {
          taskId: "t1",
          reference: "WP-1",
          title: "Monthly SEBI filing",
          departmentId: "d1",
          departmentName: "Compliance",
          assigneeEmployeeId: "e1",
          dueDate: new Date("2026-09-15T00:00:00Z"),
        },
      ]);
      expect(events[0].severity).toBe(CommandCentreSeverity.URGENT);
      expect(events[0].detail).toContain("2026-09-15");
    });
  });

  describe("project health", () => {
    const proj = (health: ProjectHealth, previous: ProjectHealth | null) => ({
      projectId: "p1",
      name: "Listing readiness",
      health,
      previousHealth: previous,
      departmentId: null,
    });

    it("reports a degradation", () => {
      expect(projectHealthEvents([proj(ProjectHealth.AMBER, ProjectHealth.GREEN)])).toHaveLength(1);
      expect(projectHealthEvents([proj(ProjectHealth.RED, ProjectHealth.AMBER)])).toHaveLength(1);
    });

    it("stays silent on an improvement", () => {
      expect(projectHealthEvents([proj(ProjectHealth.GREEN, ProjectHealth.AMBER)])).toHaveLength(0);
    });

    it("stays silent when nothing changed", () => {
      // A project AT_RISK for a month is a known problem being managed.
      expect(projectHealthEvents([proj(ProjectHealth.AMBER, ProjectHealth.AMBER)])).toHaveLength(0);
    });

    it("stays silent with no prior state to compare against", () => {
      expect(projectHealthEvents([proj(ProjectHealth.RED, null)])).toHaveLength(0);
    });

    it("keys successive degradations separately", () => {
      const toAmber = projectHealthEvents([proj(ProjectHealth.AMBER, ProjectHealth.GREEN)])[0];
      const toRed = projectHealthEvents([proj(ProjectHealth.RED, ProjectHealth.AMBER)])[0];
      expect(toAmber.dedupeKey).not.toBe(toRed.dedupeKey);
    });
  });

  describe("dedupe keys", () => {
    it("are stable for the same subject, so re-detection raises nothing new", () => {
      const a = breachEvents([breach(Priority.CRITICAL)])[0].dedupeKey;
      const b = breachEvents([breach(Priority.CRITICAL)])[0].dedupeKey;
      expect(a).toBe(b);
    });

    it("differ between event types on the same task", () => {
      const breachKey = breachEvents([breach(Priority.CRITICAL)])[0].dedupeKey;
      const overdueKey = criticalOverdueEvents([
        {
          taskId: "t1",
          reference: "WP-1",
          title: "x",
          priority: Priority.CRITICAL,
          status: TaskStatus.IN_PROGRESS,
          overdueHours: 48,
          departmentId: "d1",
          assigneeEmployeeId: "e1",
          assigneeName: "Rohan Mehta",
        },
      ])[0].dedupeKey;
      expect(breachKey).not.toBe(overdueKey);
    });
  });
});

describe("direction of travel", () => {
  const pulse = (current: number | null, previous: number | null): EnterprisePulse => ({
    openTasks: 10,
    overdueTasks: 2,
    criticalOpen: 1,
    blockedTasks: 0,
    slaBreaches: 0,
    onTimePercent: current,
    previousOnTimePercent: previous,
  });

  it("calls a small move noise", () => {
    expect(trendOf(pulse(81, 80))).toBe("STABLE");
  });

  it("reports a real improvement and a real decline", () => {
    expect(trendOf(pulse(90, 80))).toBe("IMPROVING");
    expect(trendOf(pulse(70, 80))).toBe("DETERIORATING");
  });

  it("says unknown rather than guessing with no comparison", () => {
    expect(trendOf(pulse(90, null))).toBe("UNKNOWN");
    expect(trendOf(pulse(null, 80))).toBe("UNKNOWN");
  });
});
