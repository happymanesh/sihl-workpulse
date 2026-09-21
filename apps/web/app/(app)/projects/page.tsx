"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
