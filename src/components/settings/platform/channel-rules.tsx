"use client";

import { useRef, useState } from "react";
import type { ChannelRuleRow, ChannelRulesSection } from "@/domain/access-types";
import { channelOffConsequences } from "@/domain/platform-config";
import { CHANNEL_LABELS } from "@/domain/render/errors";
import type { Channel } from "@/domain/types";
import { Switch } from "@/components/ui/switch";
import { setChannelRule } from "@/server/actions/platform";
import { useActionRun } from "@/components/primitives/use-action-run";
import { Strip } from "../strip";
import { Blocked, FullRow, useFocusAfterCommit } from "./ui";

// Settings > Platform > Channel rules: the content type by channel matrix. Turning a channel on takes
// effect at once; turning one off says what it stops (from the Active versions that use it) in a strip
// under the row, and only the strip's confirm commits it. A switch that can't flip (the last channel on)
// comes decided from the read model, `row.can.toggle`, and shows disabled with its reason.

/** The content type's name, then one column per channel (five: documents and messages side by side). */
const colsFor = (channels: readonly Channel[]) => `minmax(0,1fr) repeat(${channels.length}, 4.5rem)`;

export function ChannelRulesSectionView({ section }: { section: ChannelRulesSection }) {
  // One turn-off strip at a time across the table.
  const [asking, setAsking] = useState<{ contentTypeId: string; channel: Channel } | null>(null);
  return (
    <div data-slot="platform-section" data-section="channel-rules" role="table" aria-label="Channel rules">
      <div role="row" className="grid items-end gap-x-4 border-b border-hairline pb-2" style={{ gridTemplateColumns: colsFor(section.channels) }}>
        <span role="columnheader" className="caps-label">Content type</span>
        {section.channels.map((c) => (
          <span role="columnheader" key={c} className="caps-label text-center">
            {CHANNEL_LABELS[c]}
          </span>
        ))}
      </div>
      {section.rows.map((row) => (
        <TypeRow
          key={row.contentTypeId}
          row={row}
          channels={section.channels}
          asking={asking?.contentTypeId === row.contentTypeId ? asking.channel : null}
          setAsking={(channel) => setAsking(channel ? { contentTypeId: row.contentTypeId, channel } : null)}
        />
      ))}
    </div>
  );
}

function TypeRow({
  row,
  channels,
  asking,
  setAsking,
}: {
  row: ChannelRuleRow;
  channels: readonly Channel[];
  asking: Channel | null;
  setAsking: (channel: Channel | null) => void;
}) {
  const { pending, error, run } = useActionRun();
  const switches = useRef(new Map<Channel, HTMLElement | null>());

  const focusAfter = useFocusAfterCommit();
  const closeAsk = () => {
    const channel = asking;
    if (channel) focusAfter(() => switches.current.get(channel));
    setAsking(null);
  };

  return (
    <div role="rowgroup" className="border-b border-hairline">
      <div role="row" className="grid min-h-16 items-center gap-x-4 py-2.5" style={{ gridTemplateColumns: colsFor(channels) }}>
        <div role="cell" className="min-w-0">
          <div className="truncate text-[15px] font-medium text-text">{row.name}</div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-text">
              {error}
            </p>
          ) : null}
        </div>
        {channels.map((channel) => {
          const on = row.allowed[channel];
          const toggle = row.can.toggle[channel];
          const blocked = toggle.ok ? null : toggle.reason;
          return (
            <div role="cell" key={channel} className="flex justify-center">
              <Blocked reason={blocked}>
                <Switch
                  ref={(el) => {
                    switches.current.set(channel, el);
                  }}
                  aria-label={`${row.name} on ${CHANNEL_LABELS[channel]}`}
                  checked={on}
                  disabled={!!blocked}
                  readOnly={pending}
                  onCheckedChange={(next) => {
                    if (pending) return;
                    if (next) {
                      setAsking(null);
                      run(() => setChannelRule({ contentTypeId: row.contentTypeId, channel, allowed: true }));
                    } else {
                      setAsking(channel);
                    }
                  }}
                />
              </Blocked>
            </div>
          );
        })}
      </div>
      {asking ? (
        <FullRow span={channels.length + 1}>
          <Strip
            key={asking}
            lines={channelOffConsequences(row.name, asking, row.activeUsing[asking])}
            confirmLabel={`Turn off ${CHANNEL_LABELS[asking]}`}
            onCancel={closeAsk}
            onDone={closeAsk}
            onConfirm={() => setChannelRule({ contentTypeId: row.contentTypeId, channel: asking, allowed: false })}
            className="mb-3"
          />
        </FullRow>
      ) : null}
    </div>
  );
}
