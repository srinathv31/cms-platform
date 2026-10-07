"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { Route } from "next";
import { m } from "motion/react";
import { cn } from "@/lib/utils";
import { spring } from "@/components/motion/presets";
import { LinkPendingLabel } from "@/components/primitives/link-pending";

export const WORKSPACE_TABS = [
  { key: "content", label: "Content", segment: null },
  { key: "versions", label: "Versions", segment: "versions" },
  { key: "usage", label: "Usage", segment: "usage" },
  { key: "activity", label: "Activity", segment: "activity" },
] as const;

// The focus ring goes round the label, not the whole tab: a ring on the tab's box would run into the
// 2px underline along its bottom edge.
const TAB = "group/tab relative -mb-px flex h-11 items-center text-[15px] outline-none";
const LABEL =
  "-mx-1.5 rounded-md px-1.5 py-0.5 group-focus-visible/tab:ring-2 group-focus-visible/tab:ring-ring";

/** Content / Versions / Usage / Activity. The underline slides between tabs over the tab bar's hairline. */
export function WorkspaceTabs({ base }: { base: string }) {
  const current = useSelectedLayoutSegment();
  return (
    <nav aria-label="Template" className="flex gap-7">
      {WORKSPACE_TABS.map((tab) => {
        const active = (current ?? null) === tab.segment;
        return (
          <Link
            key={tab.key}
            href={(tab.segment ? `${base}/${tab.segment}` : base) as Route}
            aria-current={active ? "page" : undefined}
            className={cn(TAB, active ? "font-medium text-text" : "text-text-muted hover:text-text")}
          >
            <span className={LABEL}>
              <LinkPendingLabel>{tab.label}</LinkPendingLabel>
            </span>
            {active ? (
              <m.span
                layoutId="workspace-tab-underline"
                transition={spring.soft}
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Same labels and spacing while the template streams in. */
export function WorkspaceTabsSkeleton() {
  return (
    <div aria-hidden className="flex gap-7">
      {WORKSPACE_TABS.map((tab) => (
        <span key={tab.key} className={cn(TAB, "text-text-subtle")}>
          {tab.label}
        </span>
      ))}
    </div>
  );
}
