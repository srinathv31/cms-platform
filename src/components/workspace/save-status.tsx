"use client";

import { SaveIndicator } from "./autosave/save-indicator";
import { useSaveStatus } from "./session/workspace-session";

/** "Saved", "Saving…" or why it didn't save: the autosave status of the draft on screen. */
export function SaveStatus() {
  const { status, error } = useSaveStatus();
  return <SaveIndicator status={status} error={error} />;
}
