"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";

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
  closeMode: "back" | "library";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return;
        if (closeMode === "back") router.back();
        else {
          // Read at event time: a hook here would suspend the static shell on the URL.
          const team = window.location.pathname.split("/")[1];
          router.replace(`/${team}/library` as Route);
        }
      }}
    >
      <ScrimDialogContent
        aria-label="Settings"
        className="flex h-[min(46rem,84vh)] w-[min(72vw,70rem)] min-w-[56rem] rounded-3xl"
      >
        <div className="flex w-[17rem] shrink-0 flex-col bg-surface-tinted">{nav}</div>

        <div className="relative min-w-0 flex-1 overflow-y-auto px-14 pt-12 pb-10">
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
