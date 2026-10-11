import { cn } from "@/lib/utils";
import type { SaveStatus } from "./autosave-scheduler";

export interface SaveIndicatorProps {
  status: SaveStatus;
  /** The message from `useDraftAutosave` when `status` is "error". */
  error?: string;
  className?: string;
}

/** What the indicator says. Waiting to save and saving read the same, so a screen reader hears one change per burst of typing. */
export function saveIndicatorText(status: SaveStatus, error?: string): string {
  switch (status) {
    case "saved":
      return "Saved";
    case "saving":
    case "unsaved":
      return "Saving…";
    case "error":
      return error ?? "Not saved.";
  }
}

/**
 * The widest of the two texts that follow each other as people type ("Saving…" is wider than "Saved").
 * The indicator is always at least this wide, so what sits after it (the revert menu's chevron) stays
 * put as a save lands.
 */
const WIDEST = saveIndicatorText("saving");

/** Quiet text beside the title: Saved, Saving…, or why it didn't save. No spinner. */
export function SaveIndicator({ status, error, className }: SaveIndicatorProps) {
  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      data-status={status}
      // An empty, invisible line holding WIDEST gives the box that width without adding text to the live region.
      data-widest={WIDEST}
      className={cn(
        "inline-flex flex-col text-[13px] leading-5 after:invisible after:block after:h-0 after:overflow-hidden after:content-[attr(data-widest)]",
        status === "error" ? "text-danger-text" : "text-text-muted",
        className,
      )}
    >
      {saveIndicatorText(status, error)}
    </span>
  );
}
