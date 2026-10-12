"use client";

import { MessageSquarePlus } from "lucide-react";
import { MarkerGlyph } from "@/components/comments/gutter-markers";
import type { ChannelField, ChannelFieldId } from "@/domain/channel-fields";
import { plural } from "@/domain/plural";
import type { ThreadView } from "@/server/queries/threads";
import { cn } from "@/lib/utils";

/**
 * The comments on a channel field that sits in the rail (the Email details' subject and preheader). A
 * document's fields aren't in its text, so they have no gutter beside them: the controls sit at the end of
 * the field's label, and do what the document's gutter does for a block.
 */
export interface FieldComments {
  /** The template's threads: each field marks the open ones that are on it. */
  threads: readonly ThreadView[];
  activeThreadId: string | null;
  /** A marker was chosen: show the thread. */
  onActivate: (threadId: string) => void;
  /** Absent when the viewer can't comment: the field offers no way to start a thread. */
  onRequestComment?: (fieldId: ChannelFieldId) => void;
}

const BUTTON =
  "grid size-5 shrink-0 place-items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * A field's marker (a speech bubble with the number of comments on it, while it has open threads) and its
 * comment button (shown while the pointer or focus is in the field, as the document's hover marker is).
 * Both are 20px and pull into the label's line, so the row is as tall with them as without.
 */
export function FieldCommentControls({
  field,
  comments,
}: {
  field: ChannelField;
  comments: FieldComments;
}) {
  const { threads, activeThreadId, onActivate, onRequestComment } = comments;
  const open = threads.filter(
    (t) => t.blockId === field.id && t.status === "open" && !t.orphaned,
  );
  const count = open.reduce((n, t) => n + t.comments.length, 0);
  const active =
    activeThreadId !== null && open.some((t) => t.id === activeThreadId);

  // Several threads on a field: each press goes on to the next, as a marker in the gutter does.
  const choose = () => {
    const at =
      activeThreadId === null
        ? -1
        : open.findIndex((t) => t.id === activeThreadId);
    onActivate(open[(at + 1) % open.length].id);
  };

  if (open.length === 0 && !onRequestComment) return null;
  return (
    <span
      data-slot="field-comments"
      className="-my-0.5 flex items-center gap-0.5"
    >
      {open.length > 0 ? (
        <button
          type="button"
          data-field-marker={field.id}
          aria-label={`${plural(count, "comment")} on the ${field.name}`}
          aria-pressed={active}
          onClick={choose}
          className={cn(BUTTON, "group/marker")}
        >
          <MarkerGlyph count={count} active={active} compact />
        </button>
      ) : null}
      {onRequestComment ? (
        <button
          type="button"
          data-slot="field-comment"
          aria-label={`Comment on the ${field.name}`}
          onClick={() => onRequestComment(field.id)}
          className={cn(
            BUTTON,
            "text-text-subtle opacity-0 transition-[opacity,color,background-color] duration-(--dur-fast) group-focus-within/field:opacity-100 group-hover/field:opacity-100 hover:bg-hover hover:text-text-muted focus-visible:opacity-100",
          )}
        >
          <MessageSquarePlus
            aria-hidden
            strokeWidth={1.75}
            className="size-3.5"
          />
        </button>
      ) : null}
    </span>
  );
}
