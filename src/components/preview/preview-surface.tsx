"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useContractState } from "@/editor/components/editor-root";
import type { SampleSet } from "@/editor/model/types";
import { OriginalView } from "@/components/import/original-view";
import type { ImportOriginalRef } from "@/domain/import-types";
import type { Channel } from "@/domain/types";
import {
  useFocusTarget,
  usePreviewState,
  useSaveTick,
  useWorkspaceSession,
} from "@/components/workspace/session/workspace-session";
import { closePreview } from "./close-preview";
import { PreviewPane } from "./preview-pane";
import { recipientOf, senderOf } from "./preview-sender";
import { RailHeader, railHeaderViews } from "./rail-header";
import { findSet, listSets, resolveSetValues } from "./sample-sets/model";
import { SampleSetSwitcher, type SampleSetSwitcherHandle } from "./sample-sets/sample-set-switcher";
import { usePreviewRender } from "./use-preview-render";

export interface PreviewSurfaceProps {
  templateId: string;
  /** The shown version's number, or null for the open draft. */
  versionNumber: number | null;
  /** The team's name: the email frame's sender. */
  teamName: string;
  /** The version's channels as the Channels selector has them right now (live, ahead of the save). */
  channels: readonly Channel[];
  /** An open draft the viewer can edit: sample sets can be changed, and they save with the draft. */
  editable: boolean;
  /** The version's saved sample sets. */
  sampleSets: SampleSet[];
  /** The demo clock's date, YYYY-MM-DD. */
  today: string;
  /** The template has review comments: the header gets a Comments tab, with this many open. Null: no tab. */
  commentsCount?: number | null;
  /** The file the template was imported from: the header gets an Original tab, which shows it. Null: no tab. */
  original?: ImportOriginalRef | null;
}

/**
 * The preview's brain, mounted in the rail whenever the Content tab is (inside the editor root, which
 * is where the live variable list is). It reads the preview's state from the workspace session, holds
 * the version's sample sets and the last outputs, and draws the widened rail's header row (the view
 * switch, and on the Preview view the sample-set switcher) while the preview is open, with the
 * Preview view under it while that is what the rail shows. Staying mounted is what keeps the last output (and the sets) when the author
 * flips to the Variables view and back, or closes the preview and opens it again.
 *
 * A template that was imported also has an Original view (Compare with original): the widened rail
 * shows the uploaded file under the same header, instead of the output.
 *
 * Values for a render are the selected set's, formatted by the route. `variables` is the live list,
 * so a variable added in the panel is in the next render; the saved draft supplies the rest.
 */
export function PreviewSurface({
  templateId,
  versionNumber,
  teamName,
  channels,
  editable,
  sampleSets,
  today,
  commentsCount = null,
  original = null,
}: PreviewSurfaceProps) {
  const session = useWorkspaceSession();
  const preview = usePreviewState();
  const saveTick = useSaveTick();
  const { variables } = useContractState();
  const switcher = useRef<SampleSetSwitcherHandle>(null);
  // Focus follows here from the plain rail's Original tab when it widens the rail (content/rail.tsx).
  const originalTab = useFocusTarget("originalTab");

  // The sets as saved, then edited here. `listSets` fills in any default set the version lacks.
  const [stored, setStored] = useState(sampleSets);
  const sets = useMemo(() => listSets(stored, variables, today), [stored, variables, today]);
  const selected = findSet(sets, preview.setId) ?? findSet(sets, "typical") ?? sets[0];
  const values = useMemo(() => resolveSetValues(selected, variables, today), [selected, variables, today]);

  // The channel the author picked, while it is on; otherwise the first channel that is.
  const channel = channels.includes(preview.channel) ? preview.channel : (channels[0] ?? "pdf");

  const showing = preview.open && preview.view === "preview";
  const { slots, rendering, retry } = usePreviewRender({
    templateId,
    version: versionNumber ?? "draft",
    channel,
    values,
    variables,
    enabled: showing,
    saveTick,
    session,
  });

  const onSetsChange = useCallback(
    (next: SampleSet[]) => {
      setStored(next);
      session.save({ sampleSets: next });
    },
    [session],
  );

  if (!preview.open) return null;
  return (
    <>
      <RailHeader
        // A Comments view that has lost its comments (the composer was cancelled on a template without threads) reads as Variables.
        value={
          (preview.view === "comments" && commentsCount === null) || (preview.view === "original" && original === null)
            ? "variables"
            : preview.view
        }
        views={railHeaderViews({ preview: true, comments: commentsCount, original: original !== null })}
        originalTabRef={originalTab}
        onChange={(view) => session.selectRailView(view)}
        onClose={() => closePreview(session, { restoreFocus: true })}
      >
        {showing ? (
          <SampleSetSwitcher
            ref={switcher}
            sets={sets}
            variables={variables}
            today={today}
            selectedId={selected.id}
            onSelect={(id) => session.setPreview({ setId: id })}
            onChange={editable ? onSetsChange : undefined}
            readOnly={!editable}
          />
        ) : null}
      </RailHeader>
      {showing ? (
        <PreviewPane
          channels={channels}
          channel={channel}
          onChannel={(picked) => session.setPreview({ channel: picked })}
          variables={variables}
          onEditValues={() => switcher.current?.openEditor()}
          device={preview.device}
          onDevice={(device) => session.setPreview({ device })}
          slot={slots[channel]}
          rendering={rendering}
          onRetry={retry}
          sender={senderOf(teamName)}
          recipient={recipientOf(values)}
        />
      ) : null}
      {preview.view === "original" && original ? <OriginalView original={original} today={today} /> : null}
    </>
  );
}
