// The drift guard between the editor schema and the renderer. If someone adds a node or mark to the
// editor (src/editor/schema.ts) without teaching the resolver (src/domain/render/resolve.ts), or the
// other way round, this fails. It also proves every starter and seeded body renders with all its
// chips filled, from its own sample sets.

import { describe, expect, it } from "vitest";
import { HANDLED_MARKS, HANDLED_NODES, resolveDocument, validateValues } from "@/domain/render";
import type { RenderBlock, RenderInline } from "@/domain/render";
import type { JSONContent, SampleSet, Variable } from "@/domain/types";
import { sampleSetValues } from "@/editor";
import { createContext } from "@/server/seed/context";
import { seedCardStatementsTemplates } from "@/server/seed/templates/card-statements";
import { seedCoralTemplates } from "@/server/seed/templates/coral";
import { seedDepositsTemplates } from "@/server/seed/templates/deposits";
import { STARTER_KEYS, buildStarter } from "@/server/starters";
import { RenderDocumentError, checkDocument, editorSchema } from "./schema-check";

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
      expect((error as Error).message).toMatch(/^The document doesn't fit the editor schema: .*blockquote/);
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
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
