"use client";

import { useId, useRef, useState, type Ref } from "react";
import type { ChannelRuleRow, ChannelRulesSection } from "@/domain/access-types";
import { channelOffConsequences } from "@/domain/platform-config";
import { CHANNEL_LABELS } from "@/domain/render/errors";
import type { Channel } from "@/domain/types";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setChannelRule } from "@/server/actions/platform";
import { useActionRun } from "@/components/primitives/use-action-run";
import { Strip } from "../strip";
import { FullRow, useFocusAfterCommit } from "./ui";

// Settings > Platform > Channel rules: the content type by channel matrix. Turning a channel on takes
// effect at once; turning one off says what it stops (from the Active versions that use it) in a strip
// under the row, and only the strip's confirm commits it. A switch that can't flip (the last channel on,
// or a channel of the other family) comes decided from the read model, `row.can.toggle`, and shows
// greyed in place with its reason (`ChannelSwitch`).

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
          const toggle = row.can.toggle[channel];
          return (
            <div role="cell" key={channel} className="flex justify-center">
              <ChannelSwitch
                ref={(el) => {
                  switches.current.set(channel, el);
                }}
                label={`${row.name} on ${CHANNEL_LABELS[channel]}`}
                on={row.allowed[channel]}
                blocked={toggle.ok ? null : toggle.reason}
                pending={pending}
                onChange={(next) => {
                  if (next) {
                    setAsking(null);
                    run(() => setChannelRule({ contentTypeId: row.contentTypeId, channel, allowed: true }));
                  } else {
                    setAsking(channel);
                  }
                }}
              />
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

/**
 * One cell's switch. A switch the read model refuses stays in place, greyed and focusable: `aria-disabled`
 * rather than the native `disabled` (Tab would skip that, and its reason with it), its reason the tooltip
 * and its accessible description, and a guard that cancels the change, from a click or Space. It is the
 * same element blocked or not, so a switch whose refusal comes or goes as other channels change keeps
 * its focus.
 */
function ChannelSwitch({
  ref,
  label,
  on,
  blocked,
  pending,
  onChange,
}: {
  ref: Ref<HTMLElement>;
  label: string;
  on: boolean;
  /** Why it can't flip, or null. */
  blocked: string | null;
  pending: boolean;
  onChange: (next: boolean) => void;
}) {
  const reasonId = useId();
  return (
    <>
      <Tooltip disabled={!blocked}>
        <TooltipTrigger
          render={
            <Switch
              ref={ref}
              aria-label={label}
              aria-disabled={blocked ? true : undefined}
              aria-describedby={blocked ? reasonId : undefined}
              checked={on}
              readOnly={pending}
              className="aria-disabled:cursor-default aria-disabled:opacity-50"
              onCheckedChange={(next, details) => {
                if (blocked || pending) {
                  details.cancel();
                  return;
                }
                onChange(next);
              }}
            />
          }
        />
        <TooltipContent>{blocked}</TooltipContent>
      </Tooltip>
      {blocked ? (
        <span id={reasonId} className="sr-only">
          {blocked}
        </span>
      ) : null}
    </>
  );
}
