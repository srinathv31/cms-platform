"use client";

import { useEffect, useRef, useState, useTransition, type DragEvent, type Ref } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { markPaletteStale } from "@/components/palette/palette-stale";
import { IMPORT_ACCEPT } from "@/domain/import-types";
import { cn } from "@/lib/utils";
import { IMPORT_FAILED, precheckImport, precheckImportBytes, uploadImport } from "./upload-import";

/**
 * "Import a file": the dashed row under the starter cards (docs/decisions/track-c.md, 3 and 4). A
 * click opens the file picker, and a file dropped on the row works too. Picking a file imports it at
 * once: the row shows a spinner and "Importing <file>" until the new template opens (the name
 * selected, the rail on the Original tab on a wide canvas). A refusal is one line under the row, in a
 * slot that is always there (empty until something is refused), so the dialog never changes height.
 * A file whose first bytes don't match its name (a renamed picture) is refused here, unsent.
 *
 * `locked` while a starter card is being created; `onBusyChange` tells the gallery to lock its cards
 * while a file is importing, so there is one busy state at a time.
 */
export function ImportRow({
  teamSlug,
  locked,
  onBusyChange,
  onImported,
  rowRef,
}: {
  teamSlug: string;
  locked: boolean;
  onBusyChange: (busy: boolean) => void;
  /** The template is made and opening: the dialog closes with that navigation (the Library stays mounted, hidden). */
  onImported?: () => void;
  /** The dialog focuses the row when the palette asked for Import. */
  rowRef?: Ref<HTMLButtonElement>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // A file is being sent; then, until the new template has opened, the navigation is pending.
  const [uploading, setUploading] = useState(false);
  // The last file picked: what the busy row names.
  const [fileName, setFileName] = useState("");
  const [navigating, startNavigation] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = uploading || navigating;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const unusable = busy || locked;

  async function importFile(file: File | undefined) {
    if (!file || unusable) return;
    const blocked = precheckImport(file);
    if (blocked) {
      setRefusal(blocked);
      return;
    }
    // Before anything is sent: is it the kind its name says?
    const fake = await precheckImportBytes(file);
    if (fake) {
      setRefusal(fake);
      return;
    }
    setRefusal(null);
    setFileName(file.name);
    setUploading(true);
    let result;
    try {
      result = await uploadImport(file, teamSlug);
    } catch {
      setUploading(false);
      setRefusal(IMPORT_FAILED);
      return;
    }
    if (!result.ok) {
      setUploading(false);
      setRefusal(result.reason);
      return;
    }
    const { href } = result;
    markPaletteStale();
    // The row stays busy until the template has opened (the transition), then is idle again for when
    // the Library is shown again.
    startNavigation(() => {
      setUploading(false);
      onImported?.();
      router.push(href as Route);
    });
  }

  function onDragOver(event: DragEvent<HTMLButtonElement>) {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = unusable ? "none" : "copy";
    if (!unusable) setDragging(true);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    setDragging(false);
    void importFile(event.dataTransfer.files[0]);
  }

  return (
    <div>
      <button
        ref={rowRef}
        type="button"
        aria-label={busy ? `Importing ${fileName}` : undefined}
        aria-disabled={unusable || undefined}
        aria-busy={busy || undefined}
        data-dragging={dragging ? "" : undefined}
        onClick={() => {
          if (!unusable) input.current?.click();
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex h-14 w-full items-center gap-3 rounded-2xl border border-dashed border-hairline px-4 text-left outline-none transition-colors",
          "hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring data-[dragging]:bg-hover",
          busy && "cursor-default bg-selected hover:bg-selected",
          locked && !busy && "cursor-default opacity-50 hover:bg-transparent",
        )}
      >
        <span className="grid size-5 shrink-0 place-items-center text-text-muted">
          {busy ? (
            <Spinner aria-hidden role={undefined} aria-label={undefined} className="size-4" />
          ) : (
            <FileUp aria-hidden strokeWidth={1.75} className="size-[18px]" />
          )}
        </span>
        <span className="min-w-0 truncate text-[15px] leading-5 font-medium text-text">
          {busy ? `Importing ${fileName}` : "Import a file"}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        tabIndex={-1}
        aria-hidden
        data-slot="import-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Cleared at once, so picking the same file again (after a refusal) is a change too.
          event.currentTarget.value = "";
          void importFile(file);
        }}
      />
      {/* Always in the layout (empty until a file is refused), so the refusal never moves what is above or below it. */}
      <p role="alert" className="mt-2 min-h-5 px-1 text-[13px] leading-5 text-danger-text">
        {refusal}
      </p>
    </div>
  );
}
