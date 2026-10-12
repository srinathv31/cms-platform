"use client";

import { useCallback, useState } from "react";
import type { Channel } from "@/domain/types";
import type { ReviewScreenData } from "@/server/queries/review-models";
import type { ReviewView } from "./view-tabs";

/**
 * Which of the two views the review screen shows, and whether the Preview has been opened.
 *
 * A document's view is its body (and its email details); a message's (an Alert's) is its fields, which are its
 * whole content. Either way the screen opens on what was written, with the redline and the comments. The family
 * is the content type's, never read from the version's channels. The Preview is the rendered output.
 *
 * This is the one place the Preview view's screen-level state lives: `view`, `previewVisited` and the
 * `channels` the Preview offers. The channel and the phone's platform the approver has picked inside the
 * Preview belong to `PreviewView` (preview-view.tsx): whatever needs to know them gets a callback prop from it,
 * not a copy of its state.
 */
export function useReviewView(
  version: Pick<ReviewScreenData["version"], "channels">,
) {
  const [view, setView] = useState<ReviewView>("document");
  // The output is built the first time it is looked at, then kept (its last render stays up).
  const [previewVisited, setPreviewVisited] = useState(false);

  /** The outputs the Preview offers: the version's channels, never none. */
  const channels: Channel[] =
    version.channels.length > 0 ? version.channels : ["pdf"];

  const showDocument = useCallback(() => setView("document"), []);
  /** A tab was pressed. */
  const pickView = useCallback((next: ReviewView) => {
    setView(next);
    if (next === "preview") setPreviewVisited(true);
  }, []);

  return { view, previewVisited, channels, showDocument, pickView };
}
