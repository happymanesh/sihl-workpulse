"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleUser, LifeBuoy, LogOut, Settings, UserRound } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/**
 * Who you are, and the few things that belong beside that.
 *
 * Sign out is the interesting one. workPulse has no login of its own - the
 * session belongs to Synapse and is shared across the origin - so signing out
 * here cannot and must not destroy it. What it does is leave workPulse and
 * return you to Synapse, still signed in. The menu says so plainly, because a
 * control labelled "sign out" that leaves you authenticated elsewhere is worse
 * than no control at all.
 */
export function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = trpc.meta.me.useQuery();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const user = me.data;
  const initials =
    user?.fullName
      ?.split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() ?? "?";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        className={cn(
          "flex size-8 items-center justify-center rounded-full border border-border bg-card text-2xs font-semibold",
          "hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
        )}
      >
        {user ? initials : <CircleUser className="size-4 text-muted-foreground" aria-hidden />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="flex flex-col gap-0.5 border-b border-border px-3.5 py-3">
            <span className="text-sm font-medium">{user?.fullName ?? "Signing in…"}</span>
            <span className="text-2xs text-muted-foreground">{user?.username}</span>
            {user && user.roles.length > 0 && (
              <span className="mt-1 text-2xs tabular text-muted-foreground">
                {user.roles.join(" · ").toLowerCase()}
              </span>
            )}
            {user?.isEmployeeUnlinked && (
              <span className="mt-1 text-2xs text-warning">
                Not linked to an employee record — your tasks and desk card will be empty.
              </span>
            )}
          </div>

          <div className="flex flex-col py-1">
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-xs hover:bg-muted"
            >
              <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
              Your profile
            </Link>
            <Link
              href="/profile#preferences"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-xs hover:bg-muted"
            >
              <Settings className="size-3.5 text-muted-foreground" aria-hidden />
              Settings
            </Link>
            <Link
              href="/profile#support"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-xs hover:bg-muted"
            >
              <LifeBuoy className="size-3.5 text-muted-foreground" aria-hidden />
              Help and support
            </Link>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border px-3.5 py-2.5">
            <span className="label-caps">Appearance</span>
            <ThemeToggle />
          </div>

          <div className="border-t border-border p-1.5">
            <a
              href="/api/leave"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-xs hover:bg-muted"
            >
              <LogOut className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="flex flex-col gap-0.5">
                <span>Sign out of workPulse</span>
                <span className="text-2xs text-muted-foreground">
                  Takes you back to Synapse. You stay signed in there.
                </span>
              </span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
