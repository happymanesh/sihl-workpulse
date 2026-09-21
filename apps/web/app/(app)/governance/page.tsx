"use client";

import { useState } from "react";
import { AlertTriangle, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export default function GovernancePage() {
  const utils = trpc.useUtils();
  const coverage = trpc.governance.coverage.useQuery();
  const orphans = trpc.governance.orphans.useQuery();
  const manuals = trpc.governance.manuals.useQuery({});
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.governance.generateManual.useMutation({
    onSuccess: () => utils.governance.manuals.invalidate(),
    onError: (e) => setError(e.message),
  });

  if (coverage.error) {
    const code = coverage.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED" ? "Sign in to continue" : code === "FORBIDDEN" ? "Not available to your role" : "Could not load coverage"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN" ? "Control coverage is available to managers, department heads and the Audit role." : coverage.error.message}
        </p>
      </Card>
    );
  }

  const processes = coverage.data ?? [];
  const totals = processes.reduce(
    (t, p) => ({ total: t.total + p.total, covered: t.covered + p.covered }),
    { total: 0, covered: 0 },
  );
  const overall = totals.total === 0 ? 0 : Math.round((totals.covered / totals.total) * 100);
  const o = orphans.data;
  const orphanCount = o
    ? o.activitiesWithoutProcess.length + o.processesWithoutPolicy.length + o.policiesWithoutProcess.length
    : 0;

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">{error}</div>}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-10 gap-y-3">
          <div className="flex flex-col gap-0.5">
            <span className="label-caps">Control coverage</span>
            <span className={cn("text-2xl font-semibold tabular", overall < 80 && "text-warning", overall < 50 && "text-danger")}>
              {overall}%
            </span>
            <span className="text-2xs text-muted-foreground tabular">
              {totals.covered} of {totals.total} activities
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="label-caps">Processes</span>
            <span className="text-2xl font-semibold tabular">{processes.length}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="label-caps">Orphans</span>
            <span className={cn("text-2xl font-semibold tabular", orphanCount > 0 && "text-warning")}>{orphanCount}</span>
          </div>
        </CardContent>
      </Card>

      <p className="max-w-prose text-xs text-muted-foreground">
        An activity counts as covered when it has a holder, an approved workflow that is not past its review date,
        and is active. Coverage is reported, never enforced — a control environment that halted work when its
        documentation lapsed would simply be switched off.
      </p>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Coverage by process</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="label-caps px-4 py-2.5">Process</th>
                <th className="label-caps px-4 py-2.5">Policy</th>
                <th className="label-caps px-4 py-2.5">Owner</th>
                <th className="label-caps px-4 py-2.5 text-right">Covered</th>
                <th className="label-caps px-4 py-2.5">Exceptions</th>
                <th className="label-caps px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => {
                const ex = p.exceptions;
                return (
                  <tr key={p.processId} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">{p.name}</span>
                        <span className="font-mono text-2xs text-muted-foreground">{p.code}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {p.policyName ?? <span className="text-warning">Unauthorised</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.ownerName}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={cn("text-xs font-medium tabular", p.percent < 80 && "text-warning", p.percent < 50 && "text-danger")}>
                        {p.covered}/{p.total} · {p.percent}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {ex.noHolder.length > 0 && <Badge tone="danger">{ex.noHolder.length} no holder</Badge>}
                        {ex.noWorkflow.length > 0 && <Badge tone="warning">{ex.noWorkflow.length} undocumented</Badge>}
                        {ex.staleWorkflow.length > 0 && <Badge tone="warning">{ex.staleWorkflow.length} stale</Badge>}
                        {ex.inactive.length > 0 && <Badge tone="neutral">{ex.inactive.length} inactive</Badge>}
                        {p.total > 0 && p.covered === p.total && (
                          <span className="inline-flex items-center gap-1 text-2xs text-success">
                            <ShieldCheck className="size-3" /> Fully covered
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={generate.isPending}
                        onClick={() => generate.mutate({ scopeType: "PROCESS", scopeId: p.processId })}
                      >
                        <FileText /> Manual
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {processes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    No processes defined yet. A process groups the activities that together achieve one control.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {o && orphanCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Orphans</CardTitle>
            <span className="text-2xs text-muted-foreground">Mapping decays unless the decay is visible</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <OrphanList
              label="Activities with no process"
              items={o.activitiesWithoutProcess.map((a) => `${a.title} · ${a.deskCard.name}`)}
            />
            <OrphanList label="Processes with no policy" items={o.processesWithoutPolicy.map((p) => `${p.name} (${p.code})`)} />
            <OrphanList label="Policies governing nothing" items={o.policiesWithoutProcess.map((p) => `${p.name} (${p.code})`)} />
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Generated manuals</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="label-caps px-4 py-2.5">Scope</th>
                <th className="label-caps px-4 py-2.5">Generated</th>
                <th className="label-caps px-4 py-2.5 text-right">Coverage</th>
                <th className="label-caps px-4 py-2.5 text-right">Stale</th>
              </tr>
            </thead>
            <tbody>
              {(manuals.data ?? []).map((m) => (
                <tr key={m.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 text-sm">{m.scopeLabel}</td>
                  <td className="px-4 py-2.5 font-mono text-2xs text-muted-foreground">
                    {new Date(m.generatedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs tabular">
                    {m.coveragePercent}% ({m.activitiesCovered}/{m.activitiesInScope})
                  </td>
                  <td className={cn("px-4 py-2.5 text-right text-xs tabular", m.staleWorkflows > 0 && "text-warning")}>
                    {m.staleWorkflows}
                  </td>
                </tr>
              ))}
              {(manuals.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    None generated yet. A manual is a point-in-time snapshot — regenerating creates a new version
                    rather than replacing the last.
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

function OrphanList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5 label-caps">
        <AlertTriangle className="size-3 text-warning" aria-hidden="true" />
        {label} ({items.length})
      </span>
      <ul className="flex flex-col gap-0.5 pl-5">
        {items.slice(0, 8).map((i) => (
          <li key={i} className="list-disc text-xs text-muted-foreground">
            {i}
          </li>
        ))}
        {items.length > 8 && <li className="text-2xs text-muted-foreground">+{items.length - 8} more</li>}
      </ul>
    </div>
  );
}
