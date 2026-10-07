"use client";

import { usePendingNav } from "./pending-nav";
import { CanvasPendingView } from "./pending-views";

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
  // Inline, so a production build drops the pending branch and what it imports.
  const pending = process.env.NODE_ENV === "development" && view?.scope === "canvas" ? view : null;
  return (
    <>
      {pending ? (
        <div data-slot="canvas-pending" className={PAGE_BOX}>
          <CanvasPendingView view={pending} />
        </div>
      ) : null}
      <div data-slot="canvas-page" hidden={pending !== null} className={PAGE_BOX}>
        {children}
      </div>
    </>
  );
}
