"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronRight, RotateCcw } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { duration, ease } from "@/components/motion/presets";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Button } from "@/components/ui/button";
import type { CommentView, ThreadView } from "@/domain/review-types";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import type { Anchor } from "./types";

/*
 * The thread UI, drawn once and used by every variant: the rail's list (A), the popover (B), the
 * margin cards (C) and the approver's decision panel. A card is the quote it is about, the comments
 * (avatar, name, time, text), then a Reply field. Resolve sits beside Reply; a
 * resolved card says who resolved it and offers Reopen. Controls are 32px, 8px corners; Reply and
 * Comment are outline buttons because the page's one black button belongs to the screen.
 */

const FIELD =
  "block w-full resize-none rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[14px] leading-6 text-text outline-none placeholder:text-text-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// ── Pieces ───────────────────────────────────────────────────────

function Quote({ text, onClick }: { text: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      tabIndex={onClick ? 0 : -1}
      onClick={onClick}
      className="mb-3 block w-full border-l-2 border-warning-border pl-2.5 text-left text-[13px] leading-5 text-text-muted"
    >
      <span className="line-clamp-2">{text}</span>
    </button>
  );
}

function CommentRow({ comment }: { comment: CommentView }) {
  const store = useStore();
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5">
      <UserAvatar initials={comment.author.initials} hue={comment.author.hue} size="sm" />
      <div className="min-w-0">
        <div className="flex min-h-6 items-center gap-2">
          <span className="truncate text-[13.5px] font-medium leading-6 text-text">{comment.author.name}</span>
          <span className="shrink-0 text-[12.5px] leading-6 text-text-subtle">{store.ago(comment.createdAt)}</span>
        </div>
        <p className="mt-0.5 text-[14px] leading-[1.45] text-text">{comment.body}</p>
      </div>
    </div>
  );
}

/** A textarea with Cancel and the post button, for replies and new threads. */
function Composer({
  label,
  action,
  onSubmit,
  onCancel,
  leading,
  autoFocus = true,
}: {
  label: string;
  action: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  /** At the left of the button row (a reply keeps Resolve in reach). */
  leading?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const empty = body.trim() === "";

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = () => {
    if (!empty) onSubmit(body.trim());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        rows={2}
        value={body}
        aria-label={label}
        placeholder={label}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(FIELD, "min-h-16")}
      />
      <div className="flex items-center justify-end gap-2">
        {leading ? <span className="mr-auto">{leading}</span> : null}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" disabled={empty} onClick={submit}>
          {action}
        </Button>
      </div>
    </div>
  );
}

function ResolveButton({ thread }: { thread: ThreadView }) {
  const store = useStore();
  return (
    <Button variant="ghost" className="gap-1.5 px-2 text-[13px] text-text-muted hover:text-text" onClick={() => store.resolve(thread.id)}>
      <Check data-icon="inline-start" strokeWidth={1.75} />
      Resolve
    </Button>
  );
}

/** A one-line "Reply" beside Resolve; the Reply opens into a composer that keeps Resolve at its left. */
function ReplyField({ thread, open, onOpen, onClose }: { thread: ThreadView; open: boolean; onOpen: () => void; onClose: () => void }) {
  const store = useStore();
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Closing the composer (posted or cancelled) puts focus back on the field that opened it.
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          ref={trigger}
          type="button"
          aria-label={`Reply to ${thread.comments[0]?.author.name ?? "thread"}`}
          onClick={onOpen}
          className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-hairline bg-surface px-2.5 text-left text-[14px] text-text-subtle outline-none transition-colors hover:bg-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Reply
        </button>
        <ResolveButton thread={thread} />
      </div>
    );
  }
  return (
    <Composer
      label="Reply"
      action="Reply"
      onSubmit={(body) => {
        store.reply(thread.id, body);
        onClose();
      }}
      onCancel={onClose}
      leading={<ResolveButton thread={thread} />}
    />
  );
}

// ── The cards ────────────────────────────────────────────────────

export interface ThreadCardProps {
  thread: ThreadView;
  active?: boolean;
  /** "flat" drops the card's border and fill (inside a popover, which is the card). */
  flat?: boolean;
  /** Lifted off the page (margin cards): the active one gets the popover shadow. */
  floating?: boolean;
  /** The card or its quote was clicked. */
  onSelect?: () => void;
  className?: string;
}

export function ThreadCard({ thread, active = false, flat = false, floating = false, onSelect, className }: ThreadCardProps) {
  const store = useStore();
  const [replying, setReplying] = useState(false);
  const resolved = thread.status === "resolved";
  const isChange = thread.comments[0]?.kind === "change_request";

  return (
    <article
      data-thread={thread.id}
      data-status={thread.status}
      data-active={active ? "" : undefined}
      aria-label={isChange ? "Change request" : thread.quote ? `Comment on “${thread.quote}”` : "Comment on a block"}
      onClick={(event) => {
        if (!onSelect || resolved) return;
        if ((event.target as HTMLElement).closest("button, textarea, input, a")) return;
        onSelect();
      }}
      className={cn(
        "relative min-w-0",
        !flat && "rounded-xl border bg-surface p-3.5 transition-[border-color,box-shadow] duration-(--dur-base)",
        !flat && (active ? "border-warning-border ring-1 ring-warning-border" : "border-hairline"),
        !flat && floating && active && "shadow-pop",
        onSelect && !resolved && !active && "cursor-default",
        className,
      )}
    >
      {isChange ? (
        <div className="mb-3 flex items-center gap-2">
          <StatusBadge state="changes_requested" />
          {thread.originVersionNumber ? <span className="text-[13px] text-text-muted">on v{thread.originVersionNumber}</span> : null}
        </div>
      ) : null}
      {thread.quote ? <Quote text={thread.quote} onClick={onSelect && !resolved ? onSelect : undefined} /> : null}
      <div className="flex flex-col gap-3">
        {thread.comments.map((comment) => (
          <CommentRow key={comment.id} comment={comment} />
        ))}
      </div>
      <div className="mt-3">
        {resolved ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] leading-5 text-text-muted">Resolved by {thread.resolvedBy?.name ?? "someone"}</div>
              {thread.resolvedAt ? <div className="text-[12.5px] leading-5 text-text-subtle">{store.ago(thread.resolvedAt)}</div> : null}
            </div>
            <Button variant="ghost" className="shrink-0 gap-1.5 px-2 text-[13px] text-text-muted hover:text-text" onClick={() => store.reopen(thread.id)}>
              <RotateCcw data-icon="inline-start" strokeWidth={1.75} />
              Reopen
            </Button>
          </div>
        ) : (
          <ReplyField thread={thread} open={replying} onOpen={() => setReplying(true)} onClose={() => setReplying(false)} />
        )}
      </div>
    </article>
  );
}

/** The new-thread composer, as a card: the quote it will attach to, a field, Cancel and Comment. */
export function ComposeCard({ anchor, flat = false, floating = false, className }: { anchor: Anchor; flat?: boolean; floating?: boolean; className?: string }) {
  const store = useStore();
  return (
    <article
      data-compose=""
      aria-label="New comment"
      className={cn(
        "relative min-w-0",
        !flat && "rounded-xl border border-warning-border bg-surface p-3.5 ring-1 ring-warning-border",
        !flat && floating && "shadow-pop",
        className,
      )}
    >
      {anchor.quote ? <Quote text={anchor.quote} /> : null}
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5">
        <UserAvatar initials={store.me.initials} hue={store.me.hue} size="sm" />
        <Composer label="Add a comment" action="Comment" onSubmit={(body) => store.post(body)} onCancel={store.cancelCompose} />
      </div>
    </article>
  );
}

// ── Groups ───────────────────────────────────────────────────────

/** "Resolved (2)", collapsed until opened. */
export function ResolvedGroup({
  threads,
  open,
  onToggle,
  lead,
  className,
}: {
  threads: ThreadView[];
  open: boolean;
  onToggle: () => void;
  /** Shares the toggle's line, before it. */
  lead?: React.ReactNode;
  className?: string;
}) {
  const id = "resolved-threads";
  if (threads.length === 0) return null;
  return (
    <section aria-label="Resolved comments" className={className}>
      <div className="flex items-center gap-3">
        {lead}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-text-muted outline-none hover:bg-hover hover:text-text focus-visible:ring-3 focus-visible:ring-ring/50",
            lead ? "-mr-2" : "-mx-2",
          )}
        >
          <ChevronRight aria-hidden strokeWidth={1.75} className={cn("size-4 transition-transform duration-(--dur-base)", open && "rotate-90")} />
          Resolved ({threads.length})
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            id={id}
            key="list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.base, ease: ease.outSoft }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 pt-2">
              {threads.map((thread) => (
                <ThreadCard key={thread.id} thread={thread} />
              ))}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
