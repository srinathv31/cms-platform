"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Route } from "next";
import { Tabs } from "@base-ui/react/tabs";
import { m } from "motion/react";
import { Check, CornerUpLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { spring } from "@/components/motion/presets";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { BreakingBadge } from "./breaking-badge";
import {
  COLUMNS,
  COLUMNS_DECIDED,
  FOLDED_LINE,
  FOLDED_LINE_DECIDED,
  FOLDS,
  FOLDS_DECIDED,
  ROW,
  ROW_HEIGHT,
} from "./columns";
import { defaultTab, parseTab, type QueueRowView, type QueueTab, type QueueTabKey } from "./format-row";
import { TAB, TAB_BAR, TAB_CONTENT } from "./tab-styles";

function ListHeader({ decided }: { decided: boolean }) {
  return (
    <div aria-hidden className={cn("border-b border-hairline", decided ? FOLDS_DECIDED : FOLDS)}>
      <div className={cn(ROW, "h-10", decided ? COLUMNS_DECIDED : COLUMNS)}>
        <span className="caps-label">Template</span>
        <span className="caps-label">Author</span>
        <span className="caps-label">Submitted</span>
        <span className="caps-label">Stage</span>
        {decided ? <span className="caps-label">Decision</span> : null}
      </div>
    </div>
  );
}

function Decision({ decision, className }: { decision: NonNullable<QueueRowView["decision"]>; className?: string }) {
  const approved = decision.kind === "approved";
  const Icon = approved ? Check : CornerUpLeft;
  return (
    <span className={cn("min-w-0", className)}>
      <span
        className={cn(
          "flex items-center gap-1.5 text-[13px] leading-5 font-medium",
          approved ? "text-status-active-text" : "text-status-changes-text",
        )}
      >
        <Icon aria-hidden strokeWidth={2} className="size-3.5 shrink-0" />
        <span className="truncate">{decision.label}</span>
      </span>
      <span className="mt-0.5 block truncate text-[12px] leading-4 text-text-muted">
        {decision.by} · {decision.when}
      </span>
    </span>
  );
}

function QueueRow({ row, showTeam }: { row: QueueRowView; showTeam: boolean }) {
  const decided = row.decision !== undefined;
  const folds = decided ? FOLDS_DECIDED : FOLDS;
  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        href={row.href as Route}
        className={cn(
          ROW,
          ROW_HEIGHT,
          "rounded-xl py-3 text-[14px] outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
          decided ? COLUMNS_DECIDED : COLUMNS,
        )}
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[15px] leading-5 font-medium" title={row.name}>
              {row.name}
            </span>
            <span className="shrink-0 text-text-muted tabular-nums">{row.versionLabel}</span>
          </span>
          {showTeam || row.breaking ? (
            <span className="mt-0.5 flex h-[22px] min-w-0 items-center gap-2 text-[12px] text-text-muted">
              {showTeam ? <span className="truncate">{row.teamName}</span> : null}
              {row.breaking ? <BreakingBadge /> : null}
            </span>
          ) : null}
          <span className={cn("mt-0.5 truncate text-[12px] leading-4 text-text-muted", decided ? FOLDED_LINE_DECIDED : FOLDED_LINE)}>
            {row.folded}
          </span>
        </span>
        <span className={cn("flex min-w-0 items-center gap-2.5", folds)}>
          <UserAvatar initials={row.author.initials} hue={row.author.hue} size="sm" />
          <span className="truncate">{row.author.name}</span>
        </span>
        <span className={cn("truncate text-text-muted", folds)}>{row.submitted}</span>
        <span className={cn("min-w-0", folds)}>
          <span className="block truncate">{row.stage}</span>
          {row.stageStep ? <span className="block truncate text-[12px] leading-4 text-text-muted">{row.stageStep}</span> : null}
        </span>
        {row.decision ? <Decision decision={row.decision} className={folds} /> : null}
      </Link>
    </li>
  );
}

/**
 * The review queue: Waiting on me, Submitted by me and Recently decided, as underline tabs with their
 * counts, over a calm list. The server made every string (relative times are against the demo clock);
 * this lays them out. The tab is view state in the URL (`?tab=waiting|submitted|decided`), so a row you
 * opened and came back from leaves you where you were, and the link can be shared. With no `tab` it
 * opens on Waiting on me, or on the first tab with something in it when nothing waits on the viewer
 * (an author lands on Submitted by me, not on an empty list). Switching tabs replaces the history
 * entry rather than adding one, and goes through `history.replaceState`, which Next folds into
 * `useSearchParams`, so there is no round trip. An empty tab is one quiet line.
 */
export function ReviewQueueTabs({ tabs, showTeam }: { tabs: QueueTab[]; showTeam: boolean }) {
  const value: QueueTabKey = parseTab(useSearchParams().get("tab")) ?? defaultTab(tabs);

  function select(next: QueueTabKey) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <Tabs.Root value={value} onValueChange={(next) => select(next as QueueTabKey)}>
      <Tabs.List aria-label="Review queue" activateOnFocus className={TAB_BAR}>
        {tabs.map((tab) => {
          const active = tab.key === value;
          return (
            <Tabs.Tab
              key={tab.key}
              value={tab.key}
              className={cn(TAB, active ? "font-medium text-text" : "text-text-muted hover:text-text")}
            >
              <span className={TAB_CONTENT}>
                {tab.label}
                <span className="text-text-subtle tabular-nums">{tab.rows.length}</span>
              </span>
              {active ? (
                <m.span
                  layoutId="review-tab-underline"
                  transition={spring.soft}
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text"
                />
              ) : null}
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Panel key={tab.key} value={tab.key} tabIndex={-1} className="outline-none">
          {tab.rows.length > 0 ? (
            <>
              <ListHeader decided={tab.key === "decided"} />
              <ul>
                {tab.rows.map((row) => (
                  <QueueRow key={row.key} row={row} showTeam={showTeam} />
                ))}
              </ul>
            </>
          ) : (
            <p className="py-10 text-[14px] text-text-muted">{tab.empty}</p>
          )}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
