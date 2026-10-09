// Closing the preview, and where focus goes when it closes. The Preview toggle in the tab bar opens it;
// whatever way it is closed (Esc, the toggle again, the overlay's Close button), focus goes back to
// that toggle when it would otherwise be lost, so the keyboard picks up where it left off.

import type { FocusTargets } from "@/components/workspace/session/focus-targets";
import type { WorkspaceSession } from "@/components/workspace/session/session-store";

/**
 * Puts focus on the tab bar's Preview toggle, which registers itself as a focus target while it is
 * mounted (`PreviewToggle` in workspace-actions.tsx, on the Content tab, which the preview lives on).
 */
export function focusPreviewToggle(targets: Pick<FocusTargets, "get">): void {
  targets.get("previewToggle")?.focus({ preventScroll: true });
}

/**
 * Puts the preview away, and the narrow canvas's rail overlay with it. With `restoreFocus`, focus goes
 * to the Preview toggle first (what had focus inside the rail goes away with it, so focus is never
 * dropped onto the page); without it, focus stays where it is (the author pressing Esc in the
 * document keeps their caret).
 */
export function closePreview(
  session: Pick<WorkspaceSession, "closePreview" | "setRailOpen" | "focusTargets">,
  { restoreFocus }: { restoreFocus: boolean },
): void {
  if (restoreFocus) focusPreviewToggle(session.focusTargets);
  session.closePreview();
  session.setRailOpen(false);
}
