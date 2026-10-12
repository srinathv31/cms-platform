// Channel rules. A channel turned off stops rendering at once, Active versions included: the consequence
// names how many. At least one channel stays on. A content type is one family, documents (PDF, Web,
// Email) or messages (Push, SMS), never both (decision 0034): a channel from the other family can't be
// turned on. Its family is the family of the channels it allows, and since one always stays on, it
// never changes.

import type { AccessEffect, Named, Ok, Refused } from "../access-types";
import { formatCount } from "../numbers";
import { pluralWord } from "../plural";
import { refuse, type Refusal } from "../refusals";
import { CHANNEL_LABELS } from "../render/errors";
import { CHANNELS, channelFamily, familyOf, type Channel } from "../types";
import { configChanged } from "./effects";
import { PLATFORM_REFUSALS } from "./refusals";

/**
 * What turning a channel off stops, before it is committed (the confirm shows these lines):
 * "2 Active Disclosure versions stop rendering to Email." Turning one on changes nothing that renders.
 */
export function channelOffConsequences(
  contentTypeName: string,
  channel: Channel,
  activeUsing: number,
): string[] {
  const label = CHANNEL_LABELS[channel];
  const lines =
    activeUsing > 0
      ? [
          `${formatCount(activeUsing)} Active ${contentTypeName} ${pluralWord(activeUsing, "version stops", "versions stop")} rendering to ${label}.`,
        ]
      : [`No Active ${contentTypeName} version renders to ${label}.`];
  lines.push(`New ${contentTypeName} templates can't turn ${label} on.`);
  return lines;
}

/** A content type as the channel rules read it: its name and the channels it allows. */
export interface ChannelRuleType {
  name: string;
  allowedChannels: readonly Channel[];
}

/**
 * Why a content type can't have `channel` set to `allowed`, or null: it must be a channel; at least one
 * channel stays on; and a content type is one family (docs/decisions/0034), so a channel from the
 * other family can't be turned on: "Disclosures are documents. Push and SMS go on Alert templates."
 * `contentTypes` are the platform's content types, to name the ones the channel's family goes on. The
 * channel rules read model asks it for every switch, so a switch that can't flip shows disabled with
 * the reason.
 */
export function channelRuleRefusal(
  contentType: ChannelRuleType,
  channel: Channel,
  allowed: boolean,
  contentTypes: readonly ChannelRuleType[] = [],
): Refusal | null {
  if (!(CHANNELS as readonly string[]).includes(channel))
    return PLATFORM_REFUSALS.oneChannel;
  const family = familyOf(contentType.allowedChannels);
  if (allowed && family !== null && channelFamily(channel) !== family) {
    const homes = contentTypes
      .filter(
        (type) => familyOf(type.allowedChannels) === channelFamily(channel),
      )
      .map((type) => type.name)
      .sort((a, b) => a.localeCompare(b));
    return PLATFORM_REFUSALS.otherFamily(contentType.name, family, homes);
  }
  const next = CHANNELS.filter((c) =>
    c === channel ? allowed : contentType.allowedChannels.includes(c),
  );
  return next.length === 0 ? PLATFORM_REFUSALS.oneChannel : null;
}

/** Turns one channel on or off for a content type (the type × channel matrix). */
export function setChannelRule(input: {
  contentType: { id: string; name: string; allowedChannels: Channel[] };
  channel: Channel;
  allowed: boolean;
  activeUsing: number;
  /** Every content type, to name the ones a channel of the other family goes on (`channelRuleRefusal`). */
  contentTypes: readonly ChannelRuleType[];
  actor: Named;
  now: Date;
}):
  | Ok<{
      allowedChannels: Channel[];
      consequences: string[];
      effects: AccessEffect[];
    }>
  | Refused {
  const { contentType, channel, allowed } = input;
  const current = contentType.allowedChannels;
  if (!(CHANNELS as readonly string[]).includes(channel))
    return refuse(PLATFORM_REFUSALS.oneChannel);
  if (current.includes(channel) === allowed)
    return {
      ok: true,
      allowedChannels: current,
      consequences: [],
      effects: [],
    };
  const refusal = channelRuleRefusal(
    contentType,
    channel,
    allowed,
    input.contentTypes,
  );
  if (refusal) return refuse(refusal);

  const next = CHANNELS.filter((c) =>
    c === channel ? allowed : current.includes(c),
  );

  const label = CHANNEL_LABELS[channel];
  const consequences = allowed
    ? []
    : channelOffConsequences(contentType.name, channel, input.activeUsing);
  const summary = allowed
    ? `Turned on ${label} for ${contentType.name}`
    : `Turned off ${label} for ${contentType.name}` +
      (input.activeUsing > 0
        ? `: ${formatCount(input.activeUsing)} Active ${pluralWord(input.activeUsing, "version stopped", "versions stopped")} rendering to ${label}`
        : "");
  return {
    ok: true,
    allowedChannels: next,
    consequences,
    effects: [
      configChanged("channel_rules", null, summary, {
        contentTypeId: contentType.id,
        contentTypeName: contentType.name,
        channel,
        allowed,
        activeUsing: allowed ? 0 : input.activeUsing,
      }),
    ],
  };
}
