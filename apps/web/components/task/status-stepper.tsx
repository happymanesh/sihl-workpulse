import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "./task-badges";

/**
 * The lifecycle stepper from the wireframes.
 *
 * Shows the main flow only. Side-states (Blocked, Rejected, Reopened, On Hold,
 * Deferred, Cancelled) are deliberately not steps - they are conditions the
 * task is currently in, and rendering them inline would imply a linear path
 * through them that does not exist. When the task is in one, it is called out
 * above the stepper instead.
 *
 * Which steps appear depends on the Task Type: a type that does not require
 * verification never shows Verified, because for that task it is not a stage
 * that exists.
 */
const MAIN_FLOW: { status: TaskStatus; label: string }[] = [
  { status: "DRAFT", label: "Draft" },
  { status: "ASSIGNED", label: "Assigned" },
  { status: "ACCEPTED", label: "Accepted" },
  { status: "IN_PROGRESS", label: "In progress" },
  { status: "PENDING_REVIEW", label: "Pending review" },
  { status: "COMPLETED", label: "Completed" },
  { status: "VERIFIED", label: "Verified" },
  { status: "CLOSED", label: "Closed" },
];

const SIDE_STATES: TaskStatus[] = [
  "BLOCKED",
  "REJECTED",
  "REOPENED",
  "ON_HOLD",
  "DEFERRED",
  "CANCELLED",
];

export function StatusStepper({
  status,
  requiresVerification,
  className,
}: {
  status: TaskStatus;
  requiresVerification: boolean;
  className?: string;
}) {
  const steps = MAIN_FLOW.filter((s) => s.status !== "VERIFIED" || requiresVerification);
  const isSideState = SIDE_STATES.includes(status);

  // In a side-state the task still has a position in the flow - the furthest
  // point it reached - so the stepper shows that rather than collapsing.
  const currentIndex = isSideState
    ? Math.max(
        steps.findIndex((s) => s.status === "IN_PROGRESS"),
        0,
      )
    : steps.findIndex((s) => s.status === status);

  return (
    <ol className={cn("flex flex-wrap items-center gap-x-1 gap-y-2", className)} aria-label="Task progress">
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex && !isSideState;

        return (
          <li key={step.status} className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors",
                current && "bg-primary font-medium text-primary-foreground",
                done && "text-success",
                !current && !done && "text-muted-foreground",
              )}
              aria-current={current ? "step" : undefined}
            >
              {done && <Check className="size-3" aria-hidden="true" />}
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn("h-px w-3 shrink-0", done ? "bg-success/40" : "bg-border")}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
