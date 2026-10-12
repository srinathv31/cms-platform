import { expect } from "vitest";
import type { RedlineDoc } from "../review-types";
import type { JSONContent } from "../types";

export const NO_CHANGES = { added: 0, removed: 0, changed: 0, moved: 0 };

export type Inline = string | JSONContent;

const v = (key: string): JSONContent => ({ type: "variable", attrs: { key } });

/** Strings become text, with `{key}` as a chip. */
export function inline(parts: Inline[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const part of parts) {
    if (typeof part !== "string") {
      out.push(part);
      continue;
    }
    for (const piece of part.split(/(\{[a-z_]+\})/)) {
      if (!piece) continue;
      const chip = /^\{([a-z_]+)\}$/.exec(piece);
      out.push(chip ? v(chip[1]) : { type: "text", text: piece });
    }
  }
  return out;
}

const idAttrs = (id: string | null) => (id ? { attrs: { id } } : {});

export function p(id: string | null, ...parts: Inline[]): JSONContent {
  const content = inline(parts);
  return {
    type: "paragraph",
    ...idAttrs(id),
    ...(content.length > 0 ? { content } : {}),
  };
}

export function h(
  id: string | null,
  level: number,
  text: string,
  requiredKey: string | null = null,
): JSONContent {
  return {
    type: "heading",
    attrs: { ...(id ? { id } : {}), level, requiredKey },
    content: inline([text]),
  };
}

export const li = (text: string, id: string | null = null): JSONContent => ({
  type: "listItem",
  ...idAttrs(id),
  content: [p(null, text)],
});

export function list(
  type: "bulletList" | "orderedList",
  id: string | null,
  items: (string | JSONContent)[],
): JSONContent {
  return {
    type,
    ...idAttrs(id),
    content: items.map((item) => (typeof item === "string" ? li(item) : item)),
  };
}
export const ul = (id: string | null, items: (string | JSONContent)[]) =>
  list("bulletList", id, items);

export function table(
  id: string | null,
  header: string[],
  rows: string[][],
): JSONContent {
  return {
    type: "table",
    ...idAttrs(id),
    content: [
      {
        type: "tableRow",
        content: header.map((cell) => ({
          type: "tableHeader",
          content: [p(null, cell)],
        })),
      },
      ...rows.map((row) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: "tableCell",
          content: [p(null, cell)],
        })),
      })),
    ],
  };
}

export const callout = (
  id: string | null,
  ...paragraphs: string[]
): JSONContent => ({
  type: "callout",
  ...idAttrs(id),
  content: paragraphs.map((text) => p(null, text)),
});

const hr = (id: string | null): JSONContent => ({
  type: "horizontalRule",
  ...idAttrs(id),
});
export const doc = (...content: JSONContent[]): JSONContent => ({
  type: "doc",
  content,
});

export const isTextblock = (node: JSONContent) =>
  node.type === "paragraph" || node.type === "heading";
export const opOf = (x: JSONContent): unknown =>
  x.marks?.find((m) => m.type === "redline")?.attrs?.op;

/** A textblock's inline content with the redline drawn in: [-deleted-] {+inserted+}, chips {{key}}, bold **x**. */
export function show(node: JSONContent): string {
  return (node.content ?? [])
    .map((x) => {
      let s =
        x.type === "variable"
          ? `{{${x.attrs?.key}}}`
          : x.type === "text"
            ? String(x.text)
            : `<${x.type}>`;
      if (x.marks?.some((m) => m.type === "bold")) s = `**${s}**`;
      const op = opOf(x);
      return op === "delete" ? `[-${s}-]` : op === "insert" ? `{+${s}+}` : s;
    })
    .join("");
}

/** Plain text of every non-empty textblock, leaving out inline nodes marked `drop`. */
function plain(node: JSONContent, drop?: "delete" | "insert"): string[] {
  if (!isTextblock(node))
    return (node.content ?? []).flatMap((child) => plain(child, drop));
  const text = (node.content ?? [])
    .filter((x) => drop === undefined || opOf(x) !== drop)
    .map((x) =>
      x.type === "variable" ? `{{${x.attrs?.key}}}` : (x.text ?? ""),
    )
    .join("");
  return text ? [text] : [];
}

/**
 * The redline loses nothing: accepting every change reads as `next`, rejecting every change reads as
 * `base` (when nothing moved and no kind changed). That the redline, minus its marks, is a valid editor
 * document is checked on the real seeded pairs in `src/server/seed/redline-seed.test.ts` (domain code
 * can't import the editor's schema).
 */
export function expectFaithful(
  base: JSONContent,
  next: JSONContent,
  red: RedlineDoc,
  { reject = true } = {},
) {
  const accepted = red.blocks
    .filter((b) => b.status !== "removed")
    .flatMap((b) => plain(b.node, "delete"));
  expect(accepted).toEqual(plain(next));
  if (reject && red.blocks.every((b) => b.movedFrom === undefined)) {
    const rejected = red.blocks
      .filter((b) => b.status !== "added")
      .flatMap((b) => plain(b.node, "insert"));
    expect(rejected).toEqual(plain(base));
  }
}

export const statuses = (red: RedlineDoc) =>
  red.blocks.map((b) => `${b.id}:${b.status}`);
export const block = (red: RedlineDoc, id: string) => {
  const found = red.blocks.find((b) => b.id === id);
  if (!found) throw new Error(`no block ${id}`);
  return found;
};

export const EVERYTHING = doc(
  h("h1", 2, "Offer details", "offer_details"),
  p("a", "Hi {first_name}, pay 0% intro APR for 12 months."),
  ul("l", ["Transfers must post within 60 days.", "Fees apply."]),
  table("t", ["Rate or fee", "What you pay"], [["Annual fee", "$0"]]),
  callout("c", "Interest starts on the transaction date."),
  hr("r"),
  p("z", "Coral Bank, N.A. Member FDIC."),
);
