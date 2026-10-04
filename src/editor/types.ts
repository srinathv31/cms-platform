// Public contract of the portable editor module (implementation plan §8.1).
// The host app passes data in and receives events out. Persistence, permissions,
// comment storage and the lifecycle stay in the host.
//
// Composition:
//
//   <EditorRoot variables onVariablesChange baseline requiredSections readOnly>
//     <DocumentEditor content onChange ref />        the document body
//     <VariablesPanel />                             the right-hand panel
//     <InlineVariableField label value onChange />   one-line fields (email subject, preheader)
//   </EditorRoot>
//
// Everything inside one root shares a single variable list, so a chip, a panel row and an inline
// field always agree. <DocumentEditor> also works on its own (no root): it then creates a private
// root from its own `variables`, `requiredSections`, `readOnly` and `onVariablesChange` props.

import type { ReactNode, Ref } from "react";
import type { ContractChange, JSONContent, RequiredSection, Variable } from "./model/types";

export interface ThreadAnchor {
  id: string;
  blockId: string;
  quote?: string | null;
  status: "open" | "resolved";
}

export interface CommentRequest {
  blockId: string;
  quote?: string;
}

/** Where `autoFocus` / `focus()` puts the caret. "first-section" = the body of the first required section. */
export type FocusTarget = "start" | "end" | "first-section";

/**
 * How the document sits in its column.
 *   "center"  the text column is centered, with a symmetric gutter for the block handle (default)
 *   "start"   the text's left edge sits on the column's left edge (aligned with a page title above)
 *             and the handle gutter hangs into the left margin
 * Sizes come from CSS custom properties: `--doc-width` (text column) and `--ucomp-doc-gutter`
 * (handle gutter, default 3.5rem), both settable on any ancestor.
 */
export type DocumentAlign = "center" | "start";

// ── <EditorRoot> ──────────────────────────────────────────────

export interface EditorRootProps {
  /**
   * The template's variable list (the consumer contract). Read once, as the initial list: from
   * then on the root owns it and reports every change through `onVariablesChange`. To load a
   * different version, remount the root with a new `key`.
   */
  variables: Variable[];
  /** Fires after every change to the list: create, label, key, type, required, sample, delete. */
  onVariablesChange?: (variables: Variable[]) => void;
  /**
   * The Active version's variable list, when the template has one. Key, type and required changes
   * against it are contract changes: the panel flags them as they happen.
   */
  baseline?: Variable[] | null;
  /**
   * The content type's required sections. The document marks them on their H2s (`requiredKey`)
   * and the guard locks every heading that carries a key (no delete, rename, retype or move);
   * this list is accepted for the host's reference and isn't consulted by the editor yet.
   */
  requiredSections?: RequiredSection[];
  /** View only: no toolbar, handles, `/` or `{{` menus, and no panel editing. */
  readOnly?: boolean;
  /**
   * The short note shown at a required heading when an edit to it is blocked (delete, rename,
   * retype, move). Default "Required for disclosures".
   */
  requiredNote?: string;
  children: ReactNode;
}

// ── <DocumentEditor> ──────────────────────────────────────────

/** Imperative handle (`ref`). The host uses it to move focus in from outside, e.g. Enter in the name field. */
export interface DocumentEditorHandle {
  /** Focuses the document at `target`; without one, where the caret last was. Safe before the editor has mounted. */
  focus: (target?: FocusTarget) => void;
}

export interface DocumentEditorProps {
  /**
   * TipTap JSON. Top-level blocks carry stable `attrs.id`.
   * Read once, as the initial document; to load a different document, remount with a new `key`.
   */
  content: JSONContent;
  /** Fires on every document change. The host debounces and saves. Not fired for mount-time normalization. */
  onChange?: (doc: JSONContent) => void;
  /** Optional autofocus target on mount. */
  autoFocus?: FocusTarget | false;
  /** Default "center". */
  align?: DocumentAlign;
  ref?: Ref<DocumentEditorHandle>;
  className?: string;

  // Standalone use only. Inside an <EditorRoot> these come from the root and are ignored here.
  /** The template's variable list (the consumer contract). Chips read label/type from here. */
  variables?: Variable[];
  /** See EditorRootProps.requiredSections. */
  requiredSections?: RequiredSection[];
  readOnly?: boolean;
  /** Fires when the variable list changes (e.g. `{{key}}` pasted for an unknown key). */
  onVariablesChange?: (variables: Variable[]) => void;
  /** See EditorRootProps.requiredNote. */
  requiredNote?: string;

  // Review comments: accepted for the review screen, not drawn yet.
  threads?: ThreadAnchor[];
  onRequestComment?: (anchor: CommentRequest) => void;
  renderThread?: (thread: ThreadAnchor) => ReactNode;
}

// ── <VariablesPanel> ──────────────────────────────────────────

/**
 * The template's variables: type icon, label, monospace key, required toggle, usage count.
 * Must render inside an <EditorRoot>. The host places it (e.g. a sticky right column).
 */
export interface VariablesPanelProps {
  className?: string;
}

// ── <InlineVariableField> ─────────────────────────────────────

/**
 * A one-line editor that accepts text and variable chips, with the same `{{` picker, drag and
 * click-to-insert as the document. Used for the email subject and preheader. Must render inside
 * an <EditorRoot>. Enter never adds a line.
 */
export interface InlineVariableFieldProps {
  /** Accessible name, and how the field is named in a chip's "where it's used" list ("Email subject"). */
  label: string;
  /**
   * One paragraph: `{ type: "doc", content: [{ type: "paragraph", content: [...] }] }`, or null
   * for empty. Read once (remount with a new `key` to reset).
   */
  value: JSONContent | null;
  onChange?: (value: JSONContent) => void;
  id?: string;
  className?: string;
}

// ── Contract state (useContractState) ─────────────────────────

/** What a root knows about its contract at any moment (for the host, e.g. a Submit dialog). */
export interface ContractState {
  variables: Variable[];
  /** Against `baseline`; empty when there is no baseline. */
  changes: ContractChange[];
}

export interface StaticDocumentProps {
  content: JSONContent;
  variables: readonly Variable[];
  /** Match the live editor's `align`. Default "center". */
  align?: DocumentAlign;
  className?: string;
}
