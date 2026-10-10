"use client";

import { startTransition, useCallback, useEffect, useMemo, useOptimistic, useRef, useState } from "react";
import { DOCUMENT_THREAD, type ActionResult, type CommentView, type Person, type ThreadView } from "@/domain/review-types";
import { addComment, reopenThread, reply, resolveThread } from "@/server/actions/comments";
import { cn } from "@/lib/utils";
import { revealInScroller } from "./reveal";
import { ComposeCard, ResolvedGroup, ThreadCard, type Outcome } from "./thread-card";
import { groupThreads, isOptimistic, optimisticId, reduceThreads, type ThreadMutation } from "./thread-state";
import type { ComposerState } from "./use-review-threads";

const UNREACHABLE = "Couldn't reach the server. Try again.";
const STAND_IN: Person = { id: "you", name: "You", initials: "Y", hue: 215 };

/** How long a focus request waits for its place to be on screen (a new thread's id comes with the server's list). */
const FOCUS_WAIT = 5000;

/** Where focus should go next, asked for when a control that has it is about to go away. */
interface FocusRequest {
  /** The place, once it exists (null: not there yet, keep waiting). */
  find: () => HTMLElement | null;
  /** The element that had focus when it was asked: the request waits until that has gone. */
  from: HTMLElement | null;
  until: number;
  /** Animation frames to wait after the control has gone, so a host that puts focus back itself goes first. */
  frames: number;
}

/** Nothing has focus: the page fell back to <body> (or to an element that has since left it). */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

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
   * Hand over `useReviewThreads().mutate` and pass its `threads` here, and a change is applied once, in
   * the hook, so everything that reads the hook's threads (the document's markers and highlights) changes with the list.
   * Without it, the list keeps its own optimistic copy of `threads`.
   */
  onMutate?: (mutation: ThreadMutation) => void;
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
  // Two ways to be optimistic: through the hook that owns the list (`onMutate`), or on a copy of it here.
  const [local, mutateLocal] = useOptimistic(threads, reduceThreads);
  const shown = onMutate ? threads : local;
  const apply = onMutate ?? mutateLocal;

  const me = viewer ?? STAND_IN;
  const nowMs = useNowMs(now);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  // Why a thread's last change was refused. Kept here, not in the card: a resolved card moves to the
  // collapsed group while the change is on its way, and comes back (as a new card) when it is refused.
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const counter = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  // ── Focus. A control that is clicked and then goes away (Resolve, Reopen, the composer's buttons) takes
  // focus with it, and the page falls back to <body>. So each of those says where focus goes next, and the
  // list moves it there once the control has gone and the place is on screen. Never over focus that was put
  // somewhere on purpose in the meantime.
  const pending = useRef<FocusRequest | null>(null);
  // While the list itself moves focus into a card, the card's "focus arrived, so select me" (the keyboard path) stands down:
  // moving focus after a resolve doesn't also move the document to another thread.
  const movingFocus = useRef(false);
  const moveFocusTo = (target: HTMLElement) => {
    movingFocus.current = true;
    try {
      target.focus({ preventScroll: true });
    } finally {
      movingFocus.current = false;
    }
  };
  const askFocus = (find: FocusRequest["find"], frames = 0) => {
    const active = document.activeElement;
    // <body> isn't a control that goes away: with nothing focused there is nothing to wait for.
    const from = active instanceof HTMLElement && active !== document.body ? active : null;
    pending.current = { find, from, until: Date.now() + FOCUS_WAIT, frames };
  };
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    if (Date.now() > request.until) {
      pending.current = null;
      return;
    }
    if (request.from?.isConnected) return; // the control that had focus is still on screen
    if (!focusIsLost()) {
      pending.current = null; // it went somewhere on purpose
      return;
    }
    const arrive = () => {
      if (!focusIsLost()) return;
      const target = request.find();
      if (target) moveFocusTo(target);
    };
    if (request.frames > 0) {
      // Hosts put focus back too (the caret in an editable document, a frame later): look again after them.
      pending.current = null;
      let left = request.frames;
      const wait = () => (--left > 0 ? requestAnimationFrame(wait) : arrive());
      requestAnimationFrame(wait);
      return;
    }
    const target = request.find();
    if (!target) return; // not on screen yet (a new thread waits for its id): try again on the next render
    pending.current = null;
    moveFocusTo(target);
  });

  const byThread = (threadId: string) =>
    Array.from(root.current?.querySelectorAll<HTMLElement>("[data-thread]") ?? []).find((el) => el.dataset.thread === threadId) ?? null;
  const resolvedToggle = () => root.current?.querySelector<HTMLElement>('[data-slot="resolved-toggle"]') ?? null;
  /** A card's way in: its Reply, else its open reply box, else the card. */
  const wayIn = (threadId: string) => {
    const card = byThread(threadId);
    return card?.querySelector<HTMLElement>('[data-slot="reply"], textarea') ?? card;
  };

  /** Applies `mutation` now and asks the server; resolves with what it answered once it has. */
  const run = useCallback(
    <T,>(mutation: ThreadMutation, call: () => Promise<ActionResult<T>>) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          apply(mutation);
          try {
            resolve(await call());
          } catch {
            resolve({ ok: false, code: "failed", reason: UNREACHABLE });
          }
        });
      }),
    [apply],
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
    return settle(threadId, await run({ type: "reply", threadId, comment }, () => reply({ threadId, body })));
  };

  const onResolve = async (threadId: string): Promise<Outcome> => {
    if (threadId === activeThreadId) onActivate(null);
    clearRefusal(threadId);
    // The Resolve button goes with the card (it moves to the collapsed group): focus moves to the next open
    // card's Reply (the one before it when this was the last), or to "Resolved (N)" when none are left.
    const open = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-thread][data-status="open"]') ?? []).filter(
      (el) => el.dataset.thread !== threadId && !isOptimistic(el.dataset.thread ?? ""),
    );
    const own = byThread(threadId);
    const next = open.find((el) => own && own.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ?? open.at(-1);
    askFocus(() => (next?.dataset.thread ? wayIn(next.dataset.thread) : null) ?? resolvedToggle());
    const mutation: ThreadMutation = { type: "resolve", threadId, by: me, at: stamp() };
    return settle(threadId, await run(mutation, () => resolveThread({ threadId })));
  };

  const onReopen = async (threadId: string): Promise<Outcome> => {
    clearRefusal(threadId);
    // Reopen goes with the card (it moves back among the open ones): focus follows the card.
    askFocus(() => byThread(threadId));
    const result = await run({ type: "reopen", threadId }, () => reopenThread({ threadId }));
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
        { id: optimisticId("comment", ++counter.current), author: me, body, kind: "comment", createdAt: stamp() },
      ],
      orphaned: false,
    };
    const result = await run({ type: "add", thread, blockPosition }, () =>
      addComment({ templateId, versionId, blockId, quote: quote ?? null, body }),
    );
    if (!result.ok) return result.reason;
    composer.onDraftChange?.("");
    // The box goes away and the thread shows under its own id, once the server's list has arrived: focus goes to its card.
    askFocus(() => byThread(result.threadId));
    onComposerClose("posted");
    onActivate(result.threadId);
    return null;
  };

  /** Esc or Cancel: the box closes (what was typed is kept by the host) and focus goes back to what opened it. */
  const onCancel = () => {
    const opener = composer?.opener ?? null;
    askFocus(() => {
      if (opener?.isConnected && opener.getClientRects().length > 0) return opener.closest(".ProseMirror") ? null : opener;
      return root.current; // the opener is gone with the box: the list itself
    }, 2);
    onComposerClose("cancelled");
  };

  // The document asked for a thread (a marker, a quote): bring its card into view.
  useEffect(() => {
    if (!activeThreadId) return;
    const cards = root.current?.querySelectorAll<HTMLElement>("[data-thread]") ?? [];
    revealInScroller(Array.from(cards).find((el) => el.dataset.thread === activeThreadId));
  }, [activeThreadId]);

  // A composer opened (the Comment button): it is at the top, so show the top.
  const composerKey = composer ? `${composer.blockId}:${composer.quote ?? ""}` : null;
  useEffect(() => {
    if (composerKey === null) return;
    revealInScroller(root.current?.querySelector<HTMLElement>("[data-compose]"));
  }, [composerKey]);

  const groups = useMemo(() => groupThreads(shown), [shown]);
  const card = (thread: ThreadView, selectable: boolean) => (
    <ThreadCard
      key={thread.id}
      thread={thread}
      active={thread.id === activeThreadId}
      canComment={canComment}
      nowMs={nowMs}
      snippet={thread.quote || thread.blockId === DOCUMENT_THREAD || thread.orphaned ? null : (blockText?.(thread.blockId) ?? null)}
      onSelect={
        selectable
          ? () => {
              if (!movingFocus.current) onActivate(thread.id);
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
  const openCards = groups.document.length + groups.anchored.length + groups.orphaned.length;

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
          snippet={composer.quote ? null : (blockText?.(composer.blockId) ?? null)}
          draft={composer.draft}
          onDraftChange={composer.onDraftChange}
          onSubmit={onCompose}
          onCancel={onCancel}
        />
      ) : null}
      {groups.document.map((thread) => card(thread, false))}
      {groups.anchored.map((thread) => card(thread, true))}
      {groups.orphaned.length > 0 ? (
        <section aria-label="Comments on removed content" className="flex flex-col gap-3 pt-1">
          <h3 className="text-[13px] leading-5 font-normal text-text-subtle">On removed content</h3>
          {groups.orphaned.map((thread) => card(thread, false))}
        </section>
      ) : null}
      {openCards === 0 && !composer ? (
        <p className="text-[14px] leading-6 text-text-muted">No open comments.</p>
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
