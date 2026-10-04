"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { Route } from "next";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SpaceNav } from "@/server/queries/spaces";
import { TeamIcon } from "./team-icon";

/** Top of the sidebar: the current team (or "All teams") with a dropdown of every space the viewer has. */
export function TeamSwitcher({ spaces }: { spaces: SpaceNav[] }) {
  const { team } = useParams<{ team?: string }>();
  const current = spaces.find((s) => s.slug === team) ?? spaces[0];

  if (!current) {
    return (
      <div className="flex h-12 items-center gap-3 px-2">
        <div className="grid size-8 place-items-center rounded-lg border border-hairline bg-surface">
          <Users aria-hidden strokeWidth={1.75} className="size-[18px] text-text-muted" />
        </div>
        <span className="truncate text-[15px] font-medium">No team yet</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch team"
        className="flex h-12 w-full items-center gap-3 rounded-xl px-2 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-hover"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-surface">
          <TeamIcon name={current.icon} className="size-[18px] text-text" />
        </div>
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{current.name}</span>
        <ChevronsUpDown aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-text-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="min-w-60 rounded-2xl border border-hairline p-1.5 shadow-pop ring-0"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 pt-2 pb-1.5">
            <span className="caps-label">Teams</span>
          </DropdownMenuLabel>
          {spaces.map((s) => (
            <DropdownMenuItem
              key={s.slug}
              render={<Link href={`/${s.slug}/library` as Route} />}
              className="h-10 gap-3 rounded-lg px-2.5 text-[14px]"
            >
              <TeamIcon name={s.icon} className="size-[18px] text-text-muted" />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {s.slug === current.slug ? (
                <Check aria-hidden strokeWidth={2} className="size-4 text-text" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
