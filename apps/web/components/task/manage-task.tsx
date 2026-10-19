"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

const PRIORITIES = ["CRITICAL", "URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const MANAGEMENT = ["SYSTEM_ADMIN", "DEPARTMENT_HEAD", "MANAGER"];
const SETTLED = ["CLOSED", "CANCELLED"];

/**
 * The manager's half of a task.
 *
 * Everything here was missing, which left two dead ends people hit within
 * minutes: a task created without a reviewer could never be sent for review
 * ("assign one first" — with nowhere to do it), and work could not be moved
 * off somebody who had gone on leave.
 *
 * Only managers and above see it. The assignee moving their own work away, or
 * quietly pushing out their own due date, is precisely what the anti-gaming
 * checks exist to notice — so neither is offered to them.
 */
export function ManageTask({
  task,
  onChange,
  onError,
}: {
  task: {
    id: string;
    status: string;
    priority: string;
    dueDate: string | Date;
    assignee: { id: string; name: string };
    reviewer: { id: string; name: string } | null;
  };
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const me = trpc.meta.me.useQuery();
  const staff = trpc.employee.list.useQuery({ activeOnly: true });

  const [open, setOpen] = useState(false);
  const [toEmployeeId, setToEmployeeId] = useState("");
  const [moveReason, setMoveReason] = useState("");

  const [reviewerId, setReviewerId] = useState(task.reviewer?.id ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [due, setDue] = useState(new Date(task.dueDate).toISOString().slice(0, 10));
  const [editReason, setEditReason] = useState("");

  const reassign = trpc.task.reassign.useMutation({
    onSuccess: () => {
      setToEmployeeId("");
      setMoveReason("");
      onChange();
    },
    onError: (e) => onError(e.message),
  });
  const update = trpc.task.update.useMutation({
    onSuccess: () => {
      setEditReason("");
      onChange();
    },
    onError: (e) => onError(e.message),
  });

  const isManager = (me.data?.roles ?? []).some((r) => MANAGEMENT.includes(r));
  if (!isManager || SETTLED.includes(task.status)) return null;

  const people = (staff.data ?? []).filter((e) => e.id !== task.assignee.id);
  const dueChanged = due !== new Date(task.dueDate).toISOString().slice(0, 10);
  const nothingChanged =
    !dueChanged && priority === task.priority && reviewerId === (task.reviewer?.id ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Open"}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="label-caps">Move it to somebody else</span>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New assignee" htmlFor="mv-to" className="min-w-56 flex-1">
                <Select id="mv-to" value={toEmployeeId} onChange={(e) => setToEmployeeId(e.target.value)}>
                  <option value="">Currently {task.assignee.name}…</option>
                  {people.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.departmentName ? ` — ${e.departmentName}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason" htmlFor="mv-why" className="min-w-56 flex-1" required>
                <Input
                  id="mv-why"
                  value={moveReason}
                  placeholder="Why it is moving"
                  onChange={(e) => setMoveReason(e.target.value)}
                />
              </Field>
              <Button
                size="sm"
                disabled={!toEmployeeId || moveReason.trim().length < 3 || reassign.isPending}
                onClick={() =>
                  reassign.mutate({ taskId: task.id, toEmployeeId, reason: moveReason.trim() })
                }
              >
                Reassign
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              The task goes back to Assigned so the new holder accepts it themselves — carrying the
              last person&apos;s acceptance across would put their name against a commitment they
              never made. Repeatedly moving overdue work off one person is flagged for review.
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="label-caps">Correct it</span>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Reviewer" htmlFor="ed-rev" hint="Without one it cannot be sent for review">
                <Select id="ed-rev" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
                  <option value="">Nobody</option>
                  {people.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="ed-pri">
                <Select id="ed-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0) + p.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Due" htmlFor="ed-due">
                <Input id="ed-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </Field>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="Reason"
                htmlFor="ed-why"
                className="min-w-56 flex-1"
                required={dueChanged}
                hint={dueChanged ? "Required when the due date moves" : "Optional"}
              >
                <Input
                  id="ed-why"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                />
              </Field>
              <Button
                size="sm"
                disabled={
                  nothingChanged ||
                  update.isPending ||
                  (dueChanged && editReason.trim().length < 3)
                }
                onClick={() =>
                  update.mutate({
                    taskId: task.id,
                    reviewerEmployeeId: reviewerId || null,
                    priority: priority as (typeof PRIORITIES)[number],
                    dueDate: dueChanged ? new Date(due) : undefined,
                    reason: editReason.trim() || undefined,
                  })
                }
              >
                Save
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              Moving a due date always needs a reason and keeps the old date beside the new one. It
              is the simplest way to make late work look on time, so it is never silent.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
