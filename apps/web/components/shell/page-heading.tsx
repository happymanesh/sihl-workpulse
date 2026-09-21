"use client";

import { usePathname } from "next/navigation";
import { isActivePath } from "@/lib/active-path";
import { NAV_SECTIONS } from "@/lib/nav";

/**
 * Derives the header title from the nav config and the current route, so a new
 * screen gets a correct heading by virtue of being in NAV_SECTIONS - there is
 * no second list to keep in step.
 */
const FALLBACKS: { prefix: string; label: string }[] = [{ prefix: "/tasks/", label: "Task detail" }];

export function PageHeading() {
  const pathname = usePathname();

  const match = NAV_SECTIONS.flatMap((s) => s.items)
    .filter((i) => isActivePath(pathname, i.href))
    // Longest match wins, so /tasks/abc prefers /tasks over /.
    .sort((a, b) => b.href.length - a.href.length)[0];

  const fallback = FALLBACKS.find((f) => pathname.startsWith(f.prefix));
  const title = match?.label ?? fallback?.label ?? "workPulse";

  return (
    <div className="flex min-w-0 items-baseline gap-2.5">
      <h1 className="truncate text-sm font-semibold">{title}</h1>
    </div>
  );
}
