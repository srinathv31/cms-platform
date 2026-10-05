"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Bold, Italic, Link2, MessageSquare, MessageSquarePlus, Underline } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The small things that hang in the document's right gutter, and the selection bubble.
 *
 * Marker: a speech bubble with the number of comments on the block in it. Amber, the colour the
 * anchored text is tinted with, so a marker and its highlight read as one thing.
 * Ghost: what a block offers while the pointer is over it (outline, quiet), to start a comment on the
 * whole block.
 */

/** Marker box. Sits in the 40px gutter: 8px from the text, 8px from the rail's hairline. */
export const MARKER = 24;
export const GUTTER_OFFSET = 8;

export const MarkerGlyph = ({ count, active }: { count: number; active: boolean }) => (
  <span className="relative grid size-6 place-items-center">
    <MessageSquare
      aria-hidden
      strokeWidth={1.5}
      className={cn("size-6 text-warning transition-colors duration-(--dur-fast)", active ? "fill-warning-border" : "fill-warning-soft group-hover/marker:fill-warning-border")}
    />
    <span className="absolute inset-0 grid place-items-center pb-0.5 text-[11px] leading-none font-medium text-warning-text tabular-nums">{count}</span>
  </span>
);

type ButtonProps = ComponentPropsWithoutRef<"button">;

export const MarkerButton = forwardRef<HTMLButtonElement, ButtonProps & { count: number; active: boolean }>(function MarkerButton(
  { count, active, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`${count} ${count === 1 ? "comment" : "comments"} on this block`}
      aria-pressed={active}
      className={cn(
        "group/marker grid size-6 place-items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      <MarkerGlyph count={count} active={active} />
    </button>
  );
});

/** Starts a comment on a block, or (while the composer is open) marks where it will land. */
export const GhostMarker = forwardRef<HTMLButtonElement, ButtonProps & { pending?: boolean }>(function GhostMarker(
  { pending = false, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Comment on this block"
      className={cn(
        "grid size-6 place-items-center rounded-md outline-none transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
        pending ? "bg-brand-1 text-brand" : "text-text-subtle hover:bg-hover hover:text-text-muted",
        className,
      )}
      {...props}
    >
      <MessageSquarePlus aria-hidden strokeWidth={1.75} className="size-4" />
    </button>
  );
});

// ── Selection bubble ─────────────────────────────────────────────

const TOGGLE = "grid size-8 place-items-center rounded-md text-label hover:bg-hover hover:text-text";

/**
 * The editor's format bubble (Bold, Italic, Underline, Link) with Comment added after a divider. On
 * the review screen, where nothing is edited, it is the Comment button alone. Buttons keep the
 * selection (mousedown is cancelled), as the real bubble does.
 */
export function SelectionBubble({
  top,
  left,
  formatting,
  onComment,
}: {
  top: number;
  left: number;
  formatting: boolean;
  onComment: () => void;
}) {
  const icon = { className: "size-4", strokeWidth: 1.75, "aria-hidden": true } as const;
  return (
    <div
      role="toolbar"
      aria-label={formatting ? "Format and comment" : "Comment"}
      data-selection-bubble=""
      style={{ position: "fixed", top, left, transform: "translateX(-50%)" }}
      className="z-40 flex items-center gap-0.5 rounded-lg border border-hairline bg-surface p-1 shadow-pop"
      onMouseDown={(event) => event.preventDefault()}
    >
      {formatting ? (
        <>
          <button type="button" aria-label="Bold" className={TOGGLE}>
            <Bold {...icon} />
          </button>
          <button type="button" aria-label="Italic" className={TOGGLE}>
            <Italic {...icon} />
          </button>
          <button type="button" aria-label="Underline" className={TOGGLE}>
            <Underline {...icon} />
          </button>
          <button type="button" aria-label="Link" className={TOGGLE}>
            <Link2 {...icon} />
          </button>
          <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
        </>
      ) : null}
      <button
        type="button"
        onClick={onComment}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-text hover:bg-hover"
      >
        <MessageSquarePlus {...icon} />
        Comment
      </button>
    </div>
  );
}
