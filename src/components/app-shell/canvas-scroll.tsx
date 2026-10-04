"use client";

import { Suspense, useLayoutEffect, useRef } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import {
  pruneSavedPositions,
  scrollTargetOnPageChange,
  type SavedPositions,
} from "./scroll-positions";

/**
 * The scroll behaviour of the canvas, for every page.
 *
 * The app scrolls one element, the canvas in AppFrame, not the window. Next resets the window's
 * scroll on a navigation and the browser restores it on back and forward, but neither knows about
 * this element: it keeps its scroll position from the page before, and a page opened from a scrolled
 * Library lands scrolled. So the shell does both jobs itself, before the new page is painted:
 *
 *  - Opening a page (a link, a redirect, a new template): the canvas goes to the top.
 *  - Back and forward: the canvas goes to where that history entry was left.
 *  - Anything that is not another page leaves it alone: a change to the search params alone (the
 *    route segments stay the same), a hash, a router refresh, and the settings modal opening over
 *    the page behind it.
 *
 * "Another page" is a change in the route segments of the page slot, which are the same for the
 * page behind a modal and change when the team, the template or the tab does. Tabs of one template
 * are separate pages, so they open at the top too: the tab bar and the header sit at the top of the
 * workspace, a tab's content is a different document from the last, and an offset carried across
 * would land somewhere in the middle of it (or past its end).
 *
 * Where each entry was left is kept per history entry. The Navigation API (Chrome) gives every
 * entry a `key` that is stable for the life of the entry: new on a push, the same on a replace, and
 * the old one again on back and forward. Next puts nothing like it in `history.state`. Positions
 * live in memory, so they last as long as the document does.
 */
export function CanvasScroll() {
  // The segments need a boundary under Cache Components. Nothing here paints, so there is nothing
  // to fall back to, and a reload (where the canvas starts at the top anyway) loses nothing.
  return (
    <Suspense fallback={null}>
      <CanvasScrollEffects />
    </Suspense>
  );
}

/** The part of the Navigation API we use. TypeScript's DOM library does not describe it yet. */
interface NavigationApi {
  readonly currentEntry: { readonly key: string } | null;
  entries(): readonly { readonly key: string }[];
  addEventListener(type: "currententrychange", listener: EntryChangeListener): void;
  removeEventListener(type: "currententrychange", listener: EntryChangeListener): void;
}
type EntryChangeListener = (event: Event & { readonly navigationType: string | null }) => void;

const navigationApi = () => (window as unknown as { navigation?: NavigationApi }).navigation ?? null;
const canvasElement = () => document.querySelector<HTMLElement>('[data-slot="canvas-scroll"]');

interface ScrollState {
  /** The page last shown, as its route segments. `null` until the first one. */
  page: string | null;
  /** The history entry that page was shown for. */
  pageKey: string | null;
  /** The entry whose page is on screen right now: where scroll positions are recorded. */
  displayedKey: string | null;
  saved: SavedPositions;
  /** True while a restore is waiting for the page to grow, so the short page's offset is not saved. */
  restoring: boolean;
  /** Gives up a restore in progress. */
  settle: (() => void) | null;
}

function CanvasScrollEffects() {
  const page = useSelectedLayoutSegments().join("/");
  const state = useRef<ScrollState>({
    page: null,
    pageKey: null,
    displayedKey: null,
    saved: new Map(),
    restoring: false,
    settle: null,
  });

  // Keep every entry's position as the reader scrolls.
  useLayoutEffect(() => {
    const s = state.current;
    const canvas = canvasElement();
    const nav = navigationApi();
    if (!canvas) return;
    s.displayedKey ??= nav?.currentEntry?.key ?? null;

    const onScroll = () => {
      if (!s.restoring && s.displayedKey !== null) s.saved.set(s.displayedKey, canvas.scrollTop);
    };
    // The entry changes the moment the URL does, which on back and forward is before the page has
    // switched (the old page is still on screen, and scrolling it must not overwrite the entry we
    // are going back to). Next re-writes the entry when it commits the page, which lands here as
    // a replace, so the displayed entry follows then. Pushes and replaces commit with the page.
    const onEntryChange: EntryChangeListener = (event) => {
      if (event.navigationType !== "traverse") s.displayedKey = nav?.currentEntry?.key ?? null;
    };
    canvas.addEventListener("scroll", onScroll, { passive: true });
    nav?.addEventListener("currententrychange", onEntryChange);
    return () => {
      canvas.removeEventListener("scroll", onScroll);
      nav?.removeEventListener("currententrychange", onEntryChange);
      s.settle?.();
    };
  }, []);

  // A layout effect, so the canvas moves in the same frame as the page: no flash of the old offset.
  // It runs after the new page's own layout effects (this component renders after the canvas).
  useLayoutEffect(() => {
    const s = state.current;
    if (s.page === page) return;
    const first = s.page === null;
    const nav = navigationApi();
    const key = nav?.currentEntry?.key ?? null;
    const previousKey = s.pageKey;
    s.page = page;
    s.pageKey = key;
    s.displayedKey = key;
    // The page the document loaded with: the browser starts it at the top.
    if (first) return;

    s.settle?.();
    const canvas = canvasElement();
    if (!canvas) return;
    const top = scrollTargetOnPageChange(previousKey, key, s.saved);
    if (key !== null) s.saved.set(key, top);
    if (nav) pruneSavedPositions(s.saved, nav.entries().map((entry) => entry.key));
    s.restoring = true;
    s.settle = scrollTo(canvas, top, () => {
      s.restoring = false;
      s.settle = null;
    });
  }, [page]);

  return null;
}

/** How long a restore waits for the page to be tall enough. A page that is still not there by now is not coming. */
const GIVE_UP_MS = 2500;
/** The reader's own scrolling or clicking takes over from a restore. */
const TAKE_OVER = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Scrolls the canvas to `top`. A page that was streaming in when we went back is shorter than the
 * offset to restore, and the browser clamps the scroll to its end; so when the first try falls
 * short, keep trying as the page grows, until it gets there, the reader scrolls, or time runs out.
 * Returns a function that gives up, or `null` when the first try got there. `done` is called once,
 * whichever way it ends.
 */
function scrollTo(canvas: HTMLElement, top: number, done: () => void): (() => void) | null {
  const jump = () => canvas.scrollTo({ top, behavior: "instant" }); // never animated, whatever the CSS says
  jump();
  if (canvas.scrollTop >= top - 1) {
    done();
    return null;
  }

  let over = false;
  const observer = new ResizeObserver(() => {
    jump();
    if (canvas.scrollTop >= top - 1) stop();
  });
  const timer = window.setTimeout(() => stop(), GIVE_UP_MS);
  function stop() {
    if (over) return;
    over = true;
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of TAKE_OVER) canvas.removeEventListener(type, stop);
    done();
  }
  if (canvas.firstElementChild) observer.observe(canvas.firstElementChild);
  for (const type of TAKE_OVER) canvas.addEventListener(type, stop, { passive: true });
  return stop;
}
