import type { LucideIcon } from "lucide-react";
import { Activity, ClipboardList, IdCard, ListChecks, Layers, Columns3, CalendarDays, Users, ShieldCheck, FolderKanban, BarChart3, Gauge, Flag, Radar, TriangleAlert, FileSpreadsheet, KeyRound, UserMinus, Timer } from "lucide-react";

/**
 * Single source of truth for the sidebar. Adding a screen means adding an
 * entry here, not editing the shell component.
 *
 * Only built routes appear. Rendering disabled placeholders for later-phase
 * screens would telegraph an unfinished product to anyone being shown a demo,
 * so entries land here as their routes land.
 */
/** Mirrors the WorkPulseRole enum. Duplicated rather than imported so the web
 *  app keeps no dependency on the database package. */
export type RoleName =
  | "SYSTEM_ADMIN"
  | "EMPLOYEE"
  | "MANAGER"
  | "DEPARTMENT_HEAD"
  | "PROJECT_MANAGER"
  | "EXECUTIVE"
  | "EXECUTIVE_RESTRICTED"
  | "AUDIT"
  | "INTEGRATION_SERVICE";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Who sees this entry. Omitted means everyone.
   *
   * This is housekeeping, NOT access control - the API decides what anybody may
   * actually read, and it is unchanged by anything here. Hiding an entry only
   * spares somebody a screen that would refuse them. Never rely on it to keep
   * data from anyone.
   */
  roles?: RoleName[];
}

export interface NavSection {
  /** Omitted for the first group, which needs no heading. */
  heading?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "My tasks", href: "/tasks", icon: ListChecks },
      { label: "Board", href: "/board", icon: Columns3 },
      { label: "Calendar", href: "/calendar", icon: CalendarDays },
      { label: "Projects", href: "/projects", icon: FolderKanban, roles: ["SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD", "PROJECT_MANAGER", "EXECUTIVE", "EXECUTIVE_RESTRICTED"]  },
      { label: "My desk card", href: "/desk-card", icon: IdCard },
      { label: "My performance", href: "/performance", icon: Gauge },
    ],
  },
  {
    heading: "Administration",
    items: [
      { label: "Team workload", href: "/team", icon: Users, roles: ["SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD"]  },
      { label: "Handover", href: "/handover", icon: UserMinus, roles: ["SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD"]  },
      { label: "MIS", href: "/mis", icon: BarChart3, roles: ["SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD", "EXECUTIVE", "EXECUTIVE_RESTRICTED", "AUDIT"]  },
      { label: "Flags", href: "/flags", icon: Flag, roles: ["DEPARTMENT_HEAD", "AUDIT", "EXECUTIVE", "EXECUTIVE_RESTRICTED"]  },
      { label: "At risk", href: "/at-risk", icon: TriangleAlert, roles: ["SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD", "EXECUTIVE", "EXECUTIVE_RESTRICTED"]  },
      { label: "SLA targets", href: "/sla", icon: Timer, roles: ["SYSTEM_ADMIN", "DEPARTMENT_HEAD"]  },
      { label: "Appraisal evidence", href: "/appraisal", icon: FileSpreadsheet, roles: ["SYSTEM_ADMIN", "DEPARTMENT_HEAD", "AUDIT", "EXECUTIVE", "EXECUTIVE_RESTRICTED"]  },
      { label: "Controls", href: "/governance", icon: ShieldCheck, roles: ["SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD", "AUDIT"]  },
      { label: "Policies & processes", href: "/governance/controls", icon: ShieldCheck, roles: ["SYSTEM_ADMIN", "DEPARTMENT_HEAD"]  },
      { label: "Desk cards", href: "/desk-cards", icon: Layers, roles: ["SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD"]  },
    ],
  },
  {
    heading: "Executive",
    items: [{ label: "Command Centre", href: "/command-centre", icon: Radar, roles: ["SYSTEM_ADMIN", "EXECUTIVE", "EXECUTIVE_RESTRICTED", "AUDIT"]  }],
  },
  {
    heading: "System",
    items: [
      { label: "Overview", href: "/", icon: Activity, roles: ["SYSTEM_ADMIN"]  },
      { label: "Employees", href: "/employees", icon: ClipboardList, roles: ["SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD"]  },
      { label: "Task types", href: "/task-types", icon: ListChecks, roles: ["SYSTEM_ADMIN", "DEPARTMENT_HEAD"]  },
      { label: "Access", href: "/access", icon: KeyRound, roles: ["SYSTEM_ADMIN", "AUDIT"]  },
    ],
  },
];

/**
 * The sections a given set of roles should see.
 *
 * A section with nothing left in it is dropped entirely, so somebody with only
 * EMPLOYEE does not get an "Administration" heading above empty space.
 *
 * `hidden` is the per-person list an administrator set, by route. It subtracts
 * and only subtracts: an entry the roles do not grant cannot be brought back by
 * leaving it out of this list. Neither filter is access control - the API
 * decides what anybody may read, and a menu cannot change that.
 */
export function visibleSections(
  roles: readonly string[],
  hidden: readonly string[] = [],
): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (i) => (!i.roles || i.roles.some((r) => roles.includes(r))) && !hidden.includes(i.href),
    ),
  })).filter((section) => section.items.length > 0);
}

/** Every entry a given set of roles grants, flat - what an admin ticks through. */
export function entriesForRoles(roles: readonly string[]): NavItem[] {
  return NAV_SECTIONS.flatMap((s) => s.items).filter(
    (i) => !i.roles || i.roles.some((r) => roles.includes(r)),
  );
}
