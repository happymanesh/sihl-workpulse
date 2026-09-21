"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type View = "day" | "week" | "month";

const DAY_START = 8; // 08:00
const DAY_END = 20; // 20:00
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const iso = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - (iso - 1));
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtRange(from: Date, to: Date, view: View): string {
  if (view === "day") return from.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  if (view === "month") return from.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `${from.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${addDays(to, -1).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

export default function CalendarPage() {
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);

  const { from, to, days } = useMemo(() => {
    if (view === "day") {
      const f = new Date(anchor);
      f.setHours(0, 0, 0, 0);
      return { from: f, to: addDays(f, 1), days: [f] };
    }
    if (view === "month") {
      const f = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const t = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
      const grid = startOfWeek(f);
      return {
        from: grid,
        to: t,
        days: Array.from({ length: 42 }, (_, i) => addDays(grid, i)).filter((d) => d < addDays(t, 7)),
      };
    }
    const f = startOfWeek(anchor);
    return { from: f, to: addDays(f, 7), days: Array.from({ length: 5 }, (_, i) => addDays(f, i)) };
  }, [view, anchor]);

  const blocks = trpc.calendar.blocks.useQuery({ from, to });
  const util = trpc.calendar.myUtilisation.useQuery({});
  const tasks = trpc.task.mine.useQuery({ includeClosed: false });

  const remove = trpc.calendar.deleteBlock.useMutation({
    onSuccess: () => {
      utils.calendar.blocks.invalidate();
      utils.calendar.myUtilisation.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const step = (dir: number) => {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, dir * 7));
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
  };

  if (blocks.error) {
    const unauthorised = blocks.error.data?.code === "UNAUTHORIZED";
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">{unauthorised ? "Sign in to continue" : "Could not load your calendar"}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {unauthorised ? "workPulse uses your Synapse session." : blocks.error.message}
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button size="icon" variant="outline" onClick={() => step(1)} aria-label="Next">
            <ChevronRight />
          </Button>
          <span className="ml-1 text-sm font-medium">{fmtRange(from, to, view)}</span>
        </div>

        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded px-2.5 py-1 text-xs capitalize transition-colors",
                view === v ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {util.data && <UtilisationBar util={util.data} />}

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">{error}</div>
      )}

      <BlockForm
        tasks={tasks.data ?? []}
        onDone={() => {
          utils.calendar.blocks.invalidate();
          utils.calendar.myUtilisation.invalidate();
        }}
        onError={setError}
      />

      {view === "month" ? (
        <MonthGrid days={days} anchorMonth={anchor.getMonth()} blocks={blocks.data ?? []} />
      ) : (
        <TimeGrid days={days} blocks={blocks.data ?? []} onDelete={(id) => remove.mutate({ id })} />
      )}
    </div>
  );
}

interface Block {
  id: string;
  title: string | null;
  startAt: string | Date;
  endAt: string | Date;
  task: { id: string; reference: string; title: string; priority: string; status: string } | null;
}

/** Mirrors CalendarService.utilisationFor. Declared rather than inferred from
 *  the hook, which does not resolve cleanly through the nullable return. */
interface UtilisationData {
  hasBudget: boolean;
  budgetMinutes: number;
  committedMinutes: number;
  blockedMinutes: number;
  percent: number;
  isOverAllocated: boolean;
}

function UtilisationBar({ util }: { util: UtilisationData }) {
  const pct = Math.min(util.percent, 100);
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="label-caps">Committed this week</span>
          <span className={cn("text-sm font-semibold tabular", util.isOverAllocated && "text-danger")}>
            {(util.committedMinutes / 60).toFixed(1)}h
            {util.hasBudget && ` of ${(util.budgetMinutes / 60).toFixed(0)}h · ${util.percent}%`}
          </span>
        </div>

        {util.hasBudget ? (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", util.isOverAllocated ? "bg-danger" : "bg-success")}
                style={{ width: `${pct}%` }}
              />
            </div>
            {util.isOverAllocated && (
              <p className="text-2xs text-danger">
                Over capacity. This is a flag, not a block — assignment is still a judgement call.
              </p>
            )}
          </>
        ) : (
          <p className="text-2xs text-muted-foreground">
            No weekly capacity budget set, so utilisation cannot be calculated. A manager sets this.
          </p>
        )}

        <p className="text-2xs text-muted-foreground">
          Committed comes from your desk card&apos;s approved activities. Blocked time this week:{" "}
          <span className="tabular">{(util.blockedMinutes / 60).toFixed(1)}h</span>.
        </p>
      </CardContent>
    </Card>
  );
}

function BlockForm({
  tasks,
  onDone,
  onError,
}: {
  tasks: { id: string; title: string; reference: string }[];
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [taskId, setTaskId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");

  const create = trpc.calendar.createBlock.useMutation({
    onSuccess: onDone,
    onError: (e) => onError(e.message),
  });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3">
        <Field label="Task" htmlFor="bt" className="min-w-52 flex-1">
          <Select id="bt" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">Select a task…</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.reference} · {t.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="bd">
          <Input id="bd" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="From" htmlFor="bs">
          <Input id="bs" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="To" htmlFor="be">
          <Input id="be" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Button
          size="md"
          disabled={!taskId || create.isPending}
          onClick={() =>
            create.mutate({
              taskId,
              startAt: new Date(`${date}T${start}:00`),
              endAt: new Date(`${date}T${end}:00`),
            })
          }
        >
          {create.isPending ? "Blocking…" : "Block time"}
        </Button>
      </CardContent>
    </Card>
  );
}

function TimeGrid({
  days,
  blocks,
  onDelete,
}: {
  days: Date[];
  blocks: Block[];
  onDelete: (id: string) => void;
}) {
  const rowHeight = 40;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid border-b border-border" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
            <div />
            {days.map((d) => (
              <div key={d.toISOString()} className="border-l border-border px-2 py-1.5 text-center">
                <div className="label-caps">{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                <div className="text-sm font-medium tabular">{d.getDate()}</div>
              </div>
            ))}
          </div>

          <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
            <div>
              {HOURS.map((h) => (
                <div key={h} className="border-b border-border pr-2 text-right" style={{ height: rowHeight }}>
                  <span className="font-mono text-2xs text-muted-foreground">{String(h).padStart(2, "0")}:00</span>
                </div>
              ))}
            </div>

            {days.map((day) => {
              const dayBlocks = blocks.filter((b) => new Date(b.startAt).toDateString() === day.toDateString());
              return (
                <div key={day.toISOString()} className="relative border-l border-border">
                  {HOURS.map((h) => (
                    <div key={h} className="border-b border-border" style={{ height: rowHeight }} />
                  ))}

                  {dayBlocks.map((b) => {
                    const s = new Date(b.startAt);
                    const e = new Date(b.endAt);
                    const topMin = (s.getHours() - DAY_START) * 60 + s.getMinutes();
                    const durMin = (e.getTime() - s.getTime()) / 60_000;
                    if (topMin < 0) return null;

                    return (
                      <div
                        key={b.id}
                        className="group absolute inset-x-1 overflow-hidden rounded border border-primary/30 bg-primary/10 px-1.5 py-1"
                        style={{ top: (topMin / 60) * rowHeight, height: Math.max((durMin / 60) * rowHeight, 18) }}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="truncate text-2xs font-medium leading-tight">
                            {b.task?.title ?? b.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => onDelete(b.id)}
                            aria-label="Remove block"
                            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <Trash2 className="size-3 text-muted-foreground hover:text-danger" />
                          </button>
                        </div>
                        {b.task && durMin >= 45 && (
                          <Link href={`/tasks/${b.task.id}`} className="block truncate font-mono text-2xs text-muted-foreground hover:underline">
                            {b.task.reference}
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function MonthGrid({ days, anchorMonth, blocks }: { days: Date[]; anchorMonth: number; blocks: Block[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="label-caps border-l border-border px-2 py-1.5 text-center first:border-l-0">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayBlocks = blocks.filter((b) => new Date(b.startAt).toDateString() === day.toDateString());
          const otherMonth = day.getMonth() !== anchorMonth;
          const minutes = dayBlocks.reduce(
            (t, b) => t + (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60_000,
            0,
          );
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-20 border-b border-l border-border p-1.5",
                otherMonth && "bg-muted/30 text-muted-foreground",
              )}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs tabular">{day.getDate()}</span>
                {minutes > 0 && <span className="text-2xs tabular text-muted-foreground">{(minutes / 60).toFixed(1)}h</span>}
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {dayBlocks.slice(0, 3).map((b) => (
                  <span key={b.id} className="truncate rounded bg-primary/10 px-1 py-0.5 text-2xs">
                    {b.task?.title ?? b.title}
                  </span>
                ))}
                {dayBlocks.length > 3 && (
                  <span className="text-2xs text-muted-foreground">+{dayBlocks.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
