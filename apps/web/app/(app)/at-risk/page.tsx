"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

interface Factor {
  code: string;
  label: string;
  contribution: number;
}

function bandOf(risk: number): { label: string; tone: "danger" | "warning" | "neutral" } {
  if (risk >= 0.7) return { label: "high", tone: "danger" };
  if (risk >= 0.4) return { label: "elevated", tone: "warning" };
  return { label: "low", tone: "neutral" };
}

export default function AtRiskPage() {
  const atRisk = trpc.prediction.atRisk.useQuery({ limit: 25 });
  const accuracy = trpc.prediction.accuracy.useQuery({});

  if (atRisk.error) {
    const code = atRisk.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED"
            ? "Sign in to continue"
            : code === "FORBIDDEN"
              ? "Not available to your role"
              : "Could not load risk assessments"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "SLA risk triage is available to managers, department heads, executives and Audit."
            : atRisk.error.message}
        </p>
      </Card>
    );
  }

  const rows = atRisk.data ?? [];
  const acc = accuracy.data;

  return (
    <div className="flex flex-col gap-4">
      <ModelHonesty accuracy={acc} />

      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const band = bandOf(r.risk);
          const factors = (r.factorsJson as unknown as Factor[]) ?? [];
          return (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={band.tone}>{band.label} risk</Badge>
                  <span className="text-sm font-semibold tabular">{Math.round(r.risk * 100)}%</span>
                  <Link href={`/tasks/${r.task.id}`} className="text-xs tabular font-medium hover:underline">
                    {r.task.reference}
                  </Link>
                  <span className="truncate text-xs">{r.task.title}</span>
                  <span className="ml-auto text-2xs text-muted-foreground">
                    {r.task.assignee?.name ?? "Unassigned"} · due{" "}
                    {new Date(r.task.dueDate).toLocaleDateString()}
                  </span>
                </div>

                {/* The why, not just the number. A bare score is unactionable. */}
                <ul className="flex flex-col gap-0.5">
                  {factors.slice(0, 4).map((f) => (
                    <li key={f.code} className="flex items-baseline gap-2 text-2xs">
                      <span
                        className={cn(
                          "w-10 shrink-0 text-right tabular",
                          f.contribution > 0 ? "text-danger" : "text-success",
                        )}
                      >
                        {f.contribution > 0 ? "+" : ""}
                        {f.contribution.toFixed(2)}
                      </span>
                      <span className="text-muted-foreground">{f.label}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}

        {!atRisk.isLoading && rows.length === 0 && (
          <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <p className="text-sm font-medium">No risk assessments yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Open work is assessed hourly. Tasks with no SLA attached are not assessed at all — there
              is nothing for them to breach.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * The model's own track record, shown above its predictions rather than buried.
 *
 * Anyone asked to act on a risk estimate is entitled to know whether it has been
 * any good — and if it has not, this says so in plain words instead of leaving
 * a confident-looking percentage to speak for itself.
 */
function ModelHonesty({
  accuracy,
}: {
  accuracy: { count: number; skill: number; truePositives: number; falsePositives: number } | undefined;
}) {
  if (!accuracy || accuracy.count === 0) {
    return (
      <Card>
        <CardContent className="flex gap-3 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1 text-2xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">No track record yet.</span> These are
              estimates from an explainable rule set, not a trained model — there is no history to fit
              one to. Every prediction is recorded against what actually happened, so this panel will
              report whether it has been any good.
            </p>
            <p>Treat the figures below as a prompt to look, not as a forecast.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const useful = accuracy.skill > 0;
  return (
    <Card>
      <CardContent className="flex gap-3 py-4">
        <Info
          className={cn("mt-0.5 size-4 shrink-0", useful ? "text-success" : "text-danger")}
          aria-hidden
        />
        <div className="flex flex-col gap-1 text-2xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              {useful
                ? `Beating the base rate by ${Math.round(accuracy.skill * 100)}%`
                : "Not currently beating the base rate"}
            </span>{" "}
            over {accuracy.count} scored prediction{accuracy.count === 1 ? "" : "s"}.{" "}
            {accuracy.truePositives} correct warning{accuracy.truePositives === 1 ? "" : "s"},{" "}
            {accuracy.falsePositives} false alarm{accuracy.falsePositives === 1 ? "" : "s"}.
          </p>
          {!useful && (
            <p className="text-danger">
              On this record the model is not adding information beyond how often work breaches
              anyway. Weigh it accordingly, and raise it — a model that earns nothing should be
              recalibrated or retired, not quietly tolerated.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
