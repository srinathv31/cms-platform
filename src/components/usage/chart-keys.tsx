"use client";

import type { FocusEvent, KeyboardEvent, ReactNode } from "react";

/**
 * One chart's readable marks (a week's column, a day's point, a heatmap square) as a single Tab stop, so a
 * keyboard user gets every value without a pointer: each mark shows its tooltip on focus as on hover, and
 * names its values for a screen reader. Arrow keys move between the marks, Home and End go to the ends.
 *
 * The marks are the descendants with `data-mark` (`markProps` in charts.tsx), in order: the first starts
 * as the Tab stop, and the stop follows focus.
 * `rows`: the marks fill columns of this many (the heatmap's weeks of seven days): Up and Down move within
 * a column, Left and Right a column at a time. Without it they are one row: Left and Right.
 */
export function ChartKeys({ rows, as = "g", className, children }: { rows?: number; as?: "g" | "div"; className?: string; children: ReactNode }) {
  const marks = (root: Element) => [...root.querySelectorAll<HTMLElement | SVGElement>("[data-mark]")];

  function onKeyDown(event: KeyboardEvent<Element>) {
    const all = marks(event.currentTarget);
    const at = all.indexOf(event.target as HTMLElement | SVGElement);
    if (at < 0) return;
    const across = rows ?? 1;
    const step: Record<string, number> = { ArrowLeft: -across, ArrowRight: across, ...(rows ? { ArrowUp: -1, ArrowDown: 1 } : {}) };
    const to = event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : event.key in step ? at + step[event.key] : null;
    if (to === null) return;
    // The arrows move within the chart, never the page, even at its ends.
    event.preventDefault();
    all[to]?.focus();
  }

  function onFocus(event: FocusEvent<Element>) {
    const all = marks(event.currentTarget);
    if (!all.includes(event.target as HTMLElement | SVGElement)) return;
    for (const mark of all) mark.setAttribute("tabindex", mark === event.target ? "0" : "-1");
  }

  return as === "div" ? (
    <div className={className} onKeyDown={onKeyDown} onFocus={onFocus}>
      {children}
    </div>
  ) : (
    <g className={className} onKeyDown={onKeyDown} onFocus={onFocus}>
      {children}
    </g>
  );
}
