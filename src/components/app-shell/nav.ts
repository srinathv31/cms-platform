import { ChartColumn, ClipboardCheck, Library, ScrollText, type LucideIcon } from "lucide-react";

export type NavKey = "library" | "review" | "usage" | "audit";

export interface NavItem {
  key: NavKey;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "library", label: "Library", icon: Library },
  { key: "review", label: "Review", icon: ClipboardCheck },
  { key: "usage", label: "Usage", icon: ChartColumn },
  { key: "audit", label: "Audit", icon: ScrollText },
];

/** Shared look of a sidebar row: used by the real links and by their skeletons, so geometry matches. */
export const NAV_ROW =
  "relative h-9 gap-3 rounded-lg px-3 text-[15px] font-normal text-text [&_svg]:size-5 [&_svg]:text-text-muted";

export const NAV_ICON_STROKE = 1.75;
