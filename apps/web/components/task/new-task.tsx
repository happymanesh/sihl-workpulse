"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

const PRIORITIES = ["CRITICAL", "URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const COMPLEXITY = ["LOW", "MEDIUM", "HIGH"] as const;

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Raise a one-off task.
 *
 * Deliberately not the main way work appears — recurring obligations belong on
 * a desk card, where they generate themselves and carry a control. This is for
 * the genuinely ad-hoc: something came up, somebody has to do it, it is not
 * part of anybody's standing duties.
 *
 * The capability existed from the beginning and nothing called it, so until now
 * the only work in the system was whatever a desk card produced.
 */
export function NewTask({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskTypes = trpc.reference.taskTypes.useQuery(undefined, { enabled: open });
  const staff = trpc.employee.list.useQuery({ activeOnly: true }, { enabled: open });
  const me = trpc.meta.me.useQuery();

  const [f, setF] = useState({
    title: "",
    description: "",
    taskTypeId: "",
    priority: "MEDIUM" as (typeof PRIORITIES)[number],
    complexity: "MEDIUM" as (typeof COMPLEXITY)[number],
    assigneeEmployeeId: "",
    reviewerEmployeeId: "",
    dueDate: inDays(3),
    estimatedMinutes: 30,
    checklist: "",
  });

  const create = trpc.task.create.useMutation({
    onSuccess: () => {
      setOpen(false);
      setError(null);
      setF({ ...f, title: "", description: "", checklist: "" });
      onCreated();
    },
    onError: (e) => setError(e.message),
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus /> New task
      </Button>
    );
  }

  const people = staff.data ?? [];
  const selfAssigned = f.assigneeEmployeeId === me.data?.employeeId;
  const sameReviewer = Boolean(f.reviewerEmployeeId) && f.reviewerEmployeeId === f.assigneeEmployeeId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>New task</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What needs doing" htmlFor="nt-title" required className="sm:col-span-2">
            <Input
              id="nt-title"
              value={f.title}
              placeholder="Reconcile the suspense account for September"
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </Field>

          <Field label="Assignee" htmlFor="nt-assignee" required>
            <Select
              id="nt-assignee"
              value={f.assigneeEmployeeId}
              onChange={(e) => setF({ ...f, assigneeEmployeeId: e.target.value })}
            >
              <option value="">Choose…</option>
              {people.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.departmentName ? ` — ${e.departmentName}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Reviewer"
            htmlFor="nt-reviewer"
            hint="Without one it can never be sent for review"
          >
            <Select
              id="nt-reviewer"
              value={f.reviewerEmployeeId}
              onChange={(e) => setF({ ...f, reviewerEmployeeId: e.target.value })}
            >
              <option value="">Nobody</option>
              {people
                .filter((e) => e.id !== f.assigneeEmployeeId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </Select>
          </Field>

          <Field label="Task type" htmlFor="nt-type" required hint="Decides verification and evidence">
            <Select
              id="nt-type"
              value={f.taskTypeId}
              onChange={(e) => setF({ ...f, taskTypeId: e.target.value })}
            >
              <option value="">Choose…</option>
              {(taskTypes.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.requiresVerification ? " · verified" : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Due" htmlFor="nt-due" required>
            <Input
              id="nt-due"
              type="date"
              value={f.dueDate}
              onChange={(e) => setF({ ...f, dueDate: e.target.value })}
            />
          </Field>

          <Field label="Priority" htmlFor="nt-pri" required>
            <Select
              id="nt-pri"
              value={f.priority}
              onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Complexity"
            htmlFor="nt-cx"
            hint="Two hours of reconciliation and two hours of interpretation are not the same work"
          >
            <Select
              id="nt-cx"
              value={f.complexity}
              onChange={(e) => setF({ ...f, complexity: e.target.value as typeof f.complexity })}
            >
              {COMPLEXITY.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Effort (minutes)" htmlFor="nt-eff">
            <Input
              id="nt-eff"
              type="number"
              min={1}
              value={f.estimatedMinutes}
              onChange={(e) => setF({ ...f, estimatedMinutes: Number(e.target.value) })}
            />
          </Field>

          <Field
            label="Checklist"
            htmlFor="nt-check"
            className="sm:col-span-2"
            hint="One per line. Every item must be done or waived before completion."
          >
            <Textarea
              id="nt-check"
              rows={3}
              value={f.checklist}
              placeholder={"Pull the statement\nMatch against the ledger\nNote any break"}
              onChange={(e) => setF({ ...f, checklist: e.target.value })}
            />
          </Field>

          <Field label="Detail" htmlFor="nt-desc" className="sm:col-span-2">
            <Textarea
              id="nt-desc"
              rows={2}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
        </div>

        {sameReviewer && (
          <p className="text-2xs text-warning">
            The same person cannot do the work and check it. Choose a different reviewer.
          </p>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={
              f.title.trim().length < 2 ||
              !f.taskTypeId ||
              !f.assigneeEmployeeId ||
              !f.dueDate ||
              sameReviewer ||
              create.isPending
            }
            onClick={() =>
              create.mutate({
                title: f.title.trim(),
                description: f.description.trim() || undefined,
                taskTypeId: f.taskTypeId,
                priority: f.priority,
                complexity: f.complexity,
                assigneeEmployeeId: f.assigneeEmployeeId,
                reviewerEmployeeId: f.reviewerEmployeeId || undefined,
                dueDate: new Date(f.dueDate),
                estimatedMinutes: f.estimatedMinutes,
                checklist: f.checklist
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
          >
            {create.isPending ? "Creating…" : "Create task"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>

        <p className="text-2xs text-muted-foreground">
          {selfAssigned
            ? "Assigned to yourself, so it starts in Accepted — there is nobody to accept it from."
            : "It arrives with the assignee as Assigned, for them to accept."}{" "}
          If this is something that happens every month, put it on a desk card instead — then nobody
          has to remember to raise it.
        </p>
      </CardContent>
    </Card>
  );
}
