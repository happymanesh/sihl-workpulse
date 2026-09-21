import { ProjectHealth } from "@workpulse/db";

/**
 * Project and dependency logic. Pure - no Prisma, no clock beyond what is
 * passed in - so both algorithms below can be tested exhaustively.
 */

// ---------------------------------------------------------------------------
// Dependency cycles (TM-FR-030)
// ---------------------------------------------------------------------------

export interface DependencyEdge {
  predecessorTaskId: string;
  successorTaskId: string;
}

/**
 * Whether adding predecessor -> successor would create a cycle.
 *
 * A cycle means a set of tasks each waiting on another, so none can ever start.
 * The check is a reachability question: if the SUCCESSOR can already reach the
 * PREDECESSOR by following existing edges, adding this one closes the loop.
 *
 * Self-dependency is the degenerate case and is rejected first - a task cannot
 * wait for itself.
 */
export function wouldCreateCycle(
  edges: DependencyEdge[],
  predecessorTaskId: string,
  successorTaskId: string,
): boolean {
  if (predecessorTaskId === successorTaskId) return true;

  // Adjacency: predecessor -> [successors]
  const next = new Map<string, string[]>();
  for (const e of edges) {
    const list = next.get(e.predecessorTaskId);
    if (list) list.push(e.successorTaskId);
    else next.set(e.predecessorTaskId, [e.successorTaskId]);
  }

  // Depth-first from the successor, looking for the predecessor. Iterative
  // rather than recursive so a long chain cannot blow the stack.
  const seen = new Set<string>([successorTaskId]);
  const stack = [successorTaskId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === predecessorTaskId) return true;
    for (const child of next.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }

  return false;
}

/** Tasks that must finish before `taskId` may start. */
export function directPredecessors(edges: DependencyEdge[], taskId: string): string[] {
  return edges.filter((e) => e.successorTaskId === taskId).map((e) => e.predecessorTaskId);
}

// ---------------------------------------------------------------------------
// Project health (TM-FR-013)
// ---------------------------------------------------------------------------

export interface HealthInputs {
  totalTasks: number;
  overdueTasks: number;
  blockingRisks: number;
  missedMilestones: number;
}

/**
 * Thresholds from Appendix F, Project Management category:
 *   Amber at >15% overdue, or 1 blocking issue
 *   Red   at >30% overdue, or 2+ blocking issues, or a missed milestone
 *
 * Configurable so SIHL can recalibrate without a code change, but defaulted to
 * the agreed values so nothing depends on configuration existing.
 */
export interface HealthThresholds {
  amberOverduePercent: number;
  redOverduePercent: number;
  amberBlockingRisks: number;
  redBlockingRisks: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  amberOverduePercent: 15,
  redOverduePercent: 30,
  amberBlockingRisks: 1,
  redBlockingRisks: 2,
};

export function calculateHealth(
  inputs: HealthInputs,
  thresholds: HealthThresholds = DEFAULT_THRESHOLDS,
): ProjectHealth {
  const { totalTasks, overdueTasks, blockingRisks, missedMilestones } = inputs;

  // A missed milestone is Red regardless of task arithmetic. A project can look
  // healthy on percentages while having sailed past a committed date, and the
  // date is what was promised.
  if (missedMilestones > 0) return ProjectHealth.RED;
  if (blockingRisks >= thresholds.redBlockingRisks) return ProjectHealth.RED;

  const overduePercent = totalTasks === 0 ? 0 : (overdueTasks / totalTasks) * 100;
  if (overduePercent > thresholds.redOverduePercent) return ProjectHealth.RED;

  if (blockingRisks >= thresholds.amberBlockingRisks) return ProjectHealth.AMBER;
  if (overduePercent > thresholds.amberOverduePercent) return ProjectHealth.AMBER;

  return ProjectHealth.GREEN;
}

/**
 * A plain-language account of why health is what it is.
 *
 * A traffic light nobody can interrogate gets ignored or argued with; one that
 * explains itself gets acted on.
 */
export function explainHealth(
  inputs: HealthInputs,
  thresholds: HealthThresholds = DEFAULT_THRESHOLDS,
): string[] {
  const reasons: string[] = [];
  const overduePercent = inputs.totalTasks === 0 ? 0 : Math.round((inputs.overdueTasks / inputs.totalTasks) * 100);

  if (inputs.missedMilestones > 0) {
    reasons.push(`${inputs.missedMilestones} milestone${inputs.missedMilestones === 1 ? "" : "s"} passed its target date`);
  }
  if (inputs.blockingRisks > 0) {
    reasons.push(`${inputs.blockingRisks} unresolved blocking issue${inputs.blockingRisks === 1 ? "" : "s"}`);
  }
  if (overduePercent > thresholds.amberOverduePercent) {
    reasons.push(`${overduePercent}% of tasks are overdue (${inputs.overdueTasks} of ${inputs.totalTasks})`);
  }
  if (reasons.length === 0) {
    reasons.push(
      inputs.totalTasks === 0 ? "No tasks yet" : `${inputs.overdueTasks} of ${inputs.totalTasks} tasks overdue`,
    );
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// RACI (TM-FR-033)
// ---------------------------------------------------------------------------

/**
 * Exactly one Accountable per project at a time. Multiple Responsible,
 * Consulted and Informed are all fine - accountability is the one that has to
 * be singular, because "everyone is accountable" means nobody is.
 */
export function raciAccountableConflict(
  existing: { employeeId: string; role: string }[],
  incomingRole: string,
  incomingEmployeeId: string,
): string | null {
  if (incomingRole !== "ACCOUNTABLE") return null;
  const current = existing.find((a) => a.role === "ACCOUNTABLE" && a.employeeId !== incomingEmployeeId);
  return current ? current.employeeId : null;
}
