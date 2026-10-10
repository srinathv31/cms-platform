"use client";

import { VariableChipView } from "@/editor/components/variable-chip";
import type { JSONContent } from "@/editor/model/types";
import { ChannelSelector } from "@/components/workspace/content/channels";
import { VariablesPanel } from "../workspace/variables-panel";
import { ALL_CHANNELS, EMAIL_PREHEADER, EMAIL_SUBJECT, VARIABLES, countUses } from "./fixtures";
import type { ChannelId } from "./types";

/*
 * What the rail holds when nothing is being previewed: Channels, then (when Email is on) the Email
 * details under them, then Variables. The real rail takes the first two as slots and the editor's
 * Variables panel as children; here the pieces are the real ChannelSelector and the study's static
 * Variables panel.
 */

function EmailField({ label, nodes }: { label: string; nodes: JSONContent[] }) {
  return (
    <div>
      <div className="text-[13px] leading-5 text-text-muted">{label}</div>
      <div
        role="textbox"
        aria-label={label}
        className="mt-1 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[14px] leading-6 text-text"
      >
        {nodes.map((node, i) => {
          if (node.type === "variable") {
            const key = String(node.attrs?.key ?? "");
            return <VariableChipView key={i} variableKey={key} variable={VARIABLES.find((v) => v.key === key)} />;
          }
          return <span key={i}>{node.text}</span>;
        })}
      </div>
    </div>
  );
}

export function EmailDetails() {
  return (
    <section aria-label="Email details" className="flex flex-col gap-3">
      <div className="caps-label">Email details</div>
      <EmailField label="Subject" nodes={EMAIL_SUBJECT} />
      <EmailField label="Preheader" nodes={EMAIL_PREHEADER} />
    </section>
  );
}

const USES = countUses();

/** The rail's body below its first label. `onChannels` makes the Channels toggles live. */
export function RailBody({
  channels,
  onChannels,
  closeSlot,
}: {
  channels: ChannelId[];
  onChannels: (next: ChannelId[]) => void;
  /** The overlay rail puts its close button on the label's line. */
  closeSlot?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex h-6 items-center justify-between px-2">
        <div className="caps-label">Channels</div>
        {closeSlot}
      </div>
      <div className="mt-3 px-2">
        <ChannelSelector
          channels={channels}
          allowed={ALL_CHANNELS}
          editable
          // The mock allows only the document channels, so only they come back.
          onChange={(next) => onChannels(ALL_CHANNELS.filter((c) => next.includes(c)))}
        />
      </div>
      {channels.includes("email") ? (
        <div className="mt-8 px-2">
          <EmailDetails />
        </div>
      ) : null}
      <div className="mt-8">
        <VariablesPanel surface="rail" variables={VARIABLES} uses={USES} editable />
      </div>
    </>
  );
}
