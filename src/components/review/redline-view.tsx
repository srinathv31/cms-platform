"use client";

import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { GutterMarkers } from "@/components/comments/gutter-markers";
import { RedlineDocument, collapsedHosts, createRedlineHandle, groupBlocks, isCollapsedKey } from "@/components/redline";
import type { RedlineDoc, ThreadView } from "@/domain/review-types";
import type { CommentRequest, DocumentEditorHandle, ThreadAnchor, Variable } from "@/editor";

/**
 * The redline with comments beside it: the same gutter markers as the editor's, the same scroll to a
 * thread's block, the same block-level comment path. The editor isn't mounted while the changes show, so
 * the handle its markers and the screen's focus calls go through (`editorRef`) is the redline's own
 * (redline/dom-handle.ts), answered from the redline's DOM by block id. Whichever of the two is on screen
 * owns the ref.
 *
 * Selecting text to comment on it stays a feature of the clean document; here a comment is on a whole
 * block (the marker on hover, the menu in the rail), and the box opens in the rail as usual.
 *
 * With Changes only, a thread on an unchanged block that is hidden gets its marker on the caption or
 * "N unchanged blocks" line the block is collapsed into: the threads hidden there share one marker, with
 * their comments counted together. Choosing it opens the thread, and the active thread's block shows in
 * place (RedlineDocument reveals `activeBlockId`), so the marker moves onto the block itself.
 */
export function RedlineView({
  doc,
  variables,
  changesOnly,
  editorRef,
  anchors,
  threads,
  activeThreadId,
  activeBlockId,
  onActivate,
  onRequestComment,
  onRequestBlockComment,
}: {
  doc: RedlineDoc;
  variables: readonly Variable[];
  changesOnly: boolean;
  editorRef: RefObject<DocumentEditorHandle | null>;
  /** Every thread the screen can name, and the comment being written: what a thread id resolves to. */
  anchors: readonly ThreadAnchor[];
  /** What the gutter marks. */
  threads: ThreadView[];
  activeThreadId: string | null;
  /** The block the redline tints. */
  activeBlockId: string | null;
  onActivate: (threadId: string) => void;
  /** Absent when the viewer can't comment. */
  onRequestComment?: (anchor: CommentRequest) => void;
  onRequestBlockComment?: (blockId: string) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const markerThreads = useMemo(() => threadsForMarkers(doc, changesOnly, activeBlockId, threads), [doc, changesOnly, activeBlockId, threads]);
  // The marker keys that stand for blocks the redline has collapsed (their label says so).
  const collapsedKeys = useMemo(
    () => new Set(markerThreads.map((t) => t.blockId).filter(isCollapsedKey)),
    [markerThreads],
  );
  // The handle is made once and reads the latest props, so it never changes under the markers.
  const latest = useRef({ anchors, onRequestComment });
  useLayoutEffect(() => {
    latest.current = { anchors, onRequestComment };
  });
  useImperativeHandle(
    editorRef,
    () =>
      createRedlineHandle({
        root: () => wrapper.current?.querySelector<HTMLElement>("[data-redline-document]") ?? null,
        blockOfThread: (id) => latest.current.anchors.find((a) => a.id === id)?.blockId ?? null,
        onRequestComment: (request) => latest.current.onRequestComment?.(request),
      }),
    [],
  );

  return (
    <div ref={wrapper} className="relative">
      <RedlineDocument doc={doc} variables={variables} changesOnly={changesOnly} activeBlockId={activeBlockId} align="start" />
      <GutterMarkers
        editor={editorRef}
        threads={markerThreads}
        activeThreadId={activeThreadId}
        onActivate={onActivate}
        onRequestBlockComment={onRequestBlockComment}
        collapsedKeys={collapsedKeys}
      />
    </div>
  );
}

/**
 * The threads as the gutter should group them: one on a block hidden by Changes only is moved onto
 * the key of the line it is collapsed into (blocks.ts `hostKey`, which the redline's handle answers
 * for), so every thread keeps a marker and the threads under one line share it.
 */
export function threadsForMarkers(
  doc: RedlineDoc,
  changesOnly: boolean,
  activeBlockId: string | null,
  threads: ThreadView[],
): ThreadView[] {
  if (!changesOnly) return threads;
  const hosts = collapsedHosts(groupBlocks(doc, true, undefined, activeBlockId));
  if (hosts.size === 0) return threads;
  return threads.map((thread) => {
    const host = hosts.get(thread.blockId);
    return host && host !== thread.blockId ? { ...thread, blockId: host } : thread;
  });
}
