import type { TemplateUsageData } from "@/domain/golive-types";
import { PUSH_PLATFORMS } from "@/domain/messages/push";
import { CHANNEL_LABELS, PLATFORM_LABELS } from "@/domain/render/errors";
import { CHANNELS, type Channel } from "@/domain/types";
import { SERIES, type MixPart, type StackSeries } from "./charts";

// How the Usage screens colour a channel: one hue each, the same on every chart and on both screens, so a
// channel keeps its colour across the page (decision 0014).

/**
 * Each channel's hue. The charts list the channels in `CHANNELS` order, and the channel mix colours its
 * parts in the order it gets them, so a channel has the same hue here and there.
 */
export const CHANNEL_HUE: Readonly<Record<Channel, (typeof SERIES)[number]>> = {
  pdf: SERIES[0],
  web: SERIES[1],
  email: SERIES[2],
  push: SERIES[3],
  sms: SERIES[4],
};
export const CHANNEL_SERIES: StackSeries[] = CHANNELS.map((c) => ({ label: CHANNEL_LABELS[c], ...CHANNEL_HUE[c] }));

/** A push logged before the platform was kept: no phone to name, so no hue. */
const UNRECORDED = { label: `${CHANNEL_LABELS.push} · not recorded`, bg: "bg-heat-empty" } as const;

/**
 * The channel mix of one template's Usage tab: a part for each channel its content type allows, in the
 * channel's hue. Push is split by the phone it was for, "Push · iPhone" in the hue and "Push · Android" one
 * step fainter, so they read as one channel and tell apart by their names, which the legend prints with
 * each share (decision 0039). Pushes that predate the platform get a part of their own while there are any.
 */
export function templateMixParts(d: Pick<TemplateUsageData, "channels" | "byChannel" | "pushByPlatform">): MixPart[] {
  return d.channels.flatMap((channel): MixPart[] => {
    const bg = CHANNEL_HUE[channel].bg;
    if (channel !== "push") return [{ label: CHANNEL_LABELS[channel], value: d.byChannel[channel], bg }];
    return [
      ...PUSH_PLATFORMS.map((platform, i) => ({
        label: `${CHANNEL_LABELS.push} · ${PLATFORM_LABELS[platform]}`,
        value: d.pushByPlatform[platform],
        bg,
        faded: i > 0,
      })),
      ...(d.pushByPlatform.unrecorded > 0 ? [{ label: UNRECORDED.label, value: d.pushByPlatform.unrecorded, bg: UNRECORDED.bg }] : []),
    ];
  });
}
