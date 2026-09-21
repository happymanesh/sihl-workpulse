import { WorkPulseRole } from "@workpulse/db";

/**
 * Confidential-task visibility (BRS Section 18.1). Pure, so every branch can be
 * tested without a database.
 *
 * The rule that matters most is the one about Audit: restricting visibility of
 * sensitive work must NOT blind the compliance function. A BFSI entity that
 * could hide work from its own auditors by ticking a box would have built an
 * exposure, not a control.
 */

export interface Viewer {
  employeeId: string | null;
  roles: WorkPulseRole[];
  /** Employee ids this viewer manages, directly or transitively. */
  managedEmployeeIds?: string[];
}

export interface ViewableTask {
  isConfidential: boolean;
  assigneeEmployeeId: string;
  reviewerEmployeeId: string | null;
  /** RACI Accountable / DACI Approver on the task's project, where it has one. */
  governanceEmployeeIds?: string[];
}

export type VisibilityReason =
  | "AUDIT_ROLE"
  | "NOT_CONFIDENTIAL"
  | "ASSIGNEE"
  | "REVIEWER"
  | "GOVERNANCE_ROLE"
  | "MANAGEMENT_CHAIN"
  | "EXECUTIVE_RESTRICTED"
  | "DENIED";

export interface VisibilityVerdict {
  canView: boolean;
  reason: VisibilityReason;
}

export function canViewTask(viewer: Viewer, task: ViewableTask): VisibilityVerdict {
  // Audit sees everything, always, and this is checked FIRST so no later
  // condition can accidentally exclude it. The Audit role is independent of the
  // line hierarchy by design (BRS Section 18).
  if (viewer.roles.includes(WorkPulseRole.AUDIT)) {
    return { canView: true, reason: "AUDIT_ROLE" };
  }

  if (!task.isConfidential) {
    return { canView: true, reason: "NOT_CONFIDENTIAL" };
  }

  // From here the task is confidential: only the people actually involved.
  if (viewer.employeeId && viewer.employeeId === task.assigneeEmployeeId) {
    return { canView: true, reason: "ASSIGNEE" };
  }
  if (viewer.employeeId && viewer.employeeId === task.reviewerEmployeeId) {
    return { canView: true, reason: "REVIEWER" };
  }
  if (viewer.employeeId && (task.governanceEmployeeIds ?? []).includes(viewer.employeeId)) {
    return { canView: true, reason: "GOVERNANCE_ROLE" };
  }

  // The management chain above the assignee. Note this is the chain, not the
  // role: being a MANAGER somewhere else in the business grants nothing.
  if ((viewer.managedEmployeeIds ?? []).includes(task.assigneeEmployeeId)) {
    return { canView: true, reason: "MANAGEMENT_CHAIN" };
  }

  // CEO/management confidential visibility (BRS Section 11). Deliberately a
  // distinct role from EXECUTIVE, so ordinary CXO access does not carry it.
  if (viewer.roles.includes(WorkPulseRole.EXECUTIVE_RESTRICTED)) {
    return { canView: true, reason: "EXECUTIVE_RESTRICTED" };
  }

  // SYSTEM_ADMIN is absent from this list on purpose. Administering the system
  // is not a reason to read HR, legal or disciplinary matters.
  return { canView: false, reason: "DENIED" };
}

/**
 * Whether a viewer may see a task's audit trail.
 *
 * Audit sees the trail of every task including confidential ones; everyone else
 * sees the trail only of tasks they can otherwise view (BRS Section 19).
 */
export function canViewAuditTrail(viewer: Viewer, task: ViewableTask): boolean {
  if (viewer.roles.includes(WorkPulseRole.AUDIT)) return true;
  return canViewTask(viewer, task).canView;
}

/**
 * Whether confidential content should be excluded from an aggregate.
 *
 * MIS counts and the future CEO Command Centre feed exclude confidential work
 * by default (TM-FR-058) - but the exclusion is disclosed rather than silent,
 * so a total that looks wrong can be explained.
 */
export function excludeConfidentialFromAggregate(viewer: Viewer): boolean {
  return !viewer.roles.includes(WorkPulseRole.AUDIT);
}
