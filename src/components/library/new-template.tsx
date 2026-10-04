"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";
import { StarterGallery } from "./starter-gallery";

/**
 * "New template": the Library's one primary button. It opens the starter gallery in a dialog;
 * picking a card creates the template and opens it. The dialog stays open until then.
 */
export function NewTemplate({ teamSlug }: { teamSlug: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const firstCard = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-create would leave a template appearing from nowhere.
        if (!next && busy) return;
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button size="lg" className="h-10 rounded-full px-5 text-[14px]" />}>
        New template
      </DialogTrigger>
      <ScrimDialogContent
        initialFocus={firstCard}
        className="w-[min(46rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl p-8"
      >
        <DialogTitle className="display-lg mb-6">New template</DialogTitle>
        <StarterGallery teamSlug={teamSlug} columns={2} firstCardRef={firstCard} onBusyChange={setBusy} />
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              className="absolute top-5 right-5 size-9 rounded-full text-text-muted hover:bg-hover hover:text-text"
            />
          }
        >
          <X aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-5" />
        </DialogClose>
      </ScrimDialogContent>
    </Dialog>
  );
}
