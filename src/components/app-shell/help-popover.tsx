"use client";

import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Shortcut } from "@/components/primitives/keycap";
import { StatusBadge } from "@/components/primitives/status-badge";
import { VERSION_STATES } from "@/domain/types";
import { NAV_ICON_STROKE, NAV_ROW } from "./nav";
import { cn } from "@/lib/utils";

const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: "Search", keys: ["⌘", "K"] },
  { label: "Insert a block", keys: ["/"] },
  { label: "Bold", keys: ["⌘", "B"] },
  { label: "Italic", keys: ["⌘", "I"] },
  { label: "Undo", keys: ["⌘", "Z"] },
  { label: "Close", keys: ["Esc"] },
];

/** Help: the keyboard shortcuts and the six status badges. Nothing else. */
export function HelpPopover() {
  return (
    <Popover>
      <PopoverTrigger
        render={<SidebarMenuButton className={cn(NAV_ROW, "hover:bg-hover active:bg-selected data-popup-open:bg-hover")} />}
      >
        <HelpCircle aria-hidden strokeWidth={NAV_ICON_STROKE} />
        <span>Help</span>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={14}
        aria-label="Help"
        className="w-80 gap-6 rounded-2xl border border-hairline p-5 shadow-pop ring-0"
      >
        <section>
          <div className="caps-label mb-3">Shortcuts</div>
          <ul className="flex flex-col gap-2.5">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 text-[14px]">
                <span className="text-text">{s.label}</span>
                <Shortcut keys={s.keys} />
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="caps-label mb-3">Status</div>
          <ul className="flex flex-wrap gap-2">
            {VERSION_STATES.map((state) => (
              <li key={state}>
                <StatusBadge state={state} />
              </li>
            ))}
          </ul>
        </section>
      </PopoverContent>
    </Popover>
  );
}
