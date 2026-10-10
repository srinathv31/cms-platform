"use client";

import { useEffect, useState } from "react";
import { PreviewPane } from "@/components/preview/preview-pane";
import { recipientOf, senderOf } from "@/components/preview/preview-sender";
import { usePreviewRender } from "@/components/preview/use-preview-render";
import type { VariableValues } from "@/editor/model/types";
import type { Channel, Variable } from "@/domain/types";
import type { PreviewDevice } from "@/components/workspace/session/session-store";
import { RV } from "./review-grid";

/**
 * The rendered output of the version under review: the Phase 3 preview's own pieces (the channel
 * control, Download PDF or Desktop / Mobile, the output on its tinted well), rendering THIS round
 * by number and round through the same route a consumer calls, with `preview: true` (only a preview
 * may name a round).
 *
 * Nothing here is saved or edited, so there is nothing to wait for before a request (`flush` is
 * instant) and no save tick. The sample set is chosen in the tab bar; `onSeen` says which sets the
 * approver has had on screen, and the approval records them.
 *
 * The well scrolls on its own, so the pane has a height of its own: the canvas's scroll area less
 * the header (124px) and the tab bar (44px), never less than 30rem.
 */

const NO_SESSION = { flush: () => Promise.resolve() };

export function PreviewView({
  templateId,
  versionNumber,
  round,
  teamName,
  channels,
  variables,
  values,
  setId,
  enabled,
  onSeen,
  onEditValues,
}: {
  templateId: string;
  versionNumber: number;
  /** The round on screen. */
  round: number;
  teamName: string;
  /** The version's channels. Never empty. */
  channels: readonly Channel[];
  variables: Variable[];
  /** The chosen sample set's values. */
  values: VariableValues;
  setId: string;
  /** The Preview tab is the one showing. */
  enabled: boolean;
  /** A sample set's output is on screen. */
  onSeen: (setId: string) => void;
  /** The error state's Edit values: opens the (read-only) sample set's values. */
  onEditValues: () => void;
}) {
  const [picked, setPicked] = useState<Channel>(channels[0] ?? "pdf");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const channel = channels.includes(picked) ? picked : (channels[0] ?? "pdf");

  const { slots, rendering, retry } = usePreviewRender({
    templateId,
    version: versionNumber,
    round,
    channel,
    values,
    variables,
    enabled,
    saveTick: 0,
    session: NO_SESSION,
  });
  const slot = slots[channel];

  const rendered = Boolean(slot?.output) && !slot?.error;
  useEffect(() => {
    if (enabled && rendered) onSeen(setId);
  }, [enabled, rendered, setId, onSeen]);

  return (
    <div
      id="review-panel-preview"
      role="tabpanel"
      aria-labelledby="review-tab-preview"
      data-slot="review-preview"
      className={RV.output}
    >
      <PreviewPane
        channels={channels}
        channel={channel}
        onChannel={setPicked}
        variables={variables}
        onEditValues={onEditValues}
        device={device}
        onDevice={setDevice}
        slot={slot}
        rendering={rendering}
        onRetry={retry}
        sender={senderOf(teamName)}
        recipient={recipientOf(values)}
      />
    </div>
  );
}
