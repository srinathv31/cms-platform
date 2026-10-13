"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DOCUMENT_THREAD,
  type ActionResult,
  type Person,
} from "@/domain/review-types";
import {
  addComment,
  reopenThread,
  reply,
  resolveThread,
} from "@/server/actions/comments";
import { cn } from "@/lib/utils";
import type { CommentView, ThreadView } from "@/server/queries/threads";
import { revealInScroller } from "./reveal";
import {
  ComposeCard,
  ResolvedGroup,
  ThreadCard,
  type Outcome,
} from "./thread-card";
import {
  groupThreads,
  isOptimistic,
  optimisticId,
  type ThreadMutation,
} from "./thread-state";
import { useFocusRequests } from "./use-focus-request";
import type { ComposerState } from "./use-review-threads";

const UNREACHABLE = "Couldn't reach the server. Try again.";
const STAND_IN: Person = { id: "you", name: "You", initials: "Y", hue: 215 };

export type ComposerOutcome = "posted" | "cancelled";

export interface ThreadListProps {
  threads: ThreadView[];
  activeThreadId: string | null;
  /** A card was chosen (null: the active thread was resolved). */
  onActivate: (threadId: string | null) => void;
  /** Reply, resolve, reopen and compose are offered. */
  canComment: boolean;
  /**
   * A new-thread composer, shown at the top of the list. `useReviewThreads().composer` carries the draft left
   * in it last time and the opener to return focus to; a plain anchor works too, without either.
   */
  composer: ComposerState | null;
  /**
   * The composer was posted or cancelled (Esc, Cancel). After a post the list moves focus to the new thread's
   * card; after a cancel it returns focus to the control that opened the box, unless the host already put it
   * somewhere (the caret in an editable document).
   */
  onComposerClose: (outcome?: ComposerOutcome) => void;
  templateId: string;
  /** The version a new thread is created on (the one on screen). */
  versionId: string;
  className?: string;

  /** The viewer, for the comments they write (shown at once, before the server confirms). Without it they read "You". */
  viewer?: Person;
  /** The demo clock's "now" (ISO): what "3h ago" is measured from. Without it, the browser's clock, once it has loaded. */
  now?: string;
  /**
   * The start of a block's text, for a card about a whole block (a thread with no quote): it is shown where
   * a quote would be. Without it those cards have no anchor line.
   */
  blockText?: (blockId: string) => string | null;
  /** Where a block sits in the document, so a new thread slots into document order before the server confirms it. */
  blockPosition?: (blockId: string) => number | null;
  /**
   * `useReviewThreads().mutate`, with that hook's `threads` passed here. The one optimistic layer lives in the
   * hook, so a change is applied once and everything that reads the hook's threads (the document's markers and
   * highlights) changes with the list.
   */
  onMutate: (mutation: ThreadMutation) => void;
}

/**
 * The threads of a version as a list. First the change request (the thread about the whole version),
 * then open threads in document order, then those whose block is gone (labelled quietly), then
 * "Resolved (N)", collapsed. A new-thread composer sits above them all.
 *
 * Changes (post, reply, resolve, reopen) go to `@/server/actions/comments` and show at once; the
 * server's list replaces them when it arrives, and a refusal brings the control back with its reason
 * beside it.
 */
export function ThreadList({
  threads,
  activeThreadId,
  onActivate,
  canComment,
  composer,
  onComposerClose,
  templateId,
  versionId,
  className,
  viewer,
  now,
  blockText,
  blockPosition,
  onMutate,
}: ThreadListProps) {
  const me = viewer ?? STAND_IN;
  const nowMs = useNowMs(now);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  // Why a thread's last change was refused. Kept here, not in the card: a resolved card moves to the
  // collapsed group while the change is on its way, and comes back (as a new card) when it is refused.
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const counter = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  // Focus. A control that is clicked and then goes away (Resolve, Reopen, the composer's buttons) takes
  // focus with it: each of those says where focus goes next, and the hook moves it there (use-focus-request.ts).
  const focus = useFocusRequests();

  const byThread = (threadId: string) =>
    Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-thread]") ?? [],
    ).find((el) => el.dataset.thread === threadId) ?? null;
  const resolvedToggle = () =>
    root.current?.querySelector<HTMLElement>('[data-slot="resolved-toggle"]') ??
    null;
  /** A card's way in: its Reply, else its open reply box, else the card. */
  const wayIn = (threadId: string) => {
    const card = byThread(threadId);
    return (
      card?.querySelector<HTMLElement>('[data-slot="reply"], textarea') ?? card
    );
  };

  /** Applies `mutation` now and asks the server; resolves with what it answered once it has. */
  const run = useCallback(
    <T,>(mutation: ThreadMutation, call: () => Promise<ActionResult<T>>) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          onMutate(mutation);
          try {
            resolve(await call());
          } catch {
            resolve({ ok: false, code: "failed", reason: UNREACHABLE });
          }
        });
      }),
    [onMutate],
  );

  const stamp = () => new Date(nowMs ?? Date.now()).toISOString();

  /** What a card's control gets back: nothing when it worked, else the reason (which the card then shows). */
  const refuse = (threadId: string, reason: string | null) =>
    setRefusals((all) => {
      const next = { ...all };
      if (reason === null) delete next[threadId];
      else next[threadId] = reason;
      return next;
    });
  const clearRefusal = (threadId: string) => refuse(threadId, null);
  const settle = (threadId: string, result: ActionResult<object>): Outcome => {
    const reason = result.ok ? null : result.reason;
    refuse(threadId, reason);
    return reason;
  };

  const onReply = async (threadId: string, body: string): Promise<Outcome> => {
    const comment: CommentView = {
      id: optimisticId("comment", ++counter.current),
      author: me,
      body,
      kind: "comment",
      createdAt: stamp(),
    };
    clearRefusal(threadId);
    return settle(
      threadId,
      await run({ type: "reply", threadId, comment }, () =>
        reply({ threadId, body }),
      ),
    );
  };

  const onResolve = async (threadId: string): Promise<Outcome> => {
    if (threadId === activeThreadId) onActivate(null);
    clearRefusal(threadId);
    // The Resolve button goes with the card (it moves to the collapsed group): focus moves to the next open
    // card's Reply (the one before it when this was the last), or to "Resolved (N)" when none are left.
    const open = Array.from(
      root.current?.querySelectorAll<HTMLElement>(
        '[data-thread][data-status="open"]',
      ) ?? [],
    ).filter(
      (el) =>
        el.dataset.thread !== threadId &&
        !isOptimistic(el.dataset.thread ?? ""),
    );
    const own = byThread(threadId);
    const next =
      open.find(
        (el) =>
          own &&
          own.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
      ) ?? open.at(-1);
    focus.ask(
      () =>
        (next?.dataset.thread ? wayIn(next.dataset.thread) : null) ??
        resolvedToggle(),
    );
    const mutation: ThreadMutation = {
      type: "resolve",
      threadId,
      by: me,
      at: stamp(),
    };
    return settle(
      threadId,
      await run(mutation, () => resolveThread({ threadId })),
    );
  };

  const onReopen = async (threadId: string): Promise<Outcome> => {
    clearRefusal(threadId);
    // Reopen goes with the card (it moves back among the open ones): focus follows the card.
    focus.ask(() => byThread(threadId));
    const result = await run({ type: "reopen", threadId }, () =>
      reopenThread({ threadId }),
    );
    if (result.ok) onActivate(threadId);
    return settle(threadId, result);
  };

  const onCompose = async (body: string): Promise<Outcome> => {
    if (!composer) return null;
    const { blockId, quote } = composer;
    const thread: ThreadView = {
      id: optimisticId("thread", ++counter.current),
      blockId,
      quote: quote ?? null,
      status: "open",
      originVersionNumber: null,
      originRound: null,
      originLabel: null,
      comments: [
        {
          id: optimisticId("comment", ++counter.current),
          author: me,
          body,
          kind: "comment",
          createdAt: stamp(),
        },
      ],
      orphaned: false,
    };
    const result = await run({ type: "add", thread, blockPosition }, () =>
      addComment({
        templateId,
        versionId,
        blockId,
        quote: quote ?? null,
        body,
      }),
    );
    if (!result.ok) return result.reason;
    composer.onDraftChange?.("");
    // The box goes away and the thread shows under its own id, once the server's list has arrived: focus goes to its card.
    focus.ask(() => byThread(result.threadId));
    onComposerClose("posted");
    onActivate(result.threadId);
    return null;
  };

  /** Esc or Cancel: the box closes (what was typed is kept by the host) and focus goes back to what opened it. */
  const onCancel = () => {
    const opener = composer?.opener ?? null;
    focus.ask(() => {
      if (opener?.isConnected && opener.getClientRects().length > 0)
        return opener.closest(".ProseMirror") ? null : opener;
      return root.current; // the opener is gone with the box: the list itself
    }, 2);
    onComposerClose("cancelled");
  };

  // The document asked for a thread (a marker, a quote): bring its card into view.
  useEffect(() => {
    if (!activeThreadId) return;
    const cards =
      root.current?.querySelectorAll<HTMLElement>("[data-thread]") ?? [];
    revealInScroller(
      Array.from(cards).find((el) => el.dataset.thread === activeThreadId),
    );
  }, [activeThreadId]);

  // A composer opened (the Comment button): it is at the top, so show the top.
  const composerKey = composer
    ? `${composer.blockId}:${composer.quote ?? ""}`
    : null;
  useEffect(() => {
    if (composerKey === null) return;
    revealInScroller(
      root.current?.querySelector<HTMLElement>("[data-compose]"),
    );
  }, [composerKey]);

  const groups = useMemo(() => groupThreads(threads), [threads]);
  const card = (thread: ThreadView, selectable: boolean) => (
    <ThreadCard
      key={thread.id}
      thread={thread}
      active={thread.id === activeThreadId}
      canComment={canComment}
      nowMs={nowMs}
      snippet={
        thread.quote || thread.blockId === DOCUMENT_THREAD || thread.orphaned
          ? null
          : (blockText?.(thread.blockId) ?? null)
      }
      onSelect={
        selectable
          ? () => {
              if (!focus.moving()) onActivate(thread.id);
            }
          : undefined
      }
      onReply={onReply}
      onResolve={onResolve}
      onReopen={onReopen}
      refusal={refusals[thread.id] ?? null}
      onClearRefusal={() => clearRefusal(thread.id)}
    />
  );
  const openCards =
    groups.document.length + groups.anchored.length + groups.orphaned.length;

  return (
    <div
      ref={root}
      data-slot="thread-list"
      role="group"
      aria-label="Comments"
      // Where focus goes when the control it was on is gone and there is nothing nearer (not a tab stop).
      tabIndex={-1}
      className={cn("flex flex-col gap-3 outline-none", className)}
    >
      {composer ? (
        <ComposeCard
          key={composerKey}
          anchor={composer}
          author={me}
          snippet={
            composer.quote ? null : (blockText?.(composer.blockId) ?? null)
          }
          draft={composer.draft}
          onDraftChange={composer.onDraftChange}
          onSubmit={onCompose}
          onCancel={onCancel}
        />
      ) : null}
      {groups.document.map((thread) => card(thread, false))}
      {groups.anchored.map((thread) => card(thread, true))}
      {groups.orphaned.length > 0 ? (
        <section
          aria-label="Comments on removed content"
          className="flex flex-col gap-3 pt-1"
        >
          <h3 className="text-[13px] leading-5 font-normal text-text-subtle">
            On removed content
          </h3>
          {groups.orphaned.map((thread) => card(thread, false))}
        </section>
      ) : null}
      {openCards === 0 && !composer ? (
        <p className="text-[14px] leading-6 text-text-muted">
          No open comments.
        </p>
      ) : null}
      <ResolvedGroup
        count={groups.resolved.length}
        open={resolvedOpen}
        onToggle={() => setResolvedOpen((open) => !open)}
        className="mt-1"
      >
        {groups.resolved.map((thread) => card(thread, false))}
      </ResolvedGroup>
    </div>
  );
}

/** "Now" for relative times: the server's (demo) clock when it was handed over, else the browser's once the page has loaded. */
function useNowMs(now: string | undefined): number | null {
  const given = now ? Date.parse(now) : Number.NaN;
  const [browser, setBrowser] = useState<number | null>(null);
  useEffect(() => {
    if (!Number.isNaN(given)) return;
    const tick = () => setBrowser(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [given]);
  return Number.isNaN(given) ? browser : given;
}
