"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { DueDate, PriorityTag, StatusBadge, statusLabel, type Priority, type TaskStatus } from "@/components/task/task-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NewTask } from "@/components/task/new-task";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type View = "open" | "all";

/**
 * Status chips, in lifecycle order rather than alphabetical, so the row reads
 * left to right the way work actually moves. Only statuses you actually have
 * are offered - a chip reading zero is a chip nobody needs.
 */
const STATUS_ORDER: TaskStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "BLOCKED",
  "PENDING_REVIEW",
  "COMPLETED",
  "VERIFIED",
  "REJECTED",
  "REOPENED",
  "ON_HOLD",
  "DEFERRED",
  "CLOSED",
  "CANCELLED",
  "DRAFT",
];

/** yyyy-mm-dd in local time, which is what a date input expects. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default function MyTasksPage() {
  const [view, setView] = useState<View>("open");
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [from, setFrom] = useState(() => isoDay(daysAgo(90)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [search, setSearch] = useState("");

  const counts = trpc.task.myStatusCounts.useQuery();

  const query = trpc.task.mine.useQuery({
    includeClosed: view === "all",
    statuses: statuses.length ? statuses : undefined,
    from: from ? new Date(`${from}T00:00:00`) : undefined,
    // Inclusive of the whole closing day: a range ending today should contain
    // work created this afternoon.
    to: to ? new Date(`${to}T23:59:59.999`) : undefined,
    search: search.trim() || undefined,
  });

  const offered = useMemo(
    () => STATUS_ORDER.filter((s) => (counts.data?.byStatus[s] ?? 0) > 0),
    [counts.data],
  );

  function toggleStatus(s: TaskStatus) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  const filtered = statuses.length > 0 || search.trim().length > 0;

  function clearAll() {
    setStatuses([]);
    setSearch("");
    setFrom(isoDay(daysAgo(90)));
    setTo(isoDay(new Date()));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The action sits in its own row above the filters. Keeping it inside
          the filter row made the filters jump sideways when the New task form
          opened, which is what testing reported. */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">My tasks</h1>
        <NewTask
          onCreated={() => {
            query.refetch();
            counts.refetch();
          }}
        />
      </div>

      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(["open", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setView(v);
                  setStatuses([]);
                }}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  view === v && statuses.length === 0
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "open" ? "Open" : "All"}
                {v === "open" && counts.data ? ` (${counts.data.open})` : ""}
                {v === "all" && counts.data ? ` (${counts.data.total})` : ""}
              </button>
            ))}
          </div>

          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, reference or description"
              aria-label="Search my tasks"
              className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-2.5 text-xs"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-2xs text-muted-foreground" htmlFor="from">
              Created
            </label>
            <input
              id="from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 rounded-md border border-input bg-card px-2 text-xs"
            />
            <span className="text-2xs text-muted-foreground">to</span>
            <input
              type="date"
              value={to}
              min={from}
              aria-label="Created to"
              onChange={(e) => setTo(e.target.value)}
              className="h-8 rounded-md border border-input bg-card px-2 text-xs"
            />
          </div>

          {filtered && (
            <Button size="sm" variant="ghost" onClick={clearAll}>
              <X className="size-3" aria-hidden /> Clear
            </Button>
          )}
        </div>

        {offered.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
            {offered.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
                  statuses.includes(s)
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                  // Rejected is work waiting on you. It is out of the Open
                  // count now, so it has to be visible here instead.
                  s === "REJECTED" && !statuses.includes(s) && "border-danger/40 text-danger",
                )}
              >
                {statusLabel(s)}
                <span className="ml-1 tabular opacity-70">{counts.data?.byStatus[s] ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        <p className="text-2xs text-muted-foreground">
          The date range narrows finished work only — anything still open stays listed however old it is.
        </p>
      </Card>

      <QueryStates query={query}>
        {(tasks) =>
          tasks.length === 0 ? (
            <EmptyState view={view} filtered={filtered} onClear={clearAll} />
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
                <span className="text-2xs text-muted-foreground tabular">
                  {tasks.length} task{tasks.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="label-caps w-10 px-4 py-2.5 text-right">#</th>
                      <th className="label-caps px-4 py-2.5">Task</th>
                      <th className="label-caps px-4 py-2.5">Priority</th>
                      <th className="label-caps px-4 py-2.5">Due</th>
                      <th className="label-caps px-4 py-2.5">Status</th>
                      <th className="label-caps px-4 py-2.5">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t, i) => (
                      <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5 text-right text-2xs tabular text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <Link href={`/tasks/${t.id}`} className="group flex flex-col gap-0.5">
                            <span className="text-sm font-medium group-hover:underline">{t.title}</span>
                            <span className="font-mono text-2xs font-medium text-info">{t.reference}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <PriorityTag priority={t.priority as Priority} />
                        </td>
                        <td className="px-4 py-2.5">
                          <DueDate dueDate={t.dueDate} isOverdue={t.isOverdue} />
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={t.status as TaskStatus} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs text-muted-foreground">
                            {t.deskCardActivity ? "Desk card" : "Ad hoc"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        }
      </QueryStates>
    </div>
  );
}

function EmptyState({
  view,
  filtered,
  onClear,
}: {
  view: View;
  filtered: boolean;
  onClear: () => void;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium">
        {filtered ? "Nothing matches those filters" : view === "open" ? "Nothing open right now" : "No tasks yet"}
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {filtered
          ? "Try widening the date range, or clearing the status filters."
          : "Tasks assigned to you appear here, whether created directly or generated from your desk card."}
      </p>
      {filtered && (
        <Button size="sm" variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </Card>
  );
}

/**
 * Loading, error and unauthenticated states in one place.
 *
 * The unauthenticated case gets its own treatment rather than a generic error:
 * identity lives in Synapse, so the fix is to sign in there, and the screen
 * should say so instead of showing a stack trace.
 */
function QueryStates<T>({
  query,
  children,
}: {
  query: { isLoading: boolean; error: { data?: { code?: string } | null; message: string } | null; data: T | undefined };
  children: (data: T) => React.ReactNode;
}) {
  // Error before loading: an unauthorised query can still read as "loading" on
  // a paused retry, and a skeleton that never resolves tells nobody to sign in.
  if (query.error) {
    const unauthorised = query.error.data?.code === "UNAUTHORIZED";
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <p className="text-sm font-medium">{unauthorised ? "Sign in to continue" : "Could not load your tasks"}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {unauthorised
            ? "workPulse uses your Synapse session. Sign in to Synapse, then open workPulse from the Apps menu."
            : query.error.message}
        </p>
        {unauthorised && (
          <Button asChild size="sm" variant="outline">
            <a href={process.env.NEXT_PUBLIC_SYNAPSE_URL ?? "http://localhost:3010"}>Go to Synapse</a>
          </Button>
        )}
      </Card>
    );
  }

  if (query.isLoading || query.data === undefined) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-muted" />
        ))}
      </Card>
    );
  }

  return <>{children(query.data)}</>;
}
