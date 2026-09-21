"use client";

import Link from "next/link";
import { use, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { PriorityTag, StatusBadge, type Priority, type TaskStatus } from "@/components/task/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const HEALTH_TONE = { GREEN: "success", AMBER: "warning", RED: "danger" } as const;
const RACI_ORDER = ["ACCOUNTABLE", "RESPONSIBLE", "CONSULTED", "INFORMED"] as const;
const RACI_LABEL: Record<string, string> = {
  ACCOUNTABLE: "Accountable",
  RESPONSIBLE: "Responsible",
  CONSULTED: "Consulted",
  INFORMED: "Informed",
};
const DACI_LABEL: Record<string, string> = {
  DRIVER: "Driver",
  APPROVER: "Approver",
  CONTRIBUTOR: "Contributor",
  INFORMED: "Informed",
};

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const project = trpc.project.byId.useQuery({ id });
  const [error, setError] = useState<string | null>(null);

  const recalc = trpc.project.recalculateHealth.useMutation({
    onSuccess: () => utils.project.byId.invalidate({ id }),
    onError: (e) => setError(e.message),
  });

  if (project.isLoading) return <div className="h-40 animate-pulse rounded-lg bg-muted" />;

  if (project.error) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">Could not load this project</p>
        <p className="max-w-md text-xs text-muted-foreground">{project.error.message}</p>
      </Card>
    );
  }

  const p = project.data!;
  const health = p.effectiveHealth as keyof typeof HEALTH_TONE;
  const openRisks = p.risks.filter((r) => !r.isResolved);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/projects" className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Projects
      </Link>

      {error && <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">{error}</div>}

      <Card>
        <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-2xs text-muted-foreground">{p.code}</span>
            <h2 className="text-lg font-semibold leading-tight">{p.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={HEALTH_TONE[health]}>{health.toLowerCase()}</Badge>
            <Button size="icon" variant="ghost" onClick={() => recalc.mutate({ id })} title="Recalculate health">
              <RefreshCw className={cn(recalc.isPending && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Field label="Owner" value={p.owner.name} />
            <Field label="Sponsor" value={p.sponsor?.name ?? "—"} />
            <Field label="Manager" value={p.projectManager.name} />
            <Field label="Status" value={p.status.replace("_", " ").toLowerCase()} />
          </dl>

          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <span className="label-caps">Why this health</span>
            <ul className="mt-1 flex flex-col gap-0.5">
              {p.healthReasons.map((r) => (
                <li key={r} className="text-xs text-muted-foreground">
                  {r}
                </li>
              ))}
            </ul>
            {p.healthOverride && (
              <p className="mt-2 border-t border-border pt-2 text-xs">
                <span className="font-medium text-warning">Overridden to {p.healthOverride.toLowerCase()}</span>
                {p.healthOverrideReason && <span className="text-muted-foreground"> — {p.healthOverrideReason}</span>}
                <span className="block text-2xs text-muted-foreground">
                  Calculated value was {p.health.toLowerCase()}, and is kept for comparison.
                </span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>RACI</CardTitle>
            <span className="text-2xs text-muted-foreground">Who does the work, who answers for it</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {RACI_ORDER.map((role) => {
              const people = p.raci.filter((r) => r.role === role);
              return (
                <div key={role} className="flex items-baseline gap-3 border-b border-border py-1.5 last:border-b-0">
                  <span className={cn("label-caps w-24 shrink-0", role === "ACCOUNTABLE" && "text-primary")}>
                    {RACI_LABEL[role]}
                  </span>
                  <span className="text-xs">
                    {people.length > 0 ? (
                      people.map((x) => x.employee.name).join(", ")
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </div>
              );
            })}
            {p.raci.filter((r) => r.role === "ACCOUNTABLE").length === 0 && (
              <p className="text-2xs text-warning">
                No one is Accountable for this project. Exactly one person should be.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Milestones</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {p.milestones.map((m) => {
              const missed = m.isMissed;
              return (
                <div key={m.id} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
                  {m.completedAt ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                  ) : (
                    <Circle className={cn("size-3.5 shrink-0", missed ? "text-danger" : "text-muted-foreground")} />
                  )}
                  <span className={cn("flex-1 text-xs", m.completedAt && "text-muted-foreground line-through")}>
                    {m.name}
                  </span>
                  <span className={cn("text-2xs tabular", missed ? "font-medium text-danger" : "text-muted-foreground")}>
                    {new Date(m.targetDate).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                    {missed && " · missed"}
                  </span>
                </div>
              );
            })}
            {p.milestones.length === 0 && <p className="py-6 text-center text-2xs text-muted-foreground">None defined</p>}
          </CardContent>
        </Card>
      </div>

      {openRisks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open risks and issues</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {openRisks.map((r) => (
              <div key={r.id} className="flex items-start gap-2 border-b border-border py-2 last:border-b-0">
                {r.isBlocking && <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs font-medium">{r.title}</span>
                  {r.description && <span className="text-2xs text-muted-foreground">{r.description}</span>}
                </div>
                {r.isBlocking && <Badge tone="danger" className="ml-auto">blocking</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Decisions</CardTitle>
          <span className="text-2xs text-muted-foreground">Only the named Approver can decide</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-0">
          {p.decisions.map((d) => {
            const approver = d.assignments.find((a) => a.role === "APPROVER");
            const driver = d.assignments.find((a) => a.role === "DRIVER");
            return (
              <div key={d.id} className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{d.title}</span>
                  <Badge tone={d.status === "DECIDED" ? "success" : d.status === "REJECTED" ? "danger" : "warning"}>
                    {d.status.toLowerCase()}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 text-2xs text-muted-foreground">
                  {driver && <span>{DACI_LABEL.DRIVER}: {driver.employee.name}</span>}
                  {approver && <span>{DACI_LABEL.APPROVER}: {approver.employee.name}</span>}
                </div>
                {d.outcome && <p className="text-xs text-muted-foreground">{d.outcome}</p>}
              </div>
            );
          })}
          {p.decisions.length === 0 && <p className="py-6 text-center text-2xs text-muted-foreground">None raised</p>}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Tasks ({p.tasks.length})</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="label-caps px-4 py-2.5">Task</th>
                <th className="label-caps px-4 py-2.5">Depends on</th>
                <th className="label-caps px-4 py-2.5">Owner</th>
                <th className="label-caps px-4 py-2.5">Priority</th>
                <th className="label-caps px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {p.tasks.map((t) => (
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
                </tr>
              ))}
              {p.tasks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    No tasks on this project yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="label-caps">{label}</dt>
      <dd className="truncate text-sm capitalize">{value}</dd>
    </div>
  );
}
