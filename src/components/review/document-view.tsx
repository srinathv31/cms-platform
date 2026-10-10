"use client";

import { useMemo, type RefObject } from "react";
import { GutterMarkers } from "@/components/comments/gutter-markers";
import { FieldsDocument } from "@/components/redline/fields-document";
import { DocumentEditor } from "@/editor/components/document-editor";
import { EditorRoot } from "@/editor/components/editor-root";
import type { Variable } from "@/editor/model/types";
import type { CommentRequest, DocumentEditorHandle, ThreadAnchor } from "@/editor/types";
import type { JSONContent } from "@/domain/types";
import type { FieldRedline, FooterRedline, RedlineDoc, ThreadView } from "@/domain/review-types";
import type { ChannelFamily } from "@/domain/types";
import { FieldsView } from "./fields-view";
import { RedlineView } from "./redline-view";
import { RV } from "./review-grid";

/**
 * The version as a read-only document, or, with Show changes on, as the redline against the baseline
 * (the Active version, or after a revoke the version the correction started from). They are two
 * renderers in the same cell with the same typography; the editor's own document styles do both.
 *
 * The clean document is the live editor, read-only: it is where comments live (a highlight per open
 * thread, a Comment button on selected text, markers in the right gutter). The redline is static, so it
 * has no highlights and no selection to comment on; it has the rest (markers in the gutter, the scroll
 * to a thread's block with a tint on it, a comment on a whole block), through the same handle ref
 * (redline-view.tsx). Opening a thread never turns the changes off.
 *
 * Each channel's own fields show here too, as the composer shows them (redline/fields-document.tsx),
 * with their redline while Show changes is on. A document's (its email subject and preheader) sit above
 * its body. A message (an Alert) has no body: its fields are its whole content, with its comments beside
 * them (fields-view.tsx).
 */

/** The version's variables, plus any the baseline had that this one dropped (a deleted chip needs its label). */
function labelsFor(variables: readonly Variable[], baseline: readonly Variable[] | null): Variable[] {
  if (!baseline) return [...variables];
  const have = new Set(variables.map((v) => v.key));
  return [...variables, ...baseline.filter((v) => !have.has(v.key))];
}

export function DocumentView({
  versionId,
  family,
  fields,
  footer,
  body,
  variables,
  baselineVariables,
  redline,
  changesOnly,
  editorRef,
  anchors,
  activeThreadId,
  threads,
  activeBlockId,
  onThreadClick,
  onActivate,
  onRequestComment,
  onRequestBlockComment,
}: {
  versionId: string;
  /** A document shows its body (and its email details); a message, its fields alone. */
  family: ChannelFamily;
  /** The fields of the channels that are on: their redline while Show changes is on, else as they stand. */
  fields: readonly FieldRedline[];
  /** The SMS footer locked under the message: the version's own (frozen at submit), and its redline with Show changes. */
  footer: FooterRedline | null;
  body: JSONContent;
  variables: Variable[];
  baselineVariables: Variable[] | null;
  /** Set while Show changes is on. */
  redline: RedlineDoc | null;
  changesOnly: boolean;
  editorRef: RefObject<DocumentEditorHandle | null>;
  /** What the editor highlights: the open threads, and the comment being written. */
  anchors: readonly ThreadAnchor[];
  activeThreadId: string | null;
  /** What the gutter marks. */
  threads: ThreadView[];
  /** The block the redline tints (the one being read or commented on). */
  activeBlockId: string | null;
  onThreadClick: (threadId: string) => void;
  onActivate: (threadId: string) => void;
  /** Absent when the viewer can't comment: no Comment button, no markers' add path. */
  onRequestComment?: (anchor: CommentRequest) => void;
  onRequestBlockComment?: (blockId: string) => void;
}) {
  const labels = useMemo(() => labelsFor(variables, baselineVariables), [variables, baselineVariables]);

  return (
    <div
      id="review-panel-document"
      role="tabpanel"
      aria-labelledby="review-tab-document"
      data-slot="editor"
      className={RV.doc}
    >
      {family === "message" ? (
        <FieldsView
          fields={fields}
          variables={labels}
          changesOnly={changesOnly}
          footer={footer}
          editorRef={editorRef}
          anchors={anchors}
          threads={threads}
          activeThreadId={activeThreadId}
          activeBlockId={activeBlockId}
          onActivate={onActivate}
          onRequestComment={onRequestComment}
          onRequestBlockComment={onRequestBlockComment}
        />
      ) : (
        <FieldsDocument
          fields={fields}
          variables={labels}
          layout="details"
          changesOnly={changesOnly}
          align="start"
          className="mb-6 border-b border-hairline pb-4"
        />
      )}
      {family === "message" ? null : redline ? (
        <RedlineView
          doc={redline}
          variables={labels}
          changesOnly={changesOnly}
          editorRef={editorRef}
          anchors={anchors}
          threads={threads}
          activeThreadId={activeThreadId}
          activeBlockId={activeBlockId}
          onActivate={onActivate}
          onRequestComment={onRequestComment}
          onRequestBlockComment={onRequestBlockComment}
        />
      ) : (
        <EditorRoot key={versionId} variables={variables} readOnly>
          <div className="relative">
            <DocumentEditor
              content={body}
              ref={editorRef}
              align="start"
              threads={anchors}
              activeThreadId={activeThreadId}
              onThreadClick={onThreadClick}
              onRequestComment={onRequestComment}
            />
            <GutterMarkers
              editor={editorRef}
              threads={threads}
              activeThreadId={activeThreadId}
              onActivate={onActivate}
              onRequestBlockComment={onRequestBlockComment}
            />
          </div>
        </EditorRoot>
      )}
    </div>
  );
}
