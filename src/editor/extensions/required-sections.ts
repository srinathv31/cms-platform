// Required sections: top-level headings that carry a `requiredKey` (from the content type).
//
// Schema (server-safe, always on): the attribute, rendered as data-required, plus an integrity rule
// (a key appears at most once; the first in document order keeps it) and pasted or dropped
// content never carries a key (a copied required heading pastes as a plain heading).
//
// Guard (client, `guard: true`): the headings can't be deleted, renamed, retyped or reordered.
//   • The invariant, checked on every transaction (filterTransaction): every required heading
//     before the change is still there after it, top-level, in the same order, with the same
//     level and the same content (text and marks). Anything that breaks it is rejected: typing or
//     pasting into a heading, a Backspace/Delete that would join a block into one, bold/italic/
//     underline/link on one, setParagraph/setHeading/lists on one, deleting one as a selected
//     node, dragging one away.
//   • Range operations that span required headings (select-all + Delete or typing, cut, paste over a
//     selection) keep the headings in place and apply to everything else, so a select-all-delete
//     leaves the bare sections with the caret in the first one.
//   • Enter at the start of a required heading adds a line above it; Backspace at its start removes
//     an empty line above it.
//   • Whenever the guard steps in, the heading shows a small note ("Required for disclosures") for
//     about two seconds, also announced politely to screen readers. Notes never stack.
// The content under the headings is free, and blocks can move between sections.

import { Extension } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export interface RequiredSectionsOptions {
  /** Node types that can be required section headings. */
  types: string[];
  /** Enforce the guard and show the note (the live editor). Off for server-side use. */
  guard: boolean;
  /** The note's text, read when it shows. */
  note: () => string;
}

export const REQUIRED_KEY_ATTR = "requiredKey";

/** The note's default text. Hosts with other content types pass their own (`requiredNote`). */
export const DEFAULT_REQUIRED_NOTE = "Required for disclosures";

export const requiredSectionsPluginKey = new PluginKey("requiredSections");
const guardPluginKey = new PluginKey<NoteState>("requiredSectionsGuard");

const NOTE_MS = 2000;

// ── Reading required headings ────────────────────────────────────

export interface RequiredHeading {
  key: string;
  /** Position before the heading node. */
  pos: number;
  /** Position after it. */
  end: number;
  node: PMNode;
}

const headingCache = new WeakMap<PMNode, RequiredHeading[]>();

/** Top-level headings with a required key, in document order (cached per document). */
export function requiredHeadings(doc: PMNode): RequiredHeading[] {
  const cached = headingCache.get(doc);
  if (cached) return cached;
  const list: RequiredHeading[] = [];
  doc.forEach((node, offset) => {
    const key = node.attrs[REQUIRED_KEY_ATTR] as string | null | undefined;
    if (key && node.isTextblock) list.push({ key, pos: offset, end: offset + node.nodeSize, node });
  });
  headingCache.set(doc, list);
  return list;
}

export function isRequiredHeading(node: PMNode | null | undefined): boolean {
  return !!node && node.isTextblock && !!node.attrs[REQUIRED_KEY_ATTR];
}

/**
 * The key of the first required heading that `next` deletes, renames, retypes or reorders
 * relative to `prev`, or null when every one survives intact.
 */
export function requiredViolation(prev: PMNode, next: PMNode): string | null {
  const before = requiredHeadings(prev);
  if (!before.length) return null;
  const after = requiredHeadings(next);
  const byKey = new Map(after.map((h, index) => [h.key, { h, index }]));
  let lastIndex = -1;
  for (const old of before) {
    const found = byKey.get(old.key);
    if (!found || found.index < lastIndex) return old.key;
    lastIndex = found.index;
    const node = found.h.node;
    if (node === old.node) continue;
    // Text, chips, line breaks and marks all count: a required heading takes no formatting either.
    if (node.type !== old.node.type || node.attrs.level !== old.node.attrs.level || !node.content.eq(old.node.content)) {
      return old.key;
    }
  }
  return null;
}

/** The required headings a range overlaps (any part of them). */
export function headingsIn(doc: PMNode, from: number, to: number): RequiredHeading[] {
  return requiredHeadings(doc).filter((h) => from < h.end && to > h.pos);
}

/** The required heading a position sits inside (its text), if any. */
export function requiredHeadingAt(doc: PMNode, pos: number): RequiredHeading | null {
  return requiredHeadings(doc).find((h) => pos > h.pos && pos < h.end) ?? null;
}

// ── Range operations that keep the headings ──────────────────────

/** True when [from, to] holds anything: text, a leaf, or a whole node. */
function hasContent(doc: PMNode, from: number, to: number): boolean {
  if (to <= from) return false;
  let found = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false;
    if (node.isText) {
      found = Math.max(pos, from) < Math.min(pos + node.nodeSize, to);
    } else if (node.isLeaf) {
      found = pos >= from && pos + node.nodeSize <= to;
    } else if (pos >= from && pos + node.nodeSize <= to) {
      found = true;
    }
    return !found;
  });
  return found;
}

/** [from, to] minus the required headings it overlaps, keeping only pieces with content. */
function piecesAround(doc: PMNode, from: number, to: number, headings: RequiredHeading[]): Array<[number, number]> {
  const pieces: Array<[number, number]> = [];
  let cursor = from;
  for (const h of headings) {
    if (cursor < h.pos) pieces.push([cursor, h.pos]);
    cursor = Math.max(cursor, h.end);
  }
  if (cursor < to) pieces.push([cursor, to]);
  return pieces.filter(([a, b]) => hasContent(doc, a, b));
}

/**
 * A position where text can go, at or right after `pos`: inside a non-required textblock. Between
 * blocks or inside a required heading, it's the next paragraph (one is added when there isn't).
 */
function writablePos(tr: Transaction, pos: number): number {
  const $pos = tr.doc.resolve(pos);
  if ($pos.parent.inlineContent && !isRequiredHeading($pos.parent)) return pos;
  const boundary = $pos.depth === 0 ? pos : $pos.after(1);
  const next = tr.doc.resolve(boundary).nodeAfter;
  if (next && next.type.name === "paragraph" && !isRequiredHeading(next)) return boundary + 1;
  tr.insert(boundary, tr.doc.type.schema.nodes.paragraph.create());
  return boundary + 1;
}

export type RangeInsert = string | Slice | null;

/**
 * Applies a delete/replace over [from, to] to everything except the required headings in it.
 * Returns the transaction, or null when the range holds nothing but required heading text (the
 * operation would only damage a heading). `headings` must be non-empty.
 */
export function replaceAroundRequired(
  state: EditorState,
  from: number,
  to: number,
  insert: RangeInsert,
): Transaction | null {
  const headings = headingsIn(state.doc, from, to);
  const pieces = piecesAround(state.doc, from, to, headings);
  if (!pieces.length) return null;

  const tr = state.tr;
  for (let i = pieces.length - 1; i >= 0; i--) tr.delete(pieces[i][0], pieces[i][1]);
  const at = writablePos(tr, tr.mapping.map(pieces[0][0], -1));

  if (typeof insert === "string" && insert) {
    tr.insertText(insert, at);
    tr.setSelection(TextSelection.create(tr.doc, at + insert.length));
  } else if (insert instanceof Slice && insert.size) {
    tr.setSelection(TextSelection.create(tr.doc, at));
    tr.replaceSelection(insert);
  } else {
    tr.setSelection(TextSelection.create(tr.doc, at));
  }
  return tr.scrollIntoView();
}

// ── The note ─────────────────────────────────────────────────────

interface NoteState {
  key: string | null;
  seq: number;
  decorations: DecorationSet;
}

type NoteMeta = { show: string } | { hide: number };

/** Shows the note at the required heading `key` (from commands, components, other extensions). */
export function flashRequiredNote(view: EditorView, key: string) {
  if (view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(guardPluginKey, { show: key } satisfies NoteMeta).setMeta("addToHistory", false));
}

function noteDecorations(doc: PMNode, key: string | null, seq: number, text: string): DecorationSet {
  const heading = key ? requiredHeadings(doc).find((h) => h.key === key) : undefined;
  if (!heading) return DecorationSet.empty;
  return DecorationSet.create(doc, [
    Decoration.node(heading.pos, heading.end, {
      "data-required-note": text,
      // Alternates so a repeated note restarts its animation instead of stacking.
      "data-note-cycle": seq % 2 ? "a" : "b",
    }),
  ]);
}

// ── Keys ─────────────────────────────────────────────────────────

function isDeleteKey(event: KeyboardEvent): boolean {
  return event.key === "Backspace" || event.key === "Delete";
}

function emptyParagraph(node: PMNode | null | undefined): boolean {
  return !!node && node.type.name === "paragraph" && node.content.size === 0;
}

// ── Extension ────────────────────────────────────────────────────

export const RequiredSections = Extension.create<RequiredSectionsOptions>({
  name: "requiredSections",

  // Ahead of the default keymaps, the `{{` and `/` menus and the chip field, so the guard sees keys first.
  priority: 1000,

  addOptions() {
    return { types: ["heading"], guard: false, note: () => DEFAULT_REQUIRED_NOTE };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          [REQUIRED_KEY_ATTR]: {
            default: null,
            // Splitting at the end of a required heading starts a plain block.
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-required") || null,
            renderHTML: (attributes) =>
              attributes[REQUIRED_KEY_ATTR] ? { "data-required": attributes[REQUIRED_KEY_ATTR] } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const types = new Set(this.options.types);
    const plugins: Plugin[] = [
      new Plugin({
        key: requiredSectionsPluginKey,
        props: {
          // Pasted or dropped content never brings a required key along.
          transformPasted: (slice) => stripRequiredKeys(slice),
        },
        appendTransaction: (transactions, _oldState, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos) => {
            const key = types.has(node.type.name) ? (node.attrs[REQUIRED_KEY_ATTR] as string | null) : null;
            if (key) {
              if (seen.has(key)) {
                tr ??= state.tr;
                tr.setNodeAttribute(pos, REQUIRED_KEY_ATTR, null);
              } else {
                seen.add(key);
              }
            }
            return !node.isTextblock; // headings never nest; skip inline content
          });
          return tr;
        },
      }),
    ];
    if (this.options.guard) plugins.push(guardPlugin(this.options.note));
    return plugins;
  },
});

function guardPlugin(noteText: () => string): Plugin<NoteState> {
  let view: EditorView | null = null;
  let live: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const flashLater = (key: string) =>
    queueMicrotask(() => {
      if (view && !view.isDestroyed) flashRequiredNote(view, key);
    });

  /** A key the user pressed on a range that spans required headings: apply it around them. */
  const rangeOp = (v: EditorView, from: number, to: number, insert: RangeInsert, uiEvent?: string): boolean => {
    const headings = headingsIn(v.state.doc, from, to);
    if (!headings.length) return false;
    const tr = replaceAroundRequired(v.state, from, to, insert);
    if (tr) v.dispatch(uiEvent ? tr.setMeta("uiEvent", uiEvent) : tr);
    flashRequiredNote(v, headings[0].key);
    return true;
  };

  return new Plugin<NoteState>({
    key: guardPluginKey,

    state: {
      init: () => ({ key: null, seq: 0, decorations: DecorationSet.empty }),
      apply: (tr, prev, _old, state) => {
        const meta = tr.getMeta(guardPluginKey) as NoteMeta | undefined;
        if (meta && "show" in meta) {
          const seq = prev.seq + 1;
          return { key: meta.show, seq, decorations: noteDecorations(state.doc, meta.show, seq, noteText()) };
        }
        if (meta && "hide" in meta) {
          return meta.hide === prev.seq ? { key: null, seq: prev.seq, decorations: DecorationSet.empty } : prev;
        }
        if (!prev.key || !tr.docChanged) return prev;
        return { ...prev, decorations: noteDecorations(state.doc, prev.key, prev.seq, noteText()) };
      },
    },

    filterTransaction: (tr, state) => {
      if (!tr.docChanged) return true;
      const key = requiredViolation(state.doc, tr.doc);
      if (key === null) return true;
      flashLater(key);
      return false;
    },

    props: {
      decorations: (state) => guardPluginKey.getState(state)?.decorations ?? null,

      handleKeyDown: (v, event) => {
        if (event.isComposing) return false;
        const { state } = v;
        const { selection } = state;

        if (isDeleteKey(event) && !selection.empty) {
          return rangeOp(v, selection.from, selection.to, null);
        }

        if (!selection.empty || !(selection instanceof TextSelection)) return false;
        const { $from } = selection;
        if ($from.depth !== 1 || !isRequiredHeading($from.parent)) return false;
        const key = $from.parent.attrs[REQUIRED_KEY_ATTR] as string;
        const atStart = $from.parentOffset === 0;
        const atEnd = $from.parentOffset === $from.parent.content.size;

        if (event.key === "Backspace" && atStart && !event.metaKey && !event.altKey && !event.ctrlKey) {
          // An empty line right above goes; otherwise the heading stays put.
          const before = $from.index(0) > 0 ? state.doc.child($from.index(0) - 1) : null;
          if (emptyParagraph(before)) {
            const start = $from.before(1);
            v.dispatch(state.tr.delete(start - before!.nodeSize, start).scrollIntoView());
          } else {
            flashRequiredNote(v, key);
          }
          return true;
        }

        if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (atEnd) return false; // a new paragraph below (the default)
          if (atStart) {
            // A new line above the heading, caret in it.
            const start = $from.before(1);
            const tr = state.tr.insert(start, state.schema.nodes.paragraph.create());
            v.dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)).scrollIntoView());
            return true;
          }
          flashRequiredNote(v, key);
          return true;
        }
        return false;
      },

      handleTextInput: (v, from, to, text) => {
        const { state } = v;
        if (from === to) {
          const heading = requiredHeadingAt(state.doc, from);
          if (!heading) return false;
          flashRequiredNote(v, heading.key);
          return true;
        }
        return rangeOp(v, from, to, text);
      },

      handlePaste: (v, _event, slice) => {
        const { selection, doc } = v.state;
        if (selection.empty) {
          const heading = requiredHeadingAt(doc, selection.from);
          if (!heading) return false;
          flashRequiredNote(v, heading.key);
          return true;
        }
        return rangeOp(v, selection.from, selection.to, slice, "paste");
      },

      handleDOMEvents: {
        cut: (v, event) => {
          const { selection } = v.state;
          if (selection.empty || !event.clipboardData) return false;
          if (!headingsIn(v.state.doc, selection.from, selection.to).length) return false;
          // The clipboard gets everything that was selected; the document keeps its headings.
          const { dom, text } = v.serializeForClipboard(selection.content());
          event.preventDefault();
          event.clipboardData.clearData();
          event.clipboardData.setData("text/html", dom.innerHTML);
          event.clipboardData.setData("text/plain", text);
          rangeOp(v, selection.from, selection.to, null, "cut");
          return true;
        },
      },
    },

    view: (editorView) => {
      view = editorView;
      // A polite live region, present from the start so screen readers pick up its changes.
      const host = editorView.dom.parentElement;
      if (host) {
        live = editorView.dom.ownerDocument.createElement("div");
        live.className = "sr-only";
        live.setAttribute("role", "status");
        live.setAttribute("aria-live", "polite");
        host.appendChild(live);
      }
      return {
        update: (next, prevState) => {
          const prev = guardPluginKey.getState(prevState);
          const now = guardPluginKey.getState(next.state);
          if (!now || !prev || now.seq === prev.seq || now.key === null) return;
          clearTimeout(hideTimer);
          const seq = now.seq;
          if (live) {
            const message = noteText();
            live.textContent = "";
            requestAnimationFrame(() => {
              if (live) live.textContent = message;
            });
          }
          hideTimer = setTimeout(() => {
            if (!next.isDestroyed) next.dispatch(next.state.tr.setMeta(guardPluginKey, { hide: seq } satisfies NoteMeta));
            if (live) live.textContent = "";
          }, NOTE_MS);
        },
        destroy: () => {
          clearTimeout(hideTimer);
          live?.remove();
          live = null;
          view = null;
        },
      };
    },
  });
}

/** Removes `requiredKey` from every node of a slice (copied or dragged content). */
export function stripRequiredKeys(slice: Slice): Slice {
  let changed = false;
  const strip = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach((node) => {
      let next = node;
      if (node.attrs[REQUIRED_KEY_ATTR]) {
        next = node.type.create({ ...node.attrs, [REQUIRED_KEY_ATTR]: null }, node.content, node.marks);
        changed = true;
      }
      if (!next.isLeaf && next.childCount) next = next.copy(strip(next.content));
      nodes.push(next);
    });
    return Fragment.from(nodes);
  };
  const content = strip(slice.content);
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice;
}
