"use client";

import { useRef } from "react";
import { Calendar } from "@/components/ui/calendar";
import { PopoverContent } from "@/components/ui/popover";
import { addDays, fromYmd, toYmd } from "./format";

// The calendar of a sunset date, shared by the Versions tab's sunset dialog and the review screen's
// approve dialog, so the two behave the same:
//   - it opens on the selected day (not on "Previous month", the first thing in the tab order);
//   - pressing the selected day again picks it and closes the popover (it doesn't unselect it);
//   - "today" is the server's day (the demo clock's UTC day), not the browser's: the day it marks and the
//     days it disables read from the same date;
//   - the earliest day is the day after today.

const SELECTED_DAY = 'button[data-selected-single="true"]';

export function SunsetCalendarContent({
  ymd,
  today,
  onPick,
  align = "start",
}: {
  /** YYYY-MM-DD, the day now selected. */
  ymd: string;
  /** YYYY-MM-DD, the server's day. */
  today: string;
  /** A day was pressed (the selected one, again, included): the caller sets it and closes the popover. */
  onPick: (ymd: string) => void;
  align?: "start" | "center" | "end";
}) {
  const root = useRef<HTMLDivElement>(null);
  const selected = fromYmd(ymd) ?? undefined;
  const todayDate = fromYmd(today) ?? undefined;
  const earliest = fromYmd(addDays(today, 1)) ?? undefined;

  return (
    <PopoverContent
      align={align}
      className="w-auto p-0"
      // The selected day takes the focus; with none (it can't happen) the popover's default stands.
      initialFocus={() => root.current?.querySelector<HTMLElement>(SELECTED_DAY) ?? true}
    >
      <div ref={root}>
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          today={todayDate}
          disabled={earliest ? { before: earliest } : undefined}
          onSelect={(date) => onPick(toYmd(date))}
        />
      </div>
    </PopoverContent>
  );
}
