// The review-comment side of <DocumentEditor>: the host's threads, active thread and handlers, and
// the handle's thread and rect methods. One per document editor; it outlives the TipTap editor
// (which is re-created after <Activity> hides the route), so everything the host calls works before
// mount, while hidden, and again after.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { setReviewThreads } from "../extensions/review-threads";
import { blockElement, createRectSignal, rectOf, revealInContainer, threadElement } from "../lib/block-rects";
import type { CommentRequest, DocumentEditorProps, ThreadAnchor } from "../types";

export type CommentHandlers = Pick<DocumentEditorProps, "onThreadClick" | "onCaretThreadChange" | "onRequestComment">;

const NO_THREADS: readonly ThreadAnchor[] = [];

/** True when blocks were added, removed or reordered (moves that keep the document's size). */
function blocksMoved(before: PMNode, after: PMNode): boolean {
  if (before.childCount !== after.childCount) return true;
  for (let i = 0; i < before.childCount; i++) {
    if (before.child(i).attrs.id !== after.child(i).attrs.id) return true;
  }
  return false;
}

export interface CommentBridge {
  // ── From the host (props) ──
  setHandlers: (handlers: CommentHandlers) => void;
  setThreads: (threads: readonly ThreadAnchor[] | undefined) => void;
  /** The host's `activeThreadId`; only a change applies (so one set by focusThread() survives a re-show). */
  setActive: (threadId: string | null) => void;
  // ── From the live editor ──
  /** What the highlight plugin starts from when an editor is created. */
  initial: () => { threads: readonly ThreadAnchor[]; activeId: string | null };
  /** The editor is ready (created, or re-created after being hidden), or gone (null). */
  connect: (editor: Editor | null) => void;
  /** The editor's wrapper element, whose size changes move blocks. */
  attach: (wrapper: HTMLElement | null) => void;
  /** A document change: tells rect subscribers when blocks moved. */
  docChanged: (before: PMNode, after: PMNode) => void;
  threadClick: (threadId: string) => void;
  caretThread: (threadId: string | null) => void;
  requestComment: (anchor: CommentRequest) => void;
  // ── The handle ──
  focusThread: (threadId: string) => void;
  blockRect: (blockId: string) => DOMRect | null;
  threadRect: (threadId: string) => DOMRect | null;
  subscribeRects: (listener: () => void) => () => void;
}

export function createCommentBridge(): CommentBridge {
  let threads: readonly ThreadAnchor[] = NO_THREADS;
  let activeId: string | null = null;
  let hostActive: string | null | undefined = undefined;
  let pendingThread: string | null = null;
  let handlers: CommentHandlers = {};
  let editor: Editor | null = null;
  let wrapper: HTMLElement | null = null;
  const rects = createRectSignal();

  const live = () => (editor && !editor.isDestroyed ? editor : null);

  const reveal = (threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    const element = threadElement(wrapper, threadId) ?? (thread ? blockElement(wrapper, thread.blockId) : null);
    if (element && rectOf(element)) revealInContainer(element);
  };

  const blockRect = (blockId: string) => rectOf(blockElement(wrapper, blockId));

  return {
    setHandlers: (next) => {
      handlers = next;
    },
    setThreads: (next) => {
      threads = next ?? NO_THREADS;
      const current = live();
      if (current) setReviewThreads(current.view, { threads });
    },
    setActive: (next) => {
      // Effects run again when <Activity> shows the editor: the same value isn't a change.
      if (next === hostActive) return;
      hostActive = next;
      activeId = next;
      const current = live();
      if (current) setReviewThreads(current.view, { activeId });
    },

    initial: () => ({ threads, activeId }),
    connect: (next) => {
      editor = next;
      if (!next) return;
      // focusThread() before mount or while hidden: the highlight is already active (the plugin
      // started from `initial`); reveal it once the editor is laid out.
      const thread = pendingThread;
      pendingThread = null;
      if (thread) requestAnimationFrame(() => reveal(thread));
      rects.notify();
    },
    attach: (next) => {
      wrapper = next;
      rects.observe(next);
    },
    docChanged: (before, after) => {
      if (rects.active() && blocksMoved(before, after)) rects.notify();
    },
    threadClick: (threadId) => handlers.onThreadClick?.(threadId),
    caretThread: (threadId) => handlers.onCaretThreadChange?.(threadId),
    requestComment: (anchor) => handlers.onRequestComment?.(anchor),

    focusThread: (threadId) => {
      activeId = threadId;
      const current = live();
      if (!current) {
        pendingThread = threadId;
        return;
      }
      setReviewThreads(current.view, { activeId: threadId });
      reveal(threadId);
    },
    blockRect,
    threadRect: (threadId) => {
      const rect = rectOf(threadElement(wrapper, threadId));
      if (rect) return rect;
      const thread = threads.find((t) => t.id === threadId);
      return thread ? blockRect(thread.blockId) : null;
    },
    subscribeRects: (listener) => rects.subscribe(listener),
  };
}
