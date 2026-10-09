"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils";
import { LinkPendingLabel } from "@/components/primitives/link-pending";
import { TAB, TAB_ACTIVE, TAB_IDLE, TAB_LABEL } from "@/components/primitives/tab-styles";
import { TabUnderline } from "@/components/primitives/tabs";

export const WORKSPACE_TABS = [
  { key: "content", label: "Content", segment: null },
  { key: "versions", label: "Versions", segment: "versions" },
  { key: "usage", label: "Usage", segment: "usage" },
  { key: "activity", label: "Activity", segment: "activity" },
] as const;

/**
 * Content / Versions / Usage / Activity: routes, so links in a nav, in the look of the app's tabs
 * (`Tabs`). The underline slides between tabs over the tab bar's hairline.
 */
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
            className={cn(TAB, active ? TAB_ACTIVE : TAB_IDLE)}
          >
            <span className={TAB_LABEL}>
              <LinkPendingLabel>{tab.label}</LinkPendingLabel>
            </span>
            {active ? <TabUnderline layoutId="workspace-tab-underline" /> : null}
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
