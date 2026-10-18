"use client";

import { useEffect } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";
import { setSidebarCollapsed, useSidebarCollapsed } from "./sidebar-state";
import { cn } from "@/lib/utils";

/**
 * The sidebar, collapsible to an icon rail.
 *
 * Collapsed it keeps the icons rather than disappearing: somebody who works in
 * one screen all day wants the width back, not a menu they have to summon
 * before they can see where they are. The labels come back as tooltips, and
 * the current page stays highlighted either way.
 */
export function Sidebar() {
  const collapsed = useSidebarCollapsed();

  // Ctrl/Cmd+B, as in every editor these people already use. Bound on the
  // window rather than the button so it works wherever focus happens to be.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed(!collapsed);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed]);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150 md:flex",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div
        className={cn(
          "flex h-12 items-center border-b border-border",
          collapsed ? "justify-center px-0" : "gap-2 px-4",
        )}
      >
        {!collapsed && (
          <>
            <span className="text-sm font-semibold tracking-tight">workPulse</span>
            <span className="label-caps">SIHL</span>
          </>
        )}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={`${collapsed ? "Expand" : "Collapse"} menu  (Ctrl+B)`}
          onClick={() => setSidebarCollapsed(!collapsed)}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            !collapsed && "ml-auto",
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <SidebarNav collapsed={collapsed} />
      </div>
    </aside>
  );
}
