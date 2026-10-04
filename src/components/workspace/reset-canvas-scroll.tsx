"use client";

import { useLayoutEffect } from "react";

/**
 * Starts the workspace at the top.
 *
 * The app's canvas (the scroll area in AppFrame) is one element that every page shares, so it keeps
 * its scroll position from the page before: open a template from a scrolled Library and the title
 * lands cut off. Next resets scrolling only when the new page's first element is out of view, and
 * here it is in view, so nothing resets it. A workspace layout mounts when you arrive at a template
 * (and again when a hidden one is shown), never on a tab switch or an Edit, so this runs exactly on
 * arrival. Before paint, so there is no flash of the old position.
 */
export function ResetCanvasScroll() {
  useLayoutEffect(() => {
    const canvas = document.querySelector<HTMLElement>('[data-slot="canvas-scroll"]');
    if (canvas) canvas.scrollTop = 0;
  }, []);
  return null;
}
