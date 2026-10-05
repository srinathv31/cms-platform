// Closing the preview, and where focus goes when it closes. The Preview toggle in the tab bar opens it;
// whatever way it is closed (Esc, the toggle again, the overlay's Close button), focus goes back to
// that toggle when it would otherwise be lost, so the keyboard picks up where it left off.

import type { WorkspaceSession } from "@/components/workspace/session/session-store";

/** The tab bar's Preview toggle (`PreviewToggle` in workspace-actions.tsx carries the attribute). */
const PREVIEW_TOGGLE = "[data-preview-toggle]";

/** Puts focus on the tab bar's Preview toggle (it is mounted on the Content tab, which the preview lives on). */
export function focusPreviewToggle(): void {
  document.querySelector<HTMLElement>(PREVIEW_TOGGLE)?.focus({ preventScroll: true });
}

/**
 * Puts the preview away, and the narrow canvas's rail overlay with it. With `restoreFocus`, focus goes
 * to the Preview toggle first (what had focus inside the rail goes away with it, so focus is never
 * dropped onto the page); without it, focus stays where it is (the author pressing Esc in the
 * document keeps their caret).
 */
export function closePreview(
  session: Pick<WorkspaceSession, "closePreview" | "setRailOpen">,
  { restoreFocus }: { restoreFocus: boolean },
): void {
  if (restoreFocus) focusPreviewToggle();
  session.closePreview();
  session.setRailOpen(false);
}
