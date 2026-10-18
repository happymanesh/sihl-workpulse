"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  DecisionsCard,
  MilestonesCard,
  ProjectTasksCard,
  RaciCard,
  RisksCard,
  StatusAndHealth,
} from "@/components/project/project-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const HEALTH_TONE = { GREEN: "success", AMBER: "warning", RED: "danger" } as const;

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const project = trpc.project.byId.useQuery({ id });
  const [error, setError] = useState<string | null>(null);

  // Every card writes through its own mutation and then asks for the project
  // again. Health is recalculated server-side on each of those writes, so a
  // refetch is what makes the traffic light move.
  const refresh = () => {
    utils.project.byId.invalidate({ id });
    utils.project.list.invalidate();
  };

  const recalc = trpc.project.recalculateHealth.useMutation({
    onSuccess: refresh,
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

      <StatusAndHealth project={p} onChange={refresh} onError={setError} />

      <div className="grid gap-4 lg:grid-cols-2">
        <RaciCard project={p} onChange={refresh} onError={setError} />
        <MilestonesCard project={p} onChange={refresh} onError={setError} />
      </div>

      <RisksCard project={p} onChange={refresh} onError={setError} />
      <DecisionsCard project={p} onChange={refresh} onError={setError} />
      <ProjectTasksCard project={p} onChange={refresh} onError={setError} />
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
