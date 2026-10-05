// Scrolls an element into view inside its own scroll container only (never every ancestor, as
// `scrollIntoView` does: that would also move the canvas the rail sits in).

function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== element.ownerDocument.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Leaves `element` alone when it is already in view; otherwise brings it to a comfortable place near the top. */
export function revealInScroller(element: HTMLElement | null | undefined, margin = 16): void {
  if (!element || element.getClientRects().length === 0) return;
  const scroller = scrollerOf(element);
  if (!scroller) return;
  const box = element.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return;
  const reduced = element.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const delta = box.height > view.height - 2 * margin ? box.top - view.top - margin : box.top - view.top - Math.min(margin * 2, (view.height - box.height) / 2);
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: reduced ? "auto" : "smooth" });
}
