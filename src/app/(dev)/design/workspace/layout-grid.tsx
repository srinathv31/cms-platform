"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CanvasScroll } from "./shell-frame";
import { Actions, HEADER_BAND, IdAndRing, MetaRow, PanelToggle, TabBar, TabStub, TitleField } from "./header-parts";
import { VariablesPanel } from "./variables-panel";
import type { FrameProps } from "./types";

/*
 * A · Grid. One page on a two-column grid (document | 18.75rem panel), left-aligned, centered as a
 * unit (cap 68.75rem = 760 text + 2.5rem gap + 300 panel).
 *
 *   edges:  left  = title = status row = tabs = document TEXT (the handle gutter hangs into the margin)
 *           right = Template ID / ring = Preview + black button = panel
 *   The header and the tab bar span both columns; only the body splits.
 */

export function GridLayout(p: FrameProps) {
  const { model } = p;
  const [overlay, setOverlay] = useState(false);
  const onContent = p.tab === "content";

  return (
    <CanvasScroll>
      <div className="@container mx-auto w-full max-w-[68.75rem]">
        <div className={cn("mt-2 flex gap-8", HEADER_BAND)}>
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
            <TitleField model={model} onName={p.onName} />
            <MetaRow model={model} saving={p.saving} onChannels={p.onChannels} />
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
                  <PanelToggle open={overlay} onClick={() => setOverlay((o) => !o)} className="@min-[54rem]:hidden" />
                ) : null
              }
            />
          }
        />

        {/* Narrow canvas: the panel floats over the document's right edge, under the toggle. */}
        {onContent && overlay ? (
          <div className="sticky top-14 z-30 h-0 @min-[54rem]:hidden">
            <div className="absolute top-1 right-0 w-75">
              <VariablesPanel
                surface="float"
                variables={p.variables}
                uses={p.uses}
                editable={model.editing}
              />
            </div>
          </div>
        ) : null}

        {onContent ? (
          <div className="grid gap-x-10 pt-8 @min-[54rem]:grid-cols-[minmax(0,1fr)_18.75rem]">
            <div className="wm-doc" data-heads={p.heads}>
              {p.doc}
            </div>
            <div className="sticky top-15 hidden self-start @min-[54rem]:block">
              <VariablesPanel variables={p.variables} uses={p.uses} editable={model.editing} />
            </div>
          </div>
        ) : (
          <div className="pt-8">
            <TabStub tab={p.tab} />
          </div>
        )}
      </div>
    </CanvasScroll>
  );
}
