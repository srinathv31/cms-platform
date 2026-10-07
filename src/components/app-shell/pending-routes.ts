import type { NavKey } from "./nav";

// What the canvas shows between a click on an in-app link and the moment the server's page arrives.
// Pure: the address being left and the address being opened decide it (see pending-nav.tsx).
//
// Two scopes. A page in its own right (Library, a template, a review) replaces the whole canvas with
// its skeleton. A tab of the template already open keeps the workspace's header and tab bar and only
// swaps the tab's cells, the way the template layout stays mounted when the tab changes.

/** The template workspace's tabs, by the segment after the template's address (none for Content). */
export type WorkspaceTab = "content" | "versions" | "usage" | "activity";

export type PendingView =
  | { scope: "canvas"; page: "library" | "review" | "usage" | "audit" | "review-version" }
  | { scope: "canvas"; page: "template"; tab: WorkspaceTab }
  | { scope: "workspace"; tab: WorkspaceTab };

const TAB_BY_SEGMENT: Record<string, WorkspaceTab> = {
  versions: "versions",
  usage: "usage",
  activity: "activity",
};

const segments = (pathname: string) => pathname.split("/").filter(Boolean);

/**
 * The pending view for opening `to` from `from` (both pathnames), or null for an address that has
 * none: the settings modal (it opens over the page and must leave the canvas alone), a team's home
 * (a redirect), and anything outside a team.
 */
export function pendingViewFor(to: string, from: string): PendingView | null {
  const [team, section, ...rest] = segments(to);
  if (!team || !section) return null;
  switch (section) {
    case "library":
    case "usage":
    case "audit":
      return rest.length === 0 ? { scope: "canvas", page: section } : null;
    case "review":
      if (rest.length === 0) return { scope: "canvas", page: "review" };
      return rest.length === 2 ? { scope: "canvas", page: "review-version" } : null;
    case "templates": {
      const [templateId, tabSegment, ...more] = rest;
      if (!templateId || more.length > 0) return null;
      const tab = tabSegment === undefined ? "content" : TAB_BY_SEGMENT[tabSegment];
      if (!tab) return null;
      const [fromTeam, fromSection, fromTemplate] = segments(from);
      const sameTemplate = fromTeam === team && fromSection === "templates" && fromTemplate === templateId;
      return sameTemplate ? { scope: "workspace", tab } : { scope: "canvas", page: "template", tab };
    }
    default:
      return null;
  }
}

/** The sidebar item a pending view belongs to; null when it stays inside the template already open. */
export function navKeyOf(view: PendingView): NavKey | null {
  if (view.scope === "workspace") return null;
  switch (view.page) {
    case "library":
    case "template":
      return "library";
    case "review":
    case "review-version":
      return "review";
    default:
      return view.page;
  }
}
