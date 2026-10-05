"use client";

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState } from "react";
import { DOCUMENT_THREAD, type ThreadView } from "@/domain/review-types";
import type { JSONContent } from "@/domain/types";
import {
  liveBlockPresence,
  reduceThreads,
  samePresence,
  withBlockPresence,
  type ThreadMutation,
} from "./thread-state";

/** What a new thread would attach to: a block, and optionally the quoted text inside it. */
export interface ComposerAnchor {
  blockId: string;
  quote?: string;
}

/**
 * The open composer: its anchor, the text left in it last time on this anchor, and where focus goes
 * back to when it closes. `<ThreadList composer>` takes this (a plain anchor works too: it just
 * has no draft and no opener).
 */
export interface ComposerState extends ComposerAnchor {
  /** Text typed here before and not posted: the box opens with it. */
  draft?: string;
  /** Called with the box's text as it changes, so it is kept for the next time. */
  onDraftChange?: (text: string) => void;
  /** What had focus when the box was opened (null: nothing in the page did). */
  opener?: HTMLElement | null;
}

/**
 * The id of the temporary thread the editor is given while the composer is open, so the selected
 * quote stays marked. It never reaches the list, the markers or the server.
 */
export const COMPOSER_THREAD_ID = "composer";

export interface ReviewThreads {
  /**
   * The template's threads. While a change of yours is on its way (`mutate`), it is already in the list;
   * after `trackDocument`, each thread's `orphaned` reads from the document as it is now.
   */
  threads: ThreadView[];
  activeThreadId: string | null;
  setActive: (id: string | null) => void;
  composer: ComposerState | null;
  /**
   * Opens the new-thread composer on this anchor. It clears the active thread. Text left in the box the
   * last time it was open on the same anchor is put back. `opener` is where focus returns to when the box
   * closes (default: the element that has focus now).
   */
  openComposer: (anchor: ComposerAnchor, opener?: HTMLElement | null) => void;
  closeComposer: () => void;

  /**
   * For `<DocumentEditor threads>`: `threads` plus, while the composer is open, a temporary open thread on
   * its anchor, so the text being commented on stays highlighted.
   */
  threadsForEditor: ThreadView[];
  /** For `<DocumentEditor activeThreadId>`: the composer's temporary thread while it is open, else the active one. */
  editorActiveThreadId: string | null;
  /**
   * Applies a change to `threads` at once. Call it inside a transition, next to the server action it
   * stands for; the list returns to the server's when the transition ends. Hand it to `<ThreadList onMutate>`
   * so the markers and highlights in the document change with the list.
   */
  mutate: (mutation: ThreadMutation) => void;
  /**
   * For a document that can change under the threads (the author's workspace): call it with the document
   * after every edit. A thread whose block was deleted moves to "On removed content" at once, and back
   * when undo restores the block. It re-renders only when a block that has a thread comes or goes.
   */
  trackDocument: (doc: JSONContent) => void;
}

const NO_PRESENCE: ReadonlyMap<string, boolean> = new Map();

const anchorKey = (anchor: ComposerAnchor) => `${anchor.blockId}\u0000${anchor.quote ?? ""}`;

/** The element with focus, or null when nothing in the page has it. */
function focusedElement(): HTMLElement | null {
  const active = typeof document === "undefined" ? null : document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * The client state the author's workspace and the review screen share: the template's threads
 * (the server's, `initial`, plus changes in flight), which thread is active, and the new-thread composer.
 * `initial` is the server's list; it is read on every render, so a refresh simply arrives.
 *
 * What is typed in the composer is kept per anchor for as long as this hook lives (Esc, switching to
 * another comment or another rail view doesn't lose it), and dropped when it is posted or emptied.
 * It lives in a ref, not state: typing never re-renders the screen.
 */
export function useReviewThreads(initial: ThreadView[]): ReviewThreads {
  const [optimistic, mutate] = useOptimistic(initial, reduceThreads);
  const [presence, setPresence] = useState<ReadonlyMap<string, boolean>>(NO_PRESENCE);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const drafts = useRef(new Map<string, string>());

  const threads = useMemo(() => withBlockPresence(optimistic, presence), [optimistic, presence]);

  const setActive = useCallback((id: string | null) => setActiveThreadId(id), []);
  const openComposer = useCallback((anchor: ComposerAnchor, opener?: HTMLElement | null) => {
    const key = anchorKey(anchor);
    setComposer({
      blockId: anchor.blockId,
      ...(anchor.quote !== undefined ? { quote: anchor.quote } : {}),
      draft: drafts.current.get(key) ?? "",
      onDraftChange: (text) => {
        if (text.trim() === "") drafts.current.delete(key);
        else drafts.current.set(key, text);
      },
      opener: opener !== undefined ? opener : focusedElement(),
    });
    setActiveThreadId(null);
  }, []);
  const closeComposer = useCallback(() => setComposer(null), []);

  // The blocks that have a thread (the document's own thread has none), for `trackDocument` to look for.
  const watched = useRef<string[]>([]);
  const seen = useRef<ReadonlyMap<string, boolean>>(NO_PRESENCE);
  useEffect(() => {
    watched.current = [...new Set(threads.filter((t) => t.blockId !== DOCUMENT_THREAD).map((t) => t.blockId))];
  });
  const trackDocument = useCallback((doc: JSONContent) => {
    if (watched.current.length === 0) return;
    const next = liveBlockPresence(doc, watched.current);
    if (samePresence(seen.current, next)) return;
    seen.current = next;
    setPresence(next);
  }, []);

  const threadsForEditor = useMemo(() => {
    if (!composer) return threads;
    const temporary: ThreadView = {
      id: COMPOSER_THREAD_ID,
      blockId: composer.blockId,
      quote: composer.quote ?? null,
      status: "open",
      originVersionNumber: null,
      comments: [],
      orphaned: false,
    };
    return [...threads, temporary];
  }, [threads, composer]);

  return {
    threads,
    activeThreadId,
    setActive,
    composer,
    openComposer,
    closeComposer,
    threadsForEditor,
    editorActiveThreadId: composer ? COMPOSER_THREAD_ID : activeThreadId,
    mutate,
    trackDocument,
  };
}
