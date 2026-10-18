"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "workpulse-sidebar-collapsed";

/**
 * Whether the sidebar is collapsed to an icon rail.
 *
 * Stored in the browser and read through useSyncExternalStore, the same way
 * the theme is: the server snapshot is always "expanded", which is what the
 * markup renders with, so hydration matches and the stored preference applies
 * immediately afterwards. Mirroring it into component state in an effect would
 * flash the wrong width on every page load.
 *
 * Per browser, deliberately - it is a preference about this screen, not about
 * this person, and somebody on a laptop and a 27-inch monitor wants different
 * answers on each.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private browsing or blocked site data - the menu simply stays expanded.
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

export function setSidebarCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
  listeners.forEach((notify) => notify());
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
