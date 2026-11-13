"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, Check } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/**
 * What happened while you were elsewhere.
 *
 * Separate from the chat-hub bell beside it: that one is visitor conversations
 * coming in from outside, this one is your own work moving. Merging them would
 * put two unrelated queues behind one number.
 *
 * Polled rather than pushed. A socket would be better and workPulse has no
 * socket layer; a 60-second poll of a single indexed count is cheap and honest,
 * and the moment there is a push channel this is the only place to change.
 */
const POLL_MS = 60_000;
const COUNT_CAP = 99;

function relative(iso: string | Date): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const count = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: POLL_MS,
    // Someone coming back to the tab wants the number to be right immediately,
    // not up to a minute later.
    refetchOnWindowFocus: true,
  });

  const list = trpc.notification.mine.useQuery({ unreadOnly: false, limit: 20 }, { enabled: open });

  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.unreadCount.invalidate();
      utils.notification.mine.invalidate();
    },
  });

  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.unreadCount.invalidate();
      utils.notification.mine.invalidate();
    },
  });

  const unread = count.data ?? 0;
  const items = list.data ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-danger-foreground tabular">
            {unread > COUNT_CAP ? `${COUNT_CAP}+` : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Clicking anywhere else closes it. Behind the panel, so it never
              swallows a click meant for a notification. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-lg border border-border bg-card shadow-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="label-caps">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="text-2xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {list.isLoading && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>}

              {!list.isLoading && items.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  Nothing yet. You will be told here when work is assigned to you, sent back, or verified.
                </p>
              )}

              {items.map((n) => (
                <Link
                  key={n.id}
                  href={n.entityType === "Task" ? `/tasks/${n.entityId}` : "#"}
                  onClick={() => {
                    if (!n.readAt) markRead.mutate({ id: n.id });
                    setOpen(false);
                  }}
                  className={cn(
                    "flex gap-2.5 border-b border-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40",
                    !n.readAt && "bg-info-subtle/30",
                  )}
                >
                  <span
                    className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-info")}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={cn("text-xs", !n.readAt && "font-medium")}>{n.title}</span>
                    {n.body && <span className="text-2xs text-muted-foreground">{n.body}</span>}
                    <span className="text-2xs text-muted-foreground">
                      {n.actor?.name ? `${n.actor.name} · ` : ""}
                      {relative(n.createdAt)}
                    </span>
                  </span>
                  {n.readAt && <Check className="ml-auto mt-1 size-3 shrink-0 text-muted-foreground" aria-hidden />}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
