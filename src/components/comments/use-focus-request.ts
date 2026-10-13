"use client";

// Where focus goes after the control that had it goes away. `ThreadList` is the one user: a button that
// is clicked and then leaves the page (Resolve, Reopen, the composer's buttons) takes focus with it, and
// the page falls back to <body>. The caller says where focus goes next (`ask`); this hook moves it there
// once the control has gone and the place is on screen, and never over focus that was put somewhere on
// purpose in the meantime. The DOM is touched only to see what has focus and to focus what `find` returns.

import { useCallback, useEffect, useRef } from "react";

/** How long a request waits for its place to be on screen (a new thread's id comes with the server's list). */
const FOCUS_WAIT = 5000;

/** Where focus should go next, asked for when a control that has it is about to go away. */
interface FocusRequest {
  /** The place, once it exists (null: not there yet, keep waiting). */
  find: () => HTMLElement | null;
  /** The element that had focus when it was asked: the request waits until that has gone. */
  from: HTMLElement | null;
  until: number;
  /** Animation frames to wait after the control has gone, so a host that puts focus back itself goes first. */
  frames: number;
}

/** Nothing has focus: the page fell back to <body> (or to an element that has since left it). */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

export interface FocusRequests {
  /**
   * Asks for focus to go to `find()` after the element that has it now has left the page. `frames` waits
   * that many animation frames after it has gone, for a host that puts focus back itself (the caret in an
   * editable document, a frame later) to go first. A new request replaces the one before it.
   */
  ask: (find: FocusRequest["find"], frames?: number) => void;
  /**
   * True while the hook itself is moving focus into a card. The card's "focus arrived, so select me" (the
   * keyboard path) stands down then: moving focus after a resolve doesn't also move the document to
   * another thread.
   */
  moving: () => boolean;
}

/** One pending request at a time, carried out in an effect after the render in which the control left. */
export function useFocusRequests(): FocusRequests {
  const pending = useRef<FocusRequest | null>(null);
  const movingFocus = useRef(false);

  const moveFocusTo = useCallback((target: HTMLElement) => {
    movingFocus.current = true;
    try {
      target.focus({ preventScroll: true });
    } finally {
      movingFocus.current = false;
    }
  }, []);

  const ask = useCallback((find: FocusRequest["find"], frames = 0) => {
    const active = document.activeElement;
    // <body> isn't a control that goes away: with nothing focused there is nothing to wait for.
    const from =
      active instanceof HTMLElement && active !== document.body ? active : null;
    pending.current = { find, from, until: Date.now() + FOCUS_WAIT, frames };
  }, []);

  const moving = useCallback(() => movingFocus.current, []);

  // After every render: the control may have gone in this one, or the place may have arrived in it.
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    if (Date.now() > request.until) {
      pending.current = null;
      return;
    }
    if (request.from?.isConnected) return; // the control that had focus is still on screen
    if (!focusIsLost()) {
      pending.current = null; // it went somewhere on purpose
      return;
    }
    const arrive = () => {
      if (!focusIsLost()) return;
      const target = request.find();
      if (target) moveFocusTo(target);
    };
    if (request.frames > 0) {
      // Hosts put focus back too (the caret in an editable document, a frame later): look again after them.
      pending.current = null;
      let left = request.frames;
      const wait = () => (--left > 0 ? requestAnimationFrame(wait) : arrive());
      requestAnimationFrame(wait);
      return;
    }
    const target = request.find();
    if (!target) return; // not on screen yet (a new thread waits for its id): try again on the next render
    pending.current = null;
    moveFocusTo(target);
  });

  return { ask, moving };
}
