"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, Pause, Play, Plus } from "lucide-react";
import { PriorityTag, type Priority } from "@/components/task/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

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
  const setActivityStatus = trpc.activity.setStatus.useMutation({ onSuccess: refresh, onError });
  const setPaused = trpc.activity.setPaused.useMutation({ onSuccess: refresh, onError });

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
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {c.description && <p className="max-w-prose text-sm text-muted-foreground">{c.description}</p>}

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
                <th className="label-caps px-4 py-2.5 text-right">Effort</th>
                <th className="label-caps px-4 py-2.5">Priority</th>
                <th className="label-caps px-4 py-2.5">Status</th>
                <th className="label-caps px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {c.activities.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 text-sm">{a.title}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.taskType.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {a.frequency
                      ? `${a.interval > 1 ? `Every ${a.interval} ` : ""}${a.frequency.toLowerCase()}${a.leadTimeDays ? ` · ${a.leadTimeDays}d lead` : ""}`
                      : "One-off"}
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
                    </div>
                  </td>
                </tr>
              ))}
              {c.activities.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-muted-foreground">
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
  });

  const create = trpc.activity.create.useMutation({
    onSuccess: () => {
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
