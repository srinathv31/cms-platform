"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type RefObject } from "react";
import { GutterMarkers } from "@/components/comments/gutter-markers";
import { FieldsDocument, createRedlineHandle } from "@/components/redline";
import type { FieldRedline, FooterRedline, ThreadView } from "@/domain/review-types";
import type { Variable } from "@/editor/model/types";
import type { CommentRequest, DocumentEditorHandle, ThreadAnchor } from "@/editor/types";

/**
 * A version's channel fields on the review screen: as the composer shows them, read-only (FieldsDocument),
 * with the redline against the baseline while Show changes is on, and comments beside them. A field is to
 * the review what a block is to the body: a thread can anchor to it (domain/comments.ts `commentAnchors`).
 * The markers, the scroll to a thread's field and the comment on a whole field (the hover marker, the
 * rail's menu) go through the redline's DOM handle, which finds a field's frame by its `data-block-id` as it
 * finds a block's. There is no text to select, so a comment is always on a whole field.
 *
 *   "sections"  a message's whole content, one section per channel (it has no body, so this is all there is)
 *   "details"   a document's email subject and preheader, in a block above its body
 *
 * The body keeps its own handle (the live editor's, or the redline's); this view answers for the fields
 * through `handleRef` (`useReviewComments` asks whichever owns an anchor).
 */

/** The details block's spacing from the body under it. */
const DETAILS = "mb-6 border-b border-hairline pb-4";

export function FieldsView({
  layout,
  fields,
  variables,
  changesOnly,
  footer,
  handleRef,
  anchors,
  threads,
  activeThreadId,
  activeBlockId,
  onActivate,
  onRequestComment,
  onRequestBlockComment,
}: {
  layout: "sections" | "details";
  fields: readonly FieldRedline[];
  variables: readonly Variable[];
  changesOnly: boolean;
  footer: FooterRedline | null;
  /** Where the fields' handle goes: what the markers, the scroll to a thread and the comment on a field ask. */
  handleRef: RefObject<DocumentEditorHandle | null>;
  /** Every thread the screen can name, and the comment being written: what a thread id resolves to. */
  anchors: readonly ThreadAnchor[];
  /** What the gutter marks: the threads on these fields (others are not found here, and get no marker). */
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
    handleRef,
    () =>
      createRedlineHandle({
        root: () => wrapper.current?.querySelector<HTMLElement>("[data-fields-document]") ?? null,
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
        layout={layout}
        changesOnly={changesOnly}
        activeBlockId={activeBlockId}
        footer={footer}
        align="start"
        className={layout === "details" ? DETAILS : undefined}
      />
      <GutterMarkers
        editor={handleRef}
        threads={threads}
        activeThreadId={activeThreadId}
        onActivate={onActivate}
        onRequestBlockComment={onRequestBlockComment}
        noun="field"
        label={layout === "details" ? "Comments on the email details" : undefined}
      />
    </div>
  );
}
