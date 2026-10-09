"use client";

import { useRef, type ReactNode } from "react";
import { toggleVariants } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

// The app's one segmented style, for picking one of a few options: a white 32px track with a hairline
// border, 24px segments inside it (6px corners) that are muted until chosen, and a tan `bg-selected`
// fill under the chosen one, the same fill the pressed Preview button has in the tab bar. Every control
// in a rail is 32px tall with 8px corners, so the track is too.
//
// Two semantics, one look. `Segmented` is a view control (the preview's channel and device, the Usage
// filter): toggle buttons, `aria-pressed`, Tab enters the group and the arrow keys move focus.
// `SegmentedRadio` is a form field (the role in Request access): a radio group, Tab lands on the chosen
// option and the arrow keys move the choice.

const TRACK = "h-8 w-fit rounded-lg border border-hairline bg-surface p-0.5";
const SEGMENT =
  "h-6 min-w-0 rounded-md border-0 px-2.5 text-[13px] font-medium text-text-muted hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text aria-pressed:hover:bg-selected aria-checked:bg-selected aria-checked:text-text aria-checked:hover:bg-selected";
/** An icon-only segment is a 24px square. */
const ICON_SEGMENT = "size-6 px-0";

export interface SegmentedOption<T extends string> {
  value: T;
  /** What the segment reads. With an `icon`, its accessible name. */
  label: string;
  /** Drawn instead of the label: an icon-only segment (the team icon picker). */
  icon?: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  /** Called with the option chosen. The chosen one can't be unchosen: there is always one. */
  onChange: (value: T) => void;
  className?: string;
}

/** A view control: pick one of a few. Toggle buttons in a group named `label`. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T> & {
  /** The group's accessible name. */
  label: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;
        // A pressed segment can't be pressed off: there is always one chosen.
        if (picked) onChange(picked);
      }}
      spacing={0.5}
      className={cn(TRACK, className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.icon ? option.label : undefined}
          className={cn(SEGMENT, option.icon ? ICON_SEGMENT : null)}
        >
          {option.icon ?? option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * A form field: pick one of a few, as a radio group labelled by the field's visible label. Exactly one
 * option is always chosen; Tab lands on it, and the arrow keys move the choice (and focus) round.
 */
export function SegmentedRadio<T extends string>({
  labelledBy,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T> & {
  /** The id of the field's label. */
  labelledBy: string;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement | null>());

  const pick = (index: number) => {
    const option = options[(index + options.length) % options.length];
    if (!option) return;
    onChange(option.value);
    buttons.current.get(option.value)?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={cn("flex items-center gap-0.5", TRACK, className)}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttons.current.set(option.value, el);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.icon ? option.label : undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                pick(index + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                pick(index - 1);
              }
            }}
            // The toggle's own base (focus ring, transitions), so a radio segment looks like a toggle one.
            className={cn(toggleVariants(), "shrink-0 focus-visible:z-10", SEGMENT, option.icon ? ICON_SEGMENT : null)}
          >
            {option.icon ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
