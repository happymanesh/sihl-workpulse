"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath } from "@/lib/active-path";
import { visibleSections } from "@/lib/nav";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const me = trpc.meta.me.useQuery();
  // Until the session resolves, show only what everyone sees. Rendering the
  // full menu and then removing entries is worse than revealing them late.
  const sections = visibleSections(me.data?.roles ?? [], me.data?.hiddenNavKeys ?? []);

  return (
    <nav
      aria-label="Primary"
      className={cn("flex flex-col gap-5 py-4", collapsed ? "px-2" : "px-3")}
    >
      {sections.map((section, i) => (
        <div key={section.heading ?? `group-${i}`} className="flex flex-col gap-1">
          {section.heading &&
            (collapsed ? (
              // A rule instead of the heading: the grouping is still legible
              // at 56px, and the words would not be.
              <div className="mx-2 mb-1 border-t border-border" aria-hidden />
            ) : (
              <div className="label-caps px-2 pb-1">{section.heading}</div>
            ))}
          {section.items.map(({ label, href, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                // The label is the tooltip when it is not on screen, so the
                // rail stays usable for somebody who does not know the icons.
                title={collapsed ? label : undefined}
                className={cn(
                  "flex items-center rounded-md py-1.5 text-sm transition-colors",
                  collapsed ? "justify-center px-0" : "gap-2.5 px-2",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {collapsed ? <span className="sr-only">{label}</span> : label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
