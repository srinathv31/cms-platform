// The outputs an approver views before approving (decision 0037). A version's outputs are its enabled
// channels, with Push counted twice: the Preview draws a push on an iPhone and on an Android phone, and
// the two differ (the subtitle is iPhone-only, and each phone cuts the text at its own length). Approve
// is refused while any of them hasn't rendered on the approver's screen. Request changes never is: an
// approver can send a version back without looking at everything.
//
// One rule on both sides: the approve transition refuses with `outputsRefusal`, and the review screen
// asks the same function to show Approve blocked with the same sentence.

import { assertNever } from "./assert-never";
import type { PushPlatform } from "./messages/push";
import { refusal, type Refusal } from "./refusals";
import { CHANNEL_LABELS, PLATFORM_LABELS, joinWithAnd } from "./render/errors";
import { CHANNELS, type Channel } from "./types";

/** Every output there is, in the order the outputs are named: a channel, or Push on one platform. */
export const OUTPUT_KEYS = ["pdf", "web", "email", "push.ios", "push.android", "sms"] as const;
export type OutputKey = (typeof OUTPUT_KEYS)[number];

export function isOutputKey(value: string): value is OutputKey {
  return (OUTPUT_KEYS as readonly string[]).includes(value);
}

/** The output on screen: the channel, and for a push the phone it is drawn on. */
export function outputKey(channel: Channel, platform: PushPlatform): OutputKey {
  switch (channel) {
    case "pdf":
    case "web":
    case "email":
    case "sms":
      return channel;
    case "push":
      return platform === "ios" ? "push.ios" : "push.android";
    default:
      return assertNever(channel, "channel");
  }
}

/** A channel's outputs: one, or Push's two. */
export function channelOutputs(channel: Channel): OutputKey[] {
  return channel === "push" ? ["push.ios", "push.android"] : [outputKey(channel, "ios")];
}

/** The outputs a version's approver has to view: each of its channels' outputs, in the order outputs are named. */
export function requiredOutputs(channels: readonly Channel[]): OutputKey[] {
  return CHANNELS.filter((channel) => channels.includes(channel)).flatMap(channelOutputs);
}

/** The required outputs not among `viewed`, in order. Keys that aren't outputs, or aren't required, are ignored. */
export function missingOutputs(channels: readonly Channel[], viewed: readonly string[]): OutputKey[] {
  return requiredOutputs(channels).filter((key) => !viewed.includes(key));
}

/** The required outputs among `viewed`, in order and each once: what an approval records. */
export function viewedOutputs(channels: readonly Channel[], viewed: readonly string[]): OutputKey[] {
  return requiredOutputs(channels).filter((key) => viewed.includes(key));
}

/** The phone a push output is drawn on. */
function platformOf(key: "push.ios" | "push.android"): PushPlatform {
  return key === "push.ios" ? "ios" : "android";
}

/** "PDF", "Push (iPhone)", "Push (Android)", "SMS": the channel's name, and a push's phone as the Preview names it. */
export function outputLabel(key: OutputKey): string {
  switch (key) {
    case "push.ios":
    case "push.android":
      return `${CHANNEL_LABELS.push} (${PLATFORM_LABELS[platformOf(key)]})`;
    default:
      return CHANNEL_LABELS[key];
  }
}

/**
 * Outputs named a channel at a time, a push with the phones left: "PDF", "Push (iPhone, Android)",
 * "Push (Android)", "SMS". Short enough for the line under the approval stage.
 */
export function outputsLabels(outputs: readonly OutputKey[]): string[] {
  return CHANNELS.flatMap((channel) => {
    const keys = channelOutputs(channel).filter((key) => outputs.includes(key));
    if (keys.length === 0) return [];
    if (channel !== "push") return [CHANNEL_LABELS[channel]];
    const phones = keys.map((key) => PLATFORM_LABELS[platformOf(key as "push.ios" | "push.android")]);
    return [`${CHANNEL_LABELS.push} (${phones.join(", ")})`];
  });
}

export const OUTPUT_REFUSALS = {
  /** "Preview Push (Android) and SMS first." */
  notViewed: refusal(
    "output_not_viewed",
    (missing: readonly OutputKey[]) => `Preview ${joinWithAnd(outputsLabels(missing))} first.`,
  ),
} as const;

/** Why Approve isn't available yet: an output not viewed, named. Null once every required output has been. */
export function outputsRefusal(channels: readonly Channel[], viewed: readonly string[]): Refusal | null {
  const missing = missingOutputs(channels, viewed);
  return missing.length === 0 ? null : OUTPUT_REFUSALS.notViewed(missing);
}
