"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { PriorityTag, StatusBadge, type Priority, type TaskStatus } from "@/components/task/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { trpc, type RouterOutputs } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/**
 * The working parts of a project screen.
 *
 * Each card reads what it needs from the project and writes through its own
 * mutation, telling the page to refetch afterwards. They are separate files'
 * worth of behaviour kept in one module because they share a shape: a list, a
 * small form under it, and a rule explained where it bites rather than in a
 * manual nobody opens.
 */

export type Project = RouterOutputs["project"]["byId"];

type CardProps = {
  project: Project;
  onChange: () => void;
  onError: (message: string) => void;
};

const RACI_ORDER = ["ACCOUNTABLE", "RESPONSIBLE", "CONSULTED", "INFORMED"] as const;
const RACI_LABEL: Record<string, string> = {
  ACCOUNTABLE: "Accountable",
  RESPONSIBLE: "Responsible",
  CONSULTED: "Consulted",
  INFORMED: "Informed",
};
const DACI_ROLES = ["DRIVER", "APPROVER", "CONTRIBUTOR", "INFORMED"] as const;
const DACI_LABEL: Record<string, string> = {
  DRIVER: "Driver",
  APPROVER: "Approver",
  CONTRIBUTOR: "Contributor",
  INFORMED: "Informed",
};

function today(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- milestones

export function MilestonesCard({ project, onChange, onError }: CardProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(today(14));

  const add = trpc.project.addMilestone.useMutation({
    onSuccess: () => {
      setName("");
      setOpen(false);
      onChange();
    },
    onError: (e) => onError(e.message),
  });
  const setComplete = trpc.project.setMilestoneComplete.useMutation({
    onSuccess: onChange,
    onError: (e) => onError(e.message),
  });
  const remove = trpc.project.removeMilestone.useMutation({
    onSuccess: onChange,
    onError: (e) => onError(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Milestones</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Add"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-0">
        {project.milestones.map((m) => (
          <div key={m.id} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
            <button
              type="button"
              title={m.completedAt ? "Re-open this milestone" : "Report this milestone met"}
              onClick={() => setComplete.mutate({ milestoneId: m.id, complete: !m.completedAt })}
              className="shrink-0"
            >
              {m.completedAt ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <Circle className={cn("size-4", m.isMissed ? "text-danger" : "text-muted-foreground")} />
              )}
            </button>
            <span className={cn("flex-1 text-xs", m.completedAt && "text-muted-foreground line-through")}>
              {m.name}
            </span>
            <span
              className={cn(
                "text-2xs tabular",
                m.isMissed ? "font-medium text-danger" : "text-muted-foreground",
              )}
            >
              {new Date(m.targetDate).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
              {m.isMissed && " · missed"}
            </span>
            {!m.completedAt && (
              <button
                type="button"
                title="Remove this milestone"
                className="text-muted-foreground hover:text-danger"
                onClick={() => remove.mutate({ milestoneId: m.id })}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}

        {project.milestones.length === 0 && !open && (
          <p className="py-6 text-center text-2xs text-muted-foreground">
            None yet. A date nobody recorded cannot be missed, and a project with no milestones reads
            green however late it is.
          </p>
        )}

        {open && (
          <div className="flex flex-wrap items-end gap-2 pt-2">
            <Field label="Milestone" htmlFor="ms-name" className="min-w-48 flex-1">
              <Input
                id="ms-name"
                value={name}
                placeholder="UAT sign-off"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Target date" htmlFor="ms-date" className="w-44">
              <Input id="ms-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Button
              size="sm"
              disabled={name.trim().length < 2 || !date || add.isPending}
              onClick={() =>
                add.mutate({ projectId: project.id, name: name.trim(), targetDate: new Date(date) })
              }
            >
              Add
            </Button>
          </div>
        )}

        <p className="pt-2 text-2xs text-muted-foreground">
          A date that passes unmet turns the project red on its own — nobody has to decide to report
          it. Tick one to report it met; a milestone already reported met cannot be deleted.
        </p>
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------- risks

export function RisksCard({ project, onChange, onError }: CardProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const raise = trpc.project.raiseRisk.useMutation({
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setBlocking(false);
      setOpen(false);
      onChange();
    },
    onError: (e) => onError(e.message),
  });
  const setBlockingFlag = trpc.project.setRiskBlocking.useMutation({
    onSuccess: onChange,
    onError: (e) => onError(e.message),
  });
  const resolve = trpc.project.resolveRisk.useMutation({
    onSuccess: () => {
      setResolving(null);
      setNote("");
      onChange();
    },
    onError: (e) => onError(e.message),
  });

  const openRisks = project.risks.filter((r) => !r.isResolved);
  const closed = project.risks.filter((r) => r.isResolved);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risks and issues</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Raise"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-0">
        {openRisks.map((r) => (
          <div key={r.id} className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
            <div className="flex items-start gap-2">
              {r.isBlocking && <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs font-medium">{r.title}</span>
                {r.description && <span className="text-2xs text-muted-foreground">{r.description}</span>}
              </div>
              {r.isBlocking && <Badge tone="danger">blocking</Badge>}
            </div>
            <div className="flex flex-wrap gap-3 pl-1">
              <button
                type="button"
                className="text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  const reason = window.prompt(
                    r.isBlocking
                      ? "Why is this no longer blocking?"
                      : "Why is this blocking? It will stop the project being completed.",
                  );
                  if (reason?.trim()) {
                    setBlockingFlag.mutate({ riskId: r.id, isBlocking: !r.isBlocking, reason: reason.trim() });
                  }
                }}
              >
                {r.isBlocking ? "Stand down" : "Mark blocking"}
              </button>
              <button
                type="button"
                className="text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setResolving(resolving === r.id ? null : r.id);
                  setNote("");
                }}
              >
                {resolving === r.id ? "Cancel" : "Resolve"}
              </button>
            </div>
            {resolving === r.id && (
              <div className="flex flex-wrap items-end gap-2 pt-1">
                <Field label="How it was resolved" htmlFor={`rr-${r.id}`} className="min-w-56 flex-1">
                  <Input
                    id={`rr-${r.id}`}
                    value={note}
                    placeholder="What was done, and when"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <Button
                  size="sm"
                  disabled={note.trim().length < 3 || resolve.isPending}
                  onClick={() => resolve.mutate({ riskId: r.id, resolutionNote: note.trim() })}
                >
                  Resolve
                </Button>
              </div>
            )}
          </div>
        ))}

        {openRisks.length === 0 && !open && (
          <p className="py-6 text-center text-2xs text-muted-foreground">Nothing open.</p>
        )}

        {open && (
          <div className="flex flex-col gap-2 pt-2">
            <Field label="What could go wrong" htmlFor="risk-title">
              <Input
                id="risk-title"
                value={title}
                placeholder="Exchange has not confirmed the test window"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Detail" htmlFor="risk-desc">
              <Textarea
                id="risk-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
              This blocks the project — it cannot be completed until this is resolved
            </label>
            <Button
              size="sm"
              className="w-fit"
              disabled={title.trim().length < 3 || raise.isPending}
              onClick={() =>
                raise.mutate({
                  projectId: project.id,
                  title: title.trim(),
                  description: description.trim() || undefined,
                  isBlocking: blocking,
                })
              }
            >
              Raise
            </Button>
          </div>
        )}

        {closed.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
            <span className="label-caps">Resolved</span>
            {closed.map((r) => (
              <div key={r.id} className="flex flex-wrap items-baseline gap-2 text-2xs text-muted-foreground">
                <span className="line-through">{r.title}</span>
                {r.resolutionNote && <span>— {r.resolutionNote}</span>}
              </div>
            ))}
          </div>
        )}

        <p className="pt-2 text-2xs text-muted-foreground">
          One open blocking issue turns the project amber, two turn it red, and any of them stops it
          being completed. Resolving asks how, because that is the note somebody reads a year later.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------- RACI

export function RaciCard({ project, onChange, onError }: CardProps) {
  const [employeeId, setEmployeeId] = useState("");
  const [role, setRole] = useState<(typeof RACI_ORDER)[number]>("RESPONSIBLE");
  const staff = trpc.employee.list.useQuery({ activeOnly: true });

  const assign = trpc.project.assignRaci.useMutation({
    onSuccess: () => {
      setEmployeeId("");
      onChange();
    },
    onError: (e) => onError(e.message),
  });
  const remove = trpc.project.removeRaci.useMutation({
    onSuccess: onChange,
    onError: (e) => onError(e.message),
  });

  const accountable = project.raci.filter((r) => r.role === "ACCOUNTABLE");

  return (
    <Card>
      <CardHeader>
        <CardTitle>RACI</CardTitle>
        <span className="text-2xs text-muted-foreground">Who does the work, who answers for it</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {RACI_ORDER.map((r) => {
          const people = project.raci.filter((x) => x.role === r);
          return (
            <div key={r} className="flex items-baseline gap-3 border-b border-border py-1.5 last:border-b-0">
              <span className={cn("label-caps w-24 shrink-0", r === "ACCOUNTABLE" && "text-primary")}>
                {RACI_LABEL[r]}
              </span>
              <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
                {people.length === 0 && <span className="text-muted-foreground">—</span>}
                {people.map((x) => (
                  <span key={x.id} className="inline-flex items-center gap-1">
                    {x.employee.name}
                    <button
                      type="button"
                      title="Remove"
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => remove.mutate({ assignmentId: x.id })}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                ))}
              </span>
            </div>
          );
        })}

        {accountable.length === 0 && (
          <p className="text-2xs text-warning">
            No one is Accountable for this project. Exactly one person should be.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2 pt-1">
          <Field label="Person" htmlFor="raci-person" className="min-w-48 flex-1">
            <Select id="raci-person" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose…</option>
              {(staff.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.departmentName ? ` — ${e.departmentName}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" htmlFor="raci-role" className="w-40">
            <Select id="raci-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {RACI_ORDER.map((r) => (
                <option key={r} value={r}>
                  {RACI_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            size="sm"
            disabled={!employeeId || assign.isPending}
            onClick={() =>
              assign.mutate({
                projectId: project.id,
                employeeId,
                role,
                // Replacing the Accountable is deliberate, never accidental:
                // the person is asked before the previous holder is displaced.
                replaceAccountable:
                  role === "ACCOUNTABLE" && accountable.length > 0
                    ? window.confirm(
                        `${accountable[0].employee.name} is currently Accountable. Replace them?`,
                      )
                    : false,
              })
            }
          >
            Assign
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------- decisions

export function DecisionsCard({ project, onChange, onError }: CardProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState<Record<string, string>>({ DRIVER: "", APPROVER: "" });
  const [deciding, setDeciding] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");

  const staff = trpc.employee.list.useQuery({ activeOnly: true });
  const create = trpc.project.createDecision.useMutation({
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setPeople({ DRIVER: "", APPROVER: "" });
      setOpen(false);
      onChange();
    },
    onError: (e) => onError(e.message),
  });
  const decide = trpc.project.decide.useMutation({
    onSuccess: () => {
      setDeciding(null);
      setOutcome("");
      onChange();
    },
    onError: (e) => onError(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisions</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Raise"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-0">
        {project.decisions.map((d) => {
          const approver = d.assignments.find((a) => a.role === "APPROVER");
          const driver = d.assignments.find((a) => a.role === "DRIVER");
          return (
            <div key={d.id} className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{d.title}</span>
                <Badge tone={d.status === "DECIDED" ? "success" : d.status === "REJECTED" ? "danger" : "warning"}>
                  {d.status.toLowerCase()}
                </Badge>
                {d.status === "OPEN" && (
                  <button
                    type="button"
                    className="ml-auto text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => {
                      setDeciding(deciding === d.id ? null : d.id);
                      setOutcome("");
                    }}
                  >
                    {deciding === d.id ? "Cancel" : "Decide"}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 text-2xs text-muted-foreground">
                {driver && <span>{DACI_LABEL.DRIVER}: {driver.employee.name}</span>}
                {approver && <span>{DACI_LABEL.APPROVER}: {approver.employee.name}</span>}
              </div>
              {d.outcome && <p className="text-xs text-muted-foreground">{d.outcome}</p>}

              {deciding === d.id && (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2.5">
                  <Field label="The decision, and why" htmlFor={`do-${d.id}`}>
                    <Input id={`do-${d.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={outcome.trim().length < 3 || decide.isPending}
                      onClick={() => decide.mutate({ decisionId: d.id, outcome: outcome.trim(), approve: true })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={outcome.trim().length < 3 || decide.isPending}
                      onClick={() => decide.mutate({ decisionId: d.id, outcome: outcome.trim(), approve: false })}
                    >
                      Reject
                    </Button>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Only {approver?.employee.name ?? "the named Approver"} can do this. Anyone else is
                    refused — including a system administrator.
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {project.decisions.length === 0 && !open && (
          <p className="py-6 text-center text-2xs text-muted-foreground">None raised</p>
        )}

        {open && (
          <div className="flex flex-col gap-2 pt-2">
            <Field label="What has to be decided" htmlFor="dec-title">
              <Input
                id="dec-title"
                value={title}
                placeholder="Which vendor for the FIX gateway"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Context" htmlFor="dec-desc">
              <Textarea id="dec-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["DRIVER", "APPROVER"] as const).map((r) => (
                <Field key={r} label={DACI_LABEL[r]} htmlFor={`dec-${r}`}>
                  <Select
                    id={`dec-${r}`}
                    value={people[r]}
                    onChange={(e) => setPeople({ ...people, [r]: e.target.value })}
                  >
                    <option value="">Choose…</option>
                    {(staff.data ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            <Button
              size="sm"
              className="w-fit"
              disabled={title.trim().length < 3 || !people.DRIVER || !people.APPROVER || create.isPending}
              onClick={() =>
                create.mutate({
                  projectId: project.id,
                  title: title.trim(),
                  description: description.trim() || undefined,
                  assignments: DACI_ROLES.filter((r) => people[r]).map((r) => ({
                    employeeId: people[r],
                    role: r,
                  })),
                })
              }
            >
              Raise
            </Button>
          </div>
        )}

        <p className="pt-2 text-2xs text-muted-foreground">
          A decision needs exactly one named Approver, and only they can close it — not the Driver who
          did the work, not a manager. A decision closed by the wrong person is somebody else&apos;s
          opinion wearing its clothes.
        </p>
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------- tasks

export function ProjectTasksCard({ project, onChange, onError }: CardProps) {
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState("");

  const attachable = trpc.project.unassignedTasks.useQuery(undefined, { enabled: open });
  const attach = trpc.project.attachTask.useMutation({
    onSuccess: () => {
      setTaskId("");
      setOpen(false);
      onChange();
    },
    onError: (e) => onError(e.message),
  });
  const detach = trpc.project.detachTask.useMutation({
    onSuccess: onChange,
    onError: (e) => onError(e.message),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Tasks ({project.tasks.length})</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : <><Plus /> Add a task</>}
        </Button>
      </CardHeader>

      {open && (
        <div className="flex flex-wrap items-end gap-2 border-b border-border bg-muted/30 px-4 py-3">
          <Field label="Task" htmlFor="attach-task" className="min-w-64 flex-1">
            <Select id="attach-task" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">Choose an existing task…</option>
              {(attachable.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.reference} — {t.title} ({t.assignee.name})
                </option>
              ))}
            </Select>
          </Field>
          <Button
            size="sm"
            disabled={!taskId || attach.isPending}
            onClick={() => attach.mutate({ projectId: project.id, taskId })}
          >
            Add
          </Button>
          <p className="w-full text-2xs text-muted-foreground">
            Only tasks that are not already in a project are offered. Adding one does not change whose
            task it is or how it behaves — it says which body of work it counts towards.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="label-caps px-4 py-2.5">Task</th>
              <th className="label-caps px-4 py-2.5">Depends on</th>
              <th className="label-caps px-4 py-2.5">Owner</th>
              <th className="label-caps px-4 py-2.5">Priority</th>
              <th className="label-caps px-4 py-2.5">Status</th>
              <th className="label-caps px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {project.tasks.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <Link href={`/tasks/${t.id}`} className="group flex flex-col gap-0.5">
                    <span className="text-sm group-hover:underline">{t.title}</span>
                    <span className="font-mono text-2xs text-muted-foreground">{t.reference}</span>
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-2xs text-muted-foreground">
                  {t.dependsOn.length > 0 ? `${t.dependsOn.length} task(s)` : "—"}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{t.assignee.name}</td>
                <td className="px-4 py-2.5">
                  <PriorityTag priority={t.priority as Priority} />
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={t.status as TaskStatus} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    className="text-2xs text-muted-foreground underline-offset-2 hover:text-danger hover:underline"
                    onClick={() => {
                      const reason = window.prompt("Why is this coming out of the project?");
                      if (reason?.trim()) detach.mutate({ taskId: t.id, reason: reason.trim() });
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {project.tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-muted-foreground">
                  No tasks on this project yet. Until there are, &ldquo;x% overdue&rdquo; has nothing to
                  count.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ status, health

const STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;

export function StatusAndHealth({ project, onChange, onError }: CardProps) {
  const [status, setStatus] = useState<string>(project.status);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState<string>(project.healthOverride ?? "");
  const [overrideReason, setOverrideReason] = useState(project.healthOverrideReason ?? "");

  const setStatusM = trpc.project.setStatus.useMutation({
    onSuccess: () => {
      setReason("");
      onChange();
    },
    onError: (e) => onError(e.message),
  });
  const overrideM = trpc.project.overrideHealth.useMutation({
    onSuccess: onChange,
    onError: (e) => onError(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status and health</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Status" htmlFor="pr-status" className="w-44">
            <Select id="pr-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" htmlFor="pr-reason" className="min-w-56 flex-1">
            <Input id="pr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={status === project.status || setStatusM.isPending}
            onClick={() =>
              setStatusM.mutate({
                id: project.id,
                status: status as (typeof STATUSES)[number],
                reason: reason.trim() || undefined,
              })
            }
          >
            Change
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <Field label="Override health" htmlFor="pr-override" className="w-44">
            <Select id="pr-override" value={override} onChange={(e) => setOverride(e.target.value)}>
              <option value="">Use the calculation</option>
              <option value="GREEN">Green</option>
              <option value="AMBER">Amber</option>
              <option value="RED">Red</option>
            </Select>
          </Field>
          <Field label="Why you disagree" htmlFor="pr-override-reason" className="min-w-56 flex-1">
            <Input
              id="pr-override-reason"
              value={overrideReason}
              disabled={!override}
              placeholder={override ? "Shown wherever the override is" : "—"}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={overrideM.isPending || (Boolean(override) && overrideReason.trim().length < 3)}
            onClick={() =>
              overrideM.mutate({
                id: project.id,
                health: (override || null) as "GREEN" | "AMBER" | "RED" | null,
                reason: overrideReason.trim(),
              })
            }
          >
            {override ? "Override" : "Clear override"}
          </Button>
        </div>

        <p className="text-2xs text-muted-foreground">
          Health is calculated, not typed in — that is what makes a status report worth reading. You
          may disagree with it, but the override is always shown as an override, with your reason and
          the calculated value beside it.
        </p>
      </CardContent>
    </Card>
  );
}
