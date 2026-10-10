"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronRight, RotateCcw } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { duration, ease } from "@/components/motion/presets";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Button } from "@/components/ui/button";
import { ALL_CHANNEL_FIELDS } from "@/domain/channel-fields";
import type { CommentView, Person, ThreadView } from "@/domain/review-types";
import { cn } from "@/lib/utils";
import { formatAgo } from "@/domain/dates";
import { isOptimistic } from "./thread-state";

// The thread UI. A card is the quote it is about, the comments (avatar, name, time, text), then a
// Reply field with Resolve beside it; a resolved card says who resolved it and offers Reopen. Controls
// are 32px with 8px corners, and Reply and Comment are outline buttons: the screen's one black button
// belongs to the page. What a control asks the server for is the list's business (thread-list.tsx):
// these components call back and say how it went (null: it worked; a sentence: it was refused).

const FIELD =
  "block w-full resize-none rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[14px] leading-6 text-text outline-none placeholder:text-text-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** What a control's callback answers: null when it worked, otherwise the reason it didn't. */
export type Outcome = string | null;

/** Focus that came from the keyboard (or a text field), as opposed to a pointer press on a button. */
function showsFocusRing(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return true; // an environment without :focus-visible (tests)
  }
}

// ── Pieces ───────────────────────────────────────────────────────

function Quote({ text, onClick, block = false }: { text: string; onClick?: () => void; block?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={onClick ? 0 : -1}
      onClick={onClick}
      data-slot={block ? "block-snippet" : "quote"}
      className={cn(
        "mb-3 block w-full rounded-sm border-l-2 border-warning-border pl-2.5 text-left text-[13px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        block ? "text-text-subtle" : "text-text-muted",
      )}
    >
      {/* A block has no quote: the start of its text stands in, on one line and quieter than a quote. */}
      <span className={block ? "block truncate" : "line-clamp-2"}>{text}</span>
    </button>
  );
}

/** What a card is about: the quoted text, else (a comment on a whole block) the start of the block's text. */
function Anchor({ quote, snippet, onClick }: { quote?: string | null; snippet?: string | null; onClick?: () => void }) {
  if (quote) return <Quote text={quote} onClick={onClick} />;
  if (snippet) return <Quote text={snippet} onClick={onClick} block />;
  return null;
}

function CommentRow({ comment, nowMs }: { comment: CommentView; nowMs: number | null }) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5">
      <UserAvatar initials={comment.author.initials} hue={comment.author.hue} size="sm" />
      <div className="min-w-0">
        <div className="flex min-h-6 items-center gap-2">
          <span className="truncate text-[13.5px] leading-6 font-medium text-text">{comment.author.name}</span>
          <time dateTime={comment.createdAt} className="shrink-0 text-[12.5px] leading-6 text-text-subtle">
            {nowMs === null ? "" : formatAgo(comment.createdAt, nowMs, { dateFrom: 14 })}
          </time>
        </div>
        <p className="mt-0.5 text-[14px] leading-[1.45] break-words whitespace-pre-wrap text-text">{comment.body}</p>
      </div>
    </div>
  );
}

/** A textarea with Cancel and the post button: for replies and new threads. Controlled, so a refused post keeps its text. */
export function ComposerBox({
  label,
  action,
  value,
  onChange,
  onSubmit,
  onCancel,
  leading,
}: {
  label: string;
  action: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** At the left of the button row (a reply keeps Resolve in reach). */
  leading?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const empty = value.trim() === "";

  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    // A draft that came back: the caret goes after it, not before.
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!empty) onSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        rows={2}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(FIELD, "min-h-16")}
      />
      <div className="flex items-center justify-end gap-2">
        {leading ? <span className="mr-auto">{leading}</span> : null}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" disabled={empty} onClick={onSubmit}>
          {action}
        </Button>
      </div>
    </div>
  );
}

const QUIET_BUTTON = "shrink-0 gap-1.5 px-2 text-[13px] text-text-muted hover:text-text";

function Refusal({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p role="alert" className="mt-2 text-[13px] leading-5 text-danger-text">
      {reason}
    </p>
  );
}

// ── The cards ────────────────────────────────────────────────────

export interface ThreadCardProps {
  thread: ThreadView;
  active?: boolean;
  /** Reply, Resolve and Reopen are offered. */
  canComment: boolean;
  /** The time "ago" is measured from (ms); null until it is known. */
  nowMs: number | null;
  /** The start of the block's text, for a thread about a whole block (it has no quote); shown where a quote would be. */
  snippet?: string | null;
  /** The card, its quote, or a control in it was used. */
  onSelect?: () => void;
  onReply: (threadId: string, body: string) => Promise<Outcome>;
  onResolve: (threadId: string) => Promise<Outcome>;
  onReopen: (threadId: string) => Promise<Outcome>;
  /**
   * Why the last reply, resolve or reopen was refused, shown under the controls. The list keeps it (the
   * card may be put somewhere else and back while the change is on its way), and clears it on the next try.
   */
  refusal?: string | null;
  onClearRefusal?: () => void;
  className?: string;
}

export function ThreadCard({
  thread,
  active = false,
  canComment,
  nowMs,
  snippet = null,
  onSelect,
  onReply,
  onResolve,
  onReopen,
  refusal = null,
  onClearRefusal,
  className,
}: ThreadCardProps) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const wasReplying = useRef(false);

  const resolved = thread.status === "resolved";
  const isChange = thread.comments[0]?.kind === "change_request";
  const waiting = isOptimistic(thread.id);
  const selectable = !resolved && !waiting;

  // Closing the reply (posted or cancelled) puts focus back on the field that opened it.
  useEffect(() => {
    if (wasReplying.current && !replying) trigger.current?.focus({ preventScroll: true });
    wasReplying.current = replying;
  }, [replying]);

  const sendReply = async () => {
    const body = draft.trim();
    if (!body) return;
    // The comment shows in the card at once; a refusal brings the reply field back with its text.
    setReplying(false);
    setDraft("");
    const reason = await onReply(thread.id, body);
    if (reason) {
      setDraft(body);
      setReplying(true);
    }
  };

  const resolve = (
    <Button
      variant="ghost"
      className={QUIET_BUTTON}
      disabled={waiting}
      onClick={() => void onResolve(thread.id)}
    >
      <Check data-icon="inline-start" strokeWidth={1.75} />
      Resolve
    </Button>
  );

  return (
    <article
      data-thread={thread.id}
      data-status={thread.status}
      data-active={active ? "" : undefined}
      // Not a tab stop: the list moves focus here (a new thread's card) and it can be focused from script.
      tabIndex={-1}
      aria-label={isChange ? "Change request" : thread.quote ? `Comment on “${thread.quote}”` : wholeAnchorLabel(thread.blockId)}
      onClick={(event) => {
        if (!onSelect || !selectable) return;
        if ((event.target as HTMLElement).closest("button, textarea, input, a")) return;
        onSelect();
      }}
      // The keyboard path to a thread: focus arriving in its card (the quote, Reply, Resolve) selects it, so the
      // document follows. A mouse press on Resolve doesn't (it isn't focus-visible): the document stays where it is.
      onFocusCapture={(event) => {
        if (onSelect && selectable && !active && showsFocusRing(event.target)) onSelect();
      }}
      className={cn(
        "relative min-w-0 rounded-xl border bg-surface p-3.5 outline-none transition-[border-color,box-shadow] duration-(--dur-base) focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
        active ? "border-warning-border ring-1 ring-warning-border" : "border-hairline",
        className,
      )}
    >
      {isChange ? (
        <div className="mb-3 flex items-center gap-2">
          <StatusBadge state="changes_requested" />
          {thread.originVersionNumber ? (
            <span className="text-[13px] text-text-muted">on v{thread.originVersionNumber}</span>
          ) : null}
        </div>
      ) : null}
      <Anchor quote={thread.quote} snippet={snippet} onClick={onSelect && selectable ? onSelect : undefined} />
      <div className="flex flex-col gap-3">
        {thread.comments.map((comment) => (
          <CommentRow key={comment.id} comment={comment} nowMs={nowMs} />
        ))}
      </div>
      {resolved || canComment ? (
        <div className="mt-3">
          {resolved ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] leading-5 text-text-muted">
                  Resolved by {thread.resolvedBy?.name ?? "someone"}
                </div>
                {thread.resolvedAt && nowMs !== null ? (
                  <div className="text-[12.5px] leading-5 text-text-subtle">{formatAgo(thread.resolvedAt, nowMs, { dateFrom: 14 })}</div>
                ) : null}
              </div>
              {canComment ? (
                <Button variant="ghost" className={QUIET_BUTTON} onClick={() => void onReopen(thread.id)}>
                  <RotateCcw data-icon="inline-start" strokeWidth={1.75} />
                  Reopen
                </Button>
              ) : null}
            </div>
          ) : replying ? (
            <ComposerBox
              label="Reply"
              action="Reply"
              value={draft}
              onChange={setDraft}
              onSubmit={sendReply}
              // Closing keeps what was typed: the next Reply on this card opens with it.
              onCancel={() => {
                setReplying(false);
                onClearRefusal?.();
              }}
              leading={resolve}
            />
          ) : (
            <div className="flex items-center gap-2">
              <button
                ref={trigger}
                type="button"
                data-slot="reply"
                disabled={waiting}
                aria-label={`Reply to ${thread.comments[0]?.author.name ?? "thread"}`}
                onClick={() => setReplying(true)}
                className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-hairline bg-surface px-2.5 text-left text-[14px] text-text-subtle outline-none transition-colors hover:bg-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
              >
                Reply
              </button>
              {resolve}
            </div>
          )}
          <Refusal reason={refusal} />
        </div>
      ) : null}
    </article>
  );
}

/** A thread on a whole block, or on a message's field (its threads are on its fields): "Comment on the push title". */
function wholeAnchorLabel(blockId: string): string {
  const field = ALL_CHANNEL_FIELDS.find((f) => f.id === blockId);
  return field ? `Comment on the ${field.name}` : "Comment on a block";
}

/** The new-thread composer, as a card: what it will attach to, a field, Cancel and Comment. */
export function ComposeCard({
  anchor,
  author,
  onSubmit,
  onCancel,
  snippet = null,
  draft = "",
  onDraftChange,
  className,
}: {
  anchor: { blockId: string; quote?: string };
  author: Person;
  /** Posts the comment. The card hides while it is on its way, and comes back with its text if it is refused. */
  onSubmit: (body: string) => Promise<Outcome>;
  onCancel: () => void;
  /** The start of the block's text, for a comment on a whole block (no quote). */
  snippet?: string | null;
  /** What was typed here before and not posted: the box opens with it. */
  draft?: string;
  /** The text as it changes, so the host can keep it when the box closes with something in it. */
  onDraftChange?: (text: string) => void;
  className?: string;
}) {
  const [body, setBody] = useState(draft);
  const [posting, setPosting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const change = (text: string) => {
    setBody(text);
    onDraftChange?.(text);
  };

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    setRefusal(null);
    setPosting(true);
    const reason = await onSubmit(text);
    if (reason) {
      setPosting(false);
      setRefusal(reason);
    }
  };

  return (
    <article
      data-compose=""
      hidden={posting}
      aria-label="New comment"
      className={cn(
        "relative min-w-0 rounded-xl border border-warning-border bg-surface p-3.5 ring-1 ring-warning-border",
        className,
      )}
    >
      <Anchor quote={anchor.quote} snippet={snippet} />
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5">
        <UserAvatar initials={author.initials} hue={author.hue} size="sm" />
        <div className="min-w-0">
          <ComposerBox
            label="Add a comment"
            action="Comment"
            value={body}
            onChange={change}
            onSubmit={post}
            onCancel={onCancel}
          />
          <Refusal reason={refusal} />
        </div>
      </div>
    </article>
  );
}

// ── Groups ───────────────────────────────────────────────────────

/** "Resolved (2)", collapsed until opened. */
export function ResolvedGroup({
  count,
  open,
  onToggle,
  children,
  className,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <section aria-label="Resolved comments" className={className}>
      <button
        type="button"
        data-slot="resolved-toggle"
        aria-expanded={open}
        onClick={onToggle}
        className="-mx-2 flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-text-muted outline-none hover:bg-hover hover:text-text focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRight
          aria-hidden
          strokeWidth={1.75}
          className={cn("size-4 transition-transform duration-(--dur-base)", open && "rotate-90")}
        />
        Resolved ({count})
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            key="list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.base, ease: ease.outSoft }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 pt-2">{children}</div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
