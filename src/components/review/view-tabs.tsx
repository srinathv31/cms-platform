"use client";

import { m } from "motion/react";
import { spring } from "@/components/motion/presets";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// The view tabs over the main pane, in the workspace tab bar's idiom (workspace-tabs.tsx): text only,
// muted until chosen, then dark and medium with a 2px underline on the hairline that slides to the
// next tab. Whatever sits at the right of the bar belongs to the view (the change switches on the
// document, the sample sets on the output), 32px tall like every control.

const TAB = "group/tab relative -mb-px flex h-11 items-center text-[15px] outline-none";
const LABEL = "-mx-1.5 rounded-md px-1.5 py-0.5 group-focus-visible/tab:ring-2 group-focus-visible/tab:ring-ring";

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
    <div role="tablist" aria-label="View" className="flex gap-7">
      {TABS.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`review-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={tab.id === "preview" && !previewMounted ? undefined : `review-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              // Arrow keys move between the two tabs (a tablist's own keyboard model).
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const next = TABS[(TABS.findIndex((t) => t.id === tab.id) + 1) % TABS.length].id;
              onChange(next);
              requestAnimationFrame(() => document.getElementById(`review-tab-${next}`)?.focus());
            }}
            className={cn(TAB, active ? "font-medium text-text" : "text-text-muted hover:text-text")}
          >
            <span className={LABEL}>{tab.label}</span>
            {active ? (
              <m.span
                layoutId="review-tab-underline"
                transition={spring.soft}
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text"
              />
            ) : null}
          </button>
        );
      })}
    </div>
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
 * Show changes, flush right, and (once the changes show) Changes only to its left, so Show changes
 * never moves. Offered only when there is an Active version to compare with.
 *
 * The group gives way to the bar's width in steps, so it never spills past the bar's edge (800px, with
 * both on, needs the last two): "vs v2" and the count go first (32rem, 29rem), then "Show changes" reads
 * "Changes" (27.5rem) and "Changes only" reads "Only" (25.25rem). The names stay whole for screen
 * readers and in the tooltip.
 */
export function ChangeToggles({
  baselineNumber,
  showChanges,
  onShowChanges,
  changesOnly,
  onChangesOnly,
  count,
  summary,
}: {
  baselineNumber: number;
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
          <span className="text-[13px] whitespace-nowrap text-text-muted @max-[32rem]/bar:hidden">vs v{baselineNumber}</span>
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
