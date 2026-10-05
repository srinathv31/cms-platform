// The pure side of the comment list: how a mutation changes a list of threads (the optimistic
// update), and how a list is grouped for the rail. No React here.

import { DOCUMENT_THREAD, type CommentView, type Person, type ThreadView } from "@/domain/review-types";
import type { JSONContent, VersionState } from "@/domain/types";

/** A change the author just made, applied to the list at once while the server catches up. */
export type ThreadMutation =
  | {
      type: "add";
      thread: ThreadView;
      /** Where a block sits in the document (any increasing number); lets a new thread find its place among the others. */
      blockPosition?: (blockId: string) => number | null;
    }
  | { type: "reply"; threadId: string; comment: CommentView }
  | { type: "resolve"; threadId: string; by: Person; at: string }
  | { type: "reopen"; threadId: string };

const isAnchored = (t: ThreadView) => t.blockId !== DOCUMENT_THREAD && !t.orphaned;

/**
 * Puts a new thread where the server will: after the threads already on its block; else among the
 * blocks in document order (when the caller can say where a block is); else after the last anchored
 * thread and before the orphaned ones. The document thread, if new, goes first.
 */
export function insertThread(
  threads: readonly ThreadView[],
  thread: ThreadView,
  blockPosition?: (blockId: string) => number | null,
): ThreadView[] {
  const list = [...threads];
  if (thread.blockId === DOCUMENT_THREAD) {
    list.unshift(thread);
    return list;
  }
  const lastOnBlock = list.findLastIndex((t) => t.blockId === thread.blockId);
  if (lastOnBlock >= 0) {
    list.splice(lastOnBlock + 1, 0, thread);
    return list;
  }
  const own = blockPosition?.(thread.blockId) ?? null;
  if (own !== null && blockPosition) {
    const before = list.findIndex((t) => {
      if (!isAnchored(t)) return false;
      const at = blockPosition(t.blockId);
      return at !== null && at > own;
    });
    if (before >= 0) {
      list.splice(before, 0, thread);
      return list;
    }
  }
  const firstOrphan = list.findIndex((t) => t.orphaned);
  list.splice(firstOrphan >= 0 ? firstOrphan : list.length, 0, thread);
  return list;
}

export function reduceThreads(threads: ThreadView[], mutation: ThreadMutation): ThreadView[] {
  switch (mutation.type) {
    case "add":
      return insertThread(threads, mutation.thread, mutation.blockPosition);
    case "reply":
      return threads.map((t) =>
        t.id === mutation.threadId ? { ...t, comments: [...t.comments, mutation.comment] } : t,
      );
    case "resolve":
      return threads.map((t) =>
        t.id === mutation.threadId && t.status === "open"
          ? { ...t, status: "resolved", resolvedBy: mutation.by, resolvedAt: mutation.at }
          : t,
      );
    case "reopen":
      return threads.map((t) => {
        if (t.id !== mutation.threadId || t.status !== "resolved") return t;
        const reopened: ThreadView = { ...t, status: "open" };
        delete reopened.resolvedBy;
        delete reopened.resolvedAt;
        return reopened;
      });
  }
}

export interface ThreadGroups {
  /** Open threads about the whole version (a change request's reason). */
  document: ThreadView[];
  /** Open threads on blocks, in the order they came (document order). */
  anchored: ThreadView[];
  /** Open threads whose block is no longer in the version. */
  orphaned: ThreadView[];
  /** Every resolved thread. */
  resolved: ThreadView[];
}

export function groupThreads(threads: readonly ThreadView[]): ThreadGroups {
  const groups: ThreadGroups = { document: [], anchored: [], orphaned: [], resolved: [] };
  for (const thread of threads) {
    if (thread.status === "resolved") groups.resolved.push(thread);
    else if (thread.blockId === DOCUMENT_THREAD) groups.document.push(thread);
    else if (thread.orphaned) groups.orphaned.push(thread);
    else groups.anchored.push(thread);
  }
  return groups;
}

/**
 * Comments belong to a version while it is being written or reviewed. Once it has been decided (Active,
 * Superseded, Revoked, or sent back) it is a record: its threads read, and are answered in the next draft.
 */
export function versionTakesComments(state: VersionState): boolean {
  return state === "draft" || state === "in_review";
}

// ── Threads against the document as it is now ─────────────────────────────────────────────────────

/** Whether each of these blocks is in the document: the top-level blocks first, then any nested ones that carry the id (as the server counts them). */
export function liveBlockPresence(doc: JSONContent, blockIds: readonly string[]): Map<string, boolean> {
  const top = new Set<string>();
  for (const block of doc.content ?? []) {
    const id = block.attrs?.id;
    if (typeof id === "string") top.add(id);
  }
  let nested: Set<string> | null = null;
  const presence = new Map<string, boolean>();
  for (const id of blockIds) {
    if (top.has(id)) {
      presence.set(id, true);
      continue;
    }
    if (!nested) {
      nested = new Set<string>();
      const walk = (node: JSONContent) => {
        for (const child of node.content ?? []) {
          const childId = child.attrs?.id;
          if (typeof childId === "string") nested!.add(childId);
          walk(child);
        }
      };
      walk(doc);
    }
    presence.set(id, nested.has(id));
  }
  return presence;
}

export function samePresence(a: ReadonlyMap<string, boolean>, b: ReadonlyMap<string, boolean>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, present] of a) if (b.get(id) !== present) return false;
  return true;
}

/**
 * The threads with `orphaned` read from the document as it is now, for the blocks `presence` knows:
 * a thread whose block was deleted moves to "On removed content" at once, and back when undo restores
 * the block. Blocks it doesn't know keep the server's say. The same list comes back when nothing changes.
 */
export function withBlockPresence(threads: ThreadView[], presence: ReadonlyMap<string, boolean>): ThreadView[] {
  if (presence.size === 0) return threads;
  let changed = false;
  const next = threads.map((thread) => {
    if (thread.blockId === DOCUMENT_THREAD) return thread;
    const present = presence.get(thread.blockId);
    if (present === undefined || thread.orphaned === !present) return thread;
    changed = true;
    return { ...thread, orphaned: !present };
  });
  return changed ? next : threads;
}

/** How many threads are waiting on someone: the number on the Comments tab. */
export function openCount(threads: readonly ThreadView[]): number {
  return threads.reduce((n, t) => (t.status === "open" ? n + 1 : n), 0);
}

// ── Threads that exist only on this screen, until the server's arrive ─────────────────────────────

const OPTIMISTIC = "optimistic-";

/** An id for a thread or comment that the server hasn't confirmed yet. */
export function optimisticId(kind: "thread" | "comment", n: number): string {
  return `${OPTIMISTIC}${kind}-${n}`;
}

export function isOptimistic(id: string): boolean {
  return id.startsWith(OPTIMISTIC);
}
