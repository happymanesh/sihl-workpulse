"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

/**
 * Systems allowed to raise work in workPulse.
 *
 * This is the piece whose absence made the whole intake path unreachable: the
 * service that turns a ticket into a task was complete from the beginning, and
 * there was no way to register anything for it to accept.
 *
 * Deliberately on the access screen rather than somewhere in governance,
 * because registering one is an access decision — it grants an outside system
 * the ability to create work for people here.
 */
export function SourceSystems({ onError }: { onError: (message: string) => void }) {
  const utils = trpc.useUtils();
  const sources = trpc.sourceSystem.list.useQuery();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: "", name: "", referenceUrlTemplate: "", webhookUrl: "" });

  const refresh = () => utils.sourceSystem.list.invalidate();
  const register = trpc.sourceSystem.register.useMutation({
    onSuccess: () => {
      setOpen(false);
      setF({ code: "", name: "", referenceUrlTemplate: "", webhookUrl: "" });
      refresh();
    },
    onError: (e) => onError(e.message),
  });
  const update = trpc.sourceSystem.update.useMutation({
    onSuccess: refresh,
    onError: (e) => onError(e.message),
  });

  const rows = sources.data ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="label-caps">Source systems</span>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : <><Plus /> Register</>}
        </Button>
      </div>

      <CardContent className="flex flex-col gap-3 py-4">
        {rows.length === 0 && !open && (
          <p className="text-2xs text-muted-foreground">
            None registered. Nothing outside workPulse can raise work until one is.
          </p>
        )}

        {rows.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2 last:border-b-0">
            <span className="font-mono text-2xs">{s.code}</span>
            <span className="text-sm">{s.name}</span>
            {s.isActive ? <Badge tone="success">active</Badge> : <Badge tone="neutral">off</Badge>}
            <span className="text-2xs text-muted-foreground">
              {s._count.tasks} task{s._count.tasks === 1 ? "" : "s"} raised
            </span>
            {s.webhookUrl ? (
              <Badge tone="info">status pushed back</Badge>
            ) : (
              <span className="text-2xs text-muted-foreground">no webhook</span>
            )}
            <button
              type="button"
              className="ml-auto text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => update.mutate({ id: s.id, isActive: !s.isActive })}
            >
              {s.isActive ? "Switch off" : "Switch on"}
            </button>
          </div>
        ))}

        {open && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Code" htmlFor="ss-code" required hint="Sent on every event, e.g. SUPPORT_DESK">
              <Input id="ss-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>
            <Field label="Name" htmlFor="ss-name" required>
              <Input id="ss-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field
              label="Link back to the ticket"
              htmlFor="ss-ref"
              hint="{id} is replaced with their reference"
            >
              <Input
                id="ss-ref"
                value={f.referenceUrlTemplate}
                placeholder="https://tracker.sihl.internal/issues/{id}"
                onChange={(e) => setF({ ...f, referenceUrlTemplate: e.target.value })}
              />
            </Field>
            <Field label="Webhook for status back" htmlFor="ss-hook" hint="Optional. Omit for one-way intake.">
              <Input
                id="ss-hook"
                value={f.webhookUrl}
                placeholder="https://tracker.sihl.internal/hooks/workpulse"
                onChange={(e) => setF({ ...f, webhookUrl: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button
                size="sm"
                disabled={f.code.trim().length < 2 || f.name.trim().length < 2 || register.isPending}
                onClick={() =>
                  register.mutate({
                    code: f.code.trim(),
                    name: f.name.trim(),
                    referenceUrlTemplate: f.referenceUrlTemplate.trim() || null,
                    webhookUrl: f.webhookUrl.trim() || null,
                  })
                }
              >
                {register.isPending ? "Registering…" : "Register"}
              </Button>
            </div>
          </div>
        )}

        <p className="text-2xs text-muted-foreground">
          A registered system posts to <span className="font-mono">/intake</span> as a Synapse
          service account whose role maps to INTEGRATION_SERVICE — the same identity model as a
          person, so revoking it takes effect on its next request and there is no separate secret to
          rotate. Its own reference is the idempotency key: a redelivered webhook returns the task
          it already created rather than a second one. Switching a system off stops it raising new
          work and leaves what it raised alone.
        </p>
      </CardContent>
    </Card>
  );
}
