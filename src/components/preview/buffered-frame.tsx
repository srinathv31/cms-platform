"use client";

// A sandboxed iframe that swaps its document without a flash.
//
// A new `html` loads in a second iframe behind the one on screen, and only when it has loaded does it
// take over (and the old one goes away). So the author never sees a white frame, or the page jump back
// to the top: the swap copies the scroll position across first. Until the first document is loaded
// the frame is simply blank.
//
// Sandbox. `allow-same-origin` and nothing else: no scripts (the render route's HTML has none), no
// forms, no popups, no navigation. It is the same-origin flag, with scripts still off, that lets this
// component read the frame's own document, to carry the scroll across, to measure an email's height,
// and to keep a click on a link in the preview from navigating the frame. Scripts are the part that
// would make that flag unsafe, and they stay off.

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface BufferedFrameProps {
  html: string;
  /** Names the frame that is showing ("Web preview"). */
  title: string;
  /**
   * Size the frame to its content (measured after load, and again whenever its width changes), for a
   * page that scrolls with the surrounding well. Otherwise it fills its box and scrolls inside.
   */
  autoHeight?: boolean;
  /** The height before the first document has loaded, with `autoHeight`. */
  initialHeight?: number;
  className?: string;
}

type Slot = 0 | 1;

interface State {
  /** The document each iframe holds; null = that iframe doesn't exist. */
  docs: [string | null, string | null];
  /** The iframe on screen. */
  front: Slot;
  /** The iframe loading the newest document behind the front one. */
  pending: Slot | null;
  /** The newest `html` seen. */
  latest: string;
  /** The content height of the front document (`autoHeight`). */
  height: number | null;
}

export function BufferedFrame({ html, title, autoHeight = false, initialHeight = 320, className }: BufferedFrameProps) {
  const [state, setState] = useState<State>({ docs: [html, null], front: 0, pending: null, latest: html, height: null });
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)] as const;

  // A new document goes into the iframe that is not on screen (adjusting state during render).
  if (html !== state.latest) {
    const back: Slot = state.front === 0 ? 1 : 0;
    const docs: State["docs"] = [state.docs[0], state.docs[1]];
    docs[back] = html;
    setState({ ...state, docs, pending: back, latest: html });
  }

  function onLoad(slot: Slot, frame: HTMLIFrameElement) {
    const doc = readDocument(frame);
    if (doc) {
      // A click on a link must not navigate the preview.
      doc.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
      });
      // The frame's width changed (the pane was resized): its content's height did too.
      if (autoHeight) {
        frame.contentWindow?.addEventListener("resize", () => {
          const height = contentHeight(frame);
          if (height !== null) setState((s) => (s.front === slot && s.height !== height ? { ...s, height } : s));
        });
      }
    }

    if (slot === state.front) {
      // The first document, or a front one that reloaded: nothing to swap, just measure.
      if (autoHeight) {
        const height = contentHeight(frame);
        if (height !== null) setState((s) => (s.height === height ? s : { ...s, height }));
      }
      return;
    }
    if (slot !== state.pending || frame.srcdoc !== state.docs[slot]) return; // a stale load

    // The new document is ready: carry the scroll over, then let it take the front.
    const old = frames[state.front].current;
    if (old) copyScroll(old, frame);
    const height = autoHeight ? contentHeight(frame) : null;
    setState((s) => {
      if (s.pending !== slot) return s;
      const docs: State["docs"] = [s.docs[0], s.docs[1]];
      docs[s.front] = null; // the old front goes away
      return { ...s, docs, front: slot, pending: null, height: height ?? s.height };
    });
  }

  return (
    <div
      className={cn("relative", className)}
      style={autoHeight ? { height: state.height ?? initialHeight } : undefined}
    >
      {([0, 1] as const).map((slot) => {
        const doc = state.docs[slot];
        if (doc === null) return null;
        const front = slot === state.front;
        return (
          <iframe
            key={slot}
            ref={frames[slot]}
            // Only the one on screen has a name, so there is never a second "Web preview".
            title={front ? title : undefined}
            aria-hidden={front ? undefined : true}
            tabIndex={front ? undefined : -1}
            srcDoc={doc}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            onLoad={(event) => onLoad(slot, event.currentTarget)}
            className={cn("absolute inset-0 block size-full border-0 bg-surface", !front && "invisible")}
          />
        );
      })}
    </div>
  );
}

/** The frame's document, when this origin may read it (it may not, if the sandbox were stricter). */
function readDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

/** The height of the frame's content: the body, which has no margin, not the document (that is never shorter than the frame). */
function contentHeight(frame: HTMLIFrameElement): number | null {
  const body = readDocument(frame)?.body;
  return body ? Math.ceil(body.getBoundingClientRect().height) : null;
}

function copyScroll(from: HTMLIFrameElement, to: HTMLIFrameElement) {
  const source = readDocument(from)?.scrollingElement;
  const target = readDocument(to)?.scrollingElement;
  if (!source || !target) return;
  target.scrollTop = source.scrollTop;
  target.scrollLeft = source.scrollLeft;
}
