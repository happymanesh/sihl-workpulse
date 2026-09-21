"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/** First and last instant of a calendar month, matching the API's month bounds. */
function monthBounds(offset: number) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0, 0);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
  return { periodStart, periodEnd };
}

type Level =
  | { kind: "enterprise" }
  | { kind: "department"; id: string; label: string }
  | { kind: "employee"; id: string; label: string; departmentId: string; departmentLabel: string };

export default function MisPage() {
  const [monthOffset, setMonthOffset] = useState(0);
  const [level, setLevel] = useState<Level>({ kind: "enterprise" });
  const period = useMemo(() => monthBounds(monthOffset), [monthOffset]);

  const enterprise = trpc.mis.enterprise.useQuery(period);
  const departments = trpc.mis.byDepartment.useQuery(period, { enabled: level.kind !== "employee" });
  // The department currently in view, whichever level we are at.
  const activeDepartment =
    level.kind === "department"
      ? { id: level.id, label: level.label }
      : level.kind === "employee"
        ? { id: level.departmentId, label: level.departmentLabel }
        : null;

  const employees = trpc.mis.byEmployee.useQuery(
    { departmentId: activeDepartment?.id ?? "", ...period },
    { enabled: activeDepartment !== null },
  );
  const tasks = trpc.mis.tasks.useQuery(
    {
      departmentId: activeDepartment?.id,
      employeeId: level.kind === "employee" ? level.id : undefined,
      ...period,
    },
    { enabled: activeDepartment !== null },
  );

  if (enterprise.error) {
    const code = enterprise.error.data?.code;
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">
          {code === "UNAUTHORIZED" ? "Sign in to continue" : code === "FORBIDDEN" ? "Not available to your role" : "Could not load MIS"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {code === "FORBIDDEN"
            ? "Enterprise MIS is available to managers, department heads, executives and Audit."
            : enterprise.error.message}
        </p>
      </Card>
    );
  }

  const monthLabel = period.periodStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const e = enterprise.data;

  return (
    <div className="flex flex-col gap-4">
      {/* Period selector and breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1 text-xs" aria-label="Drill-down">
          <Crumb onClick={() => setLevel({ kind: "enterprise" })} active={level.kind === "enterprise"}>
            Enterprise
          </Crumb>
          {level.kind !== "enterprise" && (
            <>
              <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
              <Crumb
                onClick={() =>
                  activeDepartment && setLevel({ kind: "department", ...activeDepartment })
                }
                active={level.kind === "department"}
              >
                {activeDepartment?.label}
              </Crumb>
            </>
          )}
          {level.kind === "employee" && (
            <>
              <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
              <Crumb active>{level.label}</Crumb>
            </>
          )}
        </nav>

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

      {/* Level 1 */}
      <Card>
        <CardContent className="flex flex-wrap gap-x-10 gap-y-3">
          <Metric label="Total tasks" value={e?.total} />
          <Metric label="Open" value={e?.open} />
          <Metric label="Overdue" value={e?.overdue} tone={e && e.overdue > 0 ? "danger" : undefined} />
          <Metric label="Critical" value={e?.critical} tone={e && e.critical > 0 ? "warning" : undefined} />
          <Metric label="Blocked" value={e?.blocked} tone={e && e.blocked > 0 ? "danger" : undefined} />
          <Metric label="Missed" value={e?.missed} tone={e && e.missed > 0 ? "danger" : undefined} />
          <Metric label="On time" value={e?.onTimePercent === null ? "—" : e ? `${e.onTimePercent}%` : undefined} />
        </CardContent>
      </Card>

      {/* The two disclosures that keep these numbers honest. */}
      {(e?.scopeIsLimited || (e?.confidentialExcluded ?? 0) > 0) && (
        <div className="flex flex-wrap gap-2">
          {e?.scopeIsLimited && (
            <Badge tone="info">Scoped to your department</Badge>
          )}
          {(e?.confidentialExcluded ?? 0) > 0 && (
            <Badge tone="neutral" title="Confidential work is excluded from these aggregates for every role except Audit.">
              {e?.confidentialExcluded} confidential task{e?.confidentialExcluded === 1 ? "" : "s"} excluded
            </Badge>
          )}
        </div>
      )}

      {/* Levels 2 and 3 */}
      {level.kind === "enterprise" ? (
        <RowTable
          heading="Department"
          rows={departments.data ?? []}
          loading={departments.isLoading}
          onDrill={(r) => setLevel({ kind: "department", id: r.id, label: r.label })}
        />
      ) : (
        <RowTable
          heading="Team member"
          rows={employees.data ?? []}
          loading={employees.isLoading}
          activeId={level.kind === "employee" ? level.id : undefined}
          onDrill={(r) =>
            setLevel({
              kind: "employee",
              id: r.id,
              label: r.label,
              departmentId: activeDepartment?.id ?? "",
              departmentLabel: activeDepartment?.label ?? "",
            })
          }
        />
      )}

      {/* Level 4 - every figure above reaches the tasks behind it */}
      {level.kind !== "enterprise" && (
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <span className="label-caps">Tasks — {level.label}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="label-caps px-4 py-2.5">Reference</th>
                  <th className="label-caps px-4 py-2.5">Title</th>
                  <th className="label-caps px-4 py-2.5">Assignee</th>
                  <th className="label-caps px-4 py-2.5">Status</th>
                  <th className="label-caps px-4 py-2.5">Priority</th>
                  <th className="label-caps px-4 py-2.5 text-right">Due</th>
                </tr>
              </thead>
              <tbody>
                {(tasks.data ?? []).map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5 text-xs tabular">
                      <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">
                        {t.reference}
                      </Link>
                    </td>
                    <td className="max-w-sm truncate px-4 py-2.5 text-xs">{t.title}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{t.assignee?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{t.status.replace(/_/g, " ").toLowerCase()}</td>
                    <td className="px-4 py-2.5 text-xs">{t.priority.toLowerCase()}</td>
                    <td className={cn("px-4 py-2.5 text-right text-xs tabular", t.isMissed && "text-danger")}>
                      {new Date(t.dueDate).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {!tasks.isLoading && (tasks.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-xs text-muted-foreground">
                      No tasks in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-2xs text-muted-foreground">
        Every figure here is drillable to the tasks behind it. Access is re-checked at each level, so a
        department head sees their own department at the top and the bottom alike.
      </p>
    </div>
  );
}

function Crumb({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  if (active || !onClick) {
    return <span className="font-medium">{children}</span>;
  }
  return (
    <button type="button" onClick={onClick} className="text-muted-foreground hover:underline">
      {children}
    </button>
  );
}

interface Row {
  id: string;
  label: string;
  total: number;
  open: number;
  overdue: number;
  critical: number;
  blocked: number;
  missed: number;
  onTimePercent: number | null;
}

function RowTable({
  heading,
  rows,
  loading,
  activeId,
  onDrill,
}: {
  heading: string;
  rows: Row[];
  loading: boolean;
  activeId?: string;
  onDrill: (r: Row) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="label-caps px-4 py-2.5">{heading}</th>
              <th className="label-caps px-4 py-2.5 text-right">Open</th>
              <th className="label-caps px-4 py-2.5 text-right">Overdue</th>
              <th className="label-caps px-4 py-2.5 text-right">Critical</th>
              <th className="label-caps px-4 py-2.5 text-right">Blocked</th>
              <th className="label-caps px-4 py-2.5 text-right">Missed</th>
              <th className="label-caps px-4 py-2.5 text-right">On time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => onDrill(r)}
                className={cn(
                  "cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40",
                  activeId === r.id && "bg-muted/60",
                )}
              >
                <td className="px-4 py-2.5 text-sm font-medium">{r.label}</td>
                <td className="px-4 py-2.5 text-right text-xs tabular">{r.open}</td>
                <td className={cn("px-4 py-2.5 text-right text-xs tabular", r.overdue > 0 && "font-medium text-danger")}>
                  {r.overdue}
                </td>
                <td className={cn("px-4 py-2.5 text-right text-xs tabular", r.critical > 0 && "font-medium text-warning")}>
                  {r.critical}
                </td>
                <td className={cn("px-4 py-2.5 text-right text-xs tabular", r.blocked > 0 && "font-medium text-danger")}>
                  {r.blocked}
                </td>
                <td className={cn("px-4 py-2.5 text-right text-xs tabular", r.missed > 0 && "font-medium text-danger")}>
                  {r.missed}
                </td>
                <td className="px-4 py-2.5 text-right text-xs tabular">
                  {r.onTimePercent === null ? "—" : `${r.onTimePercent}%`}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-muted-foreground">
                  Nothing to show for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
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
