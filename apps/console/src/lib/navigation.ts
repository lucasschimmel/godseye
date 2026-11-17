import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Box,
  CircleDollarSign,
  GitBranch,
  Inbox,
  ListChecks,
  MessageSquare,
  ScrollText,
  Server,
  SlidersHorizontal,
} from "lucide-react";

export type NavKey =
  | "today"
  | "projects"
  | "hermes"
  | "server"
  | "delivery"
  | "data"
  | "jobs"
  | "costs"
  | "journal"
  | "settings";

export interface NavItem {
  key: NavKey;
  label: string;
  to: string;
  icon: LucideIcon;
  /** Second key of the "G then X" shortcut. */
  shortcut: string;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Pilotage",
    items: [
      { key: "today", label: "Aujourd’hui", to: "/", icon: Inbox, shortcut: "A" },
      { key: "projects", label: "Projets", to: "/projects", icon: Box, shortcut: "P" },
      { key: "hermes", label: "Hermes", to: "/hermes", icon: MessageSquare, shortcut: "H" },
    ],
  },
  {
    label: "Plateforme",
    items: [
      { key: "server", label: "Serveur", to: "/platform/server", icon: Server, shortcut: "S" },
      {
        key: "delivery",
        label: "Livraison",
        to: "/platform/delivery",
        icon: GitBranch,
        shortcut: "L",
      },
      { key: "data", label: "Données", to: "/platform/data", icon: Archive, shortcut: "D" },
      { key: "jobs", label: "Jobs", to: "/platform/jobs", icon: ListChecks, shortcut: "T" },
    ],
  },
  {
    label: "Suivi",
    items: [
      { key: "costs", label: "Coûts", to: "/costs", icon: CircleDollarSign, shortcut: "C" },
      { key: "journal", label: "Journal", to: "/journal", icon: ScrollText, shortcut: "J" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  key: "settings",
  label: "Réglages",
  to: "/settings",
  icon: SlidersHorizontal,
  shortcut: "R",
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

/** The navigation entry that owns a pathname; project pages belong to "Projets". */
export function activeNavItem(pathname: string): NavItem | undefined {
  if (pathname === "/") return ALL_NAV_ITEMS[0];
  return ALL_NAV_ITEMS.filter((item) => item.to !== "/").find((item) =>
    pathname.startsWith(item.to),
  );
}
