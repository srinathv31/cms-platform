// Review threads in the document: highlights, the active thread, clicks and the thread at the caret.
//
// Live editor (`ReviewThreads`): one decoration set, fed by the host through `setReviewThreads`.
//   • An open thread highlights its quote inside its block (first match) as
//     <mark class="ucomp-thread" data-thread="id">, one per text run (chips stay as they are).
//     No quote, or a quote that isn't in the block any more: the whole block gets
//     class="ucomp-thread-block" data-thread-block="id". Resolved threads aren't drawn.
//   • The active thread's highlight carries `data-active`.
//   • Decorations map through every edit, so highlights follow typing, moves and undo. A quoted
//     highlight whose text is deleted falls back to its block; an edit to that block tries the
//     quote again (so undo brings the text highlight back). A thread whose block is deleted comes
//     back when an edit (undo, paste) brings the block back.
//   • A click on a highlight calls `onThreadClick(id)`; `onCaretThread(id | null)` reports the
//     thread under the caret whenever it changes.
// Static render (`ReviewThreadMarks` + `withThreadHighlights`): the same markup as a mark and a
// block attribute, so the server paint matches the live editor exactly.
//
// Styles live in styles.css (warning tokens; no layout: backgrounds and shadows only).

import { Extension, Mark, getSchema, type Extensions } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { locateThread, normalizeQuote, textSegments, type LeafText, type ThreadRange } from "../lib/threads";
import type { JSONContent } from "../model/types";
import type { ThreadAnchor } from "../types";

export const THREAD_CLASS = "ucomp-thread";
export const THREAD_BLOCK_CLASS = "ucomp-thread-block";

/** The quote highlight's attributes (live decoration and static mark). */
export function threadTextAttrs(id: string, active: boolean): Record<string, string> {
  return active ? { class: THREAD_CLASS, "data-thread": id, "data-active": "" } : { class: THREAD_CLASS, "data-thread": id };
}

/** The whole-block highlight's attributes (live decoration and static attribute). */
export function threadBlockAttrs(id: string, active: boolean): Record<string, string> {
  return active
    ? { class: THREAD_BLOCK_CLASS, "data-thread-block": id, "data-active": "" }
    : { class: THREAD_BLOCK_CLASS, "data-thread-block": id };
}

/** Threads the editor draws: open, with a block. */
export function drawnThreads(threads: readonly ThreadAnchor[]): ThreadAnchor[] {
  return threads.filter((t) => t.status === "open" && !!t.blockId);
}

// ── Live decorations ─────────────────────────────────────────────

interface Spec {
  threadId: string;
  kind: ThreadRange["kind"];
}

interface ThreadsState {
  threads: readonly ThreadAnchor[];
  activeId: string | null;
  decorations: DecorationSet;
}

export interface ThreadsMeta {
  threads?: readonly ThreadAnchor[];
  activeId?: string | null;
}

export const reviewThreadsKey = new PluginKey<ThreadsState>("reviewThreads");

function decorate(doc: PMNode, threadId: string, range: ThreadRange, active: boolean): Decoration[] {
  if (range.kind === "text") {
    const segments = textSegments(doc, range.from, range.to);
    if (segments.length) {
      const spec: Spec = { threadId, kind: "text" };
      return segments.map(([a, b]) => Decoration.inline(a, b, { nodeName: "mark", ...threadTextAttrs(threadId, active) }, spec));
    }
    // A quote made only of chips: the block carries it.
    const $from = doc.resolve(range.from);
    if ($from.depth < 1) return [];
    return decorate(doc, threadId, { kind: "block", from: $from.before(1), to: $from.after(1) }, active);
  }
  const spec: Spec = { threadId, kind: "block" };
  return [Decoration.node(range.from, range.to, threadBlockAttrs(threadId, active), spec)];
}

function restyle(decoration: Decoration, active: boolean): Decoration {
  const spec = decoration.spec as Spec;
  return spec.kind === "block"
    ? Decoration.node(decoration.from, decoration.to, threadBlockAttrs(spec.threadId, active), spec)
    : Decoration.inline(decoration.from, decoration.to, { nodeName: "mark", ...threadTextAttrs(spec.threadId, active) }, spec);
}

function byThread(set: DecorationSet): Map<string, Decoration[]> {
  const groups = new Map<string, Decoration[]>();
  for (const decoration of set.find()) {
    const id = (decoration.spec as Spec).threadId;
    const list = groups.get(id);
    if (list) list.push(decoration);
    else groups.set(id, [decoration]);
  }
  return groups;
}

function sameAnchor(a: ThreadAnchor, b: ThreadAnchor): boolean {
  return a.blockId === b.blockId && normalizeQuote(a.quote) === normalizeQuote(b.quote);
}

/** All highlights from scratch, reusing the (mapped) ones of threads whose anchor didn't change. */
function build(
  doc: PMNode,
  threads: readonly ThreadAnchor[],
  activeId: string | null,
  leafText: LeafText,
  reuse: Map<string, Decoration[]> = new Map(),
): DecorationSet {
  const all: Decoration[] = [];
  for (const thread of threads) {
    const active = thread.id === activeId;
    const kept = reuse.get(thread.id);
    if (kept) {
      all.push(...kept.map((d) => restyle(d, active)));
      continue;
    }
    const range = locateThread(doc, thread, leafText);
    if (range) all.push(...decorate(doc, thread.id, range, active));
  }
  return all.length ? DecorationSet.create(doc, all) : DecorationSet.empty;
}

function withMeta(prev: ThreadsState, meta: ThreadsMeta, doc: PMNode, leafText: LeafText): ThreadsState {
  const threads = meta.threads ? drawnThreads(meta.threads) : prev.threads;
  const activeId = meta.activeId !== undefined ? meta.activeId : prev.activeId;
  if (!meta.threads && activeId === prev.activeId) return prev;
  const before = new Map(prev.threads.map((t) => [t.id, t]));
  const groups = byThread(prev.decorations);
  const reuse = new Map<string, Decoration[]>();
  for (const thread of threads) {
    const old = before.get(thread.id);
    const decorations = groups.get(thread.id);
    if (old && decorations && sameAnchor(old, thread)) reuse.set(thread.id, decorations);
  }
  return { threads, activeId, decorations: build(doc, threads, activeId, leafText, reuse) };
}

/** The ranges a transaction inserted or changed, in its final document. */
function changedRanges(tr: Transaction): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, start, end) => ranges.push([rest.map(start, -1), rest.map(end, 1)]));
  });
  return ranges;
}

function rangesHoldBlock(doc: PMNode, ranges: Array<[number, number]>, blockId: string): boolean {
  let found = false;
  for (const [from, to] of ranges) {
    doc.nodesBetween(from, to, (node) => {
      if (found || node.isInline) return false;
      if (node.attrs.id === blockId) found = true;
      return !found;
    });
    if (found) return true;
  }
  return false;
}

function remap(prev: ThreadsState, tr: Transaction, doc: PMNode, leafText: LeafText): ThreadsState {
  if (!prev.threads.length) return prev;
  let decorations = prev.decorations.map(tr.mapping, doc);
  const groups = byThread(decorations);
  let ranges: Array<[number, number]> | null = null;
  const changed = () => (ranges ??= changedRanges(tr));
  const remove: Decoration[] = [];
  const add: Decoration[] = [];
  for (const thread of prev.threads) {
    const current = groups.get(thread.id);
    const quoted = !!normalizeQuote(thread.quote);
    if (current) {
      // A text highlight, or a thread about the whole block: mapping is all it needs.
      const spec = current[0].spec as Spec;
      if (spec.kind === "text" || !quoted) continue;
      // A quote that fell back to its block: look again only when the block was edited.
      const { from, to } = current[0];
      if (!changed().some(([a, b]) => a <= to && b >= from)) continue;
    } else if (!rangesHoldBlock(doc, changed(), thread.blockId)) {
      continue;
    }
    const range = locateThread(doc, thread, leafText);
    if (!range) continue;
    if (current && range.kind === "block") continue;
    if (current) remove.push(...current);
    add.push(...decorate(doc, thread.id, range, thread.id === prev.activeId));
  }
  if (remove.length) decorations = decorations.remove(remove);
  if (add.length) decorations = decorations.add(doc, add);
  return { ...prev, decorations };
}

/** The open thread under `pos`: the active one when it's there, otherwise the innermost. */
export function threadAt(state: EditorState, pos: number): string | null {
  const plugin = reviewThreadsKey.getState(state);
  if (!plugin || plugin.decorations === DecorationSet.empty) return null;
  let best: string | null = null;
  let bestSize = Infinity;
  for (const decoration of plugin.decorations.find(pos, pos)) {
    const spec = decoration.spec as Spec;
    const inside = spec.kind === "block" ? decoration.from < pos && pos < decoration.to : decoration.from <= pos && pos <= decoration.to;
    if (!inside) continue;
    if (spec.threadId === plugin.activeId) return spec.threadId;
    const size = decoration.to - decoration.from;
    if (size < bestSize) {
      best = spec.threadId;
      bestSize = size;
    }
  }
  return best;
}

/** The drawn highlights, for tests and hosts' debugging: one entry per decoration. */
export function threadHighlights(state: EditorState): Array<{ threadId: string; kind: ThreadRange["kind"]; from: number; to: number; active: boolean }> {
  const plugin = reviewThreadsKey.getState(state);
  if (!plugin) return [];
  return plugin.decorations
    .find()
    .map((d) => ({ threadId: (d.spec as Spec).threadId, kind: (d.spec as Spec).kind, from: d.from, to: d.to, active: (d.spec as Spec).threadId === plugin.activeId }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The active thread as the editor shows it. */
export function activeThreadOf(state: EditorState): string | null {
  return reviewThreadsKey.getState(state)?.activeId ?? null;
}

/** Hands the editor new threads and/or a new active thread (not an edit: no undo step). */
export function setReviewThreads(view: EditorView, meta: ThreadsMeta) {
  if (view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(reviewThreadsKey, meta).setMeta("addToHistory", false));
}

export interface ReviewThreadsOptions {
  /** Read when the editor is created (also when it's re-created after <Activity> hid it). */
  initial: () => { threads: readonly ThreadAnchor[]; activeId: string | null };
  /** How chips read in a quote. */
  leafText: LeafText;
  /** A click on a highlight (text or block). */
  onThreadClick: ((threadId: string) => void) | null;
  /** The thread under the caret changed (null when the caret left every highlight). */
  onCaretThread: ((threadId: string | null) => void) | null;
}

export const ReviewThreads = Extension.create<ReviewThreadsOptions>({
  name: "reviewThreads",

  addOptions() {
    return {
      initial: () => ({ threads: [], activeId: null }),
      leafText: () => "",
      onThreadClick: null,
      onCaretThread: null,
    };
  },

  addProseMirrorPlugins() {
    const { initial, leafText, onThreadClick, onCaretThread } = this.options;
    return [
      new Plugin<ThreadsState>({
        key: reviewThreadsKey,
        state: {
          init: (_config, state) => {
            const { threads, activeId } = initial();
            const drawn = drawnThreads(threads);
            return { threads: drawn, activeId, decorations: build(state.doc, drawn, activeId, leafText) };
          },
          apply: (tr, prev, _oldState, state) => {
            let next = tr.docChanged ? remap(prev, tr, state.doc, leafText) : prev;
            const meta = tr.getMeta(reviewThreadsKey) as ThreadsMeta | undefined;
            if (meta) next = withMeta(next, meta, state.doc, leafText);
            return next;
          },
        },
        props: {
          decorations: (state) => reviewThreadsKey.getState(state)?.decorations ?? null,
          handleDOMEvents: {
            click: (view, event) => {
              if (!onThreadClick || event.button !== 0) return false;
              const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement;
              // Chips have their own popover; a drag or double click selected text instead.
              if (!target || target.closest("[data-variable]")) return false;
              const selection = view.dom.ownerDocument.getSelection();
              if (selection && !selection.isCollapsed) return false;
              const mark = target.closest<HTMLElement>("[data-thread]");
              const element = mark ?? target.closest<HTMLElement>("[data-thread-block]");
              if (!element || !view.dom.contains(element)) return false;
              const id = element.getAttribute(mark ? "data-thread" : "data-thread-block");
              if (id) onThreadClick(id);
              return false;
            },
          },
        },
        view: () => {
          let last: string | null = null;
          return {
            update: (view, prevState) => {
              if (!onCaretThread) return;
              const { state } = view;
              if (
                state.selection.eq(prevState.selection) &&
                reviewThreadsKey.getState(state) === reviewThreadsKey.getState(prevState)
              ) {
                return;
              }
              const id = threadAt(state, state.selection.head);
              if (id === last) return;
              last = id;
              onCaretThread(id);
            },
          };
        },
      }),
    ];
  },
});

// ── Static render ────────────────────────────────────────────────

const STATIC_MARK = "reviewThread";
const STATIC_ATTR = "reviewThread";

/**
 * Schema additions for the static render only: a quote highlight mark and a block attribute that
 * render exactly what the live decorations do. Never part of the editor's schema or saved JSON.
 */
export function reviewThreadMarks(blockTypes: readonly string[]): Extensions {
  return [
    Mark.create({
      name: STATIC_MARK,
      // First in the schema, so it renders innermost (inside bold, links…), like a decoration.
      priority: 100_000,
      inclusive: false,
      excludes: "",
      addAttributes() {
        return { thread: { default: null, rendered: false }, active: { default: false, rendered: false } };
      },
      renderHTML({ mark }) {
        return ["mark", threadTextAttrs(mark.attrs.thread as string, !!mark.attrs.active), 0];
      },
    }),
    Extension.create({
      name: "reviewThreadBlocks",
      addGlobalAttributes() {
        return [
          {
            types: [...blockTypes],
            attributes: {
              [STATIC_ATTR]: {
                default: null,
                parseHTML: () => null,
                renderHTML: (attributes) => {
                  const value = attributes[STATIC_ATTR] as { id: string; active: boolean } | null;
                  return value ? threadBlockAttrs(value.id, value.active) : {};
                },
              },
            },
          },
        ];
      },
    }),
  ];
}

/**
 * The document with its open threads' highlights as marks and block attributes, for the static
 * renderer. `extensions` must include `reviewThreadMarks`.
 */
export function withThreadHighlights(
  content: JSONContent,
  extensions: Extensions,
  threads: readonly ThreadAnchor[],
  activeId: string | null,
  leafText: LeafText,
): PMNode {
  const schema = getSchema(extensions);
  const doc = schema.nodeFromJSON(content);
  const tr = new Transform(doc);
  for (const thread of drawnThreads(threads)) {
    const range = locateThread(doc, thread, leafText);
    if (!range) continue;
    const active = thread.id === activeId;
    const segments = range.kind === "text" ? textSegments(doc, range.from, range.to) : [];
    if (segments.length) {
      const mark = schema.marks[STATIC_MARK].create({ thread: thread.id, active });
      for (const [a, b] of segments) tr.addMark(a, b, mark);
      continue;
    }
    const $from = doc.resolve(range.from);
    const pos = range.kind === "block" ? range.from : $from.depth >= 1 ? $from.before(1) : -1;
    const node = pos >= 0 ? tr.doc.nodeAt(pos) : null;
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, [STATIC_ATTR]: { id: thread.id, active } });
  }
  return tr.doc;
}
