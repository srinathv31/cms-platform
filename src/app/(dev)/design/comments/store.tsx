"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { DOCUMENT_THREAD, type CommentView, type Person, type ThreadView } from "@/domain/review-types";
import { nowIso, sortThreads, timeAgo } from "./fixtures";
import type { Anchor, Focus, FocusSource } from "./types";

/*
 * The mock's whole comment state in one place: the threads, which one is active, and the new-thread
 * composer. Every variant and the approver frame read and write through this, so they cannot drift.
 * The real build keeps threads on the server (addComment, reply, resolveThread, reopenThread) and
 * hands the editor the same shape.
 */

export interface Store {
  /** The viewer: Maya in the author's workspace, Jordan on the review screen. */
  me: Person;
  /** Everyone's threads, in document order. The document-level change request comes first. */
  threads: ThreadView[];
  open: ThreadView[];
  resolved: ThreadView[];
  /** The open thread that belongs to the whole version (a change request's reason), if any. */
  docThread: ThreadView | undefined;
  /** Open threads anchored to blocks. */
  anchored: ThreadView[];
  activeId: string | null;
  focus: Focus | null;
  pending: Anchor | null;
  activate: (id: string, source: FocusSource) => void;
  deactivate: () => void;
  startCompose: (anchor: Anchor) => void;
  cancelCompose: () => void;
  post: (body: string) => string | null;
  reply: (id: string, body: string) => void;
  resolve: (id: string) => void;
  reopen: (id: string) => void;
  ago: (iso: string) => string;
  /** True once, if the page was opened with `compose=sel`: select a phrase so the bubble shows. */
  takeStartSelection: () => boolean;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside <StoreProvider>");
  return store;
}

export function StoreProvider({
  seed,
  me,
  initialActive,
  initialPending,
  startSelected,
  children,
}: {
  seed: ThreadView[];
  me: Person;
  initialActive: string | null;
  initialPending: Anchor | null;
  startSelected: boolean;
  children: ReactNode;
}) {
  const [threads, setThreads] = useState(seed);
  const [activeId, setActiveId] = useState<string | null>(initialActive);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [pending, setPending] = useState<Anchor | null>(initialPending);
  const counter = useRef(0);
  const nonce = useRef(0);
  const selectOnStart = useRef(startSelected);
  const takeStartSelection = useCallback(() => {
    const was = selectOnStart.current;
    selectOnStart.current = false;
    return was;
  }, []);

  const activate = useCallback((id: string, source: FocusSource) => {
    setActiveId(id);
    setFocus({ id, source, nonce: ++nonce.current });
  }, []);
  const deactivate = useCallback(() => setActiveId(null), []);

  const startCompose = useCallback((anchor: Anchor) => {
    setActiveId(null);
    setPending(anchor);
    setFocus({ id: "pending", source: "doc", nonce: ++nonce.current });
  }, []);
  const cancelCompose = useCallback(() => setPending(null), []);

  const comment = useCallback(
    (body: string, kind: CommentView["kind"] = "comment"): CommentView => ({
      id: `c-new-${++counter.current}`,
      author: me,
      body,
      kind,
      createdAt: nowIso(),
    }),
    [me],
  );

  const post = useCallback(
    (body: string) => {
      if (!pending) return null;
      const id = `t-new-${++counter.current}`;
      const created: ThreadView = {
        id,
        blockId: pending.blockId,
        quote: pending.quote,
        status: "open",
        originVersionNumber: 2,
        comments: [comment(body)],
        orphaned: false,
      };
      setThreads((all) => sortThreads([...all, created]));
      setPending(null);
      setActiveId(id);
      setFocus({ id, source: "doc", nonce: ++nonce.current });
      return id;
    },
    [pending, comment],
  );

  const reply = useCallback(
    (id: string, body: string) =>
      setThreads((all) => all.map((t) => (t.id === id ? { ...t, comments: [...t.comments, comment(body)] } : t))),
    [comment],
  );

  const resolve = useCallback(
    (id: string) => {
      setThreads((all) =>
        all.map((t) => (t.id === id ? { ...t, status: "resolved", resolvedBy: me, resolvedAt: nowIso() } : t)),
      );
      setActiveId((current) => (current === id ? null : current));
    },
    [me],
  );

  const reopen = useCallback((id: string) => {
    setThreads((all) =>
      all.map((t) => (t.id === id ? { ...t, status: "open", resolvedBy: undefined, resolvedAt: undefined } : t)),
    );
    setActiveId(id);
    setFocus({ id, source: "list", nonce: ++nonce.current });
  }, []);

  const store = useMemo<Store>(() => {
    const open = threads.filter((t) => t.status === "open");
    return {
      me,
      threads,
      open,
      resolved: threads.filter((t) => t.status === "resolved"),
      docThread: open.find((t) => t.blockId === DOCUMENT_THREAD),
      anchored: open.filter((t) => t.blockId !== DOCUMENT_THREAD),
      activeId,
      focus,
      pending,
      activate,
      deactivate,
      startCompose,
      cancelCompose,
      post,
      reply,
      resolve,
      reopen,
      ago: timeAgo,
      takeStartSelection,
    };
  }, [threads, me, activeId, focus, pending, activate, deactivate, startCompose, cancelCompose, post, reply, resolve, reopen, takeStartSelection]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
