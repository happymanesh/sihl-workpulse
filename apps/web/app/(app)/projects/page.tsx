"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const HEALTH_TONE = { GREEN: "success", AMBER: "warning", RED: "danger" } as const;
const STATUS_LABEL: Record<string, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export default function ProjectsPage() {
  const projects = trpc.project.list.useQuery();
  const [error, setError] = useState<string | null>(null);

  if (projects.error) {
    const code = projects.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">{code === "UNAUTHORIZED" ? "Sign in to continue" : "Could not load projects"}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "UNAUTHORIZED" ? "workPulse uses your Synapse session." : projects.error.message}
        </p>
      </Card>
    );
  }

  if (projects.isLoading) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-muted" />
        ))}
      </Card>
    );
  }

  const rows = projects.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <NewProject onDone={() => projects.refetch()} onError={setError} />

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p className="text-sm font-medium">No projects yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            A project is a bounded body of cross-functional work with its own accountability — distinct from the
            standing obligations on a desk card.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="label-caps px-4 py-2.5">Project</th>
                  <th className="label-caps px-4 py-2.5">Manager</th>
                  <th className="label-caps px-4 py-2.5">Status</th>
                  <th className="label-caps px-4 py-2.5 text-right">Tasks</th>
                  <th className="label-caps px-4 py-2.5 text-right">Open risks</th>
                  <th className="label-caps px-4 py-2.5">Health</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/projects/${p.id}`} className="group flex flex-col gap-0.5">
                        <span className="text-sm font-medium group-hover:underline">{p.name}</span>
                        <span className="font-mono text-2xs text-muted-foreground">{p.code}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.projectManager.name}</td>
                    <td className="px-4 py-2.5 text-xs">{STATUS_LABEL[p.status] ?? p.status}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular">{p._count.tasks}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular">{p._count.risks}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={HEALTH_TONE[p.effectiveHealth]}>{p.effectiveHealth.toLowerCase()}</Badge>
                        {p.healthOverride && (
                          <span className="text-2xs text-muted-foreground" title="Manually overridden">
                            override
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className={cn("text-2xs text-muted-foreground")}>
        Health is calculated from overdue tasks, unresolved blocking issues and missed milestones. A project manager
        may override it, but the override is always shown as one — the calculation it disagrees with is kept.
      </p>
    </div>
  );
}

/**
 * Starting a project.
 *
 * Owner, sponsor and manager are asked for separately because they are
 * different jobs: the owner carries the outcome, the sponsor clears the way,
 * the manager runs it day to day. One person can hold more than one of them,
 * but the form does not assume it.
 */
function NewProject({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const staff = trpc.employee.list.useQuery({ activeOnly: true }, { enabled: open });

  const [f, setF] = useState({
    code: "",
    name: "",
    description: "",
    ownerEmployeeId: "",
    sponsorEmployeeId: "",
    projectManagerEmployeeId: "",
    startDate: "",
    targetEndDate: "",
  });

  const create = trpc.project.create.useMutation({
    onSuccess: () => {
      setOpen(false);
      setF({ ...f, code: "", name: "", description: "" });
      onDone();
    },
    onError: (e) => onError(e.message),
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus /> New project
      </Button>
    );
  }

  const people = staff.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>New project</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" htmlFor="pc" required hint="Short and quotable, e.g. GATEWAY-26">
            <Input id="pc" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label="Name" htmlFor="pn" required>
            <Input
              id="pn"
              value={f.name}
              placeholder="Algo order gateway upgrade"
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>

          <Field label="Owner" htmlFor="po" required hint="Carries the outcome">
            <Select
              id="po"
              value={f.ownerEmployeeId}
              onChange={(e) => setF({ ...f, ownerEmployeeId: e.target.value })}
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

          <Field label="Project manager" htmlFor="pm" required hint="Runs it day to day">
            <Select
              id="pm"
              value={f.projectManagerEmployeeId}
              onChange={(e) => setF({ ...f, projectManagerEmployeeId: e.target.value })}
            >
              <option value="">Choose…</option>
              {people.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Sponsor" htmlFor="ps" hint="Clears the way. Optional.">
            <Select
              id="ps"
              value={f.sponsorEmployeeId}
              onChange={(e) => setF({ ...f, sponsorEmployeeId: e.target.value })}
            >
              <option value="">None</option>
              {people.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="pst">
              <Input
                id="pst"
                type="date"
                value={f.startDate}
                onChange={(e) => setF({ ...f, startDate: e.target.value })}
              />
            </Field>
            <Field label="Target end" htmlFor="pet">
              <Input
                id="pet"
                type="date"
                value={f.targetEndDate}
                onChange={(e) => setF({ ...f, targetEndDate: e.target.value })}
              />
            </Field>
          </div>

          <Field label="What it is for" htmlFor="pd" className="sm:col-span-2">
            <Textarea
              id="pd"
              rows={2}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={
              f.code.trim().length < 2 ||
              f.name.trim().length < 2 ||
              !f.ownerEmployeeId ||
              !f.projectManagerEmployeeId ||
              create.isPending
            }
            onClick={() =>
              create.mutate({
                code: f.code.trim(),
                name: f.name.trim(),
                description: f.description.trim() || undefined,
                ownerEmployeeId: f.ownerEmployeeId,
                sponsorEmployeeId: f.sponsorEmployeeId || undefined,
                projectManagerEmployeeId: f.projectManagerEmployeeId,
                startDate: f.startDate ? new Date(f.startDate) : undefined,
                targetEndDate: f.targetEndDate ? new Date(f.targetEndDate) : undefined,
              })
            }
          >
            {create.isPending ? "Creating…" : "Create in planning"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>

        <p className="text-2xs text-muted-foreground">
          A project starts in planning. Its health stays green until something it is measured on —
          a missed milestone, a blocking issue, overdue work — says otherwise.
        </p>
      </CardContent>
    </Card>
  );
}
