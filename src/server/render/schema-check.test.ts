// The drift guard between the editor schema and the renderer. If someone adds a node or mark to the
// editor (src/editor/schema.ts) without teaching the resolver (src/domain/render/resolve.ts), or the
// other way round, this fails. It also proves every starter and seeded body renders with all its
// chips filled, from its own sample sets.

import { describe, expect, it } from "vitest";
import { HANDLED_MARKS, HANDLED_NODES, resolveDocument, validateValues } from "@/domain/render";
import type { RenderBlock, RenderInline } from "@/domain/render";
import type { JSONContent, SampleSet, Variable } from "@/domain/types";
import { sampleSetValues } from "@/editor/model/sample-sets";
import { createContext } from "@/server/seed/context";
import { seedCardStatementsTemplates } from "@/server/seed/templates/card-statements";
import { seedCoralTemplates } from "@/server/seed/templates/coral";
import { seedDepositsTemplates } from "@/server/seed/templates/deposits";
import { STARTER_KEYS, buildStarter } from "@/server/starters";
import { normalizeDocument } from "@/editor/model/normalize";
import { DOCUMENT_MESSAGES, RenderDocumentError, checkDocument, checkField, editorSchema } from "./schema-check";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const TODAY = NOW.toISOString().slice(0, 10);

// ── Helpers ──────────────────────────────────────────────────────────────────

function countChips(node: JSONContent | null | undefined): number {
  if (!node) return 0;
  return (node.type === "variable" ? 1 : 0) + (node.content ?? []).reduce((n, child) => n + countChips(child), 0);
}

function inlinesOf(blocks: readonly RenderBlock[]): RenderInline[] {
  return blocks.flatMap((b): RenderInline[] => {
    switch (b.type) {
      case "paragraph":
      case "heading":
        return b.content;
      case "list":
        return b.items.flatMap((item) => inlinesOf(item.content));
      case "table":
        return b.rows.flatMap((row) => row.cells.flatMap((cell) => inlinesOf(cell.content)));
      case "callout":
        return inlinesOf(b.content);
      case "rule":
        return [];
    }
  });
}

function resolvedChips(blocks: readonly RenderBlock[]): number {
  return inlinesOf(blocks).filter((i) => i.type === "text" && i.variable !== undefined).length;
}

interface Case {
  name: string;
  body: JSONContent;
  variables: Variable[];
  sampleSets: SampleSet[];
  fields: (JSONContent | null | undefined)[];
}

/** Every document must check, and resolve with every chip filled, under every sample set. */
function expectRendersFully(c: Case) {
  for (const doc of [c.body, ...c.fields]) if (doc) expect(() => checkDocument(doc), c.name).not.toThrow();
  expect(c.sampleSets.length, c.name).toBeGreaterThan(0);

  for (const set of c.sampleSets) {
    const where = `${c.name} / ${set.id}`;
    const validated = validateValues(c.variables, sampleSetValues(set, c.variables, TODAY));
    if (!validated.ok) throw new Error(`${where}: ${validated.error.message}`);
    const ctx = { variables: c.variables, values: validated.values };

    for (const doc of [c.body, ...c.fields]) {
      if (!doc) continue;
      expect(resolvedChips(resolveDocument(doc, ctx)), where).toBe(countChips(doc));
    }
  }
}

// ── The schema and the resolver agree ────────────────────────────────────────

describe("the editor schema and the resolver", () => {
  const schema = editorSchema();

  it("handle exactly the same nodes", () => {
    expect([...HANDLED_NODES].sort()).toEqual(Object.keys(schema.nodes).sort());
  });

  it("handle exactly the same marks", () => {
    expect([...HANDLED_MARKS].sort()).toEqual(Object.keys(schema.marks).sort());
  });

  it("builds the schema once", () => {
    expect(editorSchema()).toBe(schema);
  });
});

// ── checkDocument ────────────────────────────────────────────────────────────

describe("checkDocument", () => {
  const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
  const t = (text: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "text", text, ...(marks ? { marks } : {}) });
  const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

  it("accepts every block, inline node and mark of the contract", () => {
    const body = doc(
      { type: "heading", attrs: { id: "h", level: 2, requiredKey: "offer_details" }, content: [t("Offer details")] },
      p(t("Hi "), { type: "variable", attrs: { key: "first_name" } }, { type: "hardBreak" }, t("b", [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "link", attrs: { href: "https://x.example" } }])),
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("a")), { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("b"))] }] }] }] },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2 }, content: [p(t("Fee"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [p(t("a"))] }, { type: "tableCell", content: [p(t("b"))] }] },
        ],
      },
      { type: "callout", content: [p(t("Note")), p()] },
      { type: "horizontalRule" },
      p(),
    );
    expect(() => checkDocument(body)).not.toThrow();
  });

  it("accepts a one-line field (email subject)", () => {
    expect(() => checkDocument(doc(p(t("Your APR is changing on "), { type: "variable", attrs: { key: "effective_date" } })))).not.toThrow();
  });

  it.each<[string, JSONContent]>([
    ["an unknown node", doc({ type: "blockquote", content: [p(t("x"))] })],
    ["an unknown inline node", doc(p({ type: "image", attrs: { src: "x" } }))],
    ["an unknown mark", doc(p(t("x", [{ type: "strike" }])))],
    ["a code mark (turned off)", doc(p(t("x", [{ type: "code" }])))],
    ["text at the top level", doc(t("loose"))],
    ["a list without items", doc({ type: "bulletList", content: [p(t("x"))] })],
    ["a heading inside a callout", doc({ type: "callout", content: [{ type: "heading", attrs: { level: 2 }, content: [t("x")] }] })],
    ["an empty document", { type: "doc", content: [] }],
    ["an empty text node", doc(p({ type: "text", text: "" }))],
    ["a paragraph as the root", p(t("x"))],
    ["something that isn't a node", { nope: true } as unknown as JSONContent],
  ])("rejects %s", (_, body) => {
    expect(() => checkDocument(body)).toThrow(RenderDocumentError);
  });

  it("says why, and keeps the cause", () => {
    try {
      checkDocument(doc({ type: "blockquote" }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderDocumentError);
      expect((error as Error).name).toBe("RenderDocumentError");
      // The sentence is for people (the save status, the render error) and never quotes the document;
      // ProseMirror's own reason stays on the cause, for the server log.
      expect((error as Error).message).toBe("This document has content Stencil doesn't support.");
      expect((error as RenderDocumentError).problem).toBe("unsupported");
      expect((error as Error).cause).toBeInstanceOf(Error);
      expect(String(((error as Error).cause as Error).message)).toMatch(/blockquote/);
    }
  });
});

// ── The limits (docs/render-spec.md §3, "The document check") ───────────────

describe("checkDocument: the limits, with their sentences", () => {
  const t = (text: string): JSONContent => ({ type: "text", text });
  const p = (text = ""): JSONContent => (text ? { type: "paragraph", content: [t(text)] } : { type: "paragraph" });
  const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
  const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
  const ol = (attrs: Record<string, unknown>, ...content: JSONContent[]): JSONContent => ({ type: "orderedList", attrs, content });
  const ul = (...content: JSONContent[]): JSONContent => ({ type: "bulletList", content });
  const td = (content: JSONContent[] = [p("x")], attrs?: Record<string, unknown>): JSONContent => ({ type: "tableCell", ...(attrs ? { attrs } : {}), content });
  const tr = (...cells: JSONContent[]): JSONContent => ({ type: "tableRow", content: cells });
  const table = (...rows: JSONContent[]): JSONContent => ({ type: "table", content: rows });
  const row = (n: number) => tr(...Array.from({ length: n }, () => td()));

  /** Lists `levels` deep, alternating kinds, each list one item. */
  const nested = (levels: number): JSONContent => {
    let list: JSONContent = ul(li(p(`level ${levels}`)));
    for (let level = levels - 1; level >= 1; level--) {
      list = level % 2 ? ol({}, li(p(`level ${level}`), list)) : ul(li(p(`level ${level}`), list));
    }
    return list;
  };

  const refusal = (body: JSONContent) => {
    try {
      checkDocument(body);
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(RenderDocumentError);
      return (error as RenderDocumentError).message;
    }
  };

  it.each<[string, JSONContent, string]>([
    ["a heading in a table cell", doc(table(tr(td([{ type: "heading", attrs: { level: 2 }, content: [t("x")] }])))), "Table cells can hold only paragraphs and lists."],
    ["a table in a table cell", doc(table(tr(td([table(row(1))])))), "Table cells can hold only paragraphs and lists."],
    ["a rule in a table cell", doc(table(tr(td([{ type: "horizontalRule" }])))), "Table cells can hold only paragraphs and lists."],
    ["a callout in a table cell", doc(table(tr(td([{ type: "callout", content: [p("x")] }])))), "Table cells can hold only paragraphs and lists."],
    ["a heading in a list item in a table cell", doc(table(tr(td([ul(li(p("a"), { type: "heading", attrs: { level: 2 }, content: [t("x")] }))])))), "Table cells can hold only paragraphs and lists."],
    ["a table in a nested list item in a table cell", doc(table(tr(td([ul(li(p("a"), ol({}, li(p("b"), table(row(1))))))])))), "Table cells can hold only paragraphs and lists."],
    ["a rule in a list item in a table cell", doc(table(tr(td([ol({}, li(p("a"), { type: "horizontalRule" }))])))), "Table cells can hold only paragraphs and lists."],
    ["a callout in a list item in a table cell", doc(table(tr(td([ul(li(p("a"), { type: "callout", content: [p("x")] }))])))), "Table cells can hold only paragraphs and lists."],
    ["a heading of level 4", doc({ type: "heading", attrs: { level: 4 }, content: [t("x")] }), "Headings can only be levels 1 to 3."],
    ["a heading of level 0", doc({ type: "heading", attrs: { level: 0 } }), "Headings can only be levels 1 to 3."],
    ["a heading of level \"2\"", doc({ type: "heading", attrs: { level: "2" } }), "Headings can only be levels 1 to 3."],
    ["a heading of level null", doc({ type: "heading", attrs: { level: null }, content: [t("x")] }), "Headings can only be levels 1 to 3."],
    ["a list starting at 10000", doc(ol({ start: 10000 }, li(p("x")))), "A numbered list can start at 0 to 9999."],
    ["a list starting at -1", doc(ol({ start: -1 }, li(p("x")))), "A numbered list can start at 0 to 9999."],
    ["a list starting at 1.5", doc(ol({ start: 1.5 }, li(p("x")))), "A numbered list can start at 0 to 9999."],
    ["a list starting at \"3\"", doc(ol({ start: "3" }, li(p("x")))), "A numbered list can start at 0 to 9999."],
    ["an unknown numbering format", doc(ol({ markerFormat: "greek" }, li(p("x")))), "This list's numbering style isn't one Stencil knows."],
    ["an unknown delimiter", doc(ol({ markerDelimiter: "colon" }, li(p("x")))), "This list's numbering style isn't one Stencil knows."],
    ["lists 10 deep", doc(nested(10)), "Lists can nest at most 9 levels deep."],
    ["lists 10 deep through a table", doc(ul(li(p("a"), table(tr(td([nested(9)])))))), "Lists can nest at most 9 levels deep."],
    ["a colspan of 0", doc(table(tr(td([p("x")], { colspan: 0 })))), "This table's cells don't line up into rows and columns."],
    ["a rowspan of 1.5", doc(table(tr(td([p("x")], { rowspan: 1.5 })))), "This table's cells don't line up into rows and columns."],
    ["a colspan of \"2\"", doc(table(tr(td([p("x")], { colspan: "2" })))), "This table's cells don't line up into rows and columns."],
    ["a ragged table", doc(table(row(3), row(2))), "This table's cells don't line up into rows and columns."],
    ["a rowspan past the last row", doc(table(tr(td([p("x")], { rowspan: 3 }), td()), row(2))), "This table's cells don't line up into rows and columns."],
    ["a colspan running into a rowspan", doc(table(tr(td(), td([p("x")], { rowspan: 2 })), tr(td([p("x")], { colspan: 2 })))), "This table's cells don't line up into rows and columns."],
    ["13 columns", doc(table(row(13))), "Tables can have at most 12 columns."],
    ["13 columns by colspan", doc(table(tr(td(), td([p("x")], { colspan: 12 })), tr(...Array.from({ length: 13 }, () => td())))), "Tables can have at most 12 columns."],
  ])("refuses %s", (_, body, message) => {
    expect(refusal(body)).toBe(message);
  });

  it.each<[string, JSONContent]>([
    ["headings of levels 1 to 3", doc(...[1, 2, 3].map((level) => ({ type: "heading", attrs: { level }, content: [t("x")] })))],
    ["a heading without a level (the schema's default, 1)", doc({ type: "heading", content: [t("x")] })],
    ["list starts of 0 and 9999, absent and null", doc(ol({ start: 0 }, li(p("x"))), ol({ start: 9999 }, li(p("x"))), ol({}, li(p("x"))), ol({ start: null }, li(p("x"))))],
    ["every numbering style, and null", doc(ol({ markerFormat: "upper-roman", markerDelimiter: "parens" }, li(p("x"))), ol({ markerFormat: null, markerDelimiter: null }, li(p("x"))))],
    ["TipTap's own orderedList type (ignored)", doc(ol({ type: "a" }, li(p("x"))))],
    ["lists 9 deep", doc(nested(9))],
    ["12 columns", doc(table(row(12), row(12)))],
    ["spans that line up", doc(table(tr(td([p("x")], { colspan: 2, rowspan: 2 }), td()), tr(td()), row(3)))],
    ["absent and null spans (1)", doc(table(tr(td([p("x")], { colspan: null, rowspan: null }), td()), row(2)))],
    ["cells holding paragraphs and both kinds of list", doc(table(tr(td([p("a"), ul(li(p("b"))), ol({}, li(p("c"))), p()]))))],
    ["headings, rules, callouts and tables in a list item outside a table", doc(ul(li(p("a"), { type: "heading", attrs: { level: 2 }, content: [t("x")] }, { type: "horizontalRule" }, { type: "callout", content: [p("x")] }, table(row(2)))))],
    ["cell align and colwidth (removed at save, not refused)", doc(table(tr(td([p("x")], { align: "center", colwidth: [100] }))))],
    ["a link the check refuses (removed at save; the resolver drops it)", doc({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:x" } }] }] })],
  ])("accepts %s", (_, body) => {
    expect(refusal(body)).toBeNull();
  });

  it("every limit's sentence is a sentence for the author and never quotes the document", () => {
    for (const message of Object.values(DOCUMENT_MESSAGES)) expect(message).toMatch(/^[A-Z][^{}]*\.$/);
  });

  it("what normalization fixes passes the check once normalized", () => {
    const messy = doc(
      { type: "heading", attrs: { level: 6 }, content: [t("x")] },
      table(tr(td([{ type: "heading", attrs: { level: 2 }, content: [t("x")] }, table(row(2))]), td()), tr(td())),
      table(row(15)),
    );
    expect(refusal(messy)).not.toBeNull();
    expect(refusal(normalizeDocument(messy))).toBeNull();
  });
});

describe("checkField (email subject, preheader)", () => {
  const field = (...content: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content }] });

  it("accepts one line of text and variables, or an empty line", () => {
    expect(() => checkField(field({ type: "text", text: "Hi " }, { type: "variable", attrs: { key: "first_name" } }))).not.toThrow();
    expect(() => checkField({ type: "doc", content: [{ type: "paragraph" }] })).not.toThrow();
  });

  it.each<[string, JSONContent]>([
    ["two paragraphs", { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] }],
    ["a heading", { type: "doc", content: [{ type: "heading", attrs: { level: 2 } }] }],
    ["a hard break", field({ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" })],
    ["a mark", field({ type: "text", text: "a", marks: [{ type: "bold" }] })],
    ["no paragraph", { type: "doc", content: [] }],
  ])("refuses %s", (_, value) => {
    expect(() => checkField(value)).toThrow("The email subject and preheader can hold only one line of text and variables.");
  });
});

// ── Real content ─────────────────────────────────────────────────────────────

describe.each(STARTER_KEYS)("starter %s", (key) => {
  it("checks, and resolves with every chip filled from its own sample sets", () => {
    const starter = buildStarter(key, { scope: "UC-TEST01", now: NOW });
    expectRendersFully({
      name: key,
      body: starter.body,
      variables: starter.variables,
      sampleSets: starter.sampleSets,
      fields: [starter.emailSubject, starter.emailPreheader],
    });
  });
});

describe("seeded templates", () => {
  const ctx = createContext(NOW.getTime());
  seedCoralTemplates(ctx);
  seedDepositsTemplates(ctx);
  seedCardStatementsTemplates(ctx);
  const versions = ctx.sink.versions;

  it("are all reachable without a database", () => {
    expect(versions.length).toBeGreaterThan(5);
  });

  it.each(versions.map((v) => [`${v.templateId} v${v.number ?? "draft"} (${v.state})`, v] as const))(
    "%s checks, and resolves with every chip filled",
    (name, v) => {
      expectRendersFully({
        name,
        body: v.body as JSONContent,
        variables: v.variables as Variable[],
        sampleSets: v.sampleSets as SampleSet[],
        fields: [v.emailSubject as JSONContent | null, v.emailPreheader as JSONContent | null],
      });
    },
  );
});
