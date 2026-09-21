"use client";

import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/**
 * The Addendum 02 shadow quarter, for the Audit role.
 *
 * Deliberately absent from the sidebar. Advertising a route that every other
 * role would only ever be refused would tell the whole business that a weighted
 * performance score exists and is being computed — which is precisely the
 * impression a shadow quarter is run to avoid creating. Audit reach it by URL.
 */
function quarterBounds(offset: number) {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + offset;
  const year = now.getFullYear() + Math.floor(q / 4);
  const quarter = ((q % 4) + 4) % 4;
  return {
    periodStart: new Date(year, quarter * 3, 1, 0, 0, 0, 0),
    periodEnd: new Date(year, quarter * 3 + 3, 0, 23, 59, 59, 999),
    label: `Q${quarter + 1} ${year}`,
  };
}

export default function ShadowQuarterPage() {
  const utils = trpc.useUtils();
  const [offset, setOffset] = useState(-1);
  const bounds = useMemo(() => quarterBounds(offset), [offset]);
  const period = { periodStart: bounds.periodStart, periodEnd: bounds.periodEnd };

  // retry:false so a refusal lands at once. Retrying a 403 leaves the page in a
  // pending state for seconds, and this is the one page where "pending" must not
  // render anything - see the guard below.
  const report = trpc.shadowScore.report.useQuery(period, { retry: false });
  const anonymised = trpc.shadowScore.anonymised.useQuery(period, { retry: false });

  const compute = trpc.shadowScore.compute.useMutation({
    onSuccess: () => {
      utils.shadowScore.report.invalidate();
      utils.shadowScore.anonymised.invalidate();
    },
  });

  if (report.error) {
    const code = report.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED" ? "Sign in to continue" : "Not available to your role"}
        </p>
        <p className="max-w-lg text-xs text-muted-foreground">{report.error.message}</p>
      </Card>
    );
  }

  // Nothing shadow-specific renders until the caller is known to be permitted.
  //
  // Every other screen happily shows its scaffolding with empty figures while a
  // query resolves. Not this one: the headings alone would tell an unauthorised
  // reader that a weighted performance score exists and is being computed on
  // them, which is precisely the impression a shadow quarter is run to avoid.
  if (!report.isSuccess) {
    return (
      <Card className="flex items-center justify-center px-6 py-14">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </Card>
    );
  }

  const d = report.data?.distribution;
  const verdict = report.data?.verdict;
  const rows = anonymised.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* The most important thing on the page, and the first thing read. */}
      <Card className="border-warning/40 bg-warning-subtle">
        <CardContent className="flex gap-3 py-4">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="flex flex-col gap-1.5 text-2xs">
            <p className="text-sm font-semibold text-foreground">This score is not in force</p>
            <p className="text-muted-foreground">{report.data?.notInForceReason}</p>
            <p className="text-muted-foreground">
              Nothing here reaches appraisal evidence, a report card, or MIS. Rows are shown without
              names on purpose: the question a shadow quarter answers is whether the model separates
              people sensibly, not who scored badly.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOffset((o) => o - 1)}>
            Previous
          </Button>
          <span className="min-w-24 text-center text-xs font-medium tabular">{bounds.label}</span>
          <Button size="sm" variant="ghost" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)}>
            Next
          </Button>
        </div>
        <Button size="sm" variant="outline" disabled={compute.isPending} onClick={() => compute.mutate(period)}>
          {compute.isPending ? "Computing…" : "Recompute quarter"}
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-x-10 gap-y-3">
          <Metric label="Assessed" value={d?.assessed} />
          <Metric label="Below volume floor" value={d?.insufficient} />
          <Metric label="Lowest" value={pct(d?.min)} />
          <Metric label="Median" value={pct(d?.median)} />
          <Metric label="Highest" value={pct(d?.max)} />
          <Metric label="10th–90th spread" value={pct(d?.spread)} />
          <Metric label="Within 5pts of median" value={d?.clusteredAtMedian} />
        </CardContent>
      </Card>

      {verdict && (
        <Card className={cn(verdict.discriminates ? "border-success/40" : "border-danger/40")}>
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex items-center gap-2">
              <Badge tone={verdict.discriminates ? "success" : "danger"}>
                {verdict.discriminates ? "discriminates" : "does not discriminate"}
              </Badge>
              <span className="text-xs font-medium">
                {verdict.discriminates
                  ? "The model separates people across a real range"
                  : "On this quarter the model has not measured anything usable"}
              </span>
            </div>
            {verdict.reasons.length > 0 && (
              <ul className="flex flex-col gap-1 pl-4">
                {verdict.reasons.map((r) => (
                  <li key={r} className="list-disc text-2xs text-muted-foreground">
                    {r}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-2xs text-muted-foreground">
              Advisory only. HR signs off, not this page — it exists so the review produces a stated
              conclusion somebody has to disagree with in writing, rather than a chart that can be
              read to suit a decision already taken.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="label-caps">Distribution — subjects not named</span>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left">
            <tbody>
              {rows.map((r) => (
                <tr key={r.subject} className="border-b border-border last:border-b-0">
                  <td className="w-20 px-4 py-1.5 text-2xs tabular text-muted-foreground">{r.subject}</td>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-info"
                          style={{ width: `${Math.round(r.composite * 100)}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-2xs tabular">
                        {Math.round(r.composite * 100)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {!anonymised.isLoading && rows.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center text-xs text-muted-foreground">
                    Nothing computed for {bounds.label} yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-2xs text-muted-foreground">
        Weights in use: {JSON.stringify(report.data?.weights ?? {})}. These are Addendum 02&apos;s
        draft weights and have not been agreed by HR (Appendix F, F3-01 to F3-06). A quarter run under
        one set of weights tells you nothing about a different set — each row records the weights it
        was computed with.
      </p>
    </div>
  );
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? undefined : `${Math.round(v * 100)}%`;

function Metric({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-caps">{label}</span>
      <span className="text-xl font-semibold tabular">{value ?? "—"}</span>
    </div>
  );
}
