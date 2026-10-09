"use client";

import { Tab, TabList, Tabs } from "@/components/primitives/tabs";
import { Switch } from "@/components/ui/switch";
import { statusLabel } from "@/domain/status";
import type { VersionState } from "@/domain/types";
import { cn } from "@/lib/utils";

// The view tabs over the main pane: the app's tabs (`Tabs`), with the underline sliding to the next
// tab. The panels aren't beside the bar (the document and the output are cells of the review grid, and
// the output is built the first time it is looked at), so each tab names its panel itself. Whatever sits
// at the right of the bar belongs to the view (the change switches on the document, the sample sets on
// the output), 32px tall like every control.

export type ReviewView = "document" | "preview";

const TABS: readonly { id: ReviewView; label: string }[] = [
  { id: "document", label: "Document" },
  { id: "preview", label: "Preview" },
];

export function ViewTabs({
  value,
  onChange,
  previewMounted,
}: {
  value: ReviewView;
  onChange: (view: ReviewView) => void;
  /** The output's panel is in the page (it is built the first time it is looked at). */
  previewMounted: boolean;
}) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabList label="View">
        {TABS.map((tab) => (
          <Tab
            key={tab.id}
            value={tab.id}
            // The panels (document-view.tsx, preview-view.tsx) are labelled by these ids.
            id={`review-tab-${tab.id}`}
            aria-controls={tab.id === "preview" && !previewMounted ? undefined : `review-panel-${tab.id}`}
          >
            {tab.label}
          </Tab>
        ))}
      </TabList>
    </Tabs>
  );
}

function Toggle({
  label,
  shortLabel,
  shortClass,
  fullClass,
  checked,
  onChange,
  count,
  countTitle,
}: {
  /** The name, always (a screen reader hears it however the label is shortened). */
  label: string;
  /** What the label reads below the width `shortClass` and `fullClass` name (a container query on the bar). */
  shortLabel?: string;
  /** Shown only in a bar narrower than its width (`hidden`, then `inline` below the bar width). */
  shortClass?: string;
  /** Hidden in that bar (`hidden` below the bar width). */
  fullClass?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  count?: number;
  countTitle?: string;
}) {
  return (
    <label title={label} className="flex h-8 cursor-pointer items-center gap-2 text-[14px] whitespace-nowrap text-text">
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
      {shortLabel ? (
        <>
          <span className={fullClass}>{label}</span>
          <span aria-hidden className={shortClass}>
            {shortLabel}
          </span>
        </>
      ) : (
        label
      )}
      {count !== undefined ? (
        <span
          title={countTitle}
          className="grid h-5 min-w-5 place-items-center rounded-md bg-selected px-1.5 text-[12px] text-text-muted @max-[29rem]/bar:hidden"
        >
          {count}
        </span>
      ) : null}
    </label>
  );
}

/**
 * What the redline is against: "vs v2" for the Active version. With none Active (after a revoke) it is
 * an older text, and the label says which: "vs v3 (revoked)".
 */
export function baselineLabel({ number, state }: { number: number; state: VersionState }): string {
  return state === "active" ? `vs v${number}` : `vs v${number} (${statusLabel(state).toLowerCase()})`;
}

/**
 * Show changes, flush right, and (once the changes show) Changes only to its left, so Show changes
 * never moves. Offered only when there is a version to compare with (`ReviewScreenData.baseline`): the
 * Active one, or after a revoke the version the correction started from.
 *
 * The group gives way to the bar's width in steps, so it never spills past the bar's edge (800px, with
 * both on, needs the last two): "vs v2" and the count go first (32rem, 29rem), then "Show changes" reads
 * "Changes" (27.5rem) and "Changes only" reads "Only" (25.25rem). The longer "vs v3 (revoked)" goes
 * sooner, at 40rem. The names stay whole for screen readers and in the tooltip.
 */
export function ChangeToggles({
  baseline,
  showChanges,
  onShowChanges,
  changesOnly,
  onChangesOnly,
  count,
  summary,
}: {
  /** The version the redline is against, and its state. */
  baseline: { number: number; state: VersionState };
  showChanges: boolean;
  onShowChanges: (next: boolean) => void;
  changesOnly: boolean;
  onChangesOnly: (next: boolean) => void;
  count: number;
  /** "2 added, 1 removed, and 3 changed": the count's tooltip. */
  summary: string;
}) {
  return (
    <div data-change-toggles="" className="flex items-center gap-x-5 @max-[32rem]/bar:gap-x-4">
      {showChanges ? (
        <>
          <span
            data-slot="baseline-label"
            className={cn(
              "text-[13px] whitespace-nowrap text-text-muted",
              baseline.state === "active" ? "@max-[32rem]/bar:hidden" : "@max-[40rem]/bar:hidden",
            )}
          >
            {baselineLabel(baseline)}
          </span>
          <Toggle
            label="Changes only"
            shortLabel="Only"
            fullClass="@max-[25.25rem]/bar:hidden"
            shortClass="hidden @max-[25.25rem]/bar:inline"
            checked={changesOnly}
            onChange={onChangesOnly}
          />
        </>
      ) : null}
      <Toggle
        label="Show changes"
        shortLabel="Changes"
        fullClass="@max-[27.5rem]/bar:hidden"
        shortClass="hidden @max-[27.5rem]/bar:inline"
        checked={showChanges}
        onChange={onShowChanges}
        count={count}
        countTitle={summary}
      />
    </div>
  );
}
