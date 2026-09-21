"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

function monthBounds(offset: number) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0, 0);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
  return { periodStart, periodEnd };
}

function defaultCycle() {
  const now = new Date();
  return `FY${String(now.getFullYear()).slice(2)}-${now.getMonth() < 6 ? "H1" : "H2"}`;
}

const COMPONENTS = [
  {
    key: "execution" as const,
    label: "Execution",
    blurb: "Of the work you committed to this period, how much you delivered.",
  },
  {
    key: "timeliness" as const,
    label: "Timeliness",
    blurb: "Of your SLA-tracked work, how much was on time. Time a task spent blocked or on hold is excluded.",
  },
  {
    key: "quality" as const,
    label: "Quality",
    blurb: "Work that held up — not reopened or rejected. A task that bounced twice counts once.",
  },
  {
    key: "governance" as const,
    label: "Governance",
    blurb: "The review, approval and maker-checker obligations attached to your role.",
  },
  {
    key: "contribution" as const,
    label: "Contribution",
    blurb: "Work you took on beyond your own desk card. Capped, so stepping up never excuses your own remit.",
  },
];

export default function PerformancePage() {
  const [monthOffset, setMonthOffset] = useState(-1);
  const period = useMemo(() => monthBounds(monthOffset), [monthOffset]);
  const card = trpc.analytics.myReportCard.useQuery(period);

  // TM-FR-059: if HR has generated a snapshot for a cycle, the subject sees it
  // here. Reading it is what records disclosure - an employee is never in the
  // position of being discussed against evidence they have not been shown.
  const cycleLabel = defaultCycle();
  const evidence = trpc.appraisal.mine.useQuery(
    { cycleLabel },
    // A cycle HR has not opened yet is a 404, not a problem worth a retry storm.
    { retry: false },
  );

  if (card.error) {
    const code = card.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED" ? "Sign in to continue" : "Could not load your report card"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">{card.error.message}</p>
      </Card>
    );
  }

  const monthLabel = period.periodStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const data = card.data;
  const p = data?.period;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{data?.employee?.name ?? "Your report card"}</span>
          <span className="text-2xs text-muted-foreground">
            {data?.employee?.designation ?? ""}
            {data?.employee?.department?.name ? ` · ${data.employee.department.name}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setMonthOffset((m) => m - 1)}>
            Previous
          </Button>
          <span className="min-w-36 text-center text-xs font-medium tabular">{monthLabel}</span>
          <Button size="sm" variant="ghost" disabled={monthOffset >= 0} onClick={() => setMonthOffset((m) => m + 1)}>
            Next
          </Button>
        </div>
      </div>

      {/* The floor is stated, never implied by a low bar. */}
      {data && data.insufficientData ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-sm font-medium">Not enough work in this period to report on</p>
            <p className="max-w-lg text-xs text-muted-foreground">
              Below a minimum volume these figures are not meaningful, so nothing is shown rather than a
              low result. A month on leave and a difficult month look identical on a chart and mean
              opposite things.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COMPONENTS.map((c) => (
              <ComponentCard key={c.key} label={c.label} blurb={c.blurb} value={p?.[c.key] ?? null} />
            ))}
          </div>

          <Card>
            <CardContent className="flex flex-wrap gap-x-10 gap-y-3">
              <Raw label="Work due" value={p?.wtuDue} />
              <Raw label="Delivered" value={p?.wtuClosed} />
              <Raw label="On time" value={p?.wtuOnTime} />
              <Raw label="Reworked" value={p?.wtuReopened} />
              <Raw label="Under review" value={p?.wtuFlagged} />
            </CardContent>
          </Card>
        </>
      )}

      {/* Anything counted against you is visible to you, because that is what
          makes it possible to contest. */}
      {(data?.openFlags.length ?? 0) > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <span className="label-caps">Open for review</span>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {data?.openFlags.map((f) => (
              <div key={f.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge tone="warning">{f.flagType.replace(/_/g, " ").toLowerCase()}</Badge>
                  <span className="text-2xs text-muted-foreground tabular">
                    {new Date(f.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs">{f.detail}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border bg-muted/30 px-4 py-2.5">
            <p className="text-2xs text-muted-foreground">
              Work under review is excluded from the figures above entirely — it is not counted against
              you. A department head, Audit or an executive decides each one, with a written reason.
            </p>
          </div>
        </Card>
      )}

      {evidence.data && (
        <Card>
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">appraisal evidence</Badge>
              <span className="text-xs font-medium">Cycle {cycleLabel}</span>
              <span className="ml-auto text-2xs text-muted-foreground tabular">
                Fixed {new Date(evidence.data.generatedAt).toLocaleDateString()}
              </span>
            </div>
            <p className="text-2xs text-muted-foreground">
              {evidence.data.compositeScoreExplanation}
            </p>
            <p className="text-2xs text-muted-foreground">
              This snapshot is what HR holds for this cycle. It is fixed at the moment it was
              generated, so the conversation references a stable artifact rather than a figure that
              moves — and you are seeing exactly what they are.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex gap-3 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1.5 text-2xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">You see exactly what your manager sees.</span>{" "}
              There is no separate view of these figures, and no composite score — each component stands on
              its own and is read alongside the work behind it.
            </p>
            <p>
              If a figure looks wrong, you have {data?.disputeWindowDays ?? 14} days from publication to
              raise it with your manager or the department head. Every number here is drillable to the
              tasks that produced it.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ComponentCard({ label, blurb, value }: { label: string; blurb: string; value: number | null }) {
  const pct = value === null ? null : Math.round(value * 100);
  const tone = pct === null ? "muted" : pct >= 90 ? "success" : pct >= 70 ? "warning" : "danger";

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label-caps">{label}</span>
          <span
            className={cn(
              "text-xl font-semibold tabular",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
              tone === "danger" && "text-danger",
            )}
          >
            {pct === null ? "—" : `${pct}%`}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              tone === "success" && "bg-success",
              tone === "warning" && "bg-warning",
              tone === "danger" && "bg-danger",
              tone === "muted" && "bg-muted",
            )}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
        <p className="text-2xs leading-relaxed text-muted-foreground">{blurb}</p>
      </CardContent>
    </Card>
  );
}

function Raw({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-caps">{label}</span>
      <span className="text-lg font-semibold tabular">{value === undefined ? "—" : value.toFixed(1)}</span>
    </div>
  );
}
