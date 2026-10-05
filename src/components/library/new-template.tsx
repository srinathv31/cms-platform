"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";
import { subscribeLibraryIntent, takeLibraryIntent } from "./library-intent";
import { StarterGallery } from "./starter-gallery";

const TABBABLE = 'button:not([disabled]), [href], input:not([hidden]):not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tab wraps inside the dialog at once. Base UI's own trap hands focus over from a guard element a
 * moment after the key, so for that moment focus sits outside the dialog; wrapping on the key itself
 * leaves no such gap (the first and last controls are the first card and the Close button).
 */
function wrapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.getClientRects().length > 0);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * "New template": the Library's one primary button. It opens the starter gallery in a dialog;
 * picking a card creates the template and opens it, and so does importing a file from the row under
 * the cards. The dialog stays open until then.
 *
 * The ⌘K palette's New template and Import a file land here (library-intent.ts): the dialog takes
 * the intent when it mounts and while it is mounted, and opens; for Import it starts on the Import row.
 */
export function NewTemplate({ teamSlug }: { teamSlug: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startOnImport, setStartOnImport] = useState(false);
  const firstCard = useRef<HTMLButtonElement>(null);
  const importRow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const take = () => {
      const intent = takeLibraryIntent(teamSlug);
      if (intent === null) return;
      setStartOnImport(intent === "import");
      setOpen(true);
    };
    take();
    return subscribeLibraryIntent(take);
  }, [teamSlug]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-create would leave a template appearing from nowhere.
        if (!next && busy) return;
        setOpen(next);
        if (!next) setStartOnImport(false);
      }}
    >
      <DialogTrigger render={<Button size="lg" className="h-10 rounded-full px-5 text-[14px]" />}>
        New template
      </DialogTrigger>
      <ScrimDialogContent
        initialFocus={startOnImport ? importRow : firstCard}
        onKeyDown={wrapTab}
        className="w-[min(46rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl p-8"
      >
        <DialogTitle className="display-lg mb-6">New template</DialogTitle>
        <StarterGallery
          teamSlug={teamSlug}
          columns={2}
          firstCardRef={firstCard}
          importRowRef={importRow}
          onBusyChange={setBusy}
          onImported={() => {
            setOpen(false);
            setStartOnImport(false);
          }}
        />
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
