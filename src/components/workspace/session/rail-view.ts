// Which of the rail's views is on screen. The rail has up to four: the rendered preview and the
// imported original (each only while the rail is widened, and the original only when the template was
// imported), the template's review comments (only when it has some), and the normal rail (Channels,
// Email details, Variables). Both the rail and the preview's header row ask the same question.

import type { PreviewState, RailTab } from "./session-store";
import { usePreviewState, useRailTab } from "./workspace-session";

export type RailView = "preview" | "original" | "comments" | "variables";

export interface RailComments {
  /** The rail has comments to show: the template has threads, or a new-comment composer is open. */
  has: boolean;
  /** Something is waiting there (an open thread, a composer): the rail opens on Comments until the author picks a tab. */
  preferred: boolean;
}

export function resolveRailView(
  preview: PreviewState,
  tab: RailTab | null,
  comments: RailComments,
  /** The template was imported: it has an Original view. */
  hasOriginal = false,
): RailView {
  if (preview.open) {
    if (preview.view === "preview") return "preview";
    if (preview.view === "original") return hasOriginal ? "original" : "variables";
    return preview.view === "comments" && comments.has ? "comments" : "variables";
  }
  const shown = tab ?? (comments.preferred ? "comments" : "variables");
  return shown === "comments" && comments.has ? "comments" : "variables";
}

export function useRailView(comments: RailComments, hasOriginal = false): RailView {
  const preview = usePreviewState();
  const tab = useRailTab();
  return resolveRailView(preview, tab, comments, hasOriginal);
}
