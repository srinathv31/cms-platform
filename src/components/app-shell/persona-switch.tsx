"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useTransition } from "react";
import { m } from "motion/react";
import { ease } from "@/components/motion/presets";
import { switchPersona } from "@/server/actions/persona";
import { usePendingNav } from "./pending-nav";

interface PersonaSwitchValue {
  pending: boolean;
  switchTo: (personaId: string) => void;
}

const PersonaSwitchContext = createContext<PersonaSwitchValue>({
  pending: false,
  switchTo: () => {},
});

/**
 * Owns the persona-switch transition so the profile menu can trigger it
 * and the canvas can crossfade while it runs.
 */
export function PersonaSwitchProvider({ children }: { children: React.ReactNode }) {
  const [pending, startTransition] = useTransition();

  const switchTo = useCallback((personaId: string) => {
    // Read the path at event time: no hook, so the static shell never suspends on the URL.
    const path = window.location.pathname;
    startTransition(async () => {
      await switchPersona(personaId, path);
    });
  }, []);

  const value = useMemo(() => ({ pending, switchTo }), [pending, switchTo]);
  return <PersonaSwitchContext.Provider value={value}>{children}</PersonaSwitchContext.Provider>;
}

export function usePersonaSwitch() {
  return useContext(PersonaSwitchContext);
}

/**
 * The scrolling canvas body. Dips to a faint tint while the persona changes, then fades back in (~200ms each way).
 *
 * While a page is on its way (development only: see pending-nav.tsx) it is busy, and it shows the
 * pending skeleton from the top, as the page will open. If the navigation goes nowhere, the page left
 * comes back where it was; if it lands, CanvasScroll places the new page after this has run.
 */
export function CanvasFade({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = usePersonaSwitch();
  const busy = usePendingNav().view !== null;
  const ref = useRef<HTMLDivElement>(null);
  /** Where the page on screen is scrolled to, kept while it is on screen (development only). */
  const lastTop = useRef(0);
  /** Where the page hidden behind a pending view was left, until the pending view goes. */
  const leftTop = useRef<number | null>(null);

  useLayoutEffect(() => {
    // Inline, so production (which never goes busy) gets neither the listener nor the effect's work.
    if (process.env.NODE_ENV !== "development") return;
    const canvas = ref.current;
    if (!canvas) return;
    if (busy) {
      leftTop.current = lastTop.current;
      canvas.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    // The pending view is gone. Put the page that was left back where it was: this runs after the page's
    // own layout effects (Next scrolls a refreshed page to its top), and CanvasScroll, which runs after
    // this, places a page that did change.
    if (leftTop.current !== null) canvas.scrollTo({ top: leftTop.current, behavior: "instant" });
    leftTop.current = null;
    // Kept from here on, not read when the pending view goes up: by then its commit has hidden the page and
    // put the shorter skeleton in, so the offset is already clamped. This listener is gone (the busy
    // commit runs its cleanup) before that clamp's scroll event arrives.
    lastTop.current = canvas.scrollTop;
    const onScroll = () => {
      lastTop.current = canvas.scrollTop;
    };
    canvas.addEventListener("scroll", onScroll, { passive: true });
    return () => canvas.removeEventListener("scroll", onScroll);
  }, [busy]);

  return (
    <m.div
      ref={ref}
      data-slot="canvas-scroll"
      aria-busy={busy || undefined}
      className={className}
      animate={{ opacity: pending ? 0.3 : 1 }}
      transition={{ duration: 0.2, ease: ease.outSoft }}
    >
      {children}
    </m.div>
  );
}
