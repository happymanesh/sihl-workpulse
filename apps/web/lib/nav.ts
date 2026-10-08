import type { LucideIcon } from "lucide-react";
import { Activity, ClipboardList, IdCard, ListChecks, Layers, Columns3, CalendarDays, Users, ShieldCheck, FolderKanban, BarChart3, Gauge, Flag, Radar, TriangleAlert, FileSpreadsheet, KeyRound, UserMinus } from "lucide-react";

/**
 * Single source of truth for the sidebar. Adding a screen means adding an
 * entry here, not editing the shell component.
 *
 * Only built routes appear. Rendering disabled placeholders for later-phase
 * screens would telegraph an unfinished product to anyone being shown a demo,
 * so entries land here as their routes land.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
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
      { label: "Projects", href: "/projects", icon: FolderKanban },
      { label: "My desk card", href: "/desk-card", icon: IdCard },
      { label: "My performance", href: "/performance", icon: Gauge },
    ],
  },
  {
    heading: "Administration",
    items: [
      { label: "Team workload", href: "/team", icon: Users },
      { label: "Handover", href: "/handover", icon: UserMinus },
      { label: "MIS", href: "/mis", icon: BarChart3 },
      { label: "Flags", href: "/flags", icon: Flag },
      { label: "At risk", href: "/at-risk", icon: TriangleAlert },
      { label: "Appraisal evidence", href: "/appraisal", icon: FileSpreadsheet },
      { label: "Controls", href: "/governance", icon: ShieldCheck },
      { label: "Policies & processes", href: "/governance/controls", icon: ShieldCheck },
      { label: "Desk cards", href: "/desk-cards", icon: Layers },
    ],
  },
  {
    heading: "Executive",
    items: [{ label: "Command Centre", href: "/command-centre", icon: Radar }],
  },
  {
    heading: "System",
    items: [
      { label: "Overview", href: "/", icon: Activity },
      { label: "Employees", href: "/employees", icon: ClipboardList },
      { label: "Access", href: "/access", icon: KeyRound },
    ],
  },
];
