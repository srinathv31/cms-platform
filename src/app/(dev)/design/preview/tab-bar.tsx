"use client";

import { Eye, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TabId } from "../workspace/types";

/*
 * The tab bar with the template's actions at its right end: an outline Preview toggle (pressed while
 * previewing) and the one black button, Submit for review. It is its own `@container/bar`, so when a
 * variant leaves it a narrow column the tabs close up and Preview shrinks to its icon.
 */

const TABS: { id: TabId; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "versions", label: "Versions" },
  { id: "usage", label: "Usage" },
  { id: "activity", label: "Activity" },
];

export function PreviewToggle({
  pressed,
  onToggle,
  className,
}: {
  pressed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      aria-pressed={pressed}
      aria-label="Preview"
      title="Preview"
      onClick={onToggle}
      // Below a bar width of about 34rem the label gives way to the icon.
      className={cn("px-3.5 aria-pressed:bg-selected @max-[34rem]/bar:w-9 @max-[34rem]/bar:px-0", className)}
    >
      <Eye data-icon="inline-start" strokeWidth={1.75} />
      <span className="@max-[34rem]/bar:sr-only">Preview</span>
    </Button>
  );
}

/** Opens the rail over the document where the canvas is too narrow to show it beside it. */
export function RailToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="icon-lg"
      aria-label="Channels and variables"
      aria-pressed={open}
      title="Channels and variables"
      onClick={onClick}
      className={cn(open && "bg-selected")}
    >
      <PanelRight strokeWidth={1.75} />
    </Button>
  );
}

export function PreviewTabBar({
  tab,
  onTab,
  previewing,
  onPreview,
  lead,
  className,
}: {
  tab: TabId;
  onTab: (tab: TabId) => void;
  previewing: boolean;
  onPreview: () => void;
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("@container/bar", className)}>
      <div className="flex items-start justify-between gap-4 border-b border-hairline bg-canvas">
        <Tabs value={tab} onValueChange={(v) => onTab(v as TabId)} className="min-w-0">
          <TabsList variant="line" className="gap-6 p-0 group-data-horizontal/tabs:h-11 @max-[34rem]/bar:gap-4">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="h-full flex-none px-0 text-[15px] group-data-horizontal/tabs:after:-bottom-px data-active:font-medium"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex h-11 shrink-0 items-center gap-2">
          {lead}
          <PreviewToggle pressed={previewing} onToggle={onPreview} />
          {/* In the tightest column (C on a 1280px window) the label closes up to "Submit". */}
          <Button size="lg" className="px-4" aria-label="Submit for review">
            <span>
              Submit<span className="@max-[28rem]/bar:hidden"> for review</span>
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
