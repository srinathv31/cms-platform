// Where blocks and thread highlights are on screen, for hosts that place markers or cards beside
// the document (DocumentEditorHandle: getBlockRect, getThreadRect, subscribeBlockRects, focusThread).
// Everything reads the editor's wrapper DOM, which the static first paint and the live editor render
// identically (`data-id` on blocks, `data-thread` / `data-thread-block` on highlights), so it works
// before the live editor mounts too. Nothing here touches the editor's view.

/** `"` and `\` escaped, for an attribute value inside double quotes. */
const attr = (value: string) => value.replace(/["\\]/g, "\\$&");

/** A rendered element's box, or null when it isn't laid out (missing, `display: none`, hidden route). */
export function rectOf(element: Element | null | undefined): DOMRect | null {
  if (!element || !element.isConnected || element.getClientRects().length === 0) return null;
  return element.getBoundingClientRect();
}

/** The block element with this id inside the editor's wrapper. */
export function blockElement(wrapper: HTMLElement | null, blockId: string): HTMLElement | null {
  if (!wrapper || !blockId) return null;
  return wrapper.querySelector<HTMLElement>(`.ucomp-doc [data-id="${attr(blockId)}"]`);
}

/** The thread's highlight: its first text run, or its highlighted block. */
export function threadElement(wrapper: HTMLElement | null, threadId: string): HTMLElement | null {
  if (!wrapper || !threadId) return null;
  const id = attr(threadId);
  return (
    wrapper.querySelector<HTMLElement>(`.ucomp-doc [data-thread="${id}"]`) ??
    wrapper.querySelector<HTMLElement>(`.ucomp-doc [data-thread-block="${id}"]`)
  );
}

/** The nearest ancestor the user can scroll vertically; null when only the page scrolls. */
function scrollContainer(element: HTMLElement): HTMLElement | null {
  const root = element.ownerDocument;
  for (let node = element.parentElement; node && node !== root.body && node !== root.documentElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

const MARGIN = 24;

/**
 * Scrolls `element` into view inside its own scroll container only (never every ancestor, as
 * `scrollIntoView` does): left alone when it's already in view, otherwise centered (or its top
 * near the top when it's taller than the view). The page itself scrolls only when the document
 * has no scroll container of its own.
 */
export function revealInContainer(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const container = scrollContainer(element);
  const win = element.ownerDocument.defaultView;
  const view = container ? container.getBoundingClientRect() : { top: 0, height: win?.innerHeight ?? 0 };
  const bottom = view.top + view.height;
  if (box.top >= view.top + MARGIN && box.bottom <= bottom - MARGIN) return;
  const offset = box.height > view.height - 2 * MARGIN ? MARGIN : (view.height - box.height) / 2;
  const delta = box.top - view.top - offset;
  const behavior: ScrollBehavior = win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const scroller = container ?? element.ownerDocument.scrollingElement;
  scroller?.scrollTo({ top: scroller.scrollTop + delta, behavior });
}

export interface RectSignal {
  /** `listener` runs (at most once a frame) whenever block positions may have changed. */
  subscribe: (listener: () => void) => () => void;
  /** The element whose size changes move blocks (the editor's wrapper); null to stop watching. */
  observe: (element: HTMLElement | null) => void;
  /** Blocks moved without a size change (reordered), or the live editor mounted. */
  notify: () => void;
  /** Someone is listening (skip the work otherwise). */
  active: () => boolean;
}

export function createRectSignal(): RectSignal {
  const listeners = new Set<() => void>();
  let target: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;
  let frame = 0;

  const fire = () => {
    frame = 0;
    for (const listener of [...listeners]) listener();
  };
  const notify = () => {
    if (!listeners.size || frame || typeof requestAnimationFrame === "undefined") return;
    frame = requestAnimationFrame(fire);
  };
  const connect = () => {
    if (observer || !target || !listeners.size) return;
    if (typeof ResizeObserver !== "undefined") {
      // Fires once on observe (the first layout), then on every size change: typing that wraps a
      // line, width changes, fonts, and showing again after <Activity> hid the route.
      observer = new ResizeObserver(notify);
      observer.observe(target);
    }
    target.ownerDocument.defaultView?.addEventListener("resize", notify);
  };
  const disconnect = () => {
    observer?.disconnect();
    observer = null;
    target?.ownerDocument.defaultView?.removeEventListener("resize", notify);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) disconnect();
      };
    },
    observe(element) {
      if (element === target) return;
      disconnect();
      target = element;
      connect();
    },
    notify,
    active: () => listeners.size > 0,
  };
}
