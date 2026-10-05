"use client";

import { m } from "motion/react";
import { spring } from "@/components/motion/presets";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BASELINE, CHANGE_COUNT, REDLINE } from "./fixtures";
import type { ViewId } from "./types";

/*
 * The view tabs over the main pane, in the workspace tab bar's idiom: text only, muted until chosen,
 * then dark and medium with a 2px underline on the hairline that slides to the next tab. Whatever sits
 * at the right of the bar belongs to the view (Show changes on the document, the sample sets on the
 * output), 32px tall like every control.
 */

const TAB = "group/tab relative -mb-px flex h-11 items-center text-[15px] outline-none";
const LABEL = "-mx-1.5 rounded-md px-1.5 py-0.5 group-focus-visible/tab:ring-2 group-focus-visible/tab:ring-ring";

const { added, removed, changed } = REDLINE.counts;
const SUMMARY = `${added} added, ${removed} removed, ${changed} changed`;

export interface TabSpec {
  id: ViewId;
  label: string;
}

export function ViewTabs({
  tabs,
  value,
  onChange,
  group,
}: {
  tabs: TabSpec[];
  value: ViewId;
  onChange: (view: ViewId) => void;
  /** Keeps the two variants' underlines apart. */
  group: string;
}) {
  return (
    <div role="tablist" aria-label="View" className="flex gap-7">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(TAB, active ? "font-medium text-text" : "text-text-muted hover:text-text")}
          >
            <span className={LABEL}>{tab.label}</span>
            {active ? (
              <m.span
                layoutId={`review-tab-underline-${group}`}
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
  checked,
  onChange,
  count,
  countTitle,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  count?: number;
  countTitle?: string;
  className?: string;
}) {
  return (
    <label className={cn("flex h-8 cursor-pointer items-center gap-2 text-[14px] whitespace-nowrap text-text", className)}>
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
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

/** Show changes, flush right, and (once they show) Changes only to its left, so Show changes never moves. */
export function ChangeToggles({
  showChanges,
  onShowChanges,
  changesOnly,
  onChangesOnly,
  withShow,
}: {
  showChanges: boolean;
  onShowChanges: (next: boolean) => void;
  changesOnly: boolean;
  onChangesOnly: (next: boolean) => void;
  /** The Redline tab has no Show changes: changes are what it is. */
  withShow: boolean;
}) {
  return (
    <div data-change-toggles="" className="flex items-center gap-x-5 @max-[32rem]/bar:gap-x-4">
      {showChanges ? (
        <>
          <span className="text-[13px] whitespace-nowrap text-text-muted @max-[32rem]/bar:hidden">vs v{BASELINE}</span>
          <Toggle label="Changes only" checked={changesOnly} onChange={onChangesOnly} />
        </>
      ) : null}
      {withShow ? <Toggle label="Show changes" checked={showChanges} onChange={onShowChanges} count={CHANGE_COUNT} countTitle={SUMMARY} /> : null}
    </div>
  );
}

