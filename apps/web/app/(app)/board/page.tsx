"use client";

import Link from "next/link";
import { useState } from "react";
import { PriorityTag, statusLabel, type Priority, type TaskStatus } from "@/components/task/task-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/**
 * Columns follow the main execution flow (wireframe: Kanban board).
 *
 * Terminal and paused side-states are not columns. Closed and Cancelled would
 * grow without bound and push the live work off screen; On Hold and Deferred
 * are conditions rather than stages. Blocked IS a column because it is where
 * work goes to be noticed - hiding it is how blocked work stays blocked.
 */
const COLUMNS: { status: TaskStatus; accent: string }[] = [
  { status: "ASSIGNED", accent: "bg-info" },
  { status: "ACCEPTED", accent: "bg-info" },
  { status: "IN_PROGRESS", accent: "bg-info" },
  { status: "BLOCKED", accent: "bg-danger" },
  { status: "PENDING_REVIEW", accent: "bg-warning" },
  { status: "COMPLETED", accent: "bg-success" },
  { status: "VERIFIED", accent: "bg-success" },
];

export default function BoardPage() {
  const utils = trpc.useUtils();
  const tasks = trpc.task.mine.useQuery({ includeClosed: false });
  const rules = trpc.reference.taskTransitions.useQuery();

  const [dragging, setDragging] = useState<{ id: string; from: TaskStatus } | null>(null);
  const [prompt, setPrompt] = useState<{ id: string; to: TaskStatus } | null>(null);
  const [reason, setReason] = useState("");
  const [blockingOwner, setBlockingOwner] = useState("");
  const [error, setError] = useState<string | null>(null);

  const employees = trpc.employee.list.useQuery({ activeOnly: true }, { enabled: prompt?.to === "BLOCKED" });

  const move = trpc.task.transition.useMutation({
    onSuccess: () => {
      setPrompt(null);
      setReason("");
      setBlockingOwner("");
      setError(null);
      utils.task.mine.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  function attempt(taskId: string, from: TaskStatus, to: TaskStatus) {
    setDragging(null);
    if (from === to) return;
    if (rules.data?.reasonRequired.includes(to)) {
      setPrompt({ id: taskId, to });
      return;
    }
    move.mutate({ taskId, to });
  }

  if (tasks.error) {
    const unauthorised = tasks.error.data?.code === "UNAUTHORIZED";
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">{unauthorised ? "Sign in to continue" : "Could not load the board"}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {unauthorised ? "workPulse uses your Synapse session." : tasks.error.message}
        </p>
      </Card>
    );
  }

  const allowedFromDragged = dragging ? (rules.data?.allowed[dragging.from] ?? []) : null;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {prompt && (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <Field
              label={`Reason (required to ${statusLabel(prompt.to).toLowerCase()})`}
              htmlFor="kr"
              required
            >
              <Textarea id="kr" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {prompt.to === "BLOCKED" && (
              <Field label="Who owns resolving this?" htmlFor="kb" required>
                <Select id="kb" value={blockingOwner} onChange={(e) => setBlockingOwner(e.target.value)}>
                  <option value="">Select…</option>
                  {employees.data?.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!reason.trim() || (prompt.to === "BLOCKED" && !blockingOwner) || move.isPending}
                onClick={() =>
                  move.mutate({
                    taskId: prompt.id,
                    to: prompt.to,
                    reason: reason.trim(),
                    blockedReason: prompt.to === "BLOCKED" ? reason.trim() : undefined,
                    blockingOwnerEmployeeId: prompt.to === "BLOCKED" ? blockingOwner : undefined,
                  })
                }
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setPrompt(null); setReason(""); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((col) => {
          const items = (tasks.data ?? []).filter((t) => t.status === col.status);
          // During a drag, columns the state machine forbids are dimmed rather
          // than silently accepting a drop the API will reject.
          const droppable = !dragging || allowedFromDragged?.includes(col.status) || dragging.from === col.status;

          return (
            <div
              key={col.status}
              onDragOver={(e) => droppable && e.preventDefault()}
              onDrop={() => dragging && droppable && attempt(dragging.id, dragging.from, col.status)}
              className={cn(
                "flex w-64 shrink-0 flex-col rounded-lg border border-border bg-card transition-opacity",
                dragging && !droppable && "opacity-40",
              )}
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className={cn("h-3 w-0.5 rounded-full", col.accent)} aria-hidden="true" />
                <span className="label-caps flex-1">{statusLabel(col.status)}</span>
                <span className="text-2xs tabular text-muted-foreground">{items.length}</span>
              </div>

              <div className="flex min-h-24 flex-col gap-2 p-2">
                {items.map((t) => (
                  <article
                    key={t.id}
                    draggable
                    onDragStart={() => setDragging({ id: t.id, from: t.status as TaskStatus })}
                    onDragEnd={() => setDragging(null)}
                    className="flex cursor-grab flex-col gap-1.5 rounded-md border border-border bg-background p-2.5 shadow-subtle active:cursor-grabbing"
                  >
                    <Link href={`/tasks/${t.id}`} className="text-sm font-medium leading-snug hover:underline">
                      {t.title}
                    </Link>
                    <div className="flex items-center justify-between gap-2">
                      <PriorityTag priority={t.priority as Priority} />
                      <span className={cn("text-2xs tabular", t.isOverdue ? "text-danger" : "text-muted-foreground")}>
                        {new Date(t.dueDate).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-2xs text-muted-foreground">{t.reference}</span>
                      {t.isMissed && <span className="text-2xs font-medium text-danger">Missed</span>}
                    </div>

                    {/* Keyboard and touch path. Native drag-and-drop is neither,
                        so the same moves are always reachable from here. */}
                    <select
                      aria-label={`Move ${t.reference}`}
                      value=""
                      onChange={(e) => e.target.value && attempt(t.id, t.status as TaskStatus, e.target.value as TaskStatus)}
                      className="mt-0.5 w-full rounded border border-input bg-card px-1.5 py-1 text-2xs text-muted-foreground"
                    >
                      <option value="">Move to…</option>
                      {(rules.data?.allowed[t.status as TaskStatus] ?? []).map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s as TaskStatus)}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}

                {items.length === 0 && (
                  <p className="px-1 py-6 text-center text-2xs text-muted-foreground">Nothing here</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-2xs text-muted-foreground">
        Drag a card, or use its &ldquo;Move to&rdquo; list. Only moves the lifecycle permits are offered, and the API
        enforces the same rules independently — a move that needs a reason will ask for one.
      </p>
    </div>
  );
}
