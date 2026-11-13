"use client";

import { use, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Clock, Plus, Trash2 } from "lucide-react";
import { StatusStepper } from "@/components/task/status-stepper";
import { DueDate, PriorityTag, StatusBadge, statusLabel, type Priority, type TaskStatus } from "@/components/task/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { DictateButton } from "@/components/dictate-button";
import { AttachmentsPanel } from "@/components/task/attachments-panel";
import { ManageTask } from "@/components/task/manage-task";
import { cn } from "@/lib/utils";
import { describeDuration, formatHhMm } from "@/lib/duration";

/** Transitions a user can drive from the detail screen, and what to call them. */
/**
 * Labels only. Which of these are legal from the current status, and which
 * demand a written reason, both come from the API's transition map
 * (reference.taskTransitions) - the same table the service enforces. Keeping a
 * second copy of those rules here is how the two drift apart.
 */
const ACTIONS: { to: TaskStatus; label: string; variant?: "primary" | "outline" | "danger" }[] = [
  { to: "ACCEPTED", label: "Accept" },
  { to: "IN_PROGRESS", label: "Start" },
  { to: "BLOCKED", label: "Block", variant: "outline" },
  { to: "PENDING_REVIEW", label: "Send for review", variant: "outline" },
  { to: "COMPLETED", label: "Mark complete" },
  { to: "VERIFIED", label: "Verify" },
  { to: "CLOSED", label: "Close" },
  { to: "REJECTED", label: "Reject", variant: "danger" },
  { to: "REOPENED", label: "Reopen", variant: "outline" },
  { to: "ON_HOLD", label: "Put on hold", variant: "outline" },
  { to: "DEFERRED", label: "Defer", variant: "outline" },
  { to: "CANCELLED", label: "Cancel", variant: "danger" },
];

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const query = trpc.task.byId.useQuery({ id });
  const sla = trpc.sla.forTask.useQuery({ taskId: id });
  // The lifecycle rules, straight from the API. Offering a move the server
  // will refuse teaches people to distrust the buttons.
  const transitions = trpc.reference.taskTransitions.useQuery();
  // For the blocking-owner picker.
  const staff = trpc.employee.list.useQuery({ activeOnly: true });
  const comments = trpc.task.comments.useQuery({ taskId: id });

  // A remark captured alongside a lifecycle move, and a standalone note. Kept
  // apart because they mean different things: one is "what I did when I moved
  // this", the other is "something worth saying about this task".
  const [remark, setRemark] = useState("");
  const [remarkDictated, setRemarkDictated] = useState(false);
  const [remarkLanguage, setRemarkLanguage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteDictated, setNoteDictated] = useState(false);
  const [noteLanguage, setNoteLanguage] = useState<string | null>(null);

  const addComment = trpc.task.addComment.useMutation({
    onSuccess: () => {
      setNote("");
      setNoteDictated(false);
      setNoteLanguage(null);
      setError(null);
      utils.task.comments.invalidate({ taskId: id });
    },
    onError: (e) => setError(e.message),
  });

  const [pending, setPending] = useState<TaskStatus | null>(null);
  const [reason, setReason] = useState("");
  const [blockingOwner, setBlockingOwner] = useState("");
  const [error, setError] = useState<string | null>(null);

  const transition = trpc.task.transition.useMutation({
    onSuccess: () => {
      setPending(null);
      setReason("");
      setBlockingOwner("");
      setRemark("");
      setRemarkDictated(false);
      setRemarkLanguage(null);
      setError(null);
      utils.task.comments.invalidate({ taskId: id });
      utils.task.byId.invalidate({ id });
      utils.task.mine.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const setItem = trpc.task.setChecklistItem.useMutation({
    onSuccess: () => utils.task.byId.invalidate({ id }),
    onError: (e) => setError(e.message),
  });

  const [newStep, setNewStep] = useState("");

  const addItem = trpc.task.addChecklistItem.useMutation({
    onSuccess: () => {
      setNewStep("");
      setError(null);
      utils.task.byId.invalidate({ id });
    },
    onError: (e) => setError(e.message),
  });

  const removeItem = trpc.task.removeChecklistItem.useMutation({
    onSuccess: () => utils.task.byId.invalidate({ id }),
    onError: (e) => setError(e.message),
  });

  if (query.error) {
    const unauthorised = query.error.data?.code === "UNAUTHORIZED";
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">{unauthorised ? "Sign in to continue" : "Could not load this task"}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {unauthorised ? "workPulse uses your Synapse session." : query.error.message}
        </p>
      </Card>
    );
  }

  // Not `query.data!`. A query can sit pending without being "loading" - after
  // an unauthorised response, on a paused retry - and the assertion turned that
  // into a white screen rather than a skeleton. Checked, not asserted.
  if (query.isLoading || !query.data) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }

  const task = query.data;
  const status = task.status as TaskStatus;
  const checklistOutstanding = task.checklistItems.filter((i) => !i.isDone && !i.waivedReason).length;
  const sideState = ["BLOCKED", "REJECTED", "ON_HOLD", "DEFERRED", "CANCELLED", "REOPENED"].includes(status);
  // Past Completed the list of steps is the record of what was required, so it
  // stops being editable. Mirrors the server, which refuses either way.
  const checklistFrozen = ["COMPLETED", "VERIFIED", "CLOSED", "CANCELLED"].includes(status);

  // What the server says is legal from here, in the order ACTIONS declares so
  // the buttons do not jump around as the task progresses. reasonRequired
  // comes from the same place, rather than being restated in this file.
  const legal = transitions.data?.allowed[status] ?? [];
  const reasonRequired = transitions.data?.reasonRequired ?? [];

  // The transition map is the same for every task, so it cannot know this one
  // has a reviewer waiting. reviewRequired comes from the API, computed from
  // the same rule that refuses the move, so the button and the refusal agree.
  const reviewPending = task.reviewRequired && status !== "VERIFIED";

  const available = ACTIONS.filter(
    (a) => legal.includes(a.to) && !(a.to === "CLOSED" && reviewPending),
  ).map((a) => ({
    ...a,
    needsReason: reasonRequired.includes(a.to),
  }));

  function submit(to: TaskStatus, needsReason: boolean) {
    if (needsReason && !reason.trim()) {
      setPending(to);
      return;
    }
    transition.mutate({
      taskId: id,
      to,
      reason: reason.trim() || undefined,
      blockedReason: to === "BLOCKED" ? reason.trim() : undefined,
      blockingOwnerEmployeeId: to === "BLOCKED" ? blockingOwner || undefined : undefined,
      remark: remark.trim() || undefined,
      remarkWasDictated: remark.trim() ? remarkDictated : undefined,
      remarkLanguage: remark.trim() ? remarkLanguage : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/tasks" className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        My tasks
      </Link>

      <Card>
        <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-2xs font-semibold text-info">{task.reference}</span>
            <h2 className="text-lg font-semibold leading-tight">{task.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PriorityTag priority={task.priority as Priority} />
            <StatusBadge status={status} />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <StatusStepper status={status} reviewRequired={task.reviewRequired} />

          {sideState && (
            <div className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-subtle px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="text-xs">
                <p className="font-medium">This task is {statusLabel(status).toLowerCase()}</p>
                {task.blockedReason && <p className="mt-0.5 text-muted-foreground">{task.blockedReason}</p>}
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Field label="Assignee" value={task.assignee.name} />
            <Field
              label="Reviewer"
              value={
                task.reviewer ? (
                  <span className="flex items-center gap-1.5">
                    {task.reviewer.name}
                    {reviewPending && <Badge tone="warning">pending</Badge>}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            {task.deskCardActivity?.deskCard?.holder && (
              <Field label="Desk card owner" value={task.deskCardActivity.deskCard.holder.name} />
            )}
            <Field label="Type" value={task.taskType.name} />
            <Field
              label="Due"
              value={<DueDate dueDate={task.dueDate} isOverdue={false} />}
            />
            <Field label="Department" value={task.department?.name ?? "—"} />
            <Field
              label="Source"
              value={
                task.deskCardActivity ? (
                  <Link href="/desk-card" className="text-primary hover:underline">
                    Desk card
                  </Link>
                ) : (
                  "Ad hoc"
                )
              }
            />
            {task.estimatedMinutes != null && (
              <Field
                label="Estimated"
                value={<span title={describeDuration(task.estimatedMinutes)}>{formatHhMm(task.estimatedMinutes)}</span>}
              />
            )}
            {task.isMissed && <Field label="Flag" value={<Badge tone="danger">Missed</Badge>} />}
          </dl>

          {(task.relatedTask || task.relatedFrom.length > 0) && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <span className="label-caps">Related work</span>
              <div className="flex flex-col gap-1">
                {task.relatedTask && (
                  <Link
                    href={`/tasks/${task.relatedTask.id}`}
                    className="group flex items-baseline gap-2 text-xs"
                  >
                    <span className="text-muted-foreground">Follows on from</span>
                    <span className="font-mono font-medium text-info">{task.relatedTask.reference}</span>
                    <span className="group-hover:underline">{task.relatedTask.title}</span>
                  </Link>
                )}
                {task.relatedFrom.map((r) => (
                  <Link key={r.id} href={`/tasks/${r.id}`} className="group flex items-baseline gap-2 text-xs">
                    <span className="text-muted-foreground">Followed by</span>
                    <span className="font-mono font-medium text-info">{r.reference}</span>
                    <span className="group-hover:underline">{r.title}</span>
                  </Link>
                ))}
              </div>
              <p className="text-2xs text-muted-foreground">
                A reference only — neither task waits on the other.
              </p>
            </div>
          )}

          {task.description && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <span className="label-caps">Details</span>
              <p className="max-w-prose whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {(task.checklistItems.length > 0 || !checklistFrozen) && (
        <Card>
          <CardHeader className="bg-info-subtle/50">
            <CardTitle className="text-info">
              Checklist ({task.checklistItems.length - checklistOutstanding}/{task.checklistItems.length})
            </CardTitle>
            {checklistOutstanding > 0 && (
              <span className="text-2xs text-muted-foreground">
                All items must be done or waived before completion
              </span>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {task.checklistItems.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2.5 border-b border-border py-2 last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked={item.isDone}
                  disabled={Boolean(item.waivedReason) || setItem.isPending}
                  onChange={(e) => setItem.mutate({ itemId: item.id, isDone: e.target.checked })}
                  className="size-3.5 accent-[hsl(var(--primary))]"
                />
                <span className={cn("text-sm", (item.isDone || item.waivedReason) && "text-muted-foreground line-through")}>
                  {item.label}
                </span>
                {item.waivedReason && (
                  <Badge tone="warning" className="ml-auto">
                    Waived
                  </Badge>
                )}
                {item.isDone && !item.waivedReason && <Check className="ml-auto size-3.5 text-success" />}
                {!item.isDone && !item.waivedReason && !checklistFrozen && (
                  <button
                    type="button"
                    aria-label={`Remove step: ${item.label}`}
                    disabled={removeItem.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      removeItem.mutate({ itemId: item.id });
                    }}
                    className="ml-auto text-muted-foreground transition-colors hover:text-danger"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </label>
            ))}

            {task.checklistItems.length === 0 && (
              <p className="py-2 text-xs text-muted-foreground">
                No steps yet. Add the checks this task needs before it can be called done.
              </p>
            )}

            {!checklistFrozen && (
              <form
                className="flex items-center gap-2 pt-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const label = newStep.trim();
                  if (!label) return;
                  addItem.mutate({ taskId: id, label });
                }}
              >
                <input
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  placeholder="Add a step"
                  aria-label="New checklist step"
                  maxLength={300}
                  className="h-8 flex-1 rounded-md border border-input bg-card px-2.5 text-xs"
                />
                <Button type="submit" size="sm" variant="outline" disabled={!newStep.trim() || addItem.isPending}>
                  <Plus className="size-3" aria-hidden /> Add
                </Button>
              </form>
            )}

            {checklistFrozen && task.checklistItems.length > 0 && (
              <p className="pt-2.5 text-2xs text-muted-foreground">
                This task is {statusLabel(status).toLowerCase()}, so the checklist is fixed — it is the record of
                what was required.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {sla.data && <SlaPanel sla={sla.data} />}

      <Card>
        <CardHeader className="bg-primary/5">
          <CardTitle className="text-primary">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && <p className="text-xs text-danger">{error}</p>}

          {pending && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
              <label className="label-caps" htmlFor="reason">
                Reason (required to {statusLabel(pending).toLowerCase()})
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm"
                placeholder="Why?"
              />
              {pending === "BLOCKED" && (
                <select
                  value={blockingOwner}
                  onChange={(e) => setBlockingOwner(e.target.value)}
                  className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm"
                >
                  {/* A name, not an employee id. Nobody blocked at 5pm is going
                      to look up a colleague's internal id to say who they are
                      waiting on - they will skip the field and the block
                      becomes untraceable. */}
                  <option value="">Who owns unblocking this?</option>
                  {(staff.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.departmentName ? ` — ${e.departmentName}` : ""}
                      {e.designation ? ` (${e.designation})` : ""}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => submit(pending, false)}
                  disabled={
                    !reason.trim() ||
                    transition.isPending ||
                    (pending === "BLOCKED" && !blockingOwner)
                  }
                >
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setPending(null); setReason(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Optional on every move. The deck promises evidence attached to the
              work; a remark written at the moment of acting is where most of
              that comes from, and it is also what keeps a closure from being
              flagged as having none. */}
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
            <label htmlFor="remark" className="text-2xs font-medium text-muted-foreground">
              Add a note with this change — optional
            </label>
            <textarea
              id="remark"
              rows={2}
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                if (remarkDictated) setRemarkDictated(false);
              }}
              placeholder="What you did, or anything the next person needs to know."
              className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm"
            />
            <DictateButton
              seconds={10}
              disabled={transition.isPending}
              onTranscript={(text, lang) => {
                // Appended, never replacing: somebody who typed half a note and
                // then dictated the rest should not lose the typed half.
                setRemark((r) => (r.trim() ? `${r.trim()} ${text}` : text));
                setRemarkDictated(true);
                setRemarkLanguage(lang);
              }}
            />
            {remarkDictated && (
              <p className="text-2xs text-muted-foreground">
                Dictated — read it back before saving. Transcription misreads names and numbers.
              </p>
            )}
          </div>

          {reviewPending && (status === "COMPLETED" || status === "PENDING_REVIEW") && (
            <div className="flex gap-2.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5">
              <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="flex flex-col gap-0.5">
                <p className="text-xs font-medium">Review pending</p>
                <p className="max-w-xl text-2xs text-muted-foreground">
                  {task.reviewer
                    ? `${task.reviewer.name} is named to review this task. It cannot be closed until they verify it.`
                    : "This task type must be verified before it can be closed. Assign a reviewer, or ask a manager to verify it."}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {available.map((a) => (
              <Button
                key={a.to}
                size="sm"
                variant={a.variant ?? "primary"}
                disabled={transition.isPending}
                onClick={() => (a.needsReason ? setPending(a.to) : submit(a.to, false))}
              >
                {a.label}
              </Button>
            ))}
            {transitions.isLoading && (
              <span className="text-2xs text-muted-foreground">Loading what you can do…</span>
            )}
            {!transitions.isLoading && available.length === 0 && (
              <span className="text-2xs text-muted-foreground">
                Nothing further to do — {task.status.replace(/_/g, " ").toLowerCase()} is the end of the line for
                this task.
              </span>
            )}
          </div>
          <p className="text-2xs text-muted-foreground">
            Only moves that are legal from {task.status.replace(/_/g, " ").toLowerCase()} are shown. Your role is
            checked when you act — the API is still the authority, this just stops offering you what it would
            refuse.
          </p>
        </CardContent>
      </Card>

      <ManageTask
        task={task}
        onChange={() => utils.task.byId.invalidate({ id })}
        onError={setError}
      />

      <AttachmentsPanel taskId={id} taskStatus={task.status} />

      <Card>
        <CardHeader className="bg-success-subtle/50">
          <CardTitle className="text-success">Notes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(comments.data ?? []).map((c) => (
            <div key={c.id} className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-medium">{c.author.name}</span>
                {c.author.designation && (
                  <span className="text-2xs text-muted-foreground">{c.author.designation}</span>
                )}
                <Badge tone={c.kind === "GENERAL" ? "neutral" : "info"}>
                  {c.kind.toLowerCase()}
                </Badge>
                {/* Which stage the task was in when this was written. The same
                    words mean different things at In progress and at Completed. */}
                {c.relatedStatus && (
                  <span className="text-2xs text-muted-foreground">
                    at {statusLabel(c.relatedStatus as TaskStatus).toLowerCase()}
                  </span>
                )}
                {c.wasDictated && (
                  <Badge tone="outline" title={c.dictatedLanguage ?? undefined}>
                    dictated
                  </Badge>
                )}
                <span className="ml-auto text-2xs text-muted-foreground tabular">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          ))}

          {!comments.isLoading && (comments.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">
              No notes yet. A note left here is what an auditor reads alongside the dates.
            </p>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <textarea
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (noteDictated) setNoteDictated(false);
              }}
              placeholder="Add a note…"
              className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <DictateButton
                seconds={10}
                disabled={addComment.isPending}
                onTranscript={(text, lang) => {
                  setNote((n) => (n.trim() ? `${n.trim()} ${text}` : text));
                  setNoteDictated(true);
                  setNoteLanguage(lang);
                }}
              />
              <Button
                size="sm"
                disabled={!note.trim() || addComment.isPending}
                onClick={() =>
                  addComment.mutate({
                    taskId: id,
                    body: note.trim(),
                    wasDictated: noteDictated,
                    dictatedLanguage: noteLanguage,
                  })
                }
              >
                Add note
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              Notes cannot be edited or deleted once added — correct one by adding another. That is
              what makes them worth reading later.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/60">
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-0">
          {task.statusHistory.map((h) => (
            <div key={h.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-border py-2 last:border-b-0">
              <span className="text-sm">
                {h.fromStatus ? `${statusLabel(h.fromStatus as TaskStatus)} → ` : "Created as "}
                <span className="font-medium">{statusLabel(h.toStatus as TaskStatus)}</span>
              </span>
              <span className="font-mono text-2xs text-muted-foreground">
                {new Date(h.createdAt).toLocaleString()}
              </span>
              {h.actorType === "SYSTEM" && <Badge tone="neutral">System</Badge>}
              {h.reason && <p className="w-full text-xs text-muted-foreground">{h.reason}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The SLA position. Shows active and paused time separately on purpose - the
 * paused figure is the one that explains why a task sitting for three days is
 * not breached, and hiding it invites the argument.
 */
function SlaPanel({
  sla,
}: {
  sla: { state: string; percentUsed: number; activeMinutes: number; pausedMinutes: number; resolutionMinutes: number; minutesRemaining: number };
}) {
  const tone = sla.state === "BREACHED" ? "danger" : sla.state === "AT_RISK" ? "warning" : "success";
  const label = sla.state === "BREACHED" ? "Breached" : sla.state === "AT_RISK" ? "At risk" : "Within SLA";
  const h = (m: number) => `${(m / 60).toFixed(1)}h`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service level</CardTitle>
        <Badge tone={tone}>{label}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-success",
            )}
            style={{ width: `${Math.min(sla.percentUsed, 100)}%` }}
          />
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
          <Field label="Used" value={`${sla.percentUsed}%`} />
          <Field label="Active time" value={h(sla.activeMinutes)} />
          <Field label="Paused" value={h(sla.pausedMinutes)} />
          <Field label="Allowance" value={h(sla.resolutionMinutes)} />
        </dl>
        {sla.pausedMinutes > 0 && (
          <p className="text-2xs text-muted-foreground">
            {h(sla.pausedMinutes)} spent Blocked or On Hold does not count against this task — that time was
            outside the assignee&apos;s control.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="label-caps">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  );
}
