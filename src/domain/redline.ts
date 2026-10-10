// The redline: what changed between two versions of a document, as one document a renderer can walk
// like the original (contract: RedlineDoc in ./review-types). A pure walk over the editor's TipTap
// JSON (docs/render-spec.md §2): no TipTap runtime, so it ports as is.
//
// How blocks line up (top level, and the same way inside lists, list items, callouts and cells):
//   1. By `attrs.id`. Drafts keep block ids across versions, so this is the normal case.
//   2. Where an id can't speak (missing, duplicated, or on one side only, and at least one of the two
//      blocks has no id): identical content that occurs once on each side, then, between the pairs
//      that keep their order, the most similar block of the same type (word overlap of 0.5 or more).
//      Inside a list item, a callout or a cell, a stretch with as many blocks on each side pairs in
//      order instead. Two blocks that both have ids, different ones, never pair: one was removed,
//      the other added.
//   3. The longest run of pairs that keeps the base order (the LCS of the id sequences) stays put.
//      At the top level every other pair is "moved"; inside a block it's a delete plus an insert.
//   4. Unpaired base blocks are "removed" and sit where they used to be; unpaired new ones "added".
// How a paired block differs:
//   - textblocks (paragraph, heading): a word diff of the inline content. Tokens are words, runs of
//     whitespace and runs of punctuation ("1,000" and "isn't" are one word); a variable chip is one
//     token; marks are part of a token, so bolding a word deletes the plain run and inserts the bold
//     one. Deleted runs go back in place with a `delete` RedlineMark, new runs get `insert`, adjacent
//     runs with the same marks merge, and a hunk's deletions come before its insertions.
//   - lists, list items, callouts, cells: their children line up as above and are diffed recursively.
//     Table rows line up by content, then by position (or similarity, when rows were added); cells
//     line up by position.
//   - a child that doesn't line up is marked whole: every inline node inside gets the mark.
//   - a block whose kind changed (heading level, required key, list type, paragraph <-> heading) is
//     marked whole: the old content goes back deleted, then the new content inserted (only the new,
//     inserted, when the content itself didn't change, such as a level change).
//
// Decisions:
//   - No base (a first version, nothing to compare with): every block is "unchanged" and the counts
//     are zero. Calling the whole document "added" would paint a first version solid green and count
//     every block as a change; the UI knows the base is null and says there is nothing to compare with yet.
//   - A moved block whose content changed too is "changed", with `movedFrom`. Counts tally statuses,
//     so it counts once, as changed (the counts always add up to changesOnly(doc).length).
//   - Trailing empty paragraphs (the editor's trailing line) are left out on both sides, as the
//     renderer does, so that line coming and going is never a change.
//   - Blocks without an id get `next:<index>` (or `base:<index>` when removed) as their RedlineBlock id.
//   - Unchanged nodes are the input objects, not copies. Nothing here mutates its input.
//
// A version's channel fields (an email's subject, a push's title, an SMS's message) are redlined with the
// same engine, one field at a time (`diffChannelFields`): for an alert they are the whole content.

import { channelFieldValue, fieldsOfChannels, type ChannelField, type ChannelFields } from "./channel-fields";
import type { FieldRedline, FooterRedline, RedlineBlock, RedlineDoc, RedlineMark, RedlineStatus } from "./review-types";
import { CHANNELS, type Channel, type JSONContent } from "./types";

type Mark = NonNullable<JSONContent["marks"]>[number];
type RedlineOp = RedlineMark["attrs"]["op"];

/** A run of unchanged blocks, folded away in the "Changes only" view ("N unchanged blocks"). */
export interface RedlineGap {
  type: "gap";
  count: number;
}

// ── Public ───────────────────────────────────────────────────────────────────

/** The redline of `next` against `base`, one entry per top-level block in reading order. */
export function diffDocuments(base: JSONContent | null, next: JSONContent): RedlineDoc {
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  const after = topLevel(next);
  const afterIds = uniqueIds(after);
  const nextId = (j: number) => afterIds[j] ?? `next:${j}`;

  if (!base) {
    return { blocks: after.map((node, j): RedlineBlock => ({ id: nextId(j), status: "unchanged", node })), counts };
  }

  const before = topLevel(base);
  const beforeIds = uniqueIds(before);
  const taken = new Set(afterIds.filter((id): id is string => id !== null));
  const cx = createCx();
  const blocks: RedlineBlock[] = [];

  for (const e of align(cx, before, after, TOP_LEVEL)) {
    if (e.n < 0) {
      const id = beforeIds[e.b];
      blocks.push({ id: id && !taken.has(id) ? id : `base:${e.b}`, status: "removed", node: before[e.b] });
      counts.removed++;
    } else if (e.b < 0) {
      blocks.push({ id: nextId(e.n), status: "added", node: after[e.n] });
      counts.added++;
    } else {
      const { node, changed } = diffNode(cx, before[e.b], after[e.n]);
      const status: RedlineStatus = changed ? "changed" : e.moved ? "moved" : "unchanged";
      const block: RedlineBlock = { id: nextId(e.n), status, node };
      if (e.moved) block.movedFrom = e.b;
      if (status !== "unchanged") counts[status]++;
      blocks.push(block);
    }
  }
  return { blocks, counts };
}

/** The "Changes only" filter: every block that isn't unchanged, in reading order. */
export function changesOnly(doc: RedlineDoc): RedlineBlock[] {
  return doc.blocks.filter((block) => block.status !== "unchanged");
}

/** The "Changes only" view with each run of unchanged blocks folded into one gap. */
export function groupUnchanged(doc: RedlineDoc): (RedlineBlock | RedlineGap)[] {
  const out: (RedlineBlock | RedlineGap)[] = [];
  let run = 0;
  for (const block of doc.blocks) {
    if (block.status === "unchanged") {
      run++;
      continue;
    }
    if (run > 0) out.push({ type: "gap", count: run });
    run = 0;
    out.push(block);
  }
  if (run > 0) out.push({ type: "gap", count: run });
  return out;
}

/** A rename between two versions: the name is versioned, so it goes through review like the body. */
export interface NameChange {
  from: string;
  to: string;
}

/**
 * The rename from `base` to `next`, or null when the name is the same or there is no base (nothing
 * Active yet). Names compare exactly, as typed: a change of case or spacing is a rename customers see.
 */
export function nameChange(base: string | null | undefined, next: string): NameChange | null {
  return base === null || base === undefined || base === next ? null : { from: base, to: next };
}

// ── Channel fields ───────────────────────────────────────────────────────────

/**
 * A version's channel fields as the redline reads them: the channels that are on, what they store, and the
 * SMS footer it prints (`smsFooterOf`: frozen at submit, a draft's the content type's; absent: none).
 */
export interface FieldsSide {
  channels: readonly Channel[];
  channelFields: ChannelFields;
  smsFooter?: string | null;
}

/**
 * Every field's redline, in registry order, how many fields were added, removed or changed (a changed footer
 * among them), and the SMS's footer: null while SMS is off on both sides.
 */
export interface FieldsRedline {
  fields: FieldRedline[];
  counts: RedlineDoc["counts"];
  footer: FooterRedline | null;
}

/**
 * The redline of each channel field (the email's subject and preheader, a push's title, subtitle and
 * body, an SMS's message) from `base` to `next`, over the registry, so a new field or channel needs
 * nothing here. A field's text is diffed with `diffDocuments`, its paragraph given the same id on both
 * sides so the two always pair and the change is a word diff, however much was rewritten.
 *
 * A field counts only while its channel is on: it keeps its value while its channel is off, but nothing
 * renders it. So the fields shown are those of every channel on in either version, and turning a channel
 * on adds its fields, off removes them. A field with no text on either side is "unchanged" (an optional
 * subtitle left empty). No base (a first version): `next`'s fields, all "unchanged", counts zero, as
 * `diffDocuments` does.
 *
 * The SMS's footer isn't a field (the author doesn't write it), but it is part of what each version sends:
 * its `footer` says what it was and is. A footer that changed while SMS stayed on counts as one change, so
 * a version whose only difference is its footer never reads "No changes".
 */
export function diffChannelFields(base: FieldsSide | null, next: FieldsSide): FieldsRedline {
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  const channels = base ? CHANNELS.filter((c) => base.channels.includes(c) || next.channels.includes(c)) : next.channels;
  const fields = fieldsOfChannels(channels).map((field): FieldRedline => {
    const after = fieldDoc(next, field);
    if (!base) return { field, status: "unchanged", doc: diffDocuments(null, after) };
    const doc = diffDocuments(fieldDoc(base, field), after);
    const status = fieldStatus(doc);
    if (status !== "unchanged") counts[status]++;
    return { field, status, doc };
  });
  const footer = channels.includes("sms") ? footerRedline(base, next) : null;
  if (footer && footer.status !== "unchanged" && base?.channels.includes("sms") && next.channels.includes("sms")) counts[footer.status]++;
  return { fields, counts, footer };
}

/** The SMS footer each side prints while its SMS is on, and how it changed. */
function footerRedline(base: FieldsSide | null, next: FieldsSide): FooterRedline {
  const footerOf = (side: FieldsSide) => (side.channels.includes("sms") ? side.smsFooter || null : null);
  const to = footerOf(next);
  if (!base) return { from: null, to, status: "unchanged" };
  const from = footerOf(base);
  const status = from === to ? "unchanged" : from === null ? "added" : to === null ? "removed" : "changed";
  return { from, to, status };
}

/** The two counts together: the body's and the fields', for one "N changes" and its summary. */
export function addCounts(a: RedlineDoc["counts"], b: RedlineDoc["counts"]): RedlineDoc["counts"] {
  return { added: a.added + b.added, removed: a.removed + b.removed, changed: a.changed + b.changed, moved: a.moved + b.moved };
}

/** The field as a document to diff: empty while its channel is off, each block keyed by the field (they pair across versions). */
function fieldDoc(side: FieldsSide, field: ChannelField): JSONContent {
  const value = side.channels.includes(field.channel) ? channelFieldValue(side.channelFields, field) : null;
  const blocks = (value?.content ?? []).filter(isNode);
  return { type: "doc", content: blocks.map((block, i) => ({ ...block, attrs: { ...block.attrs, id: `${field.id}:${i}` } })) };
}

/** The field's status from its blocks': all added is added, all removed removed, none changed unchanged. */
function fieldStatus(doc: RedlineDoc): FieldRedline["status"] {
  const { blocks } = doc;
  if (blocks.every((b) => b.status === "unchanged")) return "unchanged";
  if (blocks.every((b) => b.status === "added")) return "added";
  if (blocks.every((b) => b.status === "removed")) return "removed";
  return "changed";
}

// ── Per-call caches ──────────────────────────────────────────────────────────

interface Bag {
  counts: Map<string, number>;
  size: number;
}

interface Cx {
  /** Content keys (ids ignored), by node. */
  keys: WeakMap<JSONContent, string>;
  /** Word multisets for similarity, by node. */
  bags: WeakMap<JSONContent, Bag>;
}

function createCx(): Cx {
  return { keys: new WeakMap(), bags: new WeakMap() };
}

// ── Node helpers ─────────────────────────────────────────────────────────────

const isNode = (x: unknown): x is JSONContent => typeof x === "object" && x !== null;

const isTextblock = (node: JSONContent) => node.type === "paragraph" || node.type === "heading";

const isEmptyParagraph = (node: JSONContent) => node.type === "paragraph" && !node.content?.length;

/** The document's top-level blocks, without the trailing empty paragraphs. */
function topLevel(doc: JSONContent | null | undefined): JSONContent[] {
  const content = doc && Array.isArray(doc.content) ? doc.content.filter(isNode) : [];
  let end = content.length;
  while (end > 0 && isEmptyParagraph(content[end - 1])) end--;
  return content.slice(0, end);
}

function idAttr(node: JSONContent): string | null {
  const id: unknown = node.attrs?.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Each node's id, or null when it has none or shares it with a sibling. */
function uniqueIds(nodes: readonly JSONContent[]): (string | null)[] {
  const seen = new Map<string, number>();
  for (const node of nodes) {
    const id = idAttr(node);
    if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return nodes.map((node) => {
    const id = idAttr(node);
    return id && seen.get(id) === 1 ? id : null;
  });
}

/** Blocks of one family can stand in for each other (a heading for a paragraph, a list for a list). */
function family(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return "text";
    case "bulletList":
    case "orderedList":
      return "list";
    case "tableCell":
    case "tableHeader":
      return "cell";
    default:
      return String(node.type);
  }
}

/** Attribute values equal to these are the same as no value. */
const DEFAULT_ATTRS: Readonly<Record<string, unknown>> = { colspan: 1, rowspan: 1, start: 1 };

/** Attributes that mean something: not `id`, not null, not a default. Sorted, so key order is noise. */
function attrsKey(attrs: JSONContent["attrs"]): string {
  if (!attrs) return "";
  const parts: string[] = [];
  for (const name of Object.keys(attrs).sort()) {
    const value: unknown = attrs[name];
    if (name === "id" || value === null || value === undefined || DEFAULT_ATTRS[name] === value) continue;
    parts.push(`${name}=${JSON.stringify(value)}`);
  }
  return parts.length > 0 ? `{${parts.join(";")}}` : "";
}

/** A link is its href (target and rel are editor defaults); other marks are their type and attributes. */
function markKey(mark: Mark): string {
  return mark.type === "link" ? `link(${String(mark.attrs?.href ?? "")})` : mark.type + attrsKey(mark.attrs);
}

function marksKey(marks: JSONContent["marks"]): string {
  return marks?.length ? `<${marks.map(markKey).sort().join(",")}>` : "";
}

/** The node's type and meaningful attributes: what a "kind" change changes. */
function kindKey(node: JSONContent): string {
  return String(node.type) + attrsKey(node.attrs);
}

/** Everything about a node except ids. Equal keys render the same. */
function nodeKey(cx: Cx, node: JSONContent): string {
  const hit = cx.keys.get(node);
  if (hit !== undefined) return hit;
  let key = kindKey(node) + marksKey(node.marks);
  if (typeof node.text === "string") key += JSON.stringify(node.text);
  if (node.content?.length) key += `[${node.content.map((child) => nodeKey(cx, child)).join(",")}]`;
  cx.keys.set(node, key);
  return key;
}

function contentKey(cx: Cx, node: JSONContent): string {
  return (node.content ?? []).map((child) => nodeKey(cx, child)).join(",");
}

function withContent(node: JSONContent, content: JSONContent[]): JSONContent {
  const copy: JSONContent = { ...node, content };
  if (content.length === 0) delete copy.content;
  return copy;
}

function redline(op: RedlineOp): RedlineMark {
  return { type: "redline", attrs: { op } };
}

function withMark(inline: JSONContent, op: RedlineOp): JSONContent {
  return { ...inline, marks: [...(inline.marks ?? []), redline(op)] };
}

/** The whole block marked: every inline node inside it gets the mark. */
function markAll(node: JSONContent, op: RedlineOp): JSONContent {
  if (!node.content?.length) return node;
  if (isTextblock(node)) return { ...node, content: node.content.map((child) => withMark(child, op)) };
  return { ...node, content: node.content.map((child) => markAll(child, op)) };
}

// ── Similarity ───────────────────────────────────────────────────────────────

/** Words, runs of whitespace, runs of punctuation. A word may hold ' ’ . , - between letters or digits. */
const TOKEN = /[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*|\s+|[^\p{L}\p{N}\s]+/gu;
const WORDISH = /[\p{L}\p{N}]/u;

/**
 * The node's words and chips, as a multiset (case ignored). Punctuation and whitespace don't count:
 * "Gamma." and "Delta." share nothing.
 */
function bag(cx: Cx, node: JSONContent): Bag {
  const hit = cx.bags.get(node);
  if (hit) return hit;
  const counts = new Map<string, number>();
  let size = 0;
  const add = (token: string) => {
    counts.set(token, (counts.get(token) ?? 0) + 1);
    size++;
  };
  const walk = (x: JSONContent) => {
    if (x.type === "text") {
      for (const piece of (typeof x.text === "string" ? x.text : "").match(TOKEN) ?? []) {
        if (WORDISH.test(piece)) add(piece.toLowerCase());
      }
    } else if (x.type === "variable") {
      add(`{{${String(x.attrs?.key)}}}`);
    } else {
      x.content?.forEach(walk);
    }
  };
  walk(node);
  const out = { counts, size };
  cx.bags.set(node, out);
  return out;
}

/** Dice coefficient of two multisets: 1 = the same words, 0 = none in common. */
function dice(a: Bag, b: Bag): number {
  if (a.size + b.size === 0) return 1;
  const [small, large] = a.counts.size <= b.counts.size ? [a, b] : [b, a];
  let shared = 0;
  for (const [token, count] of small.counts) shared += Math.min(count, large.counts.get(token) ?? 0);
  return (2 * shared) / (a.size + b.size);
}

function textSimilarity(cx: Cx, a: JSONContent, b: JSONContent): number {
  return dice(bag(cx, a), bag(cx, b));
}

/** Rows compare cell by cell, so one edited cell leaves a row recognisable. */
function rowSimilarity(cx: Cx, a: JSONContent, b: JSONContent): number {
  const ac = a.content ?? [];
  const bc = b.content ?? [];
  const width = Math.max(ac.length, bc.length);
  if (width === 0) return 1;
  let sum = 0;
  for (let k = 0; k < Math.min(ac.length, bc.length); k++) sum += dice(bag(cx, ac[k]), bag(cx, bc[k]));
  return sum / width;
}

// ── Alignment ────────────────────────────────────────────────────────────────

interface AlignOptions {
  /** Pair by `attrs.id` first. */
  ids: boolean;
  /** Report pairs out of order as moved (top level) instead of a delete plus an insert. */
  moves: boolean;
  /** 0..1, for blocks of the same type that content may pair. */
  similarity: (cx: Cx, a: JSONContent, b: JSONContent) => number;
  /** In a stretch with as many unpaired blocks on each side, pair them in order. */
  evenByPosition: boolean;
}

/** Blocks this similar (or more) are the same block, edited. */
const SIMILAR = 0.5;
/** Past this many candidate pairs in one stretch, skip the similarity pass (all deleted and inserted). */
const MAX_GAP_PAIRS = 10_000;

/** The document's blocks: a rewritten paragraph reads as one removed and one added. */
const TOP_LEVEL: AlignOptions = { ids: true, moves: true, similarity: textSimilarity, evenByPosition: false };
/** A list's items: a replaced item reads as one deleted and one inserted. */
const LIST_ITEMS: AlignOptions = { ids: true, moves: false, similarity: textSimilarity, evenByPosition: false };
/** Inside a list item, a callout or a cell (already paired): its lines pair in order when the counts match. */
const INNER_BLOCKS: AlignOptions = { ...LIST_ITEMS, evenByPosition: true };
/** A table's rows: by content, then by position. */
const TABLE_ROWS: AlignOptions = { ids: false, moves: false, similarity: rowSimilarity, evenByPosition: true };

/** One step of the merged reading order. `b` or `n` is -1 for an insert or a delete. */
interface Entry {
  b: number;
  n: number;
  moved: boolean;
}

function align(cx: Cx, before: readonly JSONContent[], after: readonly JSONContent[], opts: AlignOptions): Entry[] {
  const m = before.length;
  const n = after.length;
  const b2n = new Int32Array(m).fill(-1);
  const n2b = new Int32Array(n).fill(-1);
  const link = (i: number, j: number) => {
    b2n[i] = j;
    n2b[j] = i;
  };
  const beforeIds = opts.ids ? uniqueIds(before) : null;
  const afterIds = opts.ids ? uniqueIds(after) : null;

  // 1. The same id.
  if (beforeIds && afterIds) {
    const at = new Map<string, number>();
    beforeIds.forEach((id, i) => {
      if (id) at.set(id, i);
    });
    afterIds.forEach((id, j) => {
      const i = id ? at.get(id) : undefined;
      if (i !== undefined && family(before[i]) === family(after[j])) link(i, j);
    });
  }

  // Content pairs two blocks only when ids can't: both unpaired, and at least one has no id.
  const mayPair = (i: number, j: number) => b2n[i] < 0 && n2b[j] < 0 && !(beforeIds?.[i] && afterIds?.[j]);

  // 2. Identical content that occurs once among the unpaired blocks on each side.
  const once = (nodes: readonly JSONContent[], partner: Int32Array) => {
    const at = new Map<string, number>();
    nodes.forEach((node, k) => {
      if (partner[k] >= 0) return;
      const key = nodeKey(cx, node);
      at.set(key, at.has(key) ? -1 : k);
    });
    return at;
  };
  const beforeOnce = once(before, b2n);
  for (const [key, j] of once(after, n2b)) {
    const i = beforeOnce.get(key);
    if (j >= 0 && i !== undefined && i >= 0 && mayPair(i, j)) link(i, j);
  }

  // 3. The longest run of pairs in base order stays put; the rest moved.
  const paired: number[] = [];
  for (let j = 0; j < n; j++) if (n2b[j] >= 0) paired.push(j);
  const inOrder = increasingRun(paired.map((j) => n2b[j]));
  const moved = new Uint8Array(n);
  const movedAway = new Uint8Array(m);
  const anchors: number[] = [];
  paired.forEach((j, k) => {
    const i = n2b[j];
    if (inOrder[k]) {
      anchors.push(j);
    } else if (opts.moves) {
      moved[j] = 1;
      movedAway[i] = 1;
    } else {
      b2n[i] = -1;
      n2b[j] = -1;
    }
  });

  // 4. Between in-order pairs: the most similar blocks of the same type.
  let i0 = 0;
  let j0 = 0;
  for (let k = 0; k <= anchors.length; k++) {
    const j1 = k < anchors.length ? anchors[k] : n;
    const i1 = k < anchors.length ? n2b[j1] : m;
    const gb: number[] = [];
    const gn: number[] = [];
    for (let i = i0; i < i1; i++) if (b2n[i] < 0) gb.push(i);
    for (let j = j0; j < j1; j++) if (n2b[j] < 0) gn.push(j);
    if (gb.length > 0 && gn.length > 0) pairStretch(cx, before, after, gb, gn, opts, mayPair, link);
    i0 = i1 + 1;
    j0 = j1 + 1;
  }

  // 5. Reading order: removed blocks where they were, before what was added in their place.
  const entries: Entry[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && (b2n[i] < 0 || movedAway[i])) {
      if (b2n[i] < 0) entries.push({ b: i, n: -1, moved: false });
      i++;
    } else if (j < n && (n2b[j] < 0 || moved[j])) {
      entries.push({ b: n2b[j], n: j, moved: moved[j] === 1 });
      j++;
    } else if (i < m && j < n) {
      entries.push({ b: i, n: j, moved: false }); // an in-order pair: b2n[i] === j
      i++;
      j++;
    } else {
      break;
    }
  }
  return entries;
}

/** Pairs the unpaired blocks of one stretch (between two in-order pairs) by similarity, in order. */
function pairStretch(
  cx: Cx,
  before: readonly JSONContent[],
  after: readonly JSONContent[],
  gb: readonly number[],
  gn: readonly number[],
  opts: AlignOptions,
  mayPair: (i: number, j: number) => boolean,
  link: (i: number, j: number) => void,
) {
  const M = gb.length;
  const N = gn.length;
  if (opts.evenByPosition && M === N) {
    for (let k = 0; k < M; k++) {
      if (mayPair(gb[k], gn[k]) && family(before[gb[k]]) === family(after[gn[k]])) link(gb[k], gn[k]);
    }
    return;
  }
  if (M * N > MAX_GAP_PAIRS) return;

  // score: 2 for identical content, the similarity when it clears SIMILAR, else 0 (no pair).
  const score = new Float64Array(M * N);
  for (let k = 0; k < M; k++) {
    for (let l = 0; l < N; l++) {
      const a = before[gb[k]];
      const b = after[gn[l]];
      if (a.type !== b.type || !mayPair(gb[k], gn[l])) continue;
      if (nodeKey(cx, a) === nodeKey(cx, b)) {
        score[k * N + l] = 2;
      } else {
        const s = opts.similarity(cx, a, b);
        if (s >= SIMILAR) score[k * N + l] = s;
      }
    }
  }
  // best[k][l]: the highest total score pairing gb[k..] with gn[l..] in order.
  const W = N + 1;
  const best = new Float64Array((M + 1) * W);
  for (let k = M - 1; k >= 0; k--) {
    for (let l = N - 1; l >= 0; l--) {
      const s = score[k * N + l];
      best[k * W + l] = Math.max(best[(k + 1) * W + l], best[k * W + l + 1], s > 0 ? s + best[(k + 1) * W + l + 1] : 0);
    }
  }
  let k = 0;
  let l = 0;
  while (k < M && l < N) {
    const s = score[k * N + l];
    if (s > 0 && best[k * W + l] === s + best[(k + 1) * W + l + 1]) {
      link(gb[k], gn[l]);
      k++;
      l++;
    } else if (best[k * W + l] === best[(k + 1) * W + l]) {
      k++;
    } else {
      l++;
    }
  }
}

/** Flags the members of one longest strictly increasing subsequence (patience sorting, n log n). */
function increasingRun(seq: readonly number[]): boolean[] {
  const tails: number[] = [];
  const prev = new Int32Array(seq.length).fill(-1);
  for (let k = 0; k < seq.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[k]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const keep: boolean[] = new Array<boolean>(seq.length).fill(false);
  for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep[k] = true;
  return keep;
}

// ── Block diff ───────────────────────────────────────────────────────────────

interface Diffed {
  node: JSONContent;
  changed: boolean;
}

/** `next` with what changed since `base` marked in; `base` is the block paired with it. */
function diffNode(cx: Cx, base: JSONContent, next: JSONContent): Diffed {
  if (nodeKey(cx, base) === nodeKey(cx, next)) return { node: next, changed: false };
  if (kindKey(base) !== kindKey(next)) return { node: replaceWhole(cx, base, next), changed: true };
  if (isTextblock(next)) return diffTextblock(cx, base, next);
  switch (next.type) {
    case "table":
      return diffChildren(cx, base, next, TABLE_ROWS);
    case "tableRow":
      return diffCells(cx, base, next);
    case "bulletList":
    case "orderedList":
      return diffChildren(cx, base, next, LIST_ITEMS);
    default: // listItem, callout, tableCell, tableHeader
      return diffChildren(cx, base, next, INNER_BLOCKS);
  }
}

/** A kind change: the old content back as deleted, then the new as inserted (just the new if the same). */
function replaceWhole(cx: Cx, base: JSONContent, next: JSONContent): JSONContent {
  if (family(base) !== family(next)) return markAll(next, "insert"); // never paired; kept total
  const same = contentKey(cx, base) === contentKey(cx, next);
  const mark = isTextblock(next) ? withMark : markAll;
  return withContent(next, [
    ...(same ? [] : (base.content ?? []).map((child) => mark(child, "delete"))),
    ...(next.content ?? []).map((child) => mark(child, "insert")),
  ]);
}

function diffChildren(cx: Cx, base: JSONContent, next: JSONContent, opts: AlignOptions): Diffed {
  const before = base.content ?? [];
  const after = next.content ?? [];
  const out: JSONContent[] = [];
  let changed = false;
  for (const e of align(cx, before, after, opts)) {
    if (e.n < 0) {
      out.push(markAll(before[e.b], "delete"));
      changed = true;
    } else if (e.b < 0) {
      out.push(markAll(after[e.n], "insert"));
      changed = true;
    } else {
      const child = diffNode(cx, before[e.b], after[e.n]);
      out.push(child.node);
      changed ||= child.changed;
    }
  }
  return changed ? { node: withContent(next, out), changed } : { node: next, changed: false };
}

/** Cells line up by position; extra cells on either side are marked whole. */
function diffCells(cx: Cx, base: JSONContent, next: JSONContent): Diffed {
  const before = base.content ?? [];
  const after = next.content ?? [];
  const out: JSONContent[] = [];
  let changed = before.length !== after.length;
  for (let k = 0; k < Math.max(before.length, after.length); k++) {
    if (k >= after.length) {
      out.push(markAll(before[k], "delete"));
    } else if (k >= before.length) {
      out.push(markAll(after[k], "insert"));
    } else {
      const cell = diffNode(cx, before[k], after[k]);
      out.push(cell.node);
      changed ||= cell.changed;
    }
  }
  return changed ? { node: withContent(next, out), changed } : { node: next, changed: false };
}

// ── Inline diff ──────────────────────────────────────────────────────────────

interface Token {
  /** Interned identity: text and marks, or the whole inline node (a chip, a break). */
  id: number;
  /** Text tokens: the text. Null for an inline node. */
  text: string | null;
  marks: JSONContent["marks"];
  marksKey: string;
  /** Inline node tokens: the node. */
  node: JSONContent | null;
  /** Holds a letter, digit or chip (not just whitespace or punctuation). */
  word: boolean;
}

const EQUAL = 0;
const DELETE = 1;
const INSERT = 2;

interface Step {
  op: typeof EQUAL | typeof DELETE | typeof INSERT;
  /** The base token (EQUAL, DELETE). */
  from: Token | null;
  /** The next token (EQUAL, INSERT). */
  to: Token | null;
}

/** Past this many LCS cells (about a 1,400-token paragraph rewritten whole), mark the middle replaced. */
const MAX_LCS_CELLS = 1 << 21;

function diffTextblock(cx: Cx, base: JSONContent, next: JSONContent): Diffed {
  const ids = new Map<string, number>();
  const intern = (key: string) => {
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const steps = diffTokens(tokenize(cx, base.content, intern), tokenize(cx, next.content, intern));
  if (steps.every((s) => s.op === EQUAL)) return { node: next, changed: false };
  return { node: withContent(next, buildInline(tidy(steps))), changed: true };
}

function tokenize(cx: Cx, content: JSONContent[] | undefined, intern: (key: string) => number): Token[] {
  const out: Token[] = [];
  for (const child of content ?? []) {
    if (child.type === "text" && typeof child.text === "string") {
      const mk = marksKey(child.marks);
      for (const piece of child.text.match(TOKEN) ?? []) {
        out.push({
          id: intern(`t${mk}\u0000${piece}`),
          text: piece,
          marks: child.marks,
          marksKey: mk,
          node: null,
          word: WORDISH.test(piece),
        });
      }
    } else {
      out.push({ id: intern(`n${nodeKey(cx, child)}`), text: null, marks: child.marks, marksKey: "", node: child, word: true });
    }
  }
  return out;
}

/** A shortest edit script: common prefix and suffix, then an LCS of the middle. */
function diffTokens(a: readonly Token[], b: readonly Token[]): Step[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].id === b[pre].id) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf].id === b[b.length - 1 - suf].id) suf++;

  const steps: Step[] = [];
  for (let k = 0; k < pre; k++) steps.push({ op: EQUAL, from: a[k], to: b[k] });
  lcsSteps(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf), steps);
  for (let k = suf; k > 0; k--) steps.push({ op: EQUAL, from: a[a.length - k], to: b[b.length - k] });
  return steps;
}

function lcsSteps(a: readonly Token[], b: readonly Token[], out: Step[]) {
  const m = a.length;
  const n = b.length;
  let i = 0;
  let j = 0;
  if (m > 0 && n > 0 && m * n <= MAX_LCS_CELLS) {
    // L[i][j]: LCS length of a[i..] and b[j..].
    const w = n + 1;
    const L = new Uint32Array((m + 1) * w);
    for (let x = m - 1; x >= 0; x--) {
      for (let y = n - 1; y >= 0; y--) {
        L[x * w + y] = a[x].id === b[y].id ? L[(x + 1) * w + y + 1] + 1 : Math.max(L[(x + 1) * w + y], L[x * w + y + 1]);
      }
    }
    while (i < m && j < n) {
      if (a[i].id === b[j].id) out.push({ op: EQUAL, from: a[i++], to: b[j++] });
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) out.push({ op: DELETE, from: a[i++], to: null });
      else out.push({ op: INSERT, from: null, to: b[j++] });
    }
  }
  while (i < m) out.push({ op: DELETE, from: a[i++], to: null });
  while (j < n) out.push({ op: INSERT, from: null, to: b[j++] });
}

/**
 * Readability: a stretch of only whitespace or punctuation kept between two changes joins them
 * ("[-a b-]{+x y+}", not "[-a-]{+x+} [-b-]{+y+}"), and each change lists its deletions first.
 */
function tidy(steps: readonly Step[]): Step[] {
  const runs: { equal: boolean; steps: Step[] }[] = [];
  for (const step of steps) {
    const equal = step.op === EQUAL;
    const last = runs[runs.length - 1];
    if (last && last.equal === equal) last.steps.push(step);
    else runs.push({ equal, steps: [step] });
  }
  for (let r = 1; r < runs.length - 1; r++) {
    const run = runs[r];
    if (!run.equal || runs[r - 1].equal || runs[r + 1].equal || run.steps.some((s) => s.to!.word)) continue;
    runs[r] = {
      equal: false,
      steps: [
        ...run.steps.map((s): Step => ({ op: DELETE, from: s.from, to: null })),
        ...run.steps.map((s): Step => ({ op: INSERT, from: null, to: s.to })),
      ],
    };
  }
  const out: Step[] = [];
  let deletes: Step[] = [];
  let inserts: Step[] = [];
  const flush = () => {
    out.push(...deletes, ...inserts);
    deletes = [];
    inserts = [];
  };
  for (const run of runs) {
    if (run.equal) {
      flush();
      out.push(...run.steps);
    } else {
      for (const s of run.steps) (s.op === DELETE ? deletes : inserts).push(s);
    }
  }
  flush();
  return out;
}

/** Inline nodes from the steps: deleted runs back in place, adjacent runs with the same marks merged. */
function buildInline(steps: readonly Step[]): JSONContent[] {
  const out: JSONContent[] = [];
  let pending: { text: string; marks: JSONContent["marks"]; signature: string } | null = null;
  const flush = () => {
    if (pending) out.push(pending.marks?.length ? { type: "text", text: pending.text, marks: pending.marks } : { type: "text", text: pending.text });
    pending = null;
  };
  for (const step of steps) {
    const token = (step.op === DELETE ? step.from : step.to)!;
    const op: RedlineOp | null = step.op === DELETE ? "delete" : step.op === INSERT ? "insert" : null;
    if (token.text !== null) {
      const signature = `${token.marksKey}|${op ?? ""}`;
      if (pending && pending.signature === signature) {
        pending.text += token.text;
      } else {
        flush();
        pending = { text: token.text, marks: op ? [...(token.marks ?? []), redline(op)] : token.marks, signature };
      }
    } else {
      flush();
      out.push(op ? withMark(token.node!, op) : token.node!);
    }
  }
  flush();
  return out;
}
