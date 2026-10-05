"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { X } from "lucide-react";
import { m } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "@/components/motion/presets";
import { Button } from "@/components/ui/button";
import type { PreviewView } from "@/components/workspace/session/session-store";
import { cn } from "@/lib/utils";

const VIEWS: readonly { value: PreviewView; label: string }[] = [
  { value: "preview", label: "Preview" },
  { value: "variables", label: "Variables" },
];

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
 * Variables) to change what it is rendered from.
 */
export function RailHeader({
  value,
  onChange,
  onClose,
  children,
}: {
  value: PreviewView;
  onChange: (view: PreviewView) => void;
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
          if (next === "preview" || next === "variables") onChange(next);
        }}
        className="shrink-0"
      >
        <TabsPrimitive.List aria-label="Rail" className="-mb-px flex h-11 gap-6">
          {VIEWS.map((view) => {
            const active = view.value === value;
            return (
              <TabsPrimitive.Tab key={view.value} value={view.value} className={TAB}>
                <span className={LABEL}>
                  {/* The medium weight is wider: an unseen copy of the label holds the room for it, so the tabs don't shift when they swap. */}
                  <span className={cn("col-start-1 row-start-1", active && "font-medium")}>{view.label}</span>
                  <span aria-hidden className="invisible col-start-1 row-start-1 font-medium">
                    {view.label}
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
