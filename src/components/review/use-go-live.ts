"use client";

import { useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { VersionState } from "@/domain/types";

/** Scrolls the canvas (the page's own scroll area, not the window) to its top. */
function scrollCanvasToTop(from: HTMLElement | null) {
  for (let node = from?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      node.scrollTo({ top: 0 });
      return;
    }
  }
}

type GoLiveStage =
  /** Nothing is going on. */
  | "idle"
  /** The final approval is on its way: the header holds its state until the moment can play. */
  | "armed"
  /** The moment is playing. */
  | "playing";

/**
 * The go-live moment: when the final approval lands, the server's data moves to Active at once, behind the
 * moment's wash; the header holds its state ("in review") until the moment's own flip. `state` is the version's
 * state as the server says it. With reduced motion the moment doesn't play: the end state shows at once.
 */
export function useGoLive(state: VersionState) {
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState<GoLiveStage>("idle");
  const [flipped, setFlipped] = useState(false);
  /** The header's ring slot: where the moment lands, and where the canvas scrolls to. */
  const slotRef = useRef<HTMLDivElement>(null);

  const held = stage !== "idle" && !flipped;

  return {
    slotRef,
    /** The moment is on screen. */
    playing: stage === "playing",
    /** The state the header shows. */
    shownState: (held ? "in_review" : state) as VersionState,
    /** The version is Active and the moment is over: the ring sits in its slot. */
    ring: state === "active" && stage === "idle",
    /** The approval is on its way; `final` says it is the last stage's. */
    begin(final: boolean) {
      if (final && !reduceMotion) setStage("armed");
    },
    /** The approval went through. */
    approved(wentLive: boolean) {
      if (!wentLive) {
        setStage("idle");
        return;
      }
      if (reduceMotion) {
        // The end state at once: Active, the ring in its slot.
        setStage("idle");
        return;
      }
      scrollCanvasToTop(slotRef.current);
      setFlipped(false);
      setStage("playing");
    },
    failed() {
      setStage("idle");
    },
    /** The moment flipped the header to the new state. */
    flip() {
      setFlipped(true);
    },
    /** The moment is over. */
    done() {
      setStage("idle");
      setFlipped(false);
    },
  };
}

export type GoLiveMoment = ReturnType<typeof useGoLive>;
