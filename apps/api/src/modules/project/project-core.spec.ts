import { ProjectHealth } from "@workpulse/db";
import {
  calculateHealth,
  directPredecessors,
  explainHealth,
  raciAccountableConflict,
  wouldCreateCycle,
  type DependencyEdge,
} from "./project-core";

const edge = (p: string, s: string): DependencyEdge => ({ predecessorTaskId: p, successorTaskId: s });

describe("dependency cycles (TM-FR-030)", () => {
  // The BRS's own worked example: A -> B -> C -> D -> E
  const chain = [edge("A", "B"), edge("B", "C"), edge("C", "D"), edge("D", "E")];

  it("allows a new edge that does not close a loop", () => {
    expect(wouldCreateCycle(chain, "E", "F")).toBe(false);
  });

  it("rejects the direct reverse of an existing edge", () => {
    expect(wouldCreateCycle([edge("A", "B")], "B", "A")).toBe(true);
  });

  it("rejects a cycle closed through a long chain", () => {
    // E already depends transitively on A, so A depending on E closes the loop.
    expect(wouldCreateCycle(chain, "E", "A")).toBe(true);
  });

  it("rejects a task depending on itself", () => {
    expect(wouldCreateCycle([], "A", "A")).toBe(true);
  });

  it("allows a diamond, which is not a cycle", () => {
    // A -> B, A -> C, B -> D, C -> D. Two paths to D, no loop.
    const diamond = [edge("A", "B"), edge("A", "C"), edge("B", "D")];
    expect(wouldCreateCycle(diamond, "C", "D")).toBe(false);
  });

  it("handles a disconnected graph without false positives", () => {
    const disconnected = [edge("A", "B"), edge("X", "Y")];
    expect(wouldCreateCycle(disconnected, "B", "X")).toBe(false);
  });

  it("terminates on a graph that already contains a cycle", () => {
    // Defensive: bad data should not hang the request.
    const cyclic = [edge("A", "B"), edge("B", "C"), edge("C", "A")];
    expect(wouldCreateCycle(cyclic, "A", "D")).toBe(false);
  });

  it("finds direct predecessors", () => {
    expect(directPredecessors(chain, "D")).toEqual(["C"]);
    expect(directPredecessors(chain, "A")).toEqual([]);
  });
});

describe("project health (TM-FR-013)", () => {
  const base = { totalTasks: 20, overdueTasks: 0, blockingRisks: 0, missedMilestones: 0 };

  it("is Green when nothing is wrong", () => {
    expect(calculateHealth(base)).toBe(ProjectHealth.GREEN);
  });

  it("is Green at exactly the Amber threshold, not past it", () => {
    // 15% is the threshold; Amber is > 15%.
    expect(calculateHealth({ ...base, overdueTasks: 3 })).toBe(ProjectHealth.GREEN);
  });

  it("is Amber just past 15% overdue", () => {
    expect(calculateHealth({ ...base, overdueTasks: 4 })).toBe(ProjectHealth.AMBER);
  });

  it("is Red past 30% overdue", () => {
    expect(calculateHealth({ ...base, overdueTasks: 7 })).toBe(ProjectHealth.RED);
  });

  it("is Amber on one blocking issue", () => {
    expect(calculateHealth({ ...base, blockingRisks: 1 })).toBe(ProjectHealth.AMBER);
  });

  it("is Red on two blocking issues", () => {
    expect(calculateHealth({ ...base, blockingRisks: 2 })).toBe(ProjectHealth.RED);
  });

  it("is Red on a missed milestone regardless of task percentages", () => {
    // A project can look fine on percentages while having sailed past a
    // committed date. The date is what was promised.
    expect(calculateHealth({ ...base, missedMilestones: 1 })).toBe(ProjectHealth.RED);
  });

  it("is Green with no tasks rather than dividing by zero", () => {
    expect(calculateHealth({ ...base, totalTasks: 0 })).toBe(ProjectHealth.GREEN);
  });

  it("explains itself in plain language", () => {
    const reasons = explainHealth({ totalTasks: 20, overdueTasks: 8, blockingRisks: 1, missedMilestones: 1 });
    expect(reasons.join(" ")).toContain("milestone");
    expect(reasons.join(" ")).toContain("blocking issue");
    expect(reasons.join(" ")).toContain("40%");
  });

  it("says something useful even when healthy", () => {
    expect(explainHealth(base)[0]).toContain("0 of 20");
  });
});

describe("RACI single Accountable (TM-FR-033)", () => {
  const existing = [
    { employeeId: "e1", role: "ACCOUNTABLE" },
    { employeeId: "e2", role: "RESPONSIBLE" },
    { employeeId: "e3", role: "RESPONSIBLE" },
  ];

  it("reports the incumbent when a second Accountable is added", () => {
    expect(raciAccountableConflict(existing, "ACCOUNTABLE", "e9")).toBe("e1");
  });

  it("allows re-adding the same person as Accountable", () => {
    expect(raciAccountableConflict(existing, "ACCOUNTABLE", "e1")).toBeNull();
  });

  it("allows any number of Responsible", () => {
    expect(raciAccountableConflict(existing, "RESPONSIBLE", "e9")).toBeNull();
  });

  it("allows the first Accountable when there is none", () => {
    expect(raciAccountableConflict([{ employeeId: "e2", role: "CONSULTED" }], "ACCOUNTABLE", "e1")).toBeNull();
  });
});
