// Where the `/` menu and the `{{` picker live, and making room for them.
//
// They render inside the editor's own wrapper (`.ucomp-editor`, or an inline field's box), so
// they sit within the host page's landmarks (axe "region"), and position themselves with a fixed
// strategy (Floating UI accounts for any transformed ancestor).
//
// A menu opens below the caret. When there isn't room below and the nearest scroll container
// can scroll further, it scrolls (smoothly) to make room first, keeping the caret's line in view;
// only when scrolling can't make room does the menu flip above.

import type { Editor } from "@tiptap/core";
import { viewDom } from "../lib/editor-view";

const VIEWPORT_PADDING = 8;
const SCROLL_SETTLE_MS = 450;

/** The element menus are portalled into. */
export function menuContainer(editor: Editor): HTMLElement {
  const dom = viewDom(editor);
  return dom?.closest<HTMLElement>(".ucomp-editor, .ucomp-field") ?? document.body;
}

function scrollParent(el: Element): HTMLElement {
  const doc = el.ownerDocument;
  for (let node = el.parentElement; node && node !== doc.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return (doc.scrollingElement as HTMLElement | null) ?? doc.documentElement;
}

/**
 * Scrolls so a menu of `height` fits below `anchor` (+ `gap`). Calls `ready` once there's room (at
 * once when there already was, after the scroll otherwise, or at once when scrolling can't help).
 * Returns a cancel function.
 */
export function makeRoomBelow(context: Element, anchor: DOMRect | null, height: number, gap: number, ready: () => void): () => void {
  if (!anchor || height <= 0) {
    ready();
    return () => {};
  }
  const doc = context.ownerDocument;
  const win = doc.defaultView;
  const container = scrollParent(context);
  const isPage = container === doc.scrollingElement || container === doc.documentElement;
  const viewportBottom = win?.innerHeight ?? 0;
  const box = isPage ? { top: 0, bottom: viewportBottom } : container.getBoundingClientRect();
  const visibleTop = Math.max(box.top, 0);
  const visibleBottom = Math.min(box.bottom, viewportBottom);

  const needed = Math.ceil(anchor.bottom + gap + height + VIEWPORT_PADDING - visibleBottom);
  const canScroll = container.scrollHeight - container.clientHeight - container.scrollTop;
  // The caret's line must stay in view after the scroll.
  const keepsCaret = anchor.top - needed >= visibleTop + VIEWPORT_PADDING;
  if (needed <= 0 || canScroll < needed || !keepsCaret) {
    ready();
    return () => {};
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    target.removeEventListener("scrollend", finish);
    clearTimeout(timer);
    ready();
  };
  const target: EventTarget = isPage && win ? win : container;
  target.addEventListener("scrollend", finish);
  const timer = setTimeout(finish, SCROLL_SETTLE_MS);
  const reduce = win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  container.scrollBy({ top: needed, behavior: reduce ? "auto" : "smooth" });
  return () => {
    done = true;
    target.removeEventListener("scrollend", finish);
    clearTimeout(timer);
  };
}
