"use client";

// The ONE file where the workspace touches the editor's composition API (src/editor/README.md):
//
//   <EditorRoot variables onVariablesChange baseline requiredSections readOnly>
//     <DocumentEditor content onChange ref align />      the document column
//     <VariablesPanel />                                   in the rail
//     useEditorHistory()                                   the header's undo and redo
//   </EditorRoot>
//
// Tree order matters: the document renders BEFORE the panel and inside the same Suspense boundary
// (the page's one <Stream>). The body registers its initial JSON during render, so the server HTML
// already carries the panel's usage counts; a panel in its own boundary could hydrate first and
// mismatch. ContentWorkspace keeps that order (document cell, then rail).
//
// The root reads `variables` once. A different version is a different root: the server component
// that renders ContentWorkspace passes `key={versionId}`, which remounts everything below.

import { useLayoutEffect, type Ref } from "react";
import { DocumentEditor } from "@/editor/components/document-editor";
import { EditorRoot, useEditorHistory } from "@/editor/components/editor-root";
import { VariablesPanel } from "@/editor/components/variables-panel";
import type { JSONContent, RequiredSection, Variable } from "@/editor/model/types";
import type { CommentRequest, DocumentEditorHandle, EditorHistory, ThreadAnchor } from "@/editor/types";

export interface EditorScopeProps {
  /** The template's variable list (the consumer contract); the root owns it from the first render. */
  variables: Variable[];
  /** The variables of the newest version that still renders, for contract flags on a draft; null when none does. */
  baseline: Variable[] | null;
  requiredSections: RequiredSection[];
  readOnly: boolean;
  onVariablesChange: (variables: Variable[]) => void;
  children: React.ReactNode;
}

/** Everything inside shares one variable list: the document, the panel and (later) inline fields. */
export function EditorScope({
  variables,
  baseline,
  requiredSections,
  readOnly,
  onVariablesChange,
  children,
}: EditorScopeProps) {
  return (
    <EditorRoot
      variables={variables}
      onVariablesChange={onVariablesChange}
      baseline={baseline}
      requiredSections={requiredSections}
      readOnly={readOnly}
    >
      {children}
    </EditorRoot>
  );
}

export interface DocumentBodyProps {
  content: JSONContent;
  /** Fires on every change to the document. Omit when the document is read-only. */
  onChange?: (doc: JSONContent) => void;
  /** Receives the editor's handle (`focus("first-section")`); safe to call before the editor is live. */
  editorRef: Ref<DocumentEditorHandle>;
  /** Review comments on the document: the highlights, and what a click, the caret or the Comment button reports. */
  comments?: {
    threads: readonly ThreadAnchor[];
    activeThreadId: string | null;
    onThreadClick: (threadId: string) => void;
    onCaretThreadChange: (threadId: string | null) => void;
    /** Offers the Comment button (and ⌘⌥M). Omit when the viewer can't comment. */
    onRequestComment?: (anchor: CommentRequest) => void;
  };
}

/** The document. Its text edge sits on the column's left edge and the block-handle gutter hangs into the margin. */
export function DocumentBody({ content, onChange, editorRef, comments }: DocumentBodyProps) {
  return (
    <DocumentEditor
      content={content}
      onChange={onChange}
      ref={editorRef}
      align="start"
      threads={comments?.threads}
      activeThreadId={comments?.activeThreadId}
      onThreadClick={comments?.onThreadClick}
      onCaretThreadChange={comments?.onCaretThreadChange}
      onRequestComment={comments?.onRequestComment}
    />
  );
}

/** The variables panel, in the rail. */
export function VariablesSection() {
  return <VariablesPanel />;
}

/**
 * Hands the root's undo and redo (the last-focused field's, the document's until another has had
 * focus) to `onChange` as they change, and null when it goes. Renders nothing; place it inside the scope.
 */
export function HistoryBridge({ onChange }: { onChange: (history: EditorHistory | null) => void }) {
  const history = useEditorHistory();
  useLayoutEffect(() => {
    onChange(history);
  }, [history, onChange]);
  useLayoutEffect(() => () => onChange(null), [onChange]);
  return null;
}
