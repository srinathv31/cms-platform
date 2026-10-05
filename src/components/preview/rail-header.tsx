"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { X } from "lucide-react";
import { m } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "@/components/motion/presets";
import { Button } from "@/components/ui/button";
import type { PreviewView } from "@/components/workspace/session/session-store";
import { cn } from "@/lib/utils";

/** One tab of the header. `count` is a quiet number after the label (Comments 5). */
export interface RailHeaderView {
  value: PreviewView;
  label: string;
  count?: number;
}

const VIEWS: readonly RailHeaderView[] = [
  { value: "preview", label: "Preview" },
  { value: "variables", label: "Variables" },
];

/**
 * The tabs for a rail that has more than Variables: Preview (while the rail is widened), Original
 * (when the template was imported), Comments with its count (when it has review comments), Variables.
 */
export function railHeaderViews({
  preview,
  comments,
  original = false,
}: {
  preview: boolean;
  comments: number | null;
  original?: boolean;
}): RailHeaderView[] {
  return [
    ...(preview ? [VIEWS[0]] : []),
    ...(original ? [{ value: "original" as const, label: "Original" }] : []),
    ...(comments === null ? [] : [{ value: "comments" as const, label: "Comments", count: comments }]),
    VIEWS[1],
  ];
}

// The tab idiom of the workspace tab bar (workspace-tabs.tsx): text only, muted until chosen, then dark
// and medium with a 2px dark underline that sits on the row's hairline and slides to the other tab.
// The focus ring goes round the label, not the tab's box, so it can't run into the underline.
const TAB =
  "group/tab relative flex h-full items-center text-[14px] text-text-muted outline-none hover:text-text data-active:text-text";
const LABEL =
  "-mx-1.5 grid rounded-md px-1.5 py-0.5 group-focus-visible/tab:ring-2 group-focus-visible/tab:ring-ring";

/**
 * The header row of the widened rail: Preview | Variables at the left, the rail's own control at the
 * right (the Preview view's sample-set switcher; nothing on Variables), and, where the rail is an
 * overlay over the whole canvas, a Close button at the far end (there is no tab bar to close the
 * preview from). The row is 44px with the hairline under it, whatever it holds, so what is under it
 * never moves.
 *
 * Preview shows the rendered output; Variables shows the normal rail (Channels, Email details,
 * Variables) to change what it is rendered from. When the template has review comments the header
 * also holds a Comments tab (`views`, from `railHeaderViews`), and the plain rail uses the same
 * header without the Preview tab, so the comments never look like a different control.
 */
export function RailHeader({
  value,
  onChange,
  onClose,
  views = VIEWS,
  children,
}: {
  value: PreviewView;
  onChange: (view: PreviewView) => void;
  /** The tabs, in order. Preview | Variables unless the rail has comments. */
  views?: readonly RailHeaderView[];
  /** Shown only below the rail's breakpoint, where the rail is an overlay. */
  onClose: () => void;
  /** The control at the right of the row. It gives way (truncates) before the tabs do. */
  children?: ReactNode;
}) {
  return (
    <div data-slot="rail-header" className="flex h-11 shrink-0 items-start gap-3 border-b border-hairline">
      <TabsPrimitive.Root
        value={value}
        onValueChange={(next) => {
          const view = views.find((v) => v.value === next);
          if (view) onChange(view.value);
        }}
        className="shrink-0"
      >
        <TabsPrimitive.List aria-label="Rail" className="-mb-px flex h-11 gap-6">
          {views.map((view) => {
            const active = view.value === value;
            return (
              <TabsPrimitive.Tab key={view.value} value={view.value} className={TAB}>
                <span className={LABEL}>
                  {/* The medium weight is wider: an unseen copy of the label holds the room for it, so the tabs don't shift when they swap. */}
                  <span className={cn("col-start-1 row-start-1 flex items-baseline gap-1.5", active && "font-medium")}>
                    {view.label}
                    {view.count ? <span className="text-[13px] font-normal text-text-subtle tabular-nums">{view.count}</span> : null}
                  </span>
                  <span aria-hidden className="invisible col-start-1 row-start-1 flex items-baseline gap-1.5 font-medium">
                    {view.label}
                    {view.count ? <span className="text-[13px] tabular-nums">{view.count}</span> : null}
                  </span>
                </span>
                {active ? (
                  <m.span
                    layoutId="rail-tab-underline"
                    transition={spring.soft}
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text"
                  />
                ) : null}
              </TabsPrimitive.Tab>
            );
          })}
        </TabsPrimitive.List>
      </TabsPrimitive.Root>
      <div data-slot="rail-header-end" className="ml-auto flex min-w-0 pt-1.5">
        {children}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Close"
        className="mt-1.5 shrink-0 @min-[53rem]/ws:hidden"
        onClick={onClose}
      >
        <X strokeWidth={1.75} />
      </Button>
    </div>
  );
}
