"use client";

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";

// Exactly one settings dialog on screen. Opened by URL (reload, shared link), the page route draws the
// dialog over the library. A nav click from there is a soft navigation, which the @modal slot intercepts,
// while the page route stays mounted underneath. So each dialog registers while shown: the page's dialog
// steps aside whenever the intercepted one is up, and the intercepted one then closes to the library
// (going back would leave the app, since the nav links replace the history entry).
type Mode = "back" | "library";
const shown: Record<Mode, number> = { back: 0, library: 0 };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const interceptedShown = () => shown.back > 0;
const serverSnapshot = () => false;

function useRegister(mode: Mode) {
  useLayoutEffect(() => {
    shown[mode] += 1;
    listeners.forEach((l) => l());
    return () => {
      shown[mode] -= 1;
      listeners.forEach((l) => l());
    };
  }, [mode]);
}

/**
 * Flow-style settings modal frame: a nav column on a tinted surface (`nav`, streamed), content on the right.
 * Used by the intercepted route (closes back to the page underneath) and by the hard-navigation
 * fallback (closes to the library). It lives in a layout, so it persists while sections change.
 */
export function SettingsDialog({
  nav,
  closeMode,
  children,
}: {
  nav: React.ReactNode;
  /** "back" for the intercepted route; "library" when the page was opened directly. */
  closeMode: Mode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  useRegister(closeMode);
  const yieldToIntercepted = useSyncExternalStore(subscribe, interceptedShown, serverSnapshot) && closeMode === "library";
  // Taking over from the page's dialog: appear at once, so the scrim doesn't blink.
  const takeover = closeMode === "back" && shown.library > 0;

  // Next keeps a visited route mounted but hidden (React Activity), so this layout's state outlives the
  // dialog: closing it left `open` false and the next Settings click navigated to a dialog that never
  // showed. Effects re-run each time the route is shown again, so every show starts open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the effect IS the "shown again" signal
    setOpen(true);
  }, []);

  if (yieldToIntercepted) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return;
        if (closeMode === "back" && shown.library === 0) router.back();
        else {
          // Read at event time: a hook here would suspend the static shell on the URL.
          const team = window.location.pathname.split("/")[1];
          router.replace(`/${team}/library` as Route);
        }
      }}
    >
      <ScrimDialogContent
        instant={takeover}
        aria-label="Settings"
        className="flex h-[min(46rem,84vh)] w-[min(72vw,70rem)] min-w-[56rem] rounded-3xl"
      >
        <div className="flex w-[15rem] shrink-0 flex-col bg-surface-tinted">{nav}</div>

        <div className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain px-10 pt-12 pb-10">
          {children}
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close settings"
                className="absolute top-5 right-5 size-9 rounded-full text-text-muted hover:bg-hover hover:text-text"
              />
            }
          >
            <X aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-5" />
          </DialogClose>
        </div>
      </ScrimDialogContent>
    </Dialog>
  );
}
