"use client";

import { createContext, useCallback, useContext, useMemo, useTransition } from "react";
import { m } from "motion/react";
import { ease } from "@/components/motion/presets";
import { switchPersona } from "@/server/actions/persona";

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

/** The scrolling canvas body. Dips to a faint tint while the persona changes, then fades back in (~200ms each way). */
export function CanvasFade({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = usePersonaSwitch();
  return (
    <m.div
      data-slot="canvas-scroll"
      className={className}
      animate={{ opacity: pending ? 0.3 : 1 }}
      transition={{ duration: 0.2, ease: ease.outSoft }}
    >
      {children}
    </m.div>
  );
}
