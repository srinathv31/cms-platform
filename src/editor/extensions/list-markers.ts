// List markers in the document: the text beside every list item ("1.", "(b)", "iv)", "•"), written
// by model/list-markers.ts (resolveNumbering, formatMarker, bulletGlyph) and never by the browser's
// counters, so the editor shows exactly the marker every channel prints (docs/render-spec.md,
// "Lists and markers": CSS can't write "(a)" or the out-of-range fallbacks the same way).
//
// Live editor (`ListMarkers`): a node decoration on each list item, `data-list-marker="iv."`,
// recomputed whenever the document's blocks change (a walk over the block structure only: text isn't
// read); typing inside a line only maps the decorations along.
// Static render (`listMarkerAttrs` + `withListMarkers`): the same attribute on the same <li>, so the
// server paint, the review screen and the redline match the live editor exactly.
// styles.css draws the attribute (`li[data-list-marker]::before`).
//
// Depth is counted as the resolver counts it: an ordered list's default format follows the number of
// orderedList ancestors, a bullet's glyph the number of bulletList ancestors, through list items,
// tables and anything else in between.

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep, Transform } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  ORDERED_LIST_ATTRS,
  bulletGlyph,
  formatMarker,
  isMarkerDelimiter,
  isMarkerFormat,
  resolveNumbering,
  type NumberingStyle,
} from "../model/list-markers";

/** The attribute that carries an item's marker text, in the live editor and the static render alike. */
export const LIST_MARKER_ATTR = "data-list-marker";

/** An ordered list's style as stored: null where the attribute is absent, null or not a known value. */
export function storedNumbering(list: PMNode): { format: NumberingStyle["format"] | null; delimiter: NumberingStyle["delimiter"] | null } {
  const format = list.attrs[ORDERED_LIST_ATTRS.format] as unknown;
  const delimiter = list.attrs[ORDERED_LIST_ATTRS.delimiter] as unknown;
  return { format: isMarkerFormat(format) ? format : null, delimiter: isMarkerDelimiter(delimiter) ? delimiter : null };
}

/**
 * An ordered list's first number as the editor shows it: the stored `start`. A value nothing can
 * number from (negative, fractional, not a number: only pasted or hand-written JSON has one, and the
 * document check refuses it at save) shows as TipTap's default, 1, rather than breaking the editor.
 */
export function listStart(list: PMNode): number {
  const start = list.attrs.start as unknown;
  return typeof start === "number" && Number.isSafeInteger(start) && start >= 0 && start <= 2 ** 52 ? start : 1;
}

/** Number of orderedList nodes among the ancestors of the node at `pos` (its ordered depth). */
export function orderedDepthAt(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(pos);
  let depth = 0;
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "orderedList") depth++;
  return depth;
}

/**
 * How a list item reads in a redline: struck whole (it was removed), new whole (it was added), or
 * neither. A removed item keeps the number it had, and doesn't take one from the items after it.
 */
export type ListItemStatus = "deleted" | "inserted" | null;

export interface ListItemMarker {
  /** The list item's position. */
  pos: number;
  node: PMNode;
  /** "1.", "(b)", "iv)", "•", … */
  marker: string;
}

/**
 * Every list item's marker, in document order. Ordered items are numbered `start + index`; with a
 * `status` (the redline), new-version numbers skip removed items, and a removed item gets the number
 * it had (counting the items that weren't added).
 */
export function listItemMarkers(doc: PMNode, status?: (item: PMNode) => ListItemStatus): ListItemMarker[] {
  const out: ListItemMarker[] = [];

  const visit = (parent: PMNode, contentStart: number, ordered: number, bullet: number) => {
    parent.forEach((child, offset) => {
      const pos = contentStart + offset;
      const name = child.type.name;
      if (name === "orderedList" || name === "bulletList") {
        list(child, pos, name === "orderedList", ordered, bullet);
      } else if (!child.isTextblock && !child.isLeaf) {
        // doc, list items, tables, rows, cells, callouts: lists may sit anywhere inside them.
        visit(child, pos + 1, ordered, bullet);
      }
    });
  };

  const list = (node: PMNode, pos: number, isOrdered: boolean, ordered: number, bullet: number) => {
    let style: NumberingStyle | null = null;
    let start = 1;
    if (isOrdered) {
      const stored = storedNumbering(node);
      style = resolveNumbering(stored.format, stored.delimiter, ordered);
      start = listStart(node);
    }
    const glyph = isOrdered ? "" : bulletGlyph(bullet);
    let next = 0; // the new version's numbering
    let base = 0; // the numbering removed items had
    node.forEach((item, offset) => {
      const itemPos = pos + 1 + offset;
      let marker = glyph;
      if (style) {
        const state = status ? status(item) : null;
        const index = state === "deleted" ? base : next;
        if (state !== "inserted") base++;
        if (state !== "deleted") next++;
        marker = formatMarker(start + index, style.format, style.delimiter);
      }
      out.push({ pos: itemPos, node: item, marker });
      visit(item, itemPos + 1, isOrdered ? ordered + 1 : ordered, isOrdered ? bullet : bullet + 1);
    });
  };

  visit(doc, 0, 0, 0);
  return out;
}

// ── Live editor ──────────────────────────────────────────────────

export const listMarkersKey = new PluginKey<DecorationSet>("listMarkers");

function markerDecorations(doc: PMNode): DecorationSet {
  const found = listItemMarkers(doc);
  if (found.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    found.map(({ pos, node, marker }) => Decoration.node(pos, pos + node.nodeSize, { [LIST_MARKER_ATTR]: marker })),
  );
}

/** True when every step only replaced inline content inside one textblock (typing): no marker can change. */
function inlineOnly(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    if (!(step instanceof ReplaceStep)) return false;
    const doc = tr.docs[i]!;
    const $from = doc.resolve(step.from);
    if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(step.to))) return false;
    let blocks = false;
    step.slice.content.forEach((node) => {
      if (!node.isInline) blocks = true;
    });
    return !blocks;
  });
}

/** Draws every list item's marker (a decoration: never part of the document or undo history). */
export const ListMarkers = Extension.create({
  name: "listMarkers",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: listMarkersKey,
        state: {
          init: (_config, state) => markerDecorations(state.doc),
          apply: (tr, previous, _oldState, state) => {
            if (!tr.docChanged) return previous;
            return inlineOnly(tr) ? previous.map(tr.mapping, tr.doc) : markerDecorations(state.doc);
          },
        },
        props: {
          decorations: (state) => listMarkersKey.getState(state) ?? null,
        },
      }),
    ];
  },
});

// ── Static render ────────────────────────────────────────────────

const STATIC_ATTR = "listMarker";

/**
 * Schema addition for the static render only: a list item attribute that renders exactly what the
 * live decoration does. Never part of the editor's schema or saved JSON.
 */
export function listMarkerAttrs(): Extension {
  return Extension.create({
    name: "listMarkerAttrs",
    addGlobalAttributes() {
      return [
        {
          types: ["listItem"],
          attributes: {
            [STATIC_ATTR]: {
              default: null,
              parseHTML: () => null,
              renderHTML: (attributes) => {
                const marker = attributes[STATIC_ATTR] as string | null;
                return marker === null ? {} : { [LIST_MARKER_ATTR]: marker };
              },
            },
          },
        },
      ];
    },
  });
}

/**
 * The document with every list item's marker set, for the static renderer. `doc`'s schema must
 * include `listMarkerAttrs()`. `status` is the redline's (see listItemMarkers).
 */
export function withListMarkers(doc: PMNode, status?: (item: PMNode) => ListItemStatus): PMNode {
  const found = listItemMarkers(doc, status);
  if (found.length === 0) return doc;
  const tr = new Transform(doc);
  for (const { pos, marker } of found) tr.setNodeAttribute(pos, STATIC_ATTR, marker);
  return tr.doc;
}
