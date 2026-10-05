"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A time as its relative words ("3 days ago", the demo clock's), with the absolute time (UTC) in a
 * tooltip. The time takes the keyboard's focus, so the tooltip opens for keyboard users too, and its
 * absolute time is also in the text for assistive technology. Both strings are made on the server, so
 * they never differ between server and browser.
 */
export function Stamp({ iso, relative, absolute }: { iso: string; relative: string; absolute: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={iso}
            tabIndex={0}
            className="cursor-default rounded-sm text-[13px] leading-5 whitespace-nowrap text-text-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        {relative}
        <span className="sr-only">, {absolute}</span>
      </TooltipTrigger>
      <TooltipContent side="top" align="end">
        {absolute}
      </TooltipContent>
    </Tooltip>
  );
}
