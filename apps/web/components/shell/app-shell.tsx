import * as React from "react";
import { Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";

/**
 * Application chrome: collapsible sidebar, sticky page header, scrolling
 * content.
 *
 * The header is a slot rather than a prop-driven title bar because MIS and
 * task screens need filters, view switchers and actions in it - baking in a
 * single title-plus-button shape now would be undone in Phase 1.
 */
export function AppShell({
  children,
  header,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-border bg-background/95 px-5 backdrop-blur">
          {header}
          {/* Account, settings, support and sign-out live top right, where
              people look for them. Theme moved in here too rather than sitting
              at the bottom of the sidebar. */}
          <div className="ml-auto flex items-center gap-2">
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 px-5 py-6">{children}</main>
      </div>
    </div>
  );
}

/** Page title for the header slot, kept here so spacing stays consistent. */
export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2.5">
      <h1 className="truncate text-sm font-semibold">{title}</h1>
      {description && (
        <p className="hidden truncate text-xs text-muted-foreground sm:block">{description}</p>
      )}
    </div>
  );
}
