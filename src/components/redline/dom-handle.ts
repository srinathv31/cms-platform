// The redline as a document a host can place things beside: the DocumentEditorHandle (src/editor/README.md,
// "Comments"), answered from the redline's own DOM. The editor isn't there while Show changes is on, so the
// comment markers in the gutter, the scroll to a thread's block and the block-level comment path all need
// this stand-in. A redline block is found by `data-block-id` on its frame (RedlineDocument). A thread has
// no highlight of its own here, so a thread's box is its block's.
//
// Plain DOM, no React: the review screen puts it behind a ref (review/redline-view.tsx).

import type { CommentRequest, DocumentEditorHandle } from "@/editor";

export interface RedlineHandleSource {
  /** The element the redline renders in (null before it mounts). */
  root: () => HTMLElement | null;
  /** The block a thread (or the comment being written) is about, or null. */
  blockOfThread: (threadId: string) => string | null;
  /** A comment on a whole block was asked for (the hover button, the keyboard path). */
  onRequestComment?: (request: CommentRequest) => void;
}

/** `"` and `\` escaped, for an attribute value inside double quotes. */
const attr = (value: string) => value.replace(/["\\]/g, "\\$&");

/** The frame of a top-level block. */
export function redlineBlockElement(root: HTMLElement | null, blockId: string): HTMLElement | null {
  if (!root || !blockId) return null;
  return root.querySelector<HTMLElement>(`.ucomp-doc > [data-block-id="${attr(blockId)}"]`);
}

/** A rendered element's box, or null when it isn't laid out (missing, `display: none`, a hidden route). */
function rectOf(element: Element | null): DOMRect | null {
  if (!element || !element.isConnected || element.getClientRects().length === 0) return null;
  return element.getBoundingClientRect();
}

/** The nearest ancestor the user can scroll vertically; null when only the page scrolls. */
function scrollContainer(element: HTMLElement): HTMLElement | null {
  const doc = element.ownerDocument;
  for (let node = element.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** What the review screen keeps over the document: the sticky tab bar at the top (44px and its line), the stacked layout's decision bar below. */
const TOP = 64;
const BOTTOM = 40;

/**
 * Scrolls `element` into view inside its own scroll container only (not every ancestor, as
 * `scrollIntoView` does): left alone when it is already in view (clear of the sticky bars), otherwise
 * centered in the free band (or with its top at the band's top when it is taller than the band).
 */
export function revealInContainer(element: HTMLElement): void {
  const box = element.getBoundingClientRect();
  const container = scrollContainer(element);
  const win = element.ownerDocument.defaultView;
  const view = container ? container.getBoundingClientRect() : { top: 0, height: win?.innerHeight ?? 0 };
  const bandTop = view.top + TOP;
  const bandHeight = view.height - TOP - BOTTOM;
  if (box.top >= bandTop && box.bottom <= bandTop + bandHeight) return;
  const offset = box.height > bandHeight ? 0 : (bandHeight - box.height) / 2;
  const behavior: ScrollBehavior = win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const scroller = container ?? element.ownerDocument.scrollingElement;
  scroller?.scrollTo({ top: scroller.scrollTop + box.top - bandTop - offset, behavior });
}

export function createRedlineHandle(source: RedlineHandleSource): DocumentEditorHandle {
  const blockRect = (blockId: string) => rectOf(redlineBlockElement(source.root(), blockId));

  return {
    // Nothing in the redline takes a caret.
    focus: () => {},
    focusThread: (threadId) => {
      const blockId = source.blockOfThread(threadId);
      const element = blockId ? redlineBlockElement(source.root(), blockId) : null;
      if (element && rectOf(element)) revealInContainer(element);
    },
    getBlockRect: blockRect,
    getThreadRect: (threadId) => {
      const blockId = source.blockOfThread(threadId);
      return blockId ? blockRect(blockId) : null;
    },
    subscribeBlockRects: (listener) => {
      const root = source.root();
      if (!root) return () => {};
      let frame = 0;
      const notify = () => {
        if (frame || typeof requestAnimationFrame === "undefined") return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          listener();
        });
      };
      // Blocks move when the document resizes (width, a wrapped line, the changes switching on or off) and
      // when fonts arrive; they are also added and removed.
      const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(notify);
      resize?.observe(root);
      const mutate = typeof MutationObserver === "undefined" ? null : new MutationObserver(notify);
      mutate?.observe(root, { childList: true, subtree: true });
      const win = root.ownerDocument.defaultView;
      win?.addEventListener("resize", notify);
      void root.ownerDocument.fonts?.ready.then(notify);
      return () => {
        resize?.disconnect();
        mutate?.disconnect();
        win?.removeEventListener("resize", notify);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      };
    },
    requestComment: (blockId) => {
      if (blockId) source.onRequestComment?.({ blockId });
    },
  };
}
