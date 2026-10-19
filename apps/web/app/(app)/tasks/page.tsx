"use client";

import Link from "next/link";
import { useState } from "react";
import { DueDate, PriorityTag, StatusBadge, type Priority, type TaskStatus } from "@/components/task/task-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NewTask } from "@/components/task/new-task";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type View = "open" | "all";

export default function MyTasksPage() {
  const [view, setView] = useState<View>("open");
  const query = trpc.task.mine.useQuery({ includeClosed: view === "all" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(["open", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded px-2.5 py-1 text-xs capitalize transition-colors",
                view === v ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
        <NewTask onCreated={() => query.refetch()} />
        {query.data && (
          <span className="text-xs text-muted-foreground tabular">
            {query.data.length} task{query.data.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <QueryStates query={query}>
        {(tasks) =>
          tasks.length === 0 ? (
            <EmptyState view={view} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="label-caps px-4 py-2.5">Task</th>
                      <th className="label-caps px-4 py-2.5">Priority</th>
                      <th className="label-caps px-4 py-2.5">Due</th>
                      <th className="label-caps px-4 py-2.5">Status</th>
                      <th className="label-caps px-4 py-2.5">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5">
                          <Link href={`/tasks/${t.id}`} className="group flex flex-col gap-0.5">
                            <span className="text-sm font-medium group-hover:underline">{t.title}</span>
                            <span className="font-mono text-2xs text-muted-foreground">{t.reference}</span>
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

function EmptyState({ view }: { view: View }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium">
        {view === "open" ? "Nothing open right now" : "No tasks yet"}
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Tasks assigned to you appear here, whether created directly or generated from your desk card.
      </p>
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

  return <>{query.data !== undefined && children(query.data)}</>;
}
