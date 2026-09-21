"use client";

import { AlertTriangle, Clock, Pause } from "lucide-react";
import { PriorityTag, type Priority } from "@/components/task/task-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";

/** Occurrences per week, used to express committed load in a comparable unit. */
const PER_WEEK: Record<string, number> = {
  DAILY: 5,
  WEEKLY: 1,
  MONTHLY: 12 / 52,
  QUARTERLY: 4 / 52,
  YEARLY: 1 / 52,
};

function frequencyLabel(frequency: string | null, interval: number): string {
  if (!frequency) return "One-off";
  const base = frequency.charAt(0) + frequency.slice(1).toLowerCase();
  return interval > 1 ? `Every ${interval} × ${base.toLowerCase()}` : base;
}

export default function MyDeskCardPage() {
  const query = trpc.deskCard.mine.useQuery();
  const acknowledge = trpc.deskCard.acknowledge.useMutation({
    onSuccess: () => query.refetch(),
  });

  if (query.isLoading) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-muted" />
        ))}
      </Card>
    );
  }

  if (query.error) {
    const unauthorised = query.error.data?.code === "UNAUTHORIZED";
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <p className="text-sm font-medium">{unauthorised ? "Sign in to continue" : "Could not load your desk card"}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {unauthorised
            ? "workPulse uses your Synapse session. Sign in to Synapse, then open workPulse from the Apps menu."
            : query.error.message}
        </p>
      </Card>
    );
  }

  const card = query.data;

  if (!card) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">No desk card assigned</p>
        <p className="max-w-md text-xs text-muted-foreground">
          A desk card lists the standing obligations of your role — what you are responsible for, how often, and
          the expected effort. Your Department Head creates and assigns it.
        </p>
      </Card>
    );
  }

  const weeklyMinutes = card.activities.reduce((total, a) => {
    if (!a.frequency) return total;
    const occurrences = (PER_WEEK[a.frequency] ?? 0) / Math.max(a.interval, 1);
    return total + a.estimatedMinutes * occurrences;
  }, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <CardTitle>Desk card</CardTitle>
            <span className="truncate text-sm font-medium">{card.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{card.department.name}</Badge>
            {card.acknowledgedAt ? (
              <Badge tone="success">Acknowledged</Badge>
            ) : (
              <Button size="sm" onClick={() => acknowledge.mutate({ id: card.id })} disabled={acknowledge.isPending}>
                {acknowledge.isPending ? "Saving…" : "Acknowledge"}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex flex-wrap gap-x-10 gap-y-3">
          <Metric label="Activities" value={String(card.activities.length)} />
          <Metric label="Committed / week" value={`${(weeklyMinutes / 60).toFixed(1)} h`} />
          <Metric
            label="Recurring"
            value={String(card.activities.filter((a) => a.frequency).length)}
          />
        </CardContent>
      </Card>

      {!card.acknowledgedAt && (
        <div className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-subtle px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-foreground">
            You have not acknowledged this desk card yet. Acknowledging records that you have seen it — it does not
            change what is generated, and work continues either way.
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Standing obligations</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="label-caps px-4 py-2.5">Activity</th>
                <th className="label-caps px-4 py-2.5">Type</th>
                <th className="label-caps px-4 py-2.5">Frequency</th>
                <th className="label-caps px-4 py-2.5 text-right">Effort</th>
                <th className="label-caps px-4 py-2.5">Priority</th>
              </tr>
            </thead>
            <tbody>
              {card.activities.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{a.title}</span>
                      {a.isPaused && (
                        <span className="inline-flex items-center gap-1 text-2xs text-warning">
                          <Pause className="size-3" aria-hidden="true" />
                          Paused
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.taskType.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {frequencyLabel(a.frequency, a.interval)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1 text-xs tabular text-muted-foreground">
                      <Clock className="size-3" aria-hidden="true" />
                      {a.estimatedMinutes} min
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <PriorityTag priority={a.priority as Priority} />
                  </td>
                </tr>
              ))}
              {card.activities.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    No approved activities on this card yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Estimated effort is set by your Department Head and changes are audited. If a figure looks wrong, raise a
        revision request rather than editing it — that keeps capacity data comparable across the team.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-caps">{label}</span>
      <span className="text-xl font-semibold tabular">{value}</span>
    </div>
  );
}
