"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A box for what needs a two-dimensional layout (a data table): in a window too narrow for it, it scrolls sideways
 * inside itself instead of pushing the page (reflow, decision 0045). Once it scrolls it is a labelled region with a
 * Tab stop, so a keyboard can scroll it (axe's `scrollable-region-focusable`); while it fits it is neither, so
 * there is no stop that does nothing.
 *
 * It wraps the shadcn `Table`, whose own container would scroll first, so that container stops scrolling here
 * and this box does, or a table drawn with `role="table"`. The box is `relative` so a visually hidden (absolutely
 * placed) label inside it stays inside it, not out on the page where it widens the scroll area.
 */
export function ScrollRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Watching the box (the window changed) and its content (the table's rows changed). The first call is the
    // observer's own, right after it starts watching.
    const observer = new ResizeObserver(() => setScrolls(el.scrollWidth > el.clientWidth + 1));
    observer.observe(el);
    for (const child of el.querySelectorAll("table, [role=table]")) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={box}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      className={cn(
        "relative overflow-x-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&_[data-slot=table-container]]:overflow-visible",
        className,
      )}
    >
      {children}
    </div>
  );
}
