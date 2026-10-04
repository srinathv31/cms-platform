// Where each variable is used: chip counts per key, split by the H2 section a chip sits under.
// Pure TypeScript over a ProseMirror doc or TipTap JSON (the JSON path gives the server and the
// first paint the same numbers the live editor computes later).
//
// Cost: ProseMirror nodes are immutable and shared between document versions, so each top-level
// block is summarized once and cached by identity. Recomputing after a keystroke walks only the
// block that changed.

import type { Node as PMNode } from "@tiptap/pm/model";
import { NODE, type JSONContent } from "./types";

/** Where one variable appears, in document order. */
export interface VariablePlace {
  /** "Document" for the body, otherwise an InlineVariableField's `label`. */
  field: string;
  /** The H2 section the chip sits under (its heading text); null above the first section or in a field. */
  section: string | null;
  count: number;
}

/** A variable's chips across every field of a root (the panel's count, the chip popover's places). */
export interface VariableUsage {
  key: string;
  /** Total chips. 0 = unused (the panel mutes the row). */
  count: number;
  places: VariablePlace[];
}

export interface SectionCount {
  /** Text of the nearest H2 above; null above the first one, or in a field without sections. */
  section: string | null;
  count: number;
}

/** Chips per key in one field, each key's sections in document order. */
export type FieldUsage = ReadonlyMap<string, readonly SectionCount[]>;

export interface UsageOptions {
  /** Split counts by H2 section (the document body). Inline fields have no sections. */
  sections: boolean;
}

interface BlockSummary {
  /** Set when the block is an H2: its text (null when empty). */
  section: string | null | undefined;
  /** Chip counts in first-appearance order. */
  chips: ReadonlyArray<readonly [string, number]>;
}

const EMPTY_USAGE: FieldUsage = new Map();
const summaries = new WeakMap<PMNode, BlockSummary>();

/** Usage in a live document. Unchanged blocks come from the identity cache. */
export function usageFromDoc(doc: PMNode, { sections }: UsageOptions): FieldUsage {
  const acc = new UsageAccumulator();
  let section: string | null = null;
  doc.forEach((block) => {
    const summary = summarizeBlock(block);
    if (sections && summary.section !== undefined) section = summary.section;
    for (const [key, count] of summary.chips) acc.add(key, sections ? section : null, count);
  });
  return acc.result();
}

function summarizeBlock(block: PMNode): BlockSummary {
  const cached = summaries.get(block);
  if (cached) return cached;
  const counts = new Map<string, number>();
  if (block.type.name === NODE.variable) {
    countKey(counts, block.attrs.key);
  } else if (!block.isLeaf) {
    block.descendants((node) => {
      if (node.type.name === NODE.variable) {
        countKey(counts, node.attrs.key);
        return false;
      }
      return !node.isText;
    });
  }
  const summary: BlockSummary = {
    section: isSectionHeading(block.type.name, block.attrs) ? textOf(block) : undefined,
    chips: [...counts],
  };
  summaries.set(block, summary);
  return summary;
}

function textOf(block: PMNode): string | null {
  let text = "";
  block.forEach((child) => {
    if (child.isText) text += child.text;
  });
  return text.trim() || null;
}

/** Usage in TipTap JSON (before the editor exists: server render, first paint). */
export function usageFromJSON(doc: JSONContent | null | undefined, { sections }: UsageOptions): FieldUsage {
  if (!doc?.content?.length) return EMPTY_USAGE;
  const acc = new UsageAccumulator();
  let section: string | null = null;
  for (const block of doc.content) {
    if (sections && isSectionHeading(block.type, block.attrs)) section = jsonText(block);
    const counts = new Map<string, number>();
    walkJSON(block, counts);
    for (const [key, count] of counts) acc.add(key, sections ? section : null, count);
  }
  return acc.result();
}

function walkJSON(node: JSONContent, counts: Map<string, number>) {
  if (node.type === NODE.variable) {
    countKey(counts, node.attrs?.key);
    return;
  }
  node.content?.forEach((child) => walkJSON(child, counts));
}

function jsonText(block: JSONContent): string | null {
  const text = (block.content ?? []).map((child) => (child.type === "text" ? (child.text ?? "") : "")).join("");
  return text.trim() || null;
}

function isSectionHeading(type: string | undefined, attrs: Record<string, unknown> | undefined): boolean {
  return type === NODE.heading && Number(attrs?.level) === 2;
}

function countKey(counts: Map<string, number>, key: unknown) {
  if (typeof key !== "string" || !key) return;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

class UsageAccumulator {
  private byKey = new Map<string, SectionCount[]>();

  add(key: string, section: string | null, count: number) {
    let list = this.byKey.get(key);
    if (!list) {
      list = [];
      this.byKey.set(key, list);
    }
    const last = list.find((entry) => entry.section === section);
    if (last) last.count += count;
    else list.push({ section, count });
  }

  result(): FieldUsage {
    return this.byKey.size ? this.byKey : EMPTY_USAGE;
  }
}

// ── Combining fields ─────────────────────────────────────────────

export interface FieldUsageEntry {
  /** "Document" for the body, otherwise the inline field's label. */
  label: string;
  usage: FieldUsage;
}

/** Usage per key across every field of a root, fields in the order given. */
export function mergeUsage(fields: readonly FieldUsageEntry[]): Map<string, VariableUsage> {
  const merged = new Map<string, { count: number; places: VariablePlace[] }>();
  for (const field of fields) {
    for (const [key, sections] of field.usage) {
      let entry = merged.get(key);
      if (!entry) {
        entry = { count: 0, places: [] };
        merged.set(key, entry);
      }
      for (const { section, count } of sections) {
        entry.count += count;
        entry.places.push({ field: field.label, section, count });
      }
    }
  }
  const out = new Map<string, VariableUsage>();
  for (const [key, { count, places }] of merged) out.set(key, { key, count, places });
  return out;
}

export function sameUsage(a: VariableUsage | undefined, b: VariableUsage | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.count !== b.count || a.places.length !== b.places.length) return false;
  return a.places.every((place, i) => {
    const other = b.places[i];
    return place.field === other.field && place.section === other.section && place.count === other.count;
  });
}

/**
 * The next usage map, keeping the previous object for every key whose numbers didn't change
 * (so subscribers keyed by variable re-render only when their own row changed).
 * Returns `prev` itself when nothing changed.
 */
export function reconcileUsage(
  prev: ReadonlyMap<string, VariableUsage>,
  next: ReadonlyMap<string, VariableUsage>,
): ReadonlyMap<string, VariableUsage> {
  let changed = prev.size !== next.size;
  const out = new Map<string, VariableUsage>();
  for (const [key, usage] of next) {
    const old = prev.get(key);
    if (old && sameUsage(old, usage)) {
      out.set(key, old);
    } else {
      out.set(key, usage);
      changed = true;
    }
  }
  return changed ? out : prev;
}
