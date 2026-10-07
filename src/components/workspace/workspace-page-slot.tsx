"use client";

import { useRef } from "react";
import { pendingViews, useBlurWhenHidden } from "@/components/app-shell/canvas-pages";
import { usePendingNav } from "@/components/app-shell/pending-nav";

/**
 * Where the template layout puts its tab's cells. Between a click on another tab of this template and
 * the moment the tab's page arrives (development only: see pending-nav.tsx), it shows that tab's
 * skeleton in the same grid cells and hides the tab being left; the header and the tab bar stay.
 */
export function WorkspacePageSlot({ children }: { children: React.ReactNode }) {
  const { view } = usePendingNav();
  const pageRef = useRef<HTMLDivElement>(null);
  const tab = process.env.NODE_ENV === "development" && pendingViews && view?.scope === "workspace" ? view.tab : null;
  useBlurWhenHidden(pageRef, tab !== null);
  // In production there are no pending views: the cells are the grid's own children, as they always were.
  // Inline, so the rest folds away there.
  if (process.env.NODE_ENV !== "development" || !pendingViews) return children;
  return (
    <>
      {tab ? <pendingViews.WorkspaceTabPending tab={tab} /> : null}
      {/* `contents`: the page's cells stay the grid's own children. */}
      <div ref={pageRef} data-slot="workspace-page" hidden={tab !== null} className="contents">
        {children}
      </div>
    </>
  );
}
