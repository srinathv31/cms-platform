"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Actions, ChannelChips, HEADER_BAND, IdAndRing, MetaRow, PanelToggle, TabBar, TabStub, TitleField } from "./header-parts";
import { VariablesPanel } from "./variables-panel";
import type { FrameProps } from "./types";

/*
 * C · Rail. The canvas splits into two panes. The main pane (header, tabs, document) is one
 * centered column; the right rail is a flush full-height strip with a hairline divider, scrolling
 * on its own, with Channels above Variables (so Email details can later sit right under the Email
 * chip). The same rail can swap to Preview's split view. Below 56rem the rail becomes an overlay
 * behind a toggle.
 */

export function RailLayout(p: FrameProps) {
  const { model } = p;
  const [overlay, setOverlay] = useState(false);
  const onContent = p.tab === "content";

  const railBody = (closable: boolean) => (
    <>
      <div className="flex h-6 items-center justify-between">
        <div className="caps-label">Channels</div>
        {closable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            className="-mr-1.5"
            onClick={() => setOverlay(false)}
          >
            <X strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>
      <ChannelChips model={model} onChannels={p.onChannels} className="mt-3" />
      <div className="mt-8">
        <VariablesPanel surface="rail" variables={p.variables} uses={p.uses} editable={model.editing} />
      </div>
    </>
  );

  return (
    <div className="@container relative flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-10 pb-14 pl-(--canvas-pad-x)">
        <div className="mx-auto w-full max-w-(--doc-width)">
          <div className={cn("mt-2 flex gap-8", HEADER_BAND)}>
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <TitleField model={model} onName={p.onName} />
              <MetaRow model={model} saving={p.saving} onChannels={p.onChannels} withChannels={false} />
            </div>
            <IdAndRing model={model} />
          </div>

          <TabBar
            className="mt-6"
            tab={p.tab}
            onTab={p.onTab}
            actions={
              <Actions
                model={model}
                onEdit={p.onEdit}
                lead={
                  onContent ? (
                    <PanelToggle open={overlay} onClick={() => setOverlay((o) => !o)} className="@min-[56rem]:hidden" />
                  ) : null
                }
              />
            }
          />

          {onContent ? (
            <div className="wm-doc pt-8" data-heads={p.heads}>
              {p.doc}
            </div>
          ) : (
            <div className="pt-8">
              <TabStub tab={p.tab} />
            </div>
          )}
        </div>
      </div>

      {onContent ? (
        <aside
          aria-label="Channels and variables"
          className="hidden min-h-0 w-80 shrink-0 overflow-y-auto border-l border-hairline px-5 pt-3 pb-14 @min-[56rem]:block"
        >
          {railBody(false)}
        </aside>
      ) : null}

      {onContent && overlay ? (
        <aside
          aria-label="Channels and variables"
          className="absolute inset-y-0 right-0 z-30 w-80 overflow-y-auto border-l border-hairline bg-canvas px-5 pt-3 pb-14 shadow-pop @min-[56rem]:hidden"
        >
          {railBody(true)}
        </aside>
      ) : null}
    </div>
  );
}
