"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PersonaSummary } from "@/server/queries/personas";
import { usePersonaSwitch } from "./persona-switch";
import { UserAvatar } from "./user-avatar";

/** Avatar → who you are, plus the persona switcher (the demo's way to change viewer). */
export function ProfileMenu({
  me,
  personas,
}: {
  me: PersonaSummary;
  personas: PersonaSummary[];
}) {
  const [open, setOpen] = useState(false);
  const { switchTo } = usePersonaSwitch();

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={`${me.name}, profile and persona`}
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <UserAvatar initials={me.initials} hue={me.hue} className="size-9" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[22rem] rounded-2xl border border-hairline p-1.5 shadow-pop ring-0"
      >
        <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
          <UserAvatar initials={me.initials} hue={me.hue} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-[15px] leading-5 font-medium">{me.name}</div>
            <div className="truncate text-[13px] leading-[18px] text-text-muted">{me.summary}</div>
          </div>
        </div>
        <DropdownMenuSeparator className="mx-1 bg-hairline" />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 pt-2.5 pb-1.5">
            <span className="caps-label">Switch persona</span>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={me.id}
            onValueChange={(id) => {
              setOpen(false);
              switchTo(id);
            }}
          >
            {personas.map((p) => (
              <DropdownMenuRadioItem
                key={p.id}
                value={p.id}
                closeOnClick
                className="gap-3 rounded-lg py-2 pr-9 pl-2.5"
              >
                <UserAvatar initials={p.initials} hue={p.hue} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] leading-5 font-medium">{p.name}</span>
                  <span className="block truncate text-[12.5px] leading-[18px] text-text-muted">
                    {p.summary}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
