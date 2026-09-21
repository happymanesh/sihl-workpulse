import {
  CommandCentreEventType,
  CommandCentreSeverity,
  Priority,
  ProjectHealth,
  TaskStatus,
} from "@workpulse/db";

/**
 * TM-FR-058: the structured feed of enterprise status for the CEO Command
 * Centre.
 *
 * Pure. Deciding WHAT deserves a CEO's attention is a business rule, and
 * business rules that live inside a database query cannot be argued with in a
 * review or tested without a database.
 *
 * The governing principle is that this feed must stay quiet. A CEO feed that
 * fires on every overdue task is read once and then ignored, which is worse
 * than not having one - it converts a real escalation into noise the reader has
 * been trained to skip. So every rule here carries a threshold, and the
 * thresholds are deliberately conservative.
 *
 * Confidential tasks never reach these functions. That exclusion happens at the
 * point of generation in the service, not here, so a consumer holding an
 * integration token cannot widen it.
 */

export interface EventCandidate {
  eventType: CommandCentreEventType;
  severity: CommandCentreSeverity;
  headline: string;
  detail?: string;
  taskId?: string;
  projectId?: string;
  departmentId?: string;
  employeeId?: string;
  /** One open event per (type, subject). Re-detection must not duplicate. */
  dedupeKey: string;
}

// ---------------------------------------------------------------------------
// Thresholds. Named and exported so SIHL can calibrate against real volume
// rather than argue about them in the abstract.
// ---------------------------------------------------------------------------

/** Below this, an SLA breach is a line-manager matter, not a CEO one. */
export const BREACH_SEVERITY_PRIORITIES: Priority[] = [Priority.CRITICAL, Priority.URGENT];

/** Critical work must be this far past due before the feed says anything. */
export const CRITICAL_OVERDUE_HOURS = 24;

/** Blocked this long with no movement is an organisational problem. */
export const BLOCKED_THRESHOLD_HOURS = 72;

// ---------------------------------------------------------------------------

export interface BreachSubject {
  taskId: string;
  reference: string;
  title: string;
  priority: Priority;
  departmentId: string | null;
  departmentName: string | null;
  assigneeEmployeeId: string;
  assigneeName: string;
  overdueMinutes: number;
}

/**
 * An SLA breach, but only on work whose priority makes it enterprise-relevant.
 *
 * A breached LOW-priority task is a real fact and belongs in MIS. It does not
 * belong in front of the CEO.
 */
export function breachEvents(subjects: BreachSubject[]): EventCandidate[] {
  return subjects
    .filter((s) => BREACH_SEVERITY_PRIORITIES.includes(s.priority))
    .map((s) => ({
      eventType: CommandCentreEventType.SLA_BREACH,
      severity:
        s.priority === Priority.CRITICAL
          ? CommandCentreSeverity.URGENT
          : CommandCentreSeverity.ATTENTION,
      headline: `${s.priority === Priority.CRITICAL ? "Critical" : "Urgent"} SLA breached: ${s.reference}`,
      detail: `${s.title} — ${s.assigneeName}${s.departmentName ? `, ${s.departmentName}` : ""}. ${Math.floor(s.overdueMinutes / 60)}h past its resolution SLA.`,
      taskId: s.taskId,
      departmentId: s.departmentId ?? undefined,
      employeeId: s.assigneeEmployeeId,
      dedupeKey: `SLA_BREACH:${s.taskId}`,
    }));
}

export interface EscalationSubject {
  taskId: string;
  reference: string;
  title: string;
  level: number;
  /** The highest level configured on the chain for this task. */
  maxLevel: number;
  departmentId: string | null;
  assigneeEmployeeId: string;
  assigneeName: string;
}

/**
 * An escalation that has run out of chain.
 *
 * Only the TOP level reaches the CEO. Intermediate levels are the chain working
 * as designed; the top level is the chain having failed to resolve it - which is
 * the only part of an escalation that is genuinely an executive matter.
 */
export function topLevelEscalationEvents(subjects: EscalationSubject[]): EventCandidate[] {
  return subjects
    .filter((s) => s.maxLevel > 0 && s.level >= s.maxLevel)
    .map((s) => ({
      eventType: CommandCentreEventType.ESCALATION_TOP_LEVEL,
      severity: CommandCentreSeverity.URGENT,
      headline: `Escalation exhausted its chain: ${s.reference}`,
      detail: `${s.title} — escalated to level ${s.level} of ${s.maxLevel} and still open. Assigned to ${s.assigneeName}.`,
      taskId: s.taskId,
      departmentId: s.departmentId ?? undefined,
      employeeId: s.assigneeEmployeeId,
      dedupeKey: `ESCALATION_TOP_LEVEL:${s.taskId}`,
    }));
}

export interface OverdueSubject {
  taskId: string;
  reference: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  overdueHours: number;
  departmentId: string | null;
  assigneeEmployeeId: string;
  assigneeName: string;
}

export function criticalOverdueEvents(
  subjects: OverdueSubject[],
  thresholdHours = CRITICAL_OVERDUE_HOURS,
): EventCandidate[] {
  return subjects
    .filter((s) => s.priority === Priority.CRITICAL && s.overdueHours >= thresholdHours)
    .map((s) => ({
      eventType: CommandCentreEventType.CRITICAL_OVERDUE,
      severity: CommandCentreSeverity.URGENT,
      headline: `Critical task ${Math.floor(s.overdueHours / 24)}d overdue: ${s.reference}`,
      detail: `${s.title} — ${s.assigneeName}, currently ${s.status.replace(/_/g, " ").toLowerCase()}.`,
      taskId: s.taskId,
      departmentId: s.departmentId ?? undefined,
      employeeId: s.assigneeEmployeeId,
      dedupeKey: `CRITICAL_OVERDUE:${s.taskId}`,
    }));
}

export interface BlockedSubject {
  taskId: string;
  reference: string;
  title: string;
  blockedHours: number;
  blockedReason: string | null;
  blockingOwnerEmployeeId: string | null;
  blockingOwnerName: string | null;
  departmentId: string | null;
  assigneeEmployeeId: string;
}

/**
 * Work stuck long enough that somebody senior needs to move it.
 *
 * Deliberately reports the BLOCKING owner, not the assignee. Blocked work is
 * the one case where the person holding the task is usually not the person who
 * can do anything about it, and a feed that named the assignee here would point
 * the CEO at the wrong desk.
 */
export function blockedEvents(
  subjects: BlockedSubject[],
  thresholdHours = BLOCKED_THRESHOLD_HOURS,
): EventCandidate[] {
  return subjects
    .filter((s) => s.blockedHours >= thresholdHours)
    .map((s) => ({
      eventType: CommandCentreEventType.BLOCKED_BEYOND_THRESHOLD,
      severity: CommandCentreSeverity.ATTENTION,
      headline: `Blocked ${Math.floor(s.blockedHours / 24)}d: ${s.reference}`,
      detail: [
        s.title,
        s.blockedReason ? `Reason: ${s.blockedReason}` : "No reason recorded",
        s.blockingOwnerName
          ? `Unblocking owned by ${s.blockingOwnerName}`
          : "No owner named for unblocking",
      ].join(" — "),
      taskId: s.taskId,
      departmentId: s.departmentId ?? undefined,
      employeeId: s.blockingOwnerEmployeeId ?? s.assigneeEmployeeId,
      dedupeKey: `BLOCKED_BEYOND_THRESHOLD:${s.taskId}`,
    }));
}

export interface MissedComplianceSubject {
  taskId: string;
  reference: string;
  title: string;
  departmentId: string | null;
  departmentName: string | null;
  assigneeEmployeeId: string;
  dueDate: Date;
}

/**
 * A recurring compliance obligation that was never started and is now past due.
 *
 * Reported at URGENT regardless of priority. For a BFSI entity approaching
 * listing, a missed regulatory filing is not a productivity metric.
 */
export function missedComplianceEvents(subjects: MissedComplianceSubject[]): EventCandidate[] {
  return subjects.map((s) => ({
    eventType: CommandCentreEventType.RECURRING_COMPLIANCE_MISSED,
    severity: CommandCentreSeverity.URGENT,
    headline: `Recurring compliance obligation missed: ${s.reference}`,
    detail: `${s.title} — due ${s.dueDate.toISOString().slice(0, 10)}${s.departmentName ? `, ${s.departmentName}` : ""}. Never started.`,
    taskId: s.taskId,
    departmentId: s.departmentId ?? undefined,
    employeeId: s.assigneeEmployeeId,
    dedupeKey: `RECURRING_COMPLIANCE_MISSED:${s.taskId}`,
  }));
}

export interface ProjectHealthSubject {
  projectId: string;
  name: string;
  health: ProjectHealth;
  previousHealth: ProjectHealth | null;
  departmentId: string | null;
}

const HEALTH_RANK: Record<ProjectHealth, number> = {
  GREEN: 0,
  AMBER: 1,
  RED: 2,
};

/**
 * A project whose health got worse.
 *
 * The TRANSITION is the event, not the state. A project that has been AT_RISK
 * for a month is a known problem being managed; a project that became AT_RISK
 * this morning is news.
 */
export function projectHealthEvents(subjects: ProjectHealthSubject[]): EventCandidate[] {
  return subjects
    .filter((s) => s.previousHealth !== null && HEALTH_RANK[s.health] > HEALTH_RANK[s.previousHealth])
    .map((s) => ({
      eventType: CommandCentreEventType.PROJECT_HEALTH_DEGRADED,
      severity:
        s.health === ProjectHealth.RED
          ? CommandCentreSeverity.URGENT
          : CommandCentreSeverity.ATTENTION,
      headline: `Project health moved to ${s.health.toLowerCase()}: ${s.name}`,
      detail: `Was ${s.previousHealth?.toLowerCase()}.`,
      projectId: s.projectId,
      departmentId: s.departmentId ?? undefined,
      // Health changes track the project across successive degradations rather
      // than raising one permanent event for the project's whole life.
      dedupeKey: `PROJECT_HEALTH_DEGRADED:${s.projectId}:${s.health}`,
    }));
}

// ---------------------------------------------------------------------------
// Enterprise summary
// ---------------------------------------------------------------------------

export interface EnterprisePulse {
  openTasks: number;
  overdueTasks: number;
  criticalOpen: number;
  blockedTasks: number;
  slaBreaches: number;
  onTimePercent: number | null;
  /** Same figures for the preceding period, for direction of travel. */
  previousOnTimePercent: number | null;
}

export type Direction = "IMPROVING" | "STABLE" | "DETERIORATING" | "UNKNOWN";

/** Below this many points, a move is noise rather than a trend. */
export const TREND_NOISE_POINTS = 2;

export function trendOf(pulse: EnterprisePulse): Direction {
  if (pulse.onTimePercent === null || pulse.previousOnTimePercent === null) return "UNKNOWN";
  const delta = pulse.onTimePercent - pulse.previousOnTimePercent;
  if (Math.abs(delta) < TREND_NOISE_POINTS) return "STABLE";
  return delta > 0 ? "IMPROVING" : "DETERIORATING";
}
