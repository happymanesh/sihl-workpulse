"use client";

import { useState } from "react";
import { Info, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { trpc, type RouterOutputs } from "@/lib/trpc/client";

const PRIORITIES = ["CRITICAL", "URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const TARGETS = ["ASSIGNEE", "REVIEWER", "LINE_MANAGER", "DEPARTMENT_HEAD", "PROCESS_OWNER"] as const;
const TARGET_LABEL: Record<string, string> = {
  ASSIGNEE: "The assignee",
  REVIEWER: "The reviewer",
  LINE_MANAGER: "Their line manager",
  DEPARTMENT_HEAD: "The department head",
  PROCESS_OWNER: "The process owner",
};

type Definition = RouterOutputs["sla"]["definitions"][number];

function hhmm(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * SLA targets, and what happens as one runs out.
 *
 * The engine behind this has always worked — active time, the clock pausing in
 * Blocked and On hold, most-specific-match, the escalation chain. What did not
 * exist was any way to write a row, so it ran every half hour over an empty
 * table and the At risk screen stayed permanently blank.
 */
export default function SlaPage() {
  const utils = trpc.useUtils();
  const definitions = trpc.sla.definitions.useQuery();
  const taskTypes = trpc.reference.taskTypes.useQuery();
  const departments = trpc.reference.departments.useQuery();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => utils.sla.definitions.invalidate();
  const onError = (e: { message: string }) => setError(e.message);

  const rows = definitions.data ?? [];

  if (definitions.error) {
    const code = definitions.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "FORBIDDEN" ? "Not available to your role" : "Could not load SLA targets"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">{definitions.error.message}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <NewDefinition
        taskTypes={taskTypes.data ?? []}
        departments={departments.data ?? []}
        onDone={refresh}
        onError={onError}
      />

      {rows.length === 0 && !definitions.isLoading && (
        <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p className="text-sm font-medium">No targets set</p>
          <p className="max-w-lg text-xs text-muted-foreground">
            Until one exists, no work is on a clock: nothing breaches, nothing escalates, and the At
            risk screen has nothing to assess. That is deliberate — inventing a default would put
            every task on a deadline nobody agreed to.
          </p>
        </Card>
      )}

      {rows.map((d) => (
        <DefinitionCard key={d.id} definition={d} onChange={refresh} onError={onError} />
      ))}

      <Card>
        <CardContent className="flex gap-3 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex max-w-3xl flex-col gap-1.5 text-2xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">The most specific target wins.</span> A
              definition constrains any combination of task type, priority, department and source
              system; everything left as &ldquo;any&rdquo; is a wildcard. Task type counts for most and
              source system for least, and the ordering is strict — two targets can never tie, so
              there is no ambiguity about which applied.
            </p>
            <p>
              <span className="font-medium text-foreground">The clock pauses.</span> Time in Blocked
              and On hold is outside the assignee&apos;s control and never counts against them. That
              single rule is what keeps the timeliness figure fair for anybody sitting downstream of
              a bottleneck.
            </p>
            <p>
              <span className="font-medium text-foreground">Escalation notifies; it never
              reassigns.</span> Levels are expressed as relationships rather than names, so a chain
              keeps working when people change roles.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DefinitionCard({
  definition,
  onChange,
  onError,
}: {
  definition: Definition;
  onChange: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [level, setLevel] = useState(String((definition.escalationRules.at(-1)?.level ?? 0) + 1));
  const [threshold, setThreshold] = useState("100");
  const [target, setTarget] = useState<(typeof TARGETS)[number]>("LINE_MANAGER");

  const addRule = trpc.sla.addEscalationRule.useMutation({
    onSuccess: () => {
      setAdding(false);
      onChange();
    },
    onError,
  });
  const removeRule = trpc.sla.removeEscalationRule.useMutation({ onSuccess: onChange, onError });
  const update = trpc.sla.updateDefinition.useMutation({ onSuccess: onChange, onError });

  const scope = [
    definition.taskType ? definition.taskType.name : null,
    definition.priority ? definition.priority.toLowerCase() : null,
    definition.department ? definition.department.name : null,
    definition.sourceSystem ? definition.sourceSystem.code : null,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle>{definition.name}</CardTitle>
          <span className="text-2xs text-muted-foreground">
            {scope.length ? `Applies to ${scope.join(" · ")}` : "Applies to any work not matched by something more specific"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {definition.isActive ? (
            <Badge tone="success">active</Badge>
          ) : (
            <Badge tone="neutral">off</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (definition.isActive) {
                const reason = window.prompt("Why is this target being switched off?");
                if (!reason?.trim()) return;
                update.mutate({ id: definition.id, isActive: false, reason: reason.trim() });
              } else {
                update.mutate({ id: definition.id, isActive: true });
              }
            }}
          >
            {definition.isActive ? "Switch off" : "Switch on"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-10 gap-y-2">
          <div className="flex flex-col gap-0.5">
            <span className="label-caps">Resolution</span>
            <span className="text-sm tabular">{hhmm(definition.resolutionMinutes)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="label-caps">First response</span>
            <span className="text-sm tabular">
              {definition.responseMinutes ? hhmm(definition.responseMinutes) : "—"}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <div className="flex items-center justify-between">
            <span className="label-caps">Escalation chain</span>
            <Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)}>
              {adding ? "Cancel" : <><Plus /> Add a level</>}
            </Button>
          </div>

          {definition.escalationRules.length === 0 && !adding && (
            <p className="py-2 text-2xs text-muted-foreground">
              No levels. The target is still measured and still reported as breached — nobody is
              told, that is all.
            </p>
          )}

          {definition.escalationRules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 border-b border-border py-1.5 last:border-b-0">
              <span className="w-12 text-xs tabular text-muted-foreground">L{r.level}</span>
              <span className="w-20 text-xs tabular">{r.thresholdPercent}%</span>
              <span className="flex-1 text-xs">{TARGET_LABEL[r.notifyTarget] ?? r.notifyTarget}</span>
              {!r.isMutable && <Badge tone="warning">cannot be muted</Badge>}
              <button
                type="button"
                title="Remove this level"
                className="text-muted-foreground hover:text-danger"
                onClick={() => removeRule.mutate({ ruleId: r.id })}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}

          {adding && (
            <div className="flex flex-wrap items-end gap-2 pt-2">
              <Field label="Level" htmlFor={`lv-${definition.id}`} className="w-20">
                <Input
                  id={`lv-${definition.id}`}
                  type="number"
                  min={1}
                  max={10}
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                />
              </Field>
              <Field
                label="At % of target"
                htmlFor={`th-${definition.id}`}
                className="w-32"
                hint="100 = at breach"
              >
                <Input
                  id={`th-${definition.id}`}
                  type="number"
                  min={1}
                  max={500}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
              </Field>
              <Field label="Notify" htmlFor={`tg-${definition.id}`} className="min-w-48 flex-1">
                <Select
                  id={`tg-${definition.id}`}
                  value={target}
                  onChange={(e) => setTarget(e.target.value as typeof target)}
                >
                  {TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {TARGET_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                size="sm"
                disabled={addRule.isPending}
                onClick={() =>
                  addRule.mutate({
                    slaDefinitionId: definition.id,
                    level: Number(level),
                    thresholdPercent: Number(threshold),
                    notifyTarget: target,
                    isMutable: true,
                  })
                }
              >
                Add
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NewDefinition({
  taskTypes,
  departments,
  onDone,
  onError,
}: {
  taskTypes: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: "",
    resolutionMinutes: 480,
    responseMinutes: 60,
    taskTypeId: "",
    priority: "",
    departmentId: "",
  });

  const create = trpc.sla.createDefinition.useMutation({
    onSuccess: () => {
      setOpen(false);
      setF({ ...f, name: "" });
      onDone();
    },
    onError,
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus /> New SLA target
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New SLA target</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="sl-name" required className="sm:col-span-2">
            <Input
              id="sl-name"
              value={f.name}
              placeholder="Critical compliance filings"
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>

          <Field
            label="Resolution (minutes)"
            htmlFor="sl-res"
            required
            hint="From assignment to completion, excluding paused time"
          >
            <Input
              id="sl-res"
              type="number"
              min={1}
              value={f.resolutionMinutes}
              onChange={(e) => setF({ ...f, resolutionMinutes: Number(e.target.value) })}
            />
          </Field>

          <Field
            label="First response (minutes)"
            htmlFor="sl-resp"
            hint="Must be shorter than the resolution target"
          >
            <Input
              id="sl-resp"
              type="number"
              min={1}
              value={f.responseMinutes}
              onChange={(e) => setF({ ...f, responseMinutes: Number(e.target.value) })}
            />
          </Field>

          <Field label="Task type" htmlFor="sl-type" hint="Leave as any for a catch-all">
            <Select
              id="sl-type"
              value={f.taskTypeId}
              onChange={(e) => setF({ ...f, taskTypeId: e.target.value })}
            >
              <option value="">Any</option>
              {taskTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="sl-pri">
            <Select
              id="sl-pri"
              value={f.priority}
              onChange={(e) => setF({ ...f, priority: e.target.value })}
            >
              <option value="">Any</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Department" htmlFor="sl-dept" className="sm:col-span-2">
            <Select
              id="sl-dept"
              value={f.departmentId}
              onChange={(e) => setF({ ...f, departmentId: e.target.value })}
            >
              <option value="">Any</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={f.name.trim().length < 2 || f.resolutionMinutes < 1 || create.isPending}
            onClick={() =>
              create.mutate({
                name: f.name.trim(),
                resolutionMinutes: f.resolutionMinutes,
                responseMinutes: f.responseMinutes || null,
                taskTypeId: f.taskTypeId || null,
                priority: (f.priority || null) as (typeof PRIORITIES)[number] | null,
                departmentId: f.departmentId || null,
              })
            }
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>

        <p className="text-2xs text-muted-foreground">
          Narrow targets beat broad ones, so a catch-all and a specific rule can coexist: the
          specific one applies where it matches and the catch-all covers the rest.
        </p>
      </CardContent>
    </Card>
  );
}
