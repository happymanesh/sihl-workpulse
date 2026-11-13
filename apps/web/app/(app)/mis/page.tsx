"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Download, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc, type RouterInputs } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/** First and last instant of a calendar month, matching the API's month bounds. */
function monthBounds(offset: number) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0, 0);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
  return { periodStart, periodEnd };
}

/**
 * Hand the browser a file.
 *
 * The CSV is built on the server from the same methods the screen calls, so
 * the file and the table can never disagree; this only has to deliver it.
 * The object URL is revoked straight after - without it every export leaks
 * the whole file for as long as the tab is open.
 */
async function download(work: Promise<{ filename: string; csv: string }>) {
  const { filename, csv } = await work;
  // The BOM is what makes Excel read UTF-8 rather than the local codepage,
  // which otherwise mangles every name with an accent in it.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The stage keys the API accepts, taken from the router itself. */
type StageKey = RouterInputs["mis"]["tasks"]["stage"];

type Level =
  | { kind: "enterprise" }
  | { kind: "department"; id: string; label: string }
  | { kind: "employee"; id: string; label: string; departmentId: string; departmentLabel: string };

export default function MisPage() {
  const [monthOffset, setMonthOffset] = useState(0);
  const [level, setLevel] = useState<Level>({ kind: "enterprise" });
  const period = useMemo(() => monthBounds(monthOffset), [monthOffset]);

  // Which column of the table above is being listed below, if any. Typed from
  // the router so a stage renamed on the server breaks the build here rather
  // than silently returning an unfiltered list.
  const [stage, setStage] = useState<StageKey>(undefined);

  const utils = trpc.useUtils();
  const [exporting, setExporting] = useState(false);

  /** Fetch a CSV through the same router the table uses, then hand it over. */
  async function exportCsv(work: () => Promise<{ filename: string; csv: string }>) {
    setExporting(true);
    try {
      await download(work());
    } finally {
      setExporting(false);
    }
  }

  const stages = trpc.mis.stages.useQuery();
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
      stage,
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
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {((stages.data ?? []) as Stage[]).map((st) => (
              <Metric
                key={st.key}
                label={st.label}
                value={e?.stages[st.key as keyof typeof e.stages]}
                tone={
                  st.key === "blocked" && (e?.stages.blocked ?? 0) > 0
                    ? "danger"
                    : st.key === "rejected" && (e?.stages.rejected ?? 0) > 0
                      ? "warning"
                      : undefined
                }
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-3">
            <Metric label="Total" value={e?.total} />
            <Metric label="Overdue" value={e?.overdue} tone={e && e.overdue > 0 ? "danger" : undefined} />
            <Metric label="Critical" value={e?.critical} tone={e && e.critical > 0 ? "warning" : undefined} />
            <Metric
              label="Never started"
              value={e?.neverStarted}
              tone={e && e.neverStarted > 0 ? "danger" : undefined}
            />
            <Metric
              label="On time"
              value={e?.onTimePercent === null ? "—" : e ? `${e.onTimePercent}%` : undefined}
            />
          </div>
          <p className="text-2xs text-muted-foreground">
            On time is measured over work finished this period — an open task has no completion date to
            compare. Never started counts recurring work that came due and was never opened.
          </p>
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
          stages={(stages.data ?? []) as Stage[]}
          loading={departments.isLoading}
          activeStage={stage}
          onDrill={(r) => {
            setStage(undefined);
            setLevel({ kind: "department", id: r.id, label: r.label });
          }}
          onDrillStage={(r, key) => {
            setStage(key);
            setLevel({ kind: "department", id: r.id, label: r.label });
          }}
          onExport={() => exportCsv(() => utils.mis.csvRows.fetch({ ...period }))}
          exporting={exporting}
        />
      ) : (
        <RowTable
          heading="Team member"
          rows={employees.data ?? []}
          stages={(stages.data ?? []) as Stage[]}
          loading={employees.isLoading}
          activeId={level.kind === "employee" ? level.id : undefined}
          activeStage={stage}
          onDrill={(r) => {
            setStage(undefined);
            setLevel({
              kind: "employee",
              id: r.id,
              label: r.label,
              departmentId: activeDepartment?.id ?? "",
              departmentLabel: activeDepartment?.label ?? "",
            });
          }}
          onDrillStage={(r, key) => {
            setStage(key);
            setLevel({
              kind: "employee",
              id: r.id,
              label: r.label,
              departmentId: activeDepartment?.id ?? "",
              departmentLabel: activeDepartment?.label ?? "",
            });
          }}
          onExport={() =>
            exportCsv(() => utils.mis.csvRows.fetch({ departmentId: activeDepartment?.id, ...period }))
          }
          exporting={exporting}
        />
      )}

      {/* Level 4 - every figure above reaches the tasks behind it */}
      {level.kind !== "enterprise" && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-caps">
                Tasks — {level.label}
                {stage ? ` · ${stages.data?.find((s) => s.key === stage)?.label ?? stage}` : ""}
              </span>
              <span className="text-2xs text-muted-foreground tabular">
                {(tasks.data ?? []).length}
              </span>
              {stage && (
                <Button size="sm" variant="ghost" onClick={() => setStage(undefined)}>
                  <X className="size-3" aria-hidden /> All stages
                </Button>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting || (tasks.data ?? []).length === 0}
              onClick={() =>
                exportCsv(() =>
                  utils.mis.csvTasks.fetch({
                    departmentId: activeDepartment?.id,
                    employeeId: level.kind === "employee" ? level.id : undefined,
                    stage,
                    ...period,
                  }),
                )
              }
            >
              <Download className="size-3" aria-hidden /> CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="label-caps w-10 px-4 py-2.5 text-right">#</th>
                  <th className="label-caps px-4 py-2.5">Reference</th>
                  <th className="label-caps px-4 py-2.5">Title</th>
                  <th className="label-caps px-4 py-2.5">Assignee</th>
                  <th className="label-caps px-4 py-2.5">Status</th>
                  <th className="label-caps px-4 py-2.5">Priority</th>
                  <th className="label-caps px-4 py-2.5 text-right">Due</th>
                </tr>
              </thead>
              <tbody>
                {(tasks.data ?? []).map((t, i) => (
                  <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5 text-right text-2xs tabular text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2.5 text-xs tabular">
                      <Link href={`/tasks/${t.id}`} className="font-medium text-info hover:underline">
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
                    <td colSpan={7} className="px-4 py-10 text-center text-xs text-muted-foreground">
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

interface Stage {
  key: NonNullable<StageKey>;
  label: string;
}

interface Row {
  id: string;
  label: string;
  stages: Record<string, number>;
  total: number;
  overdue: number;
  critical: number;
  neverStarted: number;
  completedInPeriod: number;
  onTimeInPeriod: number;
  onTimePercent: number | null;
}

/**
 * A row per department or person, a column per stage.
 *
 * Every count is a button, not a figure: the number and the list behind it are
 * counted from the same set, so clicking 4 shows exactly those four. A figure
 * you cannot open is a figure you have to take on trust.
 */
function RowTable({
  heading,
  rows,
  stages,
  loading,
  activeId,
  activeStage,
  onDrill,
  onDrillStage,
  onExport,
  exporting,
}: {
  heading: string;
  rows: Row[];
  stages: Stage[];
  loading: boolean;
  activeId?: string;
  activeStage?: StageKey;
  onDrill: (r: Row) => void;
  onDrillStage: (r: Row, stage: StageKey) => void;
  onExport: () => void;
  exporting: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2">
        <span className="label-caps">{heading}</span>
        <Button size="sm" variant="ghost" onClick={onExport} disabled={exporting || rows.length === 0}>
          <Download className="size-3" aria-hidden /> {exporting ? "Preparing…" : "CSV"}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="label-caps w-10 px-3 py-2.5 text-right">#</th>
              <th className="label-caps px-3 py-2.5">{heading}</th>
              {stages.map((s) => (
                <th key={s.key} className="label-caps px-2 py-2.5 text-right whitespace-nowrap">
                  {s.label}
                </th>
              ))}
              <th className="label-caps px-2 py-2.5 text-right">Overdue</th>
              <th className="label-caps px-2 py-2.5 text-right">On time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                className={cn(
                  "border-b border-border last:border-b-0 hover:bg-muted/40",
                  activeId === r.id && "bg-muted/60",
                )}
              >
                <td className="px-3 py-2 text-right text-2xs tabular text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onDrill(r)}
                    className="text-left text-sm font-medium hover:underline"
                  >
                    {r.label}
                  </button>
                </td>
                {stages.map((s) => {
                  const n = r.stages[s.key] ?? 0;
                  const selected = activeId === r.id && activeStage === s.key;
                  return (
                    <td key={s.key} className="px-2 py-2 text-right">
                      <button
                        type="button"
                        disabled={n === 0}
                        onClick={() => onDrillStage(r, s.key)}
                        aria-label={`${n} ${s.label} for ${r.label}`}
                        className={cn(
                          "min-w-6 rounded px-1 text-xs tabular transition-colors",
                          n === 0 && "cursor-default text-muted-foreground/40",
                          n > 0 && "hover:bg-primary/10 hover:text-foreground",
                          selected && "bg-primary/15 font-semibold",
                          n > 0 && s.key === "blocked" && "text-danger",
                          n > 0 && s.key === "rejected" && "text-warning",
                        )}
                      >
                        {n}
                      </button>
                    </td>
                  );
                })}
                <td
                  className={cn(
                    "px-2 py-2 text-right text-xs tabular",
                    r.overdue > 0 && "font-medium text-danger",
                  )}
                >
                  {r.overdue}
                </td>
                <td className="px-2 py-2 text-right text-xs tabular">
                  {r.onTimePercent === null ? "—" : `${r.onTimePercent}%`}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={stages.length + 4}
                  className="px-4 py-10 text-center text-xs text-muted-foreground"
                >
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
