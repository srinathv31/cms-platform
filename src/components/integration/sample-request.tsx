"use client";

import { useState } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { ChannelTabs } from "@/components/preview/controls";
import type { IntegrationPanelData } from "@/domain/golive-types";
import type { Channel } from "@/domain/types";
import { cn } from "@/lib/utils";
import { CodeBlock, lineCount } from "./code-block";
import { CopyButton } from "./copy-button";

type Flavor = "curl" | "fetch";

// curl | fetch are view switches: text with the 2px dark underline on a hairline (workspace-tabs idiom).
const TAB =
  "-mb-px h-9 border-b-2 border-transparent text-[13px] text-text-muted outline-none transition-colors duration-(--dur-fast) hover:text-text focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring data-active:border-text data-active:font-medium data-active:text-text";

export function SampleRequest({ samples }: { samples: IntegrationPanelData["samples"] }) {
  const channels = samples.map((s) => s.channel);
  const [channel, setChannel] = useState<Channel>(channels[0] ?? "pdf");
  const [flavor, setFlavor] = useState<Flavor>("curl");

  const sample = samples.find((s) => s.channel === channel) ?? samples[0];
  if (!sample) return null;
  const text = sample[flavor];
  // The tallest sample across channels and flavors, so nothing below moves when either switch changes.
  const minLines = Math.max(...samples.flatMap((s) => [lineCount(s.curl), lineCount(s.fetch)]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        {channels.length > 1 ? <ChannelTabs channels={channels} value={channel} onChange={setChannel} /> : <span />}
        <CopyButton label={flavor} text={text} />
      </div>
      <TabsPrimitive.Root value={flavor} onValueChange={(v) => setFlavor(v as Flavor)} className="flex flex-col gap-3">
        <TabsPrimitive.List aria-label="Sample language" className="flex gap-5 border-b border-hairline">
          <TabsPrimitive.Tab value="curl" className={cn(TAB)}>
            curl
          </TabsPrimitive.Tab>
          <TabsPrimitive.Tab value="fetch" className={cn(TAB)}>
            fetch
          </TabsPrimitive.Tab>
        </TabsPrimitive.List>
        {(["curl", "fetch"] as const).map((f) => (
          <TabsPrimitive.Panel key={f} value={f} className="outline-none">
            <CodeBlock label={`${f} sample`} minLines={minLines}>
              {sample[f]}
            </CodeBlock>
          </TabsPrimitive.Panel>
        ))}
      </TabsPrimitive.Root>
    </div>
  );
}
