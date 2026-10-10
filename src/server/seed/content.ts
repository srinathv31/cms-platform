// Builders for the TipTap JSON the seed writes (contract: docs/render-spec.md §2).
//
// Block ids are derived from (template scope, block key), so a block that survives from one version
// to the next keeps its id. That is what lets comment threads anchor across versions and drafts.
//
// Inline text uses a tiny markup:  {variable_key}   **bold**   [label](https://link)

import type { JSONContent } from "@/domain/types";
import { fnv1a, mulberry32 } from "./rng";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function blockId(scope: string, key: string): string {
  const rng = mulberry32(fnv1a(`${scope}:${key}`));
  let id = "b_";
  for (let i = 0; i < 6; i++) id += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)];
  return id;
}

export interface Block {
  key: string;
  node: JSONContent;
}

// ── Inline ────────────────────────────────────────────────────

const INLINE = /\{([a-z][a-z0-9_]*)\}|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

export function rich(source: string): JSONContent[] {
  const out: JSONContent[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: source.slice(last, at) });
    if (m[1]) out.push({ type: "variable", attrs: { key: m[1] } });
    else if (m[2]) out.push({ type: "text", text: m[2], marks: [{ type: "bold" }] });
    else out.push({ type: "text", text: m[3], marks: [{ type: "link", attrs: { href: m[4] } }] });
    last = at + m[0].length;
  }
  if (last < source.length) out.push({ type: "text", text: source.slice(last) });
  return out;
}

const paragraph = (source: string): JSONContent => ({ type: "paragraph", content: rich(source) });

/** A one-paragraph document: a one-line channel field (the email subject and preheader). */
export function inlineDoc(source: string): JSONContent {
  return { type: "doc", content: [paragraph(source)] };
}

// ── Blocks ────────────────────────────────────────────────────

export const p = (key: string, source: string): Block => ({ key, node: paragraph(source) });

export const h3 = (key: string, title: string): Block => ({
  key,
  node: { type: "heading", attrs: { level: 3 }, content: rich(title) },
});

export const ul = (key: string, items: string[]): Block => ({
  key,
  node: {
    type: "bulletList",
    content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
  },
});

export const ol = (key: string, items: string[]): Block => ({
  key,
  node: {
    type: "orderedList",
    content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
  },
});

const cellAttrs = { colspan: 1, rowspan: 1, colwidth: null };

export const table = (key: string, header: string[], rows: string[][]): Block => ({
  key,
  node: {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: header.map((h) => ({
          type: "tableHeader",
          attrs: cellAttrs,
          content: [paragraph(h)],
        })),
      },
      ...rows.map((row) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: "tableCell",
          attrs: cellAttrs,
          content: [paragraph(cell)],
        })),
      })),
    ],
  },
});

export const callout = (key: string, ...paragraphs: string[]): Block => ({
  key,
  node: { type: "callout", content: paragraphs.map(paragraph) },
});

export const hr = (key: string): Block => ({ key, node: { type: "horizontalRule" } });

// ── Required sections ─────────────────────────────────────────

export const REQUIRED_SECTIONS = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
] as const;

type SectionKey = (typeof REQUIRED_SECTIONS)[number]["key"];

function section(key: SectionKey): Block {
  const meta = REQUIRED_SECTIONS.find((s) => s.key === key)!;
  return {
    key: `h_${key}`,
    node: {
      type: "heading",
      attrs: { level: 2, requiredKey: key },
      content: [{ type: "text", text: meta.title }],
    },
  };
}

// ── Document ──────────────────────────────────────────────────

export function buildDoc(scope: string, blocks: Block[]): JSONContent {
  const seen = new Map<string, string>();
  const content = blocks.map(({ key, node }) => {
    const id = blockId(scope, key);
    const clash = seen.get(id);
    if (clash !== undefined) {
      throw new Error(`Seed: block id clash in "${scope}": "${key}" and "${clash}" both hash to ${id}`);
    }
    seen.set(id, key);
    return { ...node, attrs: { id, ...node.attrs } };
  });
  return { type: "doc", content };
}

/** A disclosure body: the three required sections in order, each followed by its blocks. */
export function disclosure(
  scope: string,
  parts: { offer: Block[]; rates: Block[]; legal: Block[] },
): JSONContent {
  return buildDoc(scope, [
    section("offer_details"),
    ...parts.offer,
    section("rates_and_fees"),
    ...parts.rates,
    section("legal_notices"),
    ...parts.legal,
  ]);
}

// ── Inspection (used by the seed's own sanity checks) ─────────

export function variableKeys(node: JSONContent | null | undefined, out = new Set<string>()): Set<string> {
  if (!node) return out;
  if (node.type === "variable" && typeof node.attrs?.key === "string") out.add(node.attrs.key);
  node.content?.forEach((child) => variableKeys(child, out));
  return out;
}

export function topLevelIds(doc: JSONContent): string[] {
  return (doc.content ?? []).map((b) => String(b.attrs?.id ?? ""));
}

/** Plain text of a top-level block (used to quote it in comment threads). */
export function blockText(node: JSONContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(blockText).join(node.type === "paragraph" ? "" : " ");
}
