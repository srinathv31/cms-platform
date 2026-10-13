"use client";

// The values the Content page shows, and putting them back. "Revert to when you opened it" (the header's
// save status menu), or undoing it, hands the page the values to show (`restore`, through the session),
// and everything inside the editor root remounts with them (`shown.gen` is its key), since the root and
// the fields read their values once. Later props (a refresh) never reset a draft being edited.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  CHANNEL_FIELD_IDS,
  channelFieldValues,
  type ChannelFieldValues,
} from "@/domain/channel-fields";
import type { Channel, JSONContent, SampleSet, Variable } from "@/domain/types";
import { createLiveDraft, type LiveDraft } from "../session/live-draft";
import type { WorkspaceSession } from "../session/session-store";
import type { ContentDraft } from "./content-props";

/** The fields this page shows, which a revert can put back: every channel field among them, by id. */
const CONTENT_FIELDS = [
  "body",
  "variables",
  "channels",
  ...CHANNEL_FIELD_IDS,
  "sampleSets",
] as const;

/** The app's one scrolling element (AppFrame's canvas), which the document scrolls in. */
const canvasElement = () =>
  document.querySelector<HTMLElement>('[data-slot="canvas-scroll"]');

/** What the editor root and its fields mount with. The channel fields are held flat, by id, as autosave saves them. */
export interface ContentValues extends ChannelFieldValues {
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  sampleSets: SampleSet[];
}

/** The values on screen, and how many times a revert has replaced them (`gen`: the key that remounts the fields). */
export type ShownContent = ContentValues & { gen: number };

export interface ContentRevert {
  shown: ShownContent;
  /** The channels that are on: `shown.channels` as a revert left them, then as the author toggles them. */
  channels: Channel[];
  setChannels: Dispatch<SetStateAction<Channel[]>>;
  /**
   * The draft as typed, ahead of autosave: what the phone preview and the composer's measurements read. A new
   * one when a revert remounts the fields with other values.
   */
  liveDraft: LiveDraft;
}

/**
 * `onBodyRestored` is told the document a revert put back, so what follows the document (the threads' blocks)
 * can follow it; pass one that is stable.
 */
export function useContentRevert({
  session,
  editable,
  draft,
  onBodyRestored,
}: {
  session: WorkspaceSession;
  editable: boolean;
  draft: ContentDraft;
  onBodyRestored: (body: JSONContent) => void;
}): ContentRevert {
  const [channels, setChannels] = useState(draft.channels);

  // What the page opened with: the values "Revert to when you opened it" puts back.
  const [opening] = useState<ContentValues>(() => ({
    body: draft.body,
    variables: draft.variables,
    channels: draft.channels,
    ...channelFieldValues(draft.channelFields),
    sampleSets: draft.sampleSets,
  }));
  const [shown, setShown] = useState<ShownContent>(() => ({
    gen: 0,
    ...opening,
  }));

  const liveDraft = useMemo(
    () =>
      createLiveDraft({
        fields: Object.fromEntries(
          CHANNEL_FIELD_IDS.map((id) => [id, shown[id]]),
        ) as ChannelFieldValues,
        sampleSets: shown.sampleSets,
      }),
    [shown],
  );

  // A revert is pressed from a button, so it must not scroll the page. The old editor leaving shortens
  // the page for a moment, and the browser clamps the canvas's scroll: put it back as the new one lands.
  const keptScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const top = keptScroll.current;
    keptScroll.current = null;
    const canvas = canvasElement();
    if (top !== null && canvas && canvas.scrollTop !== top)
      canvas.scrollTo({ top, behavior: "instant" });
  }, [shown.gen]);

  useEffect(() => {
    if (!editable) return;
    return session.addRestoreTarget({
      opening,
      restore: (fields, values) => {
        if (!CONTENT_FIELDS.some((key) => key in fields)) return;
        // A channel field's null is a value (cleared), so only a missing one falls back to the opening.
        const fieldValues = Object.fromEntries(
          CHANNEL_FIELD_IDS.map((id) => [
            id,
            values[id] === undefined ? opening[id] : values[id],
          ]),
        ) as ChannelFieldValues;
        const next: ContentValues = {
          body: values.body ?? opening.body,
          variables: values.variables ?? opening.variables,
          channels: values.channels ?? opening.channels,
          ...fieldValues,
          sampleSets: values.sampleSets ?? opening.sampleSets,
        };
        onBodyRestored(next.body);
        setChannels(next.channels);
        keptScroll.current = canvasElement()?.scrollTop ?? null;
        setShown((prev) => ({ gen: prev.gen + 1, ...next }));
      },
    });
  }, [session, editable, opening, onBodyRestored]);

  return { shown, channels, setChannels, liveDraft };
}
