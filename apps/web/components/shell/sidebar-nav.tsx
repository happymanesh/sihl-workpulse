"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath } from "@/lib/active-path";
import { visibleSections } from "@/lib/nav";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export function SidebarNav() {
  const pathname = usePathname();
  const me = trpc.meta.me.useQuery();
  // Until the session resolves, show only what everyone sees. Rendering the
  // full menu and then removing entries is worse than revealing them late.
  const sections = visibleSections(me.data?.roles ?? [], me.data?.hiddenNavKeys ?? []);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5 px-3 py-4">
      {sections.map((section, i) => (
        <div key={section.heading ?? `group-${i}`} className="flex flex-col gap-1">
          {section.heading && <div className="label-caps px-2 pb-1">{section.heading}</div>}
          {section.items.map(({ label, href, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
