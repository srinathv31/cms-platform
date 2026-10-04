"use client";

// The ONE file where the workspace touches the editor's composition API (src/editor/README.md):
//
//   <EditorRoot variables onVariablesChange baseline requiredSections readOnly>
//     <DocumentEditor content onChange ref align />      the document column
//     <VariablesPanel />                                   in the rail
//   </EditorRoot>
//
// Tree order matters: the document renders BEFORE the panel and inside the same Suspense boundary
// (the page's one <Stream>). The body registers its initial JSON during render, so the server HTML
// already carries the panel's usage counts; a panel in its own boundary could hydrate first and
// mismatch. ContentWorkspace keeps that order (document cell, then rail).
//
// The root reads `variables` once. A different version is a different root: the server component
// that renders ContentWorkspace passes `key={versionId}`, which remounts everything below.

import type { Ref } from "react";
import {
  DocumentEditor,
  EditorRoot,
  VariablesPanel,
  type DocumentEditorHandle,
  type JSONContent,
  type RequiredSection,
  type Variable,
} from "@/editor";

export interface EditorScopeProps {
  /** The template's variable list (the consumer contract); the root owns it from the first render. */
  variables: Variable[];
  /** The Active version's variables, for contract flags on a draft of a live template. */
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
}

/** The document. Its text edge sits on the column's left edge and the block-handle gutter hangs into the margin. */
export function DocumentBody({ content, onChange, editorRef }: DocumentBodyProps) {
  return <DocumentEditor content={content} onChange={onChange} ref={editorRef} align="start" />;
}

/** The variables panel, in the rail. */
export function VariablesSection() {
  return <VariablesPanel />;
}
