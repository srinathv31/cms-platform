"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { Route } from "next";
import { m } from "motion/react";
import { cn } from "@/lib/utils";
import { spring } from "@/components/motion/presets";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";
import { visibleGroups, type SettingsAccessLike } from "./sections";

/** Grouped section links with a sliding selected pill. The pill persists because the dialog lives in a layout. */
export function SettingsNavList({
  teamSlug,
  access,
}: {
  teamSlug: string;
  access: SettingsAccessLike;
}) {
  const activeSection = useSelectedLayoutSegment();
  const groups = visibleGroups(access);

  return (
    <nav aria-label="Settings sections" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-7 pb-5">
      <div className="flex flex-col gap-7">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="px-3 pb-2.5">
              <span className="caps-label">{group.label}</span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.sections.map((section) => {
                const isActive = section.key === activeSection;
                return (
                  <li key={section.key}>
                    <Link
                      replace
                      href={`/${teamSlug}/settings/${section.key}` as Route}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "relative flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                        isActive && "font-medium hover:bg-transparent",
                      )}
                    >
                      {isActive ? (
                        <m.span
                          layoutId="settings-nav-pill"
                          transition={spring.soft}
                          className="absolute inset-0 rounded-lg bg-selected"
                        />
                      ) : null}
                      <section.icon
                        aria-hidden
                        strokeWidth={NAV_ICON_STROKE}
                        className="relative size-5 text-text-muted"
                      />
                      <span className="relative">{section.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-auto px-3 pt-6 text-[13px] text-text-muted">UCOMP · v0.1 prototype</p>
    </nav>
  );
}
