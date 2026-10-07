"use client";

import { useLayoutEffect, useRef } from "react";
import { usePendingNav } from "./pending-nav";

/**
 * The pending views, in development only. Required in a branch production folds away (React's own
 * index.js picks its builds this way), so their skeletons, styles and the modules they pull in never
 * reach a production chunk.
 */
export const pendingViews: typeof import("./pending-views") | null =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would ship the views to production
  process.env.NODE_ENV === "development" ? require("./pending-views") : null;

/**
 * Takes focus off a page as it is hidden for a pending view, so Tab doesn't move on from something no
 * one can see. Focus falls to the body, where it is once the new page arrives anyway.
 */
export function useBlurWhenHidden(page: React.RefObject<HTMLElement | null>, hidden: boolean) {
  useLayoutEffect(() => {
    // Inline, so production (which never hides a page this way) gets no work here.
    if (process.env.NODE_ENV !== "development" || !hidden) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && page.current?.contains(active)) active.blur();
  }, [page, hidden]);
}

/** The canvas's content column: the page, centred, up to the widest layout. */
const PAGE_BOX = "mx-auto w-full max-w-[96rem]";

/**
 * The page inside the canvas. Between a click on a wired link and the moment the page arrives
 * (development only: see pending-nav.tsx), the destination's skeleton takes the page's place, in the
 * same box, and the page being left is hidden rather than unmounted: if the navigation goes nowhere,
 * it comes straight back.
 */
export function CanvasPages({ children }: { children: React.ReactNode }) {
  const { view } = usePendingNav();
  const pageRef = useRef<HTMLDivElement>(null);
  // Inline as well as the null check, so production folds the pending branch away here too.
  const pending = process.env.NODE_ENV === "development" && pendingViews && view?.scope === "canvas" ? view : null;
  useBlurWhenHidden(pageRef, pending !== null);
  return (
    <>
      {pendingViews && pending ? (
        <div data-slot="canvas-pending" className={PAGE_BOX}>
          <pendingViews.CanvasPendingView view={pending} />
        </div>
      ) : null}
      <div ref={pageRef} data-slot="canvas-page" hidden={pending !== null} className={PAGE_BOX}>
        {children}
      </div>
    </>
  );
}
