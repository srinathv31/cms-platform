"use client";

import { useEffect, useMemo, useState } from "react";
import { renderMessagePreview } from "@/components/preview/message-preview";
import type { PhoneView } from "@/components/preview/phone-controls";
import { PreviewPane } from "@/components/preview/preview-pane";
import { phoneClock, phoneSenders, recipientOf, senderOf } from "@/components/preview/preview-sender";
import { usePreviewRender } from "@/components/preview/use-preview-render";
import { INITIAL_PHONE, type PreviewDevice } from "@/components/workspace/session/session-store";
import type { ChannelFields } from "@/domain/channel-fields";
import type { MessageTypeRules, TeamSenders } from "@/domain/platform-config";
import type { VariableValues } from "@/editor/model/types";
import { isDocumentChannel, type Channel, type Variable } from "@/domain/types";
import { RV } from "./review-grid";

/**
 * The rendered output of the version under review: the Phase 3 preview's own pieces (the channel
 * control, Download PDF, Desktop / Mobile or the phone's controls, the output on its tinted well).
 * A document channel renders THIS version by number through the same route a consumer calls, with
 * `preview: true`. Push and SMS render in the browser from the version's stored fields, through the
 * route's own function (decision 0035): what the approver sees is what a consumer gets.
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
  teamName,
  channels,
  variables,
  channelFields,
  messageRules,
  senders,
  today,
  values,
  setId,
  enabled,
  onSeen,
  onEditValues,
}: {
  templateId: string;
  versionNumber: number;
  teamName: string;
  /** The version's channels. Never empty. */
  channels: readonly Channel[];
  variables: Variable[];
  /** The version's own fields (a push's, an SMS's), as stored. */
  channelFields: ChannelFields;
  /** The content type's SMS footer (and part budget). */
  messageRules: MessageTypeRules;
  /** Who the team's messages come from on the phone. */
  senders: TeamSenders;
  /** The demo clock's day, YYYY-MM-DD: the phone's date. */
  today: string;
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
  const [phone, setPhone] = useState<PhoneView>({ settings: INITIAL_PHONE, screen: "lock" });
  const channel = channels.includes(picked) ? picked : (channels[0] ?? "pdf");

  const { slots, rendering, retry } = usePreviewRender({
    templateId,
    version: versionNumber,
    channel: isDocumentChannel(channel) ? channel : null,
    values,
    variables,
    enabled,
    saveTick: 0,
    session: NO_SESSION,
  });
  const slot = isDocumentChannel(channel) ? slots[channel] : undefined;

  const platform = phone.settings.platform;
  const message = useMemo(() => {
    if (!enabled || isDocumentChannel(channel)) return null;
    const target = channel === "push" ? ({ channel, platform } as const) : ({ channel } as const);
    return renderMessagePreview(target, { fields: channelFields, variables, values, rules: messageRules });
  }, [enabled, channel, platform, channelFields, variables, values, messageRules]);

  const rendered = message ? message.ok : Boolean(slot?.output) && !slot?.error;
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
        phone={phone}
        onPhone={(next) => setPhone((now) => ({ ...now, ...next }))}
        message={message}
        senders={phoneSenders(senders, teamName)}
        clock={phoneClock(today)}
      />
    </div>
  );
}
