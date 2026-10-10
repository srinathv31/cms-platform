"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type RefObject } from "react";
import { GutterMarkers } from "@/components/comments/gutter-markers";
import { FieldsDocument, createRedlineHandle } from "@/components/redline";
import type { FieldRedline, ThreadView } from "@/domain/review-types";
import type { Variable } from "@/editor/model/types";
import type { CommentRequest, DocumentEditorHandle, ThreadAnchor } from "@/editor/types";

/**
 * A message's content on the review screen: its channel fields as the composer shows them, read-only
 * (FieldsDocument), with the redline against the baseline while Show changes is on, and comments beside
 * them. A message has no body, so its threads are on its fields (domain/comments.ts `commentAnchors`): a
 * field is to a message what a block is to a document. The markers, the scroll to a thread's field and the
 * comment on a whole field (the hover marker, the rail's menu) go through the redline's DOM handle, which
 * finds a field's frame by its `data-block-id` as it finds a block's. There is no text to select, so a
 * comment is always on a whole field.
 */
export function FieldsView({
  fields,
  variables,
  changesOnly,
  smsFooter,
  editorRef,
  anchors,
  threads,
  activeThreadId,
  activeBlockId,
  onActivate,
  onRequestComment,
  onRequestBlockComment,
}: {
  fields: readonly FieldRedline[];
  variables: readonly Variable[];
  changesOnly: boolean;
  smsFooter: string | null;
  editorRef: RefObject<DocumentEditorHandle | null>;
  /** Every thread the screen can name, and the comment being written: what a thread id resolves to. */
  anchors: readonly ThreadAnchor[];
  /** What the gutter marks. */
  threads: ThreadView[];
  activeThreadId: string | null;
  /** The field tinted: the one a thread is being read or written on. */
  activeBlockId: string | null;
  onActivate: (threadId: string) => void;
  /** Absent when the viewer can't comment. */
  onRequestComment?: (anchor: CommentRequest) => void;
  onRequestBlockComment?: (blockId: string) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
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
      <FieldsDocument
        fields={fields}
        variables={variables}
        layout="sections"
        changesOnly={changesOnly}
        activeBlockId={activeBlockId}
        smsFooter={smsFooter}
        align="start"
      />
      <GutterMarkers
        editor={editorRef}
        threads={threads}
        activeThreadId={activeThreadId}
        onActivate={onActivate}
        onRequestBlockComment={onRequestBlockComment}
        noun="field"
      />
    </div>
  );
}
