"use client";

import { m } from "motion/react";
import { Download } from "lucide-react";
import { duration, ease } from "@/components/motion/presets";
import { ChannelTabs, DevicePicker } from "@/components/preview/controls";
import { SampleSetSwitcher, resolveSetValues } from "@/components/preview/sample-sets";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { makeCtx } from "../preview/render-doc";
import { CHANNELS, SAMPLE_SETS, TODAY, VARIABLES } from "./fixtures";
import { Output } from "./outputs";
import type { ChannelId, DeviceId } from "./types";

/*
 * The rendered output of the version under review: the preview's controls (the channel control and,
 * for Web, Desktop / Mobile or, for PDF, Download) in one 32px row, then the output on a tinted well.
 * The sample-set switcher is the real, read-only one; the tab bar carries it.
 */

export function SampleSets({ setId, onSet }: { setId: string; onSet: (id: string) => void }) {
  return (
    <SampleSetSwitcher
      readOnly
      sets={SAMPLE_SETS}
      variables={VARIABLES}
      today={TODAY}
      selectedId={setId}
      onSelect={onSet}
    />
  );
}

export function OutputView({
  channel,
  onChannel,
  device,
  onDevice,
  setId,
  bleed = false,
}: {
  channel: ChannelId;
  onChannel: (channel: ChannelId) => void;
  device: DeviceId;
  onDevice: (device: DeviceId) => void;
  setId: string;
  /** Output first: the well takes the main pane's margins (the page needs the width), not the text column's. */
  bleed?: boolean;
}) {
  const set = SAMPLE_SETS.find((s) => s.id === setId) ?? SAMPLE_SETS[0];
  const values = Object.fromEntries(
    Object.entries(resolveSetValues(set, VARIABLES, TODAY)).map(([key, value]) => [key, String(value)]),
  );
  const ctx = makeCtx(VARIABLES, values);

  return (
    <div data-output-view="" className="@container/controls pt-8 pb-14">
      <div className="flex h-8 items-center justify-between gap-3">
        <ChannelTabs channels={CHANNELS} value={channel} onChange={onChannel} />
        {channel === "pdf" ? (
          <Button variant="outline" className="gap-1.5 bg-surface px-3 text-[13px]">
            <Download data-icon="inline-start" strokeWidth={1.75} />
            Download PDF
          </Button>
        ) : null}
        {channel === "web" ? <DevicePicker value={device} onChange={onDevice} /> : null}
      </div>
      <div
        data-output-well=""
        className={cn(
          "mt-3 rounded-xl border border-hairline bg-surface-tinted py-4",
          bleed ? "-mr-4 -ml-11 px-3" : "px-4",
        )}
      >
        <m.div
          key={`${channel}:${channel === "web" ? device : ""}:${setId}`}
          initial={{ opacity: 0.3, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.base, ease: ease.outSoft }}
        >
          <Output channel={channel} device={device} ctx={ctx} />
        </m.div>
      </div>
    </div>
  );
}

