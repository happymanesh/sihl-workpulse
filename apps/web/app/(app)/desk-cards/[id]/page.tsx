"use client";

import Link from "next/link";
import { Fragment, use, useState } from "react";
import { ArrowLeft, Pause, Pencil, Play, Plus } from "lucide-react";
import { PriorityTag, type Priority } from "@/components/task/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { WorkflowEditor } from "@/components/desk-card/workflow-editor";
import { trpc, type RouterOutputs } from "@/lib/trpc/client";

const STATUS_TONE = { DRAFT: "neutral", PENDING_REVIEW: "warning", APPROVED: "success", RETIRED: "neutral" } as const;
const FREQUENCIES = ["", "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
const PRIORITIES = ["CRITICAL", "URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const WEEKDAYS = [
  { n: 1, l: "Mon" },
  { n: 2, l: "Tue" },
  { n: 3, l: "Wed" },
  { n: 4, l: "Thu" },
  { n: 5, l: "Fri" },
];

export default function DeskCardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const card = trpc.deskCard.byId.useQuery({ id });
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    utils.deskCard.byId.invalidate({ id });
    utils.deskCard.list.invalidate();
  };
  const onError = (e: { message: string }) => setError(e.message);

  const setStatus = trpc.deskCard.setStatus.useMutation({ onSuccess: refresh, onError });
  const transfer = trpc.deskCard.transferHolder.useMutation({ onSuccess: refresh, onError });
  const [editCard, setEditCard] = useState(false);
  const updateCard = trpc.deskCard.update.useMutation({
    onSuccess: () => {
      setEditCard(false);
      refresh();
    },
    onError,
  });
  const setActivityStatus = trpc.activity.setStatus.useMutation({ onSuccess: refresh, onError });
  const setPaused = trpc.activity.setPaused.useMutation({ onSuccess: refresh, onError });
  // For the inline "serves" picker on each activity row.
  const processes = trpc.governance.processes.useQuery();
  const linkProcess = trpc.governance.setActivityProcess.useMutation({ onSuccess: refresh, onError });

  // Which activity is open for editing. Held on the page so only one row is
  // ever open at a time; the pending changes live in the editor itself.
  const [editing, setEditing] = useState<string | null>(null);
  // Which activity's procedure is open. Separate from `editing` so a person can
  // read the steps while deciding what to amend.
  const [steps, setSteps] = useState<string | null>(null);
  const amend = trpc.activity.amend.useMutation({
    onSuccess: (r) => {
      setEditing(null);
      if (r.returnedToDraft) {
        setError(
          "Recurrence changed, so this activity has gone back to draft — approve it again to resume generating work.",
        );
      }
      refresh();
    },
    onError,
  });

  if (card.isLoading) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;

  if (card.error) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">Could not load this desk card</p>
        <p className="max-w-md text-xs text-muted-foreground">{card.error.message}</p>
      </Card>
    );
  }

  const c = card.data!;
  const canApprove = c.status !== "APPROVED" && c.activities.some((a) => a.status === "APPROVED");

  return (
    <div className="flex flex-col gap-4">
      <Link href="/desk-cards" className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Desk cards
      </Link>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">{error}</div>
      )}

      <Card>
        <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-2xs text-muted-foreground">{c.code}</span>
            <h2 className="text-lg font-semibold leading-tight">{c.name}</h2>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge tone="neutral">{c.department.name}</Badge>
            <Badge tone={STATUS_TONE[c.status]}>{c.status.replace("_", " ").toLowerCase()}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setEditCard((v) => !v)}>
              {editCard ? "Cancel" : <><Pencil /> Edit</>}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {editCard ? (
            <CardEditor
              card={c}
              pending={updateCard.isPending}
              onSave={(changes) => updateCard.mutate({ id, ...changes })}
            />
          ) : (
            c.description && <p className="max-w-prose text-sm text-muted-foreground">{c.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {c.status === "DRAFT" && (
              <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id, status: "PENDING_REVIEW" })}>
                Send for review
              </Button>
            )}
            {canApprove && (
              <Button size="sm" onClick={() => setStatus.mutate({ id, status: "APPROVED" })}>
                Approve card
              </Button>
            )}
            {c.status !== "APPROVED" && !canApprove && (
              <p className="text-2xs text-muted-foreground">
                Approve at least one activity before the card can be approved.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <HolderPanel
        card={c}
        onTransfer={(toEmployeeId, reason) => transfer.mutate({ deskCardId: id, toEmployeeId, reason })}
        pending={transfer.isPending}
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Activities ({c.activities.length})</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="label-caps px-4 py-2.5">Activity</th>
                <th className="label-caps px-4 py-2.5">Type</th>
                <th className="label-caps px-4 py-2.5">Recurrence</th>
                <th className="label-caps px-4 py-2.5">Serves</th>
                <th className="label-caps px-4 py-2.5 text-right">Effort</th>
                <th className="label-caps px-4 py-2.5">Priority</th>
                <th className="label-caps px-4 py-2.5">Status</th>
                <th className="label-caps px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {c.activities.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 text-sm">{a.title}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.taskType.name}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {a.frequency
                        ? `${a.interval > 1 ? `Every ${a.interval} ` : ""}${a.frequency.toLowerCase()}${a.leadTimeDays ? ` · ${a.leadTimeDays}d lead` : ""}`
                        : "One-off"}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {/* Editable in place: an activity created without a control
                          had no way to acquire one, and approval is refused until
                          it does. */}
                      {a.status === "APPROVED" && a.process ? (
                        <span className="tabular text-muted-foreground" title={a.process.name}>
                          {a.process.code}
                        </span>
                      ) : (
                        <select
                          aria-label={`Control served by ${a.title}`}
                          className="h-7 w-44 rounded-md border border-input bg-card px-1.5 text-xs"
                          value={a.process?.id ?? ""}
                          onChange={(e) =>
                            linkProcess.mutate({ activityId: a.id, processId: e.target.value || null })
                          }
                        >
                          <option value="">No control</option>
                          {(processes.data ?? [])
                            .filter((pr) => pr.status !== "RETIRED")
                            .map((pr) => (
                              <option key={pr.id} value={pr.id}>
                                {pr.code}
                              </option>
                            ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs tabular text-muted-foreground">{a.estimatedMinutes}m</td>
                    <td className="px-4 py-2.5">
                      <PriorityTag priority={a.priority as Priority} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={STATUS_TONE[a.status]}>{a.status.replace("_", " ").toLowerCase()}</Badge>
                        {a.isPaused && <Badge tone="warning">paused</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {a.status !== "APPROVED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            // Approval is refused without a control, so offering
                            // the button and letting the server say no just
                            // teaches people the screen is unreliable.
                            disabled={!a.process}
                            title={a.process ? undefined : "Choose the control this activity serves first"}
                            onClick={() => setActivityStatus.mutate({ activityId: a.id, status: "APPROVED" })}
                          >
                            Approve
                          </Button>
                        )}
                        {a.status === "APPROVED" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={a.isPaused ? "Resume generation" : "Pause generation"}
                            onClick={() => setPaused.mutate({ activityId: a.id, isPaused: !a.isPaused })}
                          >
                            {a.isPaused ? <Play /> : <Pause />}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSteps(steps === a.id ? null : a.id)}
                          title="The procedure this work follows"
                        >
                          {steps === a.id ? "Hide steps" : "Steps"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(editing === a.id ? null : a.id)}
                        >
                          {editing === a.id ? "Cancel" : "Edit"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {steps === a.id && (
                    <WorkflowEditor
                      activityId={a.id}
                      activityTitle={a.title}
                      onError={setError}
                    />
                  )}
                  {editing === a.id && (
                    <ActivityEditor
                      activity={a}
                      pending={amend.isPending}
                      onCancel={() => setEditing(null)}
                      onSave={(changes, reason) => amend.mutate({ activityId: a.id, changes, reason })}
                    />
                  )}
                </Fragment>
              ))}
              {c.activities.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    No activities yet. Add the obligations this role carries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <AddActivity deskCardId={id} onDone={refresh} onError={onError} />
    </div>
  );
}

/**
 * Corrects the card itself.
 *
 * The code is shown but not editable: audit entries, exports and anything
 * outside workPulse refer to a card by its code, so a card created under the
 * wrong one gets retired and replaced rather than renamed underneath them.
 *
 * Moving the department is the consequential field, not the cosmetic one. A
 * task takes its department from the card rather than from its assignee, so
 * the department decides which SLA targets match the work and whose head is
 * escalated to on a breach - which is why the reason box appears only when the
 * department actually changes, and why it is required then.
 */
function CardEditor({
  card,
  pending,
  onSave,
}: {
  card: { code: string; name: string; description: string | null; departmentId: string };
  pending: boolean;
  onSave: (changes: { name: string; description: string | null; departmentId: string; reason?: string }) => void;
}) {
  const departments = trpc.reference.departments.useQuery();
  const [name, setName] = useState(card.name);
  const [description, setDescription] = useState(card.description ?? "");
  const [departmentId, setDepartmentId] = useState(card.departmentId);
  const [reason, setReason] = useState("");

  const moving = departmentId !== card.departmentId;
  const changed = moving || name.trim() !== card.name || description.trim() !== (card.description ?? "");
  const ready = changed && name.trim().length >= 2 && (!moving || reason.trim().length > 0);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Code" htmlFor="dc-code" hint="Not editable — retire and replace instead">
          <Input id="dc-code" value={card.code} disabled readOnly />
        </Field>
        <Field label="Name" htmlFor="dc-name" required>
          <Input id="dc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Department"
          htmlFor="dc-dept"
          required
          hint="Decides which SLA targets apply and who is escalated to"
        >
          <Select id="dc-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        {moving && (
          <Field label="Why it is moving" htmlFor="dc-reason" required>
            <Input
              id="dc-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Created against the wrong department, reorganisation…"
            />
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="dc-desc">
            <Textarea
              id="dc-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {moving && (
        <p className="text-2xs text-warning">
          Work already raised under this card keeps the department it was raised with. Only tasks
          generated from now on will carry the new one.
        </p>
      )}

      <div>
        <Button
          size="sm"
          disabled={!ready || pending}
          onClick={() =>
            onSave({
              name: name.trim(),
              description: description.trim() || null,
              departmentId,
              reason: moving ? reason.trim() : undefined,
            })
          }
        >
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function HolderPanel({
  card,
  onTransfer,
  pending,
}: {
  card: { holder: { id: string; name: string } | null; holderHistory: { id: string; employee: { name: string }; fromDate: string | Date; toDate: string | Date | null; reason: string | null }[] };
  onTransfer: (employeeId: string, reason: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const employees = trpc.employee.list.useQuery({ activeOnly: true }, { enabled: open });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holder</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {card.holder ? "Transfer" : "Assign"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          {card.holder ? card.holder.name : <span className="text-warning">Unassigned — this card generates no work</span>}
        </p>

        {open && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
            <Field label="Transfer to" htmlFor="holder" required>
              <Select id="holder" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Select an employee…</option>
                {employees.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} {e.designation ? `· ${e.designation}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" htmlFor="tr" required hint="Recorded permanently in the handover history">
              <Input id="tr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Role change, exit, cover…" />
            </Field>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!employeeId || reason.trim().length < 3 || pending}
                onClick={() => {
                  onTransfer(employeeId, reason.trim());
                  setOpen(false);
                  setEmployeeId("");
                  setReason("");
                }}
              >
                Confirm transfer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              Transfers future generation only. Tasks already created stay with their current assignee.
            </p>
          </div>
        )}

        {card.holderHistory.length > 0 && (
          <div className="flex flex-col gap-0 border-t border-border pt-2">
            <span className="label-caps pb-1">Handover history</span>
            {card.holderHistory.map((h) => (
              <div key={h.id} className="flex flex-wrap items-baseline gap-x-2 py-1 text-xs">
                <span className="font-medium">{h.employee.name}</span>
                <span className="font-mono text-2xs text-muted-foreground">
                  {new Date(h.fromDate).toLocaleDateString()} → {h.toDate ? new Date(h.toDate).toLocaleDateString() : "present"}
                </span>
                {h.reason && <span className="text-muted-foreground">{h.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddActivity({
  deskCardId,
  onDone,
  onError,
}: {
  deskCardId: string;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const taskTypes = trpc.reference.taskTypes.useQuery(undefined, { enabled: open });

  const [f, setF] = useState({
    title: "",
    description: "",
    taskTypeId: "",
    priority: "MEDIUM" as (typeof PRIORITIES)[number],
    estimatedMinutes: 30,
    frequency: "" as (typeof FREQUENCIES)[number],
    interval: 1,
    daysOfWeek: [] as number[],
    dayOfMonth: 1,
    leadTimeDays: 0,
    processId: "",
    reviewerEmployeeId: "",
  });

  // The control this obligation serves. An activity cannot be approved
  // without one, so asking here saves a trip to /governance/controls and a
  // confusing refusal later.
  const processes = trpc.governance.processes.useQuery();
  const staff = trpc.employee.list.useQuery({ activeOnly: true });
  const linkProcess = trpc.governance.setActivityProcess.useMutation({ onError });

  const create = trpc.activity.create.useMutation({
    onSuccess: async (activity) => {
      // Two calls rather than one because activity.create does not take a
      // processId - changing its input would ripple through the recurrence
      // tests. The link is audited separately either way.
      if (f.processId) {
        await linkProcess.mutateAsync({ activityId: activity.id, processId: f.processId });
      }
      setOpen(false);
      setF({ ...f, title: "", description: "" });
      onDone();
    },
    onError,
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus /> Add activity
      </Button>
    );
  }

  const monthly = ["MONTHLY", "QUARTERLY", "YEARLY"].includes(f.frequency);

  return (
    <Card>
      <CardHeader>
        <CardTitle>New activity</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" htmlFor="at" required className="sm:col-span-2">
            <Input id="at" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Monthly SEBI compliance filing" />
          </Field>

          <Field
            label="Serves process"
            htmlFor="apr"
            hint="Required before this activity can be approved"
            className="sm:col-span-2"
          >
            <Select id="apr" value={f.processId} onChange={(e) => setF({ ...f, processId: e.target.value })}>
              <option value="">Choose the control this work serves…</option>
              {(processes.data ?? [])
                .filter((pr) => pr.status !== "RETIRED")
                .map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.code} — {pr.name}
                    {pr.status !== "APPROVED" ? ` (${pr.status.toLowerCase()})` : ""}
                  </option>
                ))}
            </Select>
            {(processes.data ?? []).length === 0 && (
              <p className="mt-1 text-2xs text-warning">
                No processes exist yet. Create one under Policies &amp; processes first — an activity
                cannot be approved until it serves a named control.
              </p>
            )}
          </Field>

          <Field
            label="Reviewer"
            htmlFor="arev"
            hint="Who checks this work. Without one it cannot be sent for review."
          >
            <Select
              id="arev"
              value={f.reviewerEmployeeId}
              onChange={(e) => setF({ ...f, reviewerEmployeeId: e.target.value })}
            >
              <option value="">Nobody — no verification needed</option>
              {(staff.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.departmentName ? ` — ${e.departmentName}` : ""}
                  {e.designation ? ` (${e.designation})` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Task type" htmlFor="att" required hint="Controls verification, evidence and maker-checker">
            <Select id="att" value={f.taskTypeId} onChange={(e) => setF({ ...f, taskTypeId: e.target.value })}>
              <option value="">Select…</option>
              {taskTypes.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.requiresVerification ? " · verified" : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="ap" required>
            <Select id="ap" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Estimated effort (minutes)"
            htmlFor="ae"
            required
            hint="Set here by you, not the holder — it drives capacity and scoring"
          >
            <Input
              id="ae"
              type="number"
              min={1}
              value={f.estimatedMinutes}
              onChange={(e) => setF({ ...f, estimatedMinutes: Number(e.target.value) })}
            />
          </Field>

          <Field label="Frequency" htmlFor="af" hint="Leave blank for a one-off obligation">
            <Select id="af" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as typeof f.frequency })}>
              {FREQUENCIES.map((x) => (
                <option key={x} value={x}>
                  {x ? x.charAt(0) + x.slice(1).toLowerCase() : "One-off"}
                </option>
              ))}
            </Select>
          </Field>

          {f.frequency === "WEEKLY" && (
            <Field label="Days" className="sm:col-span-2" required>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d) => {
                  const on = f.daysOfWeek.includes(d.n);
                  return (
                    <button
                      key={d.n}
                      type="button"
                      onClick={() =>
                        setF({
                          ...f,
                          daysOfWeek: on ? f.daysOfWeek.filter((x) => x !== d.n) : [...f.daysOfWeek, d.n],
                        })
                      }
                      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {monthly && (
            <Field label="Day of month" htmlFor="adm" required hint="31 falls back to the last day of shorter months">
              <Input
                id="adm"
                type="number"
                min={1}
                max={31}
                value={f.dayOfMonth}
                onChange={(e) => setF({ ...f, dayOfMonth: Number(e.target.value) })}
              />
            </Field>
          )}

          {f.frequency && (
            <Field label="Lead time (working days)" htmlFor="al" hint="Generate this many working days before it is due">
              <Input
                id="al"
                type="number"
                min={0}
                value={f.leadTimeDays}
                onChange={(e) => setF({ ...f, leadTimeDays: Number(e.target.value) })}
              />
            </Field>
          )}

          <Field label="Description" htmlFor="ad" className="sm:col-span-2">
            <Textarea id="ad" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!f.title.trim() || !f.taskTypeId || f.estimatedMinutes < 1 || create.isPending}
            onClick={() =>
              create.mutate({
                deskCardId,
                title: f.title.trim(),
                description: f.description.trim() || undefined,
                taskTypeId: f.taskTypeId,
                priority: f.priority,
                reviewerEmployeeId: f.reviewerEmployeeId || null,
                estimatedMinutes: f.estimatedMinutes,
                frequency: f.frequency || null,
                interval: f.interval,
                daysOfWeek: f.frequency === "WEEKLY" ? f.daysOfWeek : [],
                dayOfMonth: monthly ? f.dayOfMonth : null,
                leadTimeDays: f.leadTimeDays,
              })
            }
          >
            {create.isPending ? "Adding…" : "Add in draft"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type ActivityRow = RouterOutputs["deskCard"]["byId"]["activities"][number];

/** The frequencies minus the empty option the <select> needs for "one-off". */
type Frequency = Exclude<(typeof FREQUENCIES)[number], "">;

type AmendChanges = {
  title?: string;
  priority?: (typeof PRIORITIES)[number];
  estimatedMinutes?: number;
  frequency?: Frequency | null;
  interval?: number;
  daysOfWeek?: number[];
  dayOfMonth?: number | null;
  leadTimeDays?: number;
};

/**
 * Amend one activity in place.
 *
 * Only what actually changed is sent, because the server decides what a change
 * means from the fields it receives: wording is free, substance needs a reason,
 * and anything about recurrence returns an approved activity to draft. Sending
 * the whole row every time would make every edit look like a definition change.
 *
 * Nothing here touches tasks that already exist — see the note in the footer,
 * which is the question holders ask first.
 */
function ActivityEditor({
  activity,
  pending,
  onCancel,
  onSave,
}: {
  activity: ActivityRow;
  pending: boolean;
  onCancel: () => void;
  onSave: (changes: AmendChanges, reason?: string) => void;
}) {
  const [f, setF] = useState({
    title: activity.title,
    priority: activity.priority as (typeof PRIORITIES)[number],
    estimatedMinutes: activity.estimatedMinutes,
    frequency: (activity.frequency ?? "") as (typeof FREQUENCIES)[number],
    interval: activity.interval,
    daysOfWeek: activity.daysOfWeek ?? [],
    dayOfMonth: activity.dayOfMonth ?? 1,
    leadTimeDays: activity.leadTimeDays ?? 0,
  });
  const [reason, setReason] = useState("");

  const monthly = ["MONTHLY", "QUARTERLY", "YEARLY"].includes(f.frequency);
  const sameDays =
    JSON.stringify([...f.daysOfWeek].sort()) === JSON.stringify([...(activity.daysOfWeek ?? [])].sort());

  const changesSubstance =
    f.priority !== activity.priority || f.estimatedMinutes !== activity.estimatedMinutes;
  const changesDefinition =
    f.frequency !== (activity.frequency ?? "") ||
    f.interval !== activity.interval ||
    !sameDays ||
    (monthly && f.dayOfMonth !== activity.dayOfMonth) ||
    (!!f.frequency && f.leadTimeDays !== (activity.leadTimeDays ?? 0));
  const needsReason = changesSubstance || changesDefinition;
  const changed = needsReason || f.title.trim() !== activity.title;

  const submit = () => {
    const changes: AmendChanges = {};
    if (f.title.trim() !== activity.title) changes.title = f.title.trim();
    if (f.priority !== activity.priority) changes.priority = f.priority;
    if (f.estimatedMinutes !== activity.estimatedMinutes) changes.estimatedMinutes = f.estimatedMinutes;
    if (changesDefinition) {
      changes.frequency = (f.frequency as Frequency) || null;
      changes.interval = f.interval;
      changes.daysOfWeek = f.frequency === "WEEKLY" ? f.daysOfWeek : [];
      changes.dayOfMonth = monthly ? f.dayOfMonth : null;
      changes.leadTimeDays = f.frequency ? f.leadTimeDays : 0;
    }
    onSave(changes, reason.trim() || undefined);
  };

  return (
    <tr className="border-b border-border bg-muted/30 last:border-b-0">
      <td colSpan={8} className="px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Title" htmlFor={`e-t-${activity.id}`} required className="sm:col-span-3">
              <Input id={`e-t-${activity.id}`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>

            <Field label="Priority" htmlFor={`e-p-${activity.id}`}>
              <Select
                id={`e-p-${activity.id}`}
                value={f.priority}
                onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}
              >
                {PRIORITIES.map((x) => (
                  <option key={x} value={x}>
                    {x.charAt(0) + x.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Estimated effort (minutes)" htmlFor={`e-m-${activity.id}`}>
              <Input
                id={`e-m-${activity.id}`}
                type="number"
                min={1}
                value={f.estimatedMinutes}
                onChange={(e) => setF({ ...f, estimatedMinutes: Number(e.target.value) })}
              />
            </Field>

            <Field label="Frequency" htmlFor={`e-f-${activity.id}`} hint="Changing this needs re-approval">
              <Select
                id={`e-f-${activity.id}`}
                value={f.frequency}
                onChange={(e) => setF({ ...f, frequency: e.target.value as typeof f.frequency })}
              >
                {FREQUENCIES.map((x) => (
                  <option key={x} value={x}>
                    {x ? x.charAt(0) + x.slice(1).toLowerCase() : "One-off"}
                  </option>
                ))}
              </Select>
            </Field>

            {f.frequency === "WEEKLY" && (
              <Field label="Days" className="sm:col-span-2">
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((d) => {
                    const on = f.daysOfWeek.includes(d.n);
                    return (
                      <button
                        key={d.n}
                        type="button"
                        onClick={() =>
                          setF({
                            ...f,
                            daysOfWeek: on ? f.daysOfWeek.filter((x) => x !== d.n) : [...f.daysOfWeek, d.n],
                          })
                        }
                        className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
                      >
                        {d.l}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            {monthly && (
              <Field label="Day of month" htmlFor={`e-dm-${activity.id}`}>
                <Input
                  id={`e-dm-${activity.id}`}
                  type="number"
                  min={1}
                  max={31}
                  value={f.dayOfMonth}
                  onChange={(e) => setF({ ...f, dayOfMonth: Number(e.target.value) })}
                />
              </Field>
            )}

            {!!f.frequency && (
              <Field label="Lead time (working days)" htmlFor={`e-l-${activity.id}`}>
                <Input
                  id={`e-l-${activity.id}`}
                  type="number"
                  min={0}
                  value={f.leadTimeDays}
                  onChange={(e) => setF({ ...f, leadTimeDays: Number(e.target.value) })}
                />
              </Field>
            )}

            <Field
              label="Reason"
              htmlFor={`e-r-${activity.id}`}
              required={needsReason}
              hint={needsReason ? "Recorded against the amendment" : "Not needed for a wording fix"}
              className="sm:col-span-3"
            >
              <Input
                id={`e-r-${activity.id}`}
                value={reason}
                disabled={!needsReason}
                placeholder={needsReason ? "Why this is changing" : "—"}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pending || !changed || f.title.trim().length < 2 || (needsReason && reason.trim().length < 3)}
              onClick={submit}
            >
              {pending ? "Saving…" : "Save amendment"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            {changesDefinition && activity.status === "APPROVED" && (
              <span className="text-2xs text-warning">
                Saving returns this activity to draft — it generates nothing until approved again.
              </span>
            )}
          </div>

          <p className="max-w-prose text-2xs text-muted-foreground">
            Applies to work generated from now on. Tasks that already exist keep the definition they
            were created under, so an auditor sees the obligation that actually applied rather than a
            later revision of it. To change a task that exists today, edit that task.
          </p>
        </div>
      </td>
    </tr>
  );
}
