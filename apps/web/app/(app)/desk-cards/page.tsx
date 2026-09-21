"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";

const STATUS_TONE = {
  DRAFT: "neutral",
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  RETIRED: "neutral",
} as const;

export default function DeskCardsAdminPage() {
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);

  const cards = trpc.deskCard.list.useQuery({ includeRetired: false });
  const departments = trpc.reference.departments.useQuery(undefined, { enabled: creating });

  const [form, setForm] = useState({ code: "", name: "", description: "", departmentId: "" });
  const [error, setError] = useState<string | null>(null);

  const create = trpc.deskCard.create.useMutation({
    onSuccess: () => {
      setCreating(false);
      setForm({ code: "", name: "", description: "", departmentId: "" });
      setError(null);
      utils.deskCard.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (cards.error) {
    const unauthorised = cards.error.data?.code === "UNAUTHORIZED";
    const forbidden = cards.error.data?.code === "FORBIDDEN";
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {unauthorised ? "Sign in to continue" : forbidden ? "You do not have access to this" : "Could not load desk cards"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {forbidden
            ? "Desk card administration is limited to Department Heads and System Admins."
            : unauthorised
              ? "workPulse uses your Synapse session."
              : cards.error.message}
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground tabular">
          {cards.data ? `${cards.data.length} card${cards.data.length === 1 ? "" : "s"}` : " "}
        </span>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus /> New desk card
        </Button>
      </div>

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>New desk card</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" htmlFor="code" required hint="Short, stable identifier — e.g. COMP-OFFICER">
                <Input
                  id="code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="COMP-OFFICER"
                />
              </Field>
              <Field label="Role name" htmlFor="name" required>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Compliance Officer"
                />
              </Field>
              <Field label="Department" htmlFor="dept" required className="sm:col-span-2">
                <Select
                  id="dept"
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                >
                  <option value="">Select a department…</option>
                  {departments.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Description" htmlFor="desc" className="sm:col-span-2">
                <Textarea
                  id="desc"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What this role is standingly responsible for"
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!form.code.trim() || !form.name.trim() || !form.departmentId || create.isPending}
                onClick={() =>
                  create.mutate({
                    code: form.code.trim(),
                    name: form.name.trim(),
                    description: form.description.trim() || undefined,
                    departmentId: form.departmentId,
                  })
                }
              >
                {create.isPending ? "Creating…" : "Create in draft"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setError(null); }}>
                Cancel
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              A new card starts in Draft. It generates no work until it is approved and has a holder.
            </p>
          </CardContent>
        </Card>
      )}

      {cards.isLoading ? (
        <Card className="flex flex-col gap-2 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted" />
          ))}
        </Card>
      ) : cards.data && cards.data.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="label-caps px-4 py-2.5">Role</th>
                  <th className="label-caps px-4 py-2.5">Department</th>
                  <th className="label-caps px-4 py-2.5">Holder</th>
                  <th className="label-caps px-4 py-2.5 text-right">Activities</th>
                  <th className="label-caps px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {cards.data.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/desk-cards/${c.id}`} className="group flex flex-col gap-0.5">
                        <span className="text-sm font-medium group-hover:underline">{c.name}</span>
                        <span className="font-mono text-2xs text-muted-foreground">{c.code}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.department.name}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {c.holder ? (
                        c.holder.name
                      ) : (
                        <span className="text-warning">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs tabular text-muted-foreground">
                      {c._count.activities}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[c.status]}>{c.status.replace("_", " ").toLowerCase()}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p className="text-sm font-medium">No desk cards yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            A desk card defines what a role is standingly responsible for — the obligations, how often each recurs,
            and the expected effort. Approved cards generate work automatically.
          </p>
        </Card>
      )}
    </div>
  );
}
