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

/**
 * A toast's action (Undo) is an outline button, like the rest of the app's secondary actions: a screen has one
 * black button, and sonner draws an action filled in the toast's text color, near black. Sonner's own styles are
 * outside Tailwind's layers, so the utilities that override them are marked important.
 * `toast` repeats ui/sonner.tsx's class: `toastOptions` here replaces that one whole.
 */
const TOAST_OPTIONS = {
  classNames: {
    toast: "cn-toast",
    actionButton: "border! border-border! bg-surface! text-text! hover:bg-hover!",
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  useIgnoreAbortedViewTransitions();
  return (
    <MotionConfig reducedMotion="user" transition={spring.soft}>
      {/* domMax: layout + layoutId animations (nav pill, tab underline, go-live morph) */}
      <LazyMotion features={domMax} strict>
        <TooltipProvider delay={300}>
          {children}
          <Toaster position="bottom-center" toastOptions={TOAST_OPTIONS} />
        </TooltipProvider>
      </LazyMotion>
    </MotionConfig>
  );
}
