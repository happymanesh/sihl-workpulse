"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export default function TeamWorkloadPage() {
  const utils = trpc.useUtils();
  const team = trpc.calendar.teamWorkload.useQuery({});
  const [editing, setEditing] = useState<string | null>(null);
  const [hours, setHours] = useState(40);
  const [error, setError] = useState<string | null>(null);

  const setBudget = trpc.calendar.setBudget.useMutation({
    onSuccess: () => {
      setEditing(null);
      utils.calendar.teamWorkload.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (team.error) {
    const code = team.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED" ? "Sign in to continue" : code === "FORBIDDEN" ? "Not available to your role" : "Could not load team workload"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "Team workload is available to managers and department heads."
            : team.error.message}
        </p>
      </Card>
    );
  }

  const rows = team.data ?? [];
  const totals = rows.reduce(
    (t, r) => ({
      open: t.open + r.counts.open,
      overdue: t.overdue + r.counts.overdue,
      critical: t.critical + r.counts.critical,
      over: t.over + (r.utilisation.isOverAllocated ? 1 : 0),
    }),
    { open: 0, overdue: 0, critical: 0, over: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">{error}</div>
      )}

      <Card>
        <CardContent className="flex flex-wrap gap-x-10 gap-y-3">
          <Metric label="Open tasks" value={totals.open} />
          <Metric label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? "danger" : undefined} />
          <Metric label="Critical" value={totals.critical} tone={totals.critical > 0 ? "warning" : undefined} />
          <Metric label="Over capacity" value={totals.over} tone={totals.over > 0 ? "danger" : undefined} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="label-caps px-4 py-2.5">Team member</th>
                <th className="label-caps px-4 py-2.5">Department</th>
                <th className="label-caps px-4 py-2.5 text-right">Open</th>
                <th className="label-caps px-4 py-2.5 text-right">Critical</th>
                <th className="label-caps px-4 py-2.5 text-right">Overdue</th>
                <th className="label-caps px-4 py-2.5 text-right">Blocked</th>
                <th className="label-caps px-4 py-2.5" style={{ minWidth: 180 }}>
                  Committed vs capacity
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const u = r.utilisation;
                const pct = Math.min(u.percent, 100);
                return (
                  <tr key={r.employee.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">{r.employee.name}</span>
                        {r.employee.designation && (
                          <span className="text-2xs text-muted-foreground">{r.employee.designation}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.employee.department?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular">{r.counts.open}</td>
                    <td className={cn("px-4 py-2.5 text-right text-xs tabular", r.counts.critical > 0 && "font-medium text-warning")}>
                      {r.counts.critical}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right text-xs tabular", r.counts.overdue > 0 && "font-medium text-danger")}>
                      {r.counts.overdue}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right text-xs tabular", r.counts.blocked > 0 && "font-medium text-danger")}>
                      {r.counts.blocked}
                    </td>
                    <td className="px-4 py-2.5">
                      {editing === r.employee.id ? (
                        <div className="flex items-end gap-2">
                          <Field label="Hours / week" htmlFor={`h-${r.employee.id}`} className="w-28">
                            <Input
                              id={`h-${r.employee.id}`}
                              type="number"
                              min={1}
                              max={80}
                              value={hours}
                              onChange={(e) => setHours(Number(e.target.value))}
                            />
                          </Field>
                          <Button
                            size="sm"
                            disabled={setBudget.isPending}
                            onClick={() =>
                              setBudget.mutate({ employeeId: r.employee.id, weeklyMinutes: hours * 60 })
                            }
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : u.hasBudget ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(r.employee.id);
                            setHours(Math.round(u.budgetMinutes / 60));
                          }}
                          className="flex w-full flex-col gap-1 text-left"
                          title="Change weekly capacity"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={cn("text-xs tabular", u.isOverAllocated && "font-medium text-danger")}>
                              {(u.committedMinutes / 60).toFixed(1)}h / {(u.budgetMinutes / 60).toFixed(0)}h
                            </span>
                            <span className={cn("text-2xs tabular", u.isOverAllocated ? "text-danger" : "text-muted-foreground")}>
                              {u.percent}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full", u.isOverAllocated ? "bg-danger" : "bg-success")}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setEditing(r.employee.id); setHours(40); }}>
                          Set capacity
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    No active employees found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-2xs text-muted-foreground">
        Committed load comes from each person&apos;s approved desk card activities, not from what they reported.
        Over-allocation is a flag for you to weigh — it never blocks an assignment.
      </p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" }) {
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
        {value}
      </span>
    </div>
  );
}
