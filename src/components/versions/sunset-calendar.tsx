"use client";

import { useRef } from "react";
import { Calendar } from "@/components/ui/calendar";
import { PopoverContent } from "@/components/ui/popover";
import { zoneLabel } from "@/domain/business-zone";
import { cn } from "@/lib/utils";
import { addDays, fromYmd, toYmd } from "./format";

// The calendar of a sunset date, shared by the Versions tab's sunset dialog and the review screen's
// approve dialog, so the two behave the same:
//   - it opens on the selected day (not on "Previous month", the first thing in the tab order);
//   - pressing the selected day again picks it and closes the popover (it doesn't unselect it);
//   - "today" is the server's day in the business time zone (`SunsetCalendar.today`, on the demo clock),
//     not the browser's: the day it marks and the days it disables read from the same date;
//   - the earliest day is the day after today;
//   - beside the picker, `SunsetZone` says when the day ends: "Ends at 00:00 Eastern (America/New_York)".

const SELECTED_DAY = 'button[data-selected-single="true"]';

/** "Ends at 00:00 Eastern (America/New_York)": the time a sunset date stops renders (decision 0017). */
export function sunsetZoneLine(zone: string): string {
  return `Ends at 00:00 ${zoneLabel(zone)}`;
}

/** The zone line, at the picker. The trigger names it with `aria-describedby={id}`. */
export function SunsetZone({ id, zone, className }: { id: string; zone: string; className?: string }) {
  return (
    <p id={id} data-slot="sunset-zone" className={cn("text-[13px] text-text-muted", className)}>
      {sunsetZoneLine(zone)}
    </p>
  );
}

export function SunsetCalendarContent({
  ymd,
  today,
  onPick,
  align = "start",
}: {
  /** YYYY-MM-DD, the day now selected. */
  ymd: string;
  /** YYYY-MM-DD, the server's day in the business time zone. */
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
