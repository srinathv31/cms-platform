"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CanvasScroll } from "./shell-frame";
import { Actions, HEADER_BAND, IdAndRing, MetaRow, PanelToggle, TabBar, TabStub, TitleField } from "./header-parts";
import { VariablesPanel } from "./variables-panel";
import type { FrameProps } from "./types";

/*
 * B · Column. Header, tabs and document are ONE centered column (text width 47.5rem), so every
 * edge is shared by construction: title = tabs = text on the left; ID / ring = black button = text
 * on the right. The panel is a card that hangs to the right of the column and is closed by default
 * (a toggle sits beside Preview). Open, it pushes the column left while there is room (canvas
 * 60rem+), and floats over the document's right edge below that.
 */

export function ColumnLayout(p: FrameProps) {
  const { model } = p;
  const [open, setOpen] = useState(false);
  const onContent = p.tab === "content";

  return (
    <CanvasScroll>
      <div className="@container">
        <div className={cn("grid gap-x-10", open && onContent && "@min-[60rem]:grid-cols-[minmax(0,1fr)_18.75rem]")}>
          <div className="min-w-0">
            <div className="mx-auto w-full max-w-(--doc-width)">
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
                    lead={onContent ? <PanelToggle open={open} onClick={() => setOpen((o) => !o)} /> : null}
                  />
                }
              />

              {/* Below 60rem the panel floats over the document's right edge, under the toggle. */}
              {open && onContent ? (
                <div className="sticky top-14 z-30 h-0 @min-[60rem]:hidden">
                  <div className="absolute top-1 right-0 w-75">
                    <VariablesPanel surface="float" variables={p.variables} uses={p.uses} editable={model.editing} />
                  </div>
                </div>
              ) : null}

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

          {open && onContent ? (
            <div className="hidden pt-[6.5rem] @min-[60rem]:block">
              <div className="sticky top-15">
                <VariablesPanel variables={p.variables} uses={p.uses} editable={model.editing} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </CanvasScroll>
  );
}
