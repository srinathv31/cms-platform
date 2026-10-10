// Public contract of the portable editor module (implementation plan §8.1).
// The host app passes data in and receives events out. Persistence, permissions,
// comment storage and the lifecycle stay in the host.
//
// Composition:
//
//   <EditorRoot variables onVariablesChange baseline requiredSections readOnly>
//     <DocumentEditor content onChange ref />        the document body
//     <VariablesPanel />                             the right-hand panel
//     <InlineVariableField label value onChange />   channel fields (email subject, push title, SMS message)
//   </EditorRoot>
//
// Everything inside one root shares a single variable list, so a chip, a panel row and an inline
// field always agree. <DocumentEditor> also works on its own (no root): it then creates a private
// root from its own `variables`, `requiredSections`, `readOnly` and `onVariablesChange` props.

import type { ReactNode, Ref } from "react";
import type { CharacterRules } from "./model/characters";
import type { FieldLines } from "./model/normalize";
import type { ContractChange, JSONContent, RequiredSection, Variable } from "./model/types";

/**
 * A review thread as the editor sees it. It anchors to a block id (`attrs.id`) and, optionally, a
 * quote: the first match of the quote in the block's text is highlighted; without a quote (or when
 * the quote isn't in the block any more) the whole block is. Only open threads are highlighted.
 */
export interface ThreadAnchor {
  id: string;
  blockId: string;
  quote?: string | null;
  status: "open" | "resolved";
}

/**
 * What a new comment anchors to. From a selection: the top-level block's id and the selected text
 * (chips read as their label; trimmed, whitespace runs as one space). Block-level (no quote): from
 * the handle's `requestComment(blockId)`, or ⌘⌥M with a caret.
 */
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
   * The variable list consumers render now, when there is one (in Stencil, the newest version that
   * still renders). Key, type and required changes against it are contract changes: the panel flags
   * them as they happen.
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

  // Phase 4: review comments. Each works in readOnly, and is safe before the editor has mounted
  // and while it's hidden (<Activity>). A test double or adapter of the handle implements all of them
  // (no-ops are fine).
  /**
   * Scrolls the thread's highlight (its block when it has no text highlight) into view inside its
   * scroll container, centered when it was out of view, and marks the thread active until
   * `activeThreadId` changes. Doesn't move focus. Before mount or while hidden, it's applied when
   * the editor is back.
   */
  focusThread: (threadId: string) => void;
  /** The block's box (`getBoundingClientRect`, viewport coordinates), or null when it isn't rendered. */
  getBlockRect: (blockId: string) => DOMRect | null;
  /**
   * The thread's highlight box: its first text run, or its block for a block-level highlight; the
   * block's box when it isn't highlighted (resolved); null when neither is rendered.
   */
  getThreadRect: (threadId: string) => DOMRect | null;
  /**
   * Calls `listener` (at most once a frame) whenever block positions may have changed: the document
   * resizes or reflows (typing that wraps a line, width, fonts), blocks are added, removed or moved,
   * the editor shows again after being hidden. Read rects with `getBlockRect` / `getThreadRect` in
   * the listener. Returns the unsubscribe function.
   */
  subscribeBlockRects: (listener: () => void) => () => void;
  /** A block-level comment: calls `onRequestComment({ blockId })`. */
  requestComment: (blockId: string) => void;
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

  // Review comments (Phase 4). See README, Behavior → Comments.
  /** Open threads are highlighted (their quote, or their whole block); resolved ones aren't. */
  threads?: readonly ThreadAnchor[];
  /** The thread shown as active: a stronger highlight. `focusThread` also sets it, until this changes. */
  activeThreadId?: string | null;
  /** A click on a highlight (quoted text, or a block highlighted as a whole). */
  onThreadClick?: (threadId: string) => void;
  /** The open thread under the caret, each time it changes (null when the caret leaves every highlight). */
  onCaretThreadChange?: (threadId: string | null) => void;
  /**
   * Turns commenting on. Selected text inside one top-level block gets a Comment action in the
   * toolbar (in readOnly, a toolbar with only Comment), also ⌘⌥M; a caret + ⌘⌥M asks for a
   * block-level comment. The host opens its composer and saves the thread.
   */
  onRequestComment?: (anchor: CommentRequest) => void;
  /** Accepted, not drawn: the host places thread cards itself (see the handle's rect methods). */
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
 * A field editor that accepts text and variable chips, with the same `{{` picker, drag and
 * click-to-insert as the document. Used for the channel fields: the email subject and preheader, a
 * push's title and body, an SMS message. Must render inside an <EditorRoot>. On one line (the default)
 * Enter never adds a line; with `lines="lines"` Enter adds a hard break.
 */
export interface InlineVariableFieldProps {
  /** Accessible name, and how the field is named in a chip's "where it's used" list ("Email subject"). */
  label: string;
  /**
   * One paragraph: `{ type: "doc", content: [{ type: "paragraph", content: [...] }] }`, or null
   * for empty. Read once (remount with a new `key` to reset).
   */
  value: JSONContent | null;
  /**
   * `"line"` (default): one line; a pasted line break becomes a space. `"lines"`: line breaks are kept
   * as hard breaks (Enter adds one, a paste keeps its lines). Read once, like `value`.
   */
  lines?: FieldLines;
  /**
   * Which characters a paste keeps (model/characters.ts). `"document"` (default): the email's fields, which
   * lose invisible characters as the document does. `"message"`: a push's or an SMS's field, which keeps
   * them (the joiner in an emoji sequence, the non-joiner in a Persian name). Read once, like `value`.
   */
  characters?: CharacterRules;
  onChange?: (value: JSONContent) => void;
  /**
   * Not shown for now (the email subject while Email is off), but still part of the root: its chips
   * count in the panel and follow renames and deletes (reported through `onChange`). Click-to-insert,
   * undo and redo pass it by. Default false.
   */
  hidden?: boolean;
  /**
   * Marks problems in the text where they sit (an SMS's characters outside GSM-7, a link on a public
   * shortener). Called on every edit with the field's text (each chip a space, each line break "\n");
   * each flag it returns is underlined, and its popover shows the `message` and, with a `replacement`,
   * a one-click fix. Read on every edit, so it may change between renders. Default: no flags.
   */
  flags?: TextFlagger;
  /**
   * Fixed text shown inside the field's box after what the author types, never editable: an SMS's
   * locked footer. Default none.
   */
  footer?: ReactNode;
  /**
   * `"sm"` (default): 14px text, for a rail (the email subject). `"md"`: 15px text and roomier
   * padding, for a page's main column (the message composer).
   */
  size?: "sm" | "md";
  id?: string;
  className?: string;
}

/**
 * One problem in a field's text (`InlineVariableFieldProps.flags`). `from` and `to` are offsets into
 * the text the flagger was given (UTF-16, `to` exclusive).
 */
export interface TextFlag {
  from: number;
  to: number;
  /** What the popover says: "’ isn't in the SMS character set." */
  message: string;
  /** What the one-click fix writes in its place; "" removes it. Absent: no fix (the popover only explains). */
  replacement?: string;
}

/** A field's text in, its flags out (see `InlineVariableFieldProps.flags`). */
export type TextFlagger = (text: string) => readonly TextFlag[];

// ── Contract state (useContractState) ─────────────────────────

/** What a root knows about its contract at any moment (for the host, e.g. a Submit dialog). */
export interface ContractState {
  variables: Variable[];
  /** Against `baseline`; empty when there is no baseline. */
  changes: ContractChange[];
}

// ── Undo and redo (useEditorHistory) ─────────────────────────

/**
 * Undo and redo for a host's own buttons, on the root's last-focused field (the document until a
 * field has had focus): the same field ⌘Z and ⇧⌘Z act on.
 */
export interface EditorHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** One step back, as ⌘Z, but the page stays where it is (⌘Z scrolls to the change). False when there was nothing to undo. */
  undo: () => boolean;
  /** One step forward again, as ⇧⌘Z, without scrolling. */
  redo: () => boolean;
}

export interface StaticDocumentProps {
  content: JSONContent;
  variables: readonly Variable[];
  /** Match the live editor's `align`. Default "center". */
  align?: DocumentAlign;
  className?: string;
  /** Phase 4: the same highlights as the live editor's `threads` / `activeThreadId`. */
  threads?: readonly ThreadAnchor[];
  activeThreadId?: string | null;
}
