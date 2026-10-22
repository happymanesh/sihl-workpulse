"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { trpc, type RouterOutputs } from "@/lib/trpc/client";

type TaskType = RouterOutputs["taskType"]["list"][number];

const BLANK = {
  code: "",
  name: "",
  requiresVerification: false,
  requiresEvidence: false,
  requiresMakerChecker: false,
};

/**
 * Task types decide whether work is checked before it closes.
 *
 * Until now they could only be changed by editing the seed and redeploying,
 * which made the one master that governs every other control the hardest to
 * change. The flags are read at the moment a task moves rather than copied
 * onto it when raised, so a change here reaches work that is already open —
 * which the screen says out loud rather than leaving somebody to discover.
 */
export default function TaskTypesPage() {
  const utils = trpc.useUtils();
  const types = trpc.taskType.list.useQuery();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);

  const refresh = () => utils.taskType.list.invalidate();
  const onError = (e: { message: string }) => setError(e.message);

  const create = trpc.taskType.create.useMutation({
    onSuccess: () => {
      setCreating(false);
      setForm(BLANK);
      setError(null);
      refresh();
    },
    onError,
  });

  if (types.error) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm font-medium">Task types are not yours to see</p>
          <p className="mt-1 text-xs text-muted-foreground">{types.error.message}</p>
        </CardContent>
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

      <Card>
        <CardContent className="flex flex-col gap-2 py-4">
          <div className="flex items-center justify-between gap-2">
            <span className="label-caps">Task types</span>
            <Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
              {creating ? "Cancel" : <><Plus /> New type</>}
            </Button>
          </div>
          <p className="max-w-3xl text-xs text-muted-foreground">
            A task type decides what must happen before work of that kind can close. These are read
            when a task moves, not when it is raised — so switching one off applies to work already
            in progress, and switching it off asks you why.
          </p>

          {creating && (
            <div className="mt-2 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <Field label="Code" htmlFor="tt-code" required hint="Short and permanent, e.g. OPERATIONAL">
                <Input
                  id="tt-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </Field>
              <Field label="Name" htmlFor="tt-name" required>
                <Input
                  id="tt-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Toggle
                  label="Needs verification before it can close"
                  checked={form.requiresVerification}
                  onChange={(v) => setForm({ ...form, requiresVerification: v })}
                />
                <Toggle
                  label="The checker may not be the person who did the work"
                  checked={form.requiresMakerChecker}
                  onChange={(v) => setForm({ ...form, requiresMakerChecker: v })}
                />
                <Toggle
                  label="Closing with no evidence attached is flagged"
                  checked={form.requiresEvidence}
                  onChange={(v) => setForm({ ...form, requiresEvidence: v })}
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  disabled={form.code.trim().length < 2 || form.name.trim().length < 2 || create.isPending}
                  onClick={() => create.mutate({ ...form, code: form.code.trim(), name: form.name.trim() })}
                >
                  {create.isPending ? "Creating…" : "Create task type"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(types.data ?? []).map((t) => (
        <TaskTypeRow key={t.id} type={t} onError={onError} onDone={refresh} />
      ))}

      {types.data?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No task types exist. Nothing can be raised until at least one does.
        </p>
      )}
    </div>
  );
}

function TaskTypeRow({
  type,
  onError,
  onDone,
}: {
  type: TaskType;
  onError: (e: { message: string }) => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: type.name,
    requiresVerification: type.requiresVerification,
    requiresEvidence: type.requiresEvidence,
    requiresMakerChecker: type.requiresMakerChecker,
  });
  const [reason, setReason] = useState("");

  const update = trpc.taskType.update.useMutation({
    onSuccess: () => {
      setOpen(false);
      setReason("");
      onDone();
    },
    onError,
  });
  const setActive = trpc.taskType.setActive.useMutation({ onSuccess: onDone, onError });

  // Which controls this edit would remove. The reason exists for these only.
  const weakened = [
    type.requiresVerification && !draft.requiresVerification ? "verification" : null,
    type.requiresMakerChecker && !draft.requiresMakerChecker ? "maker-checker" : null,
    type.requiresEvidence && !draft.requiresEvidence ? "evidence" : null,
  ].filter(Boolean) as string[];

  const changed =
    draft.name !== type.name ||
    draft.requiresVerification !== type.requiresVerification ||
    draft.requiresEvidence !== type.requiresEvidence ||
    draft.requiresMakerChecker !== type.requiresMakerChecker;

  return (
    <Card className={type.isActive ? undefined : "opacity-70"}>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-2xs">{type.code}</span>
          <span className="text-sm font-medium">{type.name}</span>
          {type.requiresVerification && <Badge tone="info">verified</Badge>}
          {type.requiresMakerChecker && <Badge tone="info">maker-checker</Badge>}
          {type.requiresEvidence && <Badge tone="info">evidence</Badge>}
          {!type.isActive && <Badge tone="neutral">retired</Badge>}
          <span className="ml-auto text-2xs text-muted-foreground">
            {type._count.activities} obligation{type._count.activities === 1 ? "" : "s"} ·{" "}
            {type._count.tasks} task{type._count.tasks === 1 ? "" : "s"}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Edit"}
          </Button>
        </div>

        {open && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <Field label="Name" htmlFor={`n-${type.id}`}>
              <Input
                id={`n-${type.id}`}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Toggle
              label="Needs verification before it can close"
              checked={draft.requiresVerification}
              onChange={(v) => setDraft({ ...draft, requiresVerification: v })}
            />
            <Toggle
              label="The checker may not be the person who did the work"
              checked={draft.requiresMakerChecker}
              onChange={(v) => setDraft({ ...draft, requiresMakerChecker: v })}
            />
            <Toggle
              label="Closing with no evidence attached is flagged"
              checked={draft.requiresEvidence}
              onChange={(v) => setDraft({ ...draft, requiresEvidence: v })}
            />

            {weakened.length > 0 && (
              <>
                <p className="text-2xs text-warning">
                  This removes {weakened.join(" and ")}. {type._count.tasks} task
                  {type._count.tasks === 1 ? "" : "s"} already exist under this type, and the change
                  applies to the ones still open.
                </p>
                <Field label="Why it is being removed" htmlFor={`r-${type.id}`} required>
                  <Input
                    id={`r-${type.id}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Recorded against your name"
                  />
                </Field>
              </>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!changed || (weakened.length > 0 && !reason.trim()) || update.isPending}
                onClick={() =>
                  update.mutate({
                    id: type.id,
                    ...draft,
                    reason: weakened.length > 0 ? reason.trim() : undefined,
                  })
                }
              >
                {update.isPending ? "Saving…" : "Save"}
              </Button>
              <button
                type="button"
                className="text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() =>
                  setActive.mutate({
                    id: type.id,
                    isActive: !type.isActive,
                    reason: type.isActive ? reason.trim() || "Retired from the task types screen" : undefined,
                  })
                }
              >
                {type.isActive ? "Retire this type" : "Bring it back"}
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-primary"
      />
      {label}
    </label>
  );
}
