"use client";

import { Suspense, use, useState } from "react";
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
import type { SidebarCardModel } from "@/domain/access-types";
import type { SpaceNav } from "@/server/queries/spaces";
import { HelpPopover } from "./help-popover";
import { NAV_ICON_STROKE, NAV_ITEMS, NAV_ROW, type NavKey } from "./nav";
import { usePendingNav } from "./pending-nav";
import { navKeyOf } from "./pending-routes";
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

/**
 * The count of versions waiting on the viewer, at the row's right edge. Hidden at zero. It is an image
 * with a name ("3 waiting") rather than a plain span with an `aria-label`, which no screen reader is
 * bound to read; the link then reads "Review 3 waiting". The digits stay in the DOM as its text.
 */
function ReviewCount({ counts, slug }: { counts: Promise<Record<string, number>>; slug: string }) {
  const count = use(counts)[slug] ?? 0;
  if (count <= 0) return null;
  return (
    <span
      role="img"
      aria-label={`${count} waiting`}
      className="relative ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] leading-none font-medium text-brand-foreground tabular-nums"
    >
      {count}
    </span>
  );
}

export function SidebarBody({
  spaces,
  homeCard,
  reviewCounts,
}: {
  spaces: SpaceNav[];
  /** The card for a viewer with no space yet (their own pending request). */
  homeCard: SidebarCardModel | null;
  /** Review badge counts by space slug. A promise: the badge streams in after the nav. */
  reviewCounts: Promise<Record<string, number>>;
}) {
  const { team } = useParams<{ team?: string }>();
  const pathname = usePathname();
  const space = spaces.find((s) => s.slug === team) ?? spaces[0];

  // Adjusting state while rendering: remember the last real page so the pill doesn't jump when a modal opens.
  const derived = activeFromPath(pathname, space?.slug);
  const [active, setActive] = useState<NavKey>(derived ?? "library");
  if (derived && derived !== active) setActive(derived);
  // A page on its way lights its item at once (development only: see pending-nav.tsx). The page on
  // screen keeps `aria-current` until the new one arrives.
  const { view, link } = usePendingNav();
  const shown = (process.env.NODE_ENV === "development" && view && navKeyOf(view)) || active;

  const settingsSection = space ? firstSettingsSection(space.settings) : null;
  const card = space ? space.card : homeCard;
  const items = NAV_ITEMS.filter((i) => i.key !== "audit" || space?.showAudit);

  return (
    <>
      <SidebarContent className="px-3 pt-2">
        {space ? (
          <SidebarMenu className="gap-1">
            {items.map((item) => {
              const href = `/${space.slug}/${item.key}`;
              const isActive = item.key === shown;
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    render={<Link href={href as Route} onNavigate={link(href)} />}
                    isActive={isActive}
                    aria-current={item.key === active ? "page" : undefined}
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
                    {item.key === "review" ? (
                      <Suspense fallback={null}>
                        <ReviewCount counts={reviewCounts} slug={space.slug} />
                      </Suspense>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="relative gap-3 px-3 pt-0 pb-4">
        {card ? <SidebarCard key={card.id} card={card} /> : null}
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
