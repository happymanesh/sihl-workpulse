"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

function monthBounds(offset: number) {
  const now = new Date();
  return {
    periodStart: new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0, 0),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999),
  };
}

const SEVERITY_TONE = {
  URGENT: "danger",
  ATTENTION: "warning",
  INFO: "info",
} as const;

export default function CommandCentrePage() {
  const utils = trpc.useUtils();
  const period = useMemo(() => monthBounds(0), []);
  const [showResolved, setShowResolved] = useState(false);

  const pulse = trpc.commandCentre.pulse.useQuery(period);
  const feed = trpc.commandCentre.events.useQuery({ limit: 100, includeResolved: showResolved });

  const refresh = trpc.commandCentre.refresh.useMutation({
    onSuccess: () => {
      utils.commandCentre.events.invalidate();
      utils.commandCentre.pulse.invalidate();
    },
  });

  if (pulse.error) {
    const code = pulse.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED"
            ? "Sign in to continue"
            : code === "FORBIDDEN"
              ? "Not available to your role"
              : "Could not load the Command Centre"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "The Command Centre is available to executives and Audit."
            : pulse.error.message}
        </p>
      </Card>
    );
  }

  const p = pulse.data;
  const events = feed.data?.events ?? [];
  const open = events.filter((e) => !e.resolvedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Enterprise status</span>
          {p && <Trend direction={p.trend} />}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className={cn("size-3.5", refresh.isPending && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-x-10 gap-y-3">
          <Metric label="Open" value={p?.openTasks} />
          <Metric label="Overdue" value={p?.overdueTasks} tone={p && p.overdueTasks > 0 ? "danger" : undefined} />
          <Metric label="Critical open" value={p?.criticalOpen} tone={p && p.criticalOpen > 0 ? "warning" : undefined} />
          <Metric label="Blocked" value={p?.blockedTasks} tone={p && p.blockedTasks > 0 ? "danger" : undefined} />
          <Metric label="SLA breaches" value={p?.slaBreaches} tone={p && p.slaBreaches > 0 ? "danger" : undefined} />
          <Metric
            label="On time"
            value={p?.onTimePercent === null ? "—" : p ? `${p.onTimePercent}%` : undefined}
          />
          <Metric
            label="Prior period"
            value={p?.previousOnTimePercent === null ? "—" : p ? `${p.previousOnTimePercent}%` : undefined}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <span className="label-caps">
          {showResolved ? "All events" : `Open events${open.length ? ` (${open.length})` : ""}`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Open only" : "Include resolved"}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {events.map((e) => (
          <Card key={e.id} className={cn(e.resolvedAt && "opacity-60")}>
            <CardContent className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity.toLowerCase()}</Badge>
                <Badge tone="outline">{e.eventType.replace(/_/g, " ").toLowerCase()}</Badge>
                {e.resolvedAt && <Badge tone="success">resolved</Badge>}
                <span className="ml-auto text-2xs text-muted-foreground tabular">
                  {new Date(e.occurredAt).toLocaleString()}
                </span>
              </div>

              <p className="text-sm font-medium">{e.headline}</p>
              {e.detail && <p className="text-xs text-muted-foreground">{e.detail}</p>}

              <div className="flex flex-wrap items-center gap-3 pt-0.5 text-2xs text-muted-foreground">
                {e.task && (
                  <Link href={`/tasks/${e.task.id}`} className="tabular hover:underline">
                    {e.task.reference}
                  </Link>
                )}
                {e.project && <span>{e.project.name}</span>}
                {e.department && <span>{e.department.name}</span>}
                {e.employee && <span>{e.employee.name}</span>}
              </div>
            </CardContent>
          </Card>
        ))}

        {!feed.isLoading && events.length === 0 && (
          <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <p className="text-sm font-medium">Nothing needs your attention</p>
            <p className="max-w-md text-xs text-muted-foreground">
              This feed stays deliberately quiet. It reports critical and urgent SLA breaches,
              escalations that ran out of chain, critical work more than a day overdue, work blocked
              beyond three days, missed recurring compliance obligations, and projects whose health
              got worse.
            </p>
          </Card>
        )}
      </div>

      <p className="text-2xs text-muted-foreground">
        Confidential work never enters this feed — the exclusion is applied when events are generated,
        not when they are read, so no consumer can widen it. The same events are available to an
        external Command Centre over a cursor-paged REST feed at{" "}
        <code className="rounded bg-muted px-1 py-0.5">/command-centre/events</code>.
      </p>
    </div>
  );
}

function Trend({ direction }: { direction: "IMPROVING" | "STABLE" | "DETERIORATING" | "UNKNOWN" }) {
  if (direction === "UNKNOWN") {
    return <Badge tone="neutral">no comparison</Badge>;
  }
  if (direction === "STABLE") {
    return (
      <Badge tone="neutral">
        <Minus className="size-3" aria-hidden />
        stable
      </Badge>
    );
  }
  const improving = direction === "IMPROVING";
  return (
    <Badge tone={improving ? "success" : "danger"}>
      {improving ? (
        <ArrowUpRight className="size-3" aria-hidden />
      ) : (
        <ArrowDownRight className="size-3" aria-hidden />
      )}
      {improving ? "improving" : "deteriorating"}
    </Badge>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string | undefined;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-caps">{label}</span>
      <span
        className={cn(
          "text-xl font-semibold tabular",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
        )}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}
