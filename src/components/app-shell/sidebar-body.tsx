"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { Route } from "next";
import { m } from "motion/react";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { spring } from "@/components/motion/presets";
import { firstSettingsSection } from "@/components/settings/sections";
import type { SpaceNav } from "@/server/queries/spaces";
import { HelpPopover } from "./help-popover";
import { NAV_ICON_STROKE, NAV_ITEMS, NAV_ROW, type NavKey } from "./nav";
import { SidebarCard } from "./sidebar-card";

const ROW_INTERACTION = "hover:bg-hover active:bg-selected data-active:bg-transparent";

/** Which main-nav item the URL belongs to. Settings is a modal: it keeps whatever is behind it. */
function activeFromPath(pathname: string, slug: string | undefined): NavKey | null {
  if (!slug) return null;
  const rest = pathname.startsWith(`/${slug}/`) ? pathname.slice(slug.length + 2) : "";
  const first = rest.split("/")[0];
  switch (first) {
    case "library":
    case "templates":
    case "new":
      return "library";
    case "review":
    case "usage":
    case "audit":
      return first;
    default:
      return null;
  }
}

export function SidebarBody({ spaces }: { spaces: SpaceNav[] }) {
  const { team } = useParams<{ team?: string }>();
  const pathname = usePathname();
  const space = spaces.find((s) => s.slug === team) ?? spaces[0];

  // Adjusting state while rendering: remember the last real page so the pill doesn't jump when a modal opens.
  const derived = activeFromPath(pathname, space?.slug);
  const [active, setActive] = useState<NavKey>(derived ?? "library");
  if (derived && derived !== active) setActive(derived);

  const settingsSection = space ? firstSettingsSection(space.settings) : null;
  const items = NAV_ITEMS.filter((i) => i.key !== "audit" || space?.showAudit);

  return (
    <>
      <SidebarContent className="px-3 pt-2">
        {space ? (
          <SidebarMenu className="gap-1">
            {items.map((item) => {
              const isActive = item.key === active;
              const count = item.key === "review" ? space.reviewCount : 0;
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    render={<Link href={`/${space.slug}/${item.key}` as Route} />}
                    isActive={isActive}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(NAV_ROW, ROW_INTERACTION, isActive && "font-medium")}
                  >
                    {isActive ? (
                      <m.span
                        layoutId="sidebar-active-pill"
                        transition={spring.soft}
                        className="absolute inset-0 rounded-lg bg-selected"
                      />
                    ) : null}
                    <item.icon
                      aria-hidden
                      strokeWidth={NAV_ICON_STROKE}
                      className={cn("relative", isActive && "text-text")}
                    />
                    <span className="relative">{item.label}</span>
                    {count > 0 ? (
                      <span
                        aria-label={`${count} waiting`}
                        className="relative ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] leading-none font-medium text-brand-foreground tabular-nums"
                      >
                        {count}
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="relative gap-3 px-3 pt-0 pb-4">
        {space?.recert ? <SidebarCard key={space.recert.id} recert={space.recert} teamSlug={space.slug} /> : null}
        <div className="mx-1 h-px bg-hairline" />
        <SidebarMenu className="gap-1">
          {space && settingsSection ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`/${space.slug}/settings/${settingsSection}` as Route} />}
                className={cn(NAV_ROW, ROW_INTERACTION)}
              >
                <Settings aria-hidden strokeWidth={NAV_ICON_STROKE} />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <HelpPopover />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
