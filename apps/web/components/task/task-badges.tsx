import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Priority = "CRITICAL" | "URGENT" | "HIGH" | "MEDIUM" | "LOW";

export type TaskStatus =
  | "DRAFT"
  | "ASSIGNED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "PENDING_REVIEW"
  | "COMPLETED"
  | "VERIFIED"
  | "CLOSED"
  | "REJECTED"
  | "REOPENED"
  | "CANCELLED"
  | "ON_HOLD"
  | "DEFERRED";

/**
 * Priority reads as a coloured rule plus a label rather than a filled block.
 *
 * Thirty rows of saturated fills stop communicating urgency - which is exactly
 * how the incumbent product's grids fail. Here Critical is the only priority
 * that raises its voice, so it still means something when it appears.
 */
const PRIORITY_STYLE: Record<Priority, { bar: string; text: string; label: string }> = {
  CRITICAL: { bar: "bg-priority-critical", text: "text-priority-critical font-semibold", label: "Critical" },
  URGENT: { bar: "bg-priority-urgent", text: "text-priority-urgent", label: "Urgent" },
  HIGH: { bar: "bg-priority-high", text: "text-priority-high", label: "High" },
  MEDIUM: { bar: "bg-priority-medium", text: "text-muted-foreground", label: "Medium" },
  LOW: { bar: "bg-priority-low", text: "text-muted-foreground", label: "Low" },
};

export function PriorityTag({ priority, className }: { priority: Priority; className?: string }) {
  const s = PRIORITY_STYLE[priority];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs whitespace-nowrap", s.text, className)}>
      <span className={cn("h-3 w-0.5 shrink-0 rounded-full", s.bar)} aria-hidden="true" />
      {s.label}
    </span>
  );
}

const STATUS_TONE: Record<TaskStatus, { tone: "neutral" | "info" | "success" | "warning" | "danger"; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  ASSIGNED: { tone: "info", label: "Assigned" },
  ACCEPTED: { tone: "info", label: "Accepted" },
  IN_PROGRESS: { tone: "info", label: "In progress" },
  BLOCKED: { tone: "danger", label: "Blocked" },
  PENDING_REVIEW: { tone: "warning", label: "Pending review" },
  COMPLETED: { tone: "success", label: "Completed" },
  VERIFIED: { tone: "success", label: "Verified" },
  CLOSED: { tone: "neutral", label: "Closed" },
  REJECTED: { tone: "danger", label: "Rejected" },
  REOPENED: { tone: "warning", label: "Reopened" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
  ON_HOLD: { tone: "warning", label: "On hold" },
  DEFERRED: { tone: "neutral", label: "Deferred" },
};

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const s = STATUS_TONE[status];
  return (
    <Badge tone={s.tone} className={className}>
      {s.label}
    </Badge>
  );
}

export function statusLabel(status: TaskStatus): string {
  return STATUS_TONE[status].label;
}

/**
 * `isOverdue` is supplied by the API, not computed here.
 *
 * Deliberately: comparing against the browser's clock would make lateness
 * depend on the viewer's device, and computing it during render makes server
 * and client disagree across hydration. The server's clock is the only one
 * that can be authoritative about whether something was late.
 */
export function DueDate({ dueDate, isOverdue }: { dueDate: string | Date; isOverdue: boolean }) {
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  const overdue = isOverdue;

  return (
    <span className={cn("text-xs tabular whitespace-nowrap", overdue ? "font-medium text-danger" : "text-muted-foreground")}>
      {due.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
      {overdue && " · overdue"}
    </span>
  );
}
