"use client";

import { useEffect } from "react";
import { LazyMotion, MotionConfig, domMax } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { spring } from "./presets";

// The browser cancels a view transition when the page is hidden (another tab, a hidden pane) and
// rejects its promise with this error. The update itself still applies, so it's noise; ignore only it.
function useIgnoreAbortedViewTransitions() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { name?: string; message?: string } | undefined;
      if (reason?.name === "InvalidStateError" && reason.message?.includes("Transition was aborted")) {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  useIgnoreAbortedViewTransitions();
  return (
    <MotionConfig reducedMotion="user" transition={spring.soft}>
      {/* domMax: layout + layoutId animations (nav pill, tab underline, go-live morph) */}
      <LazyMotion features={domMax} strict>
        <TooltipProvider delay={300}>
          {children}
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </LazyMotion>
    </MotionConfig>
  );
}
