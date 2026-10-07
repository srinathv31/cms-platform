"use client";

import { usePendingNav } from "@/components/app-shell/pending-nav";
import { WorkspaceTabPending } from "@/components/app-shell/pending-views";

/**
 * Where the template layout puts its tab's cells. Between a click on another tab of this template and
 * the moment the tab's page arrives (development only: see pending-nav.tsx), it shows that tab's
 * skeleton in the same grid cells and hides the tab being left; the header and the tab bar stay.
 */
export function WorkspacePageSlot({ children }: { children: React.ReactNode }) {
  const { view } = usePendingNav();
  // Inline, so a production build drops the pending branch and what it imports: there the cells are
  // the grid's own children, as they always were.
  if (process.env.NODE_ENV !== "development") return children;
  const tab = view?.scope === "workspace" ? view.tab : null;
  return (
    <>
      {tab ? <WorkspaceTabPending tab={tab} /> : null}
      {/* `contents`: the page's cells stay the grid's own children. */}
      <div data-slot="workspace-page" hidden={tab !== null} className="contents">
        {children}
      </div>
    </>
  );
}
