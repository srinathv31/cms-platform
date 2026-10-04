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

/** Quiet text beside the title: Saved, Saving…, or why it didn't save. No spinner. */
export function SaveIndicator({ status, error, className }: SaveIndicatorProps) {
  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      data-status={status}
      className={cn("text-[13px] leading-5", status === "error" ? "text-danger-text" : "text-text-muted", className)}
    >
      {saveIndicatorText(status, error)}
    </span>
  );
}
