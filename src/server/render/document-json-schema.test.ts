// The generated document schema (document-json-schema.ts, decision 0065), against the TypeScript check:
//   1. docs/reference/document.schema.json is what the generator makes (`npm run document-schema:update`
//      rewrites it);
//   2. the schema and the check (`checkDocument`, `checkField`) agree on every golden case, starter and
//      seeded body, on a table of hand-written documents, and on seeded random mutations of the real ones.
//      They differ only where the header of document-json-schema.ts says: the three rules left to code,
//      and a few shapes the editor never writes;
//   3. render spec §2 lists the same gaps.
// The schema is run by zod's `fromJSONSchema` (draft 2020-12, local `$ref`s), as golive/json-schema.test.ts
// does for the values schema.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { JSONContent } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ALL_CHANNEL_FIELDS,
  channelFieldValue,
  type ChannelField,
} from "@/domain/channel-fields";
import type { DocumentProblem } from "@/editor/model/document-check";
import { createContext } from "@/server/seed/context";
import { seedCardStatementsTemplates } from "@/server/seed/templates/card-statements";
import { seedCoralTemplates } from "@/server/seed/templates/coral";
import { seedCoralAlerts } from "@/server/seed/templates/coral-alerts";
import { seedDepositsTemplates } from "@/server/seed/templates/deposits";
import { STARTER_KEYS, buildStarter } from "@/server/starters";
import { caseSlugs, readInput } from "./golden/files";
import {
  ATTRIBUTE_RULES,
  SCHEMA_GAPS,
  documentJsonSchema,
  type JsonSchema,
} from "./document-json-schema";
import {
  RenderDocumentError,
  checkDocument,
  checkField,
  editorSchema,
} from "./schema-check";
import { json } from "./testing/fixture";
import {
  br,
  bold,
  callout,
  cell,
  doc,
  h,
  head,
  item,
  italic,
  li,
  line,
  link,
  nestedOrdered,
  ol,
  p,
  para,
  row,
  rule,
  section,
  span,
  t,
  table,
  td,
  ul,
  underline,
  v,
  type Node,
} from "./testing/tiptap";

const SCHEMA_FILE = path.join(
  process.cwd(),
  "docs/reference/document.schema.json",
);
const SPEC_FILE = path.join(process.cwd(), "docs/render-spec.md");

/** True under `npm run document-schema:update`: write the file instead of comparing with it. */
const UPDATING = process.env.DOCUMENT_SCHEMA_UPDATE === "1";

const generated = documentJsonSchema();
if (UPDATING) writeFileSync(SCHEMA_FILE, json(generated));

// ── The validators ───────────────────────────────────────────────────────────

/** A validator for a part of the generated schema, by its JSON pointer into `$defs` (or the root). */
const validatorFor = (definition?: string) =>
  z.fromJSONSchema(
    (definition
      ? {
          $schema: generated.$schema,
          $ref: `#/$defs/${definition}`,
          $defs: generated.$defs,
        }
      : generated) as never,
  );
const bodySchema = validatorFor();
const FIELD_SCHEMAS = {
  line: validatorFor("field-line"),
  paragraph: validatorFor("field-line"),
  lines: validatorFor("field-lines"),
};

const schemaAcceptsBody = (value: unknown) =>
  bodySchema.safeParse(value).success;
const schemaAcceptsField = (
  field: Pick<ChannelField, "shape">,
  value: unknown,
) => FIELD_SCHEMAS[field.shape].safeParse(value).success;

/** The check's verdict on a body: the problem it refuses with, or null. */
function bodyProblem(value: unknown): DocumentProblem | null {
  try {
    checkDocument(value as JSONContent);
    return null;
  } catch (error) {
    if (error instanceof RenderDocumentError) return error.problem;
    throw error;
  }
}

function fieldProblem(field: ChannelField, value: JSONContent) {
  try {
    checkField(value, field);
    return null;
  } catch (error) {
    if (error instanceof RenderDocumentError) return error.problem;
    throw error;
  }
}

/** The rules the schema leaves to code: a document the check refuses for one of them may pass the schema. */
const LEFT_TO_CODE: readonly DocumentProblem[] = [
  "tableShape",
  "tableColumns",
  "listDepth",
];

/**
 * The agreement: when the check accepts a body the schema does, and when the check refuses it for any
 * rule the schema states the schema refuses it too. (A body the check refuses for a rule left to code
 * may go either way: another rule the schema does state may refuse it.)
 */
function disagreement(value: unknown): string | null {
  const problem = bodyProblem(value);
  const valid = schemaAcceptsBody(value);
  if (problem !== null && LEFT_TO_CODE.includes(problem)) return null;
  if (problem === null && !valid)
    return `the check accepts it, the schema refuses it: ${JSON.stringify(value)}`;
  if (problem !== null && valid)
    return `the check refuses it (${problem}), the schema accepts it: ${JSON.stringify(value)}`;
  return null;
}

// ── 1. The committed file ────────────────────────────────────────────────────

describe("docs/reference/document.schema.json", () => {
  it("is what the generator makes", () => {
    expect(
      JSON.parse(readFileSync(SCHEMA_FILE, "utf8")),
      "The editor's schema or the generator changed. Run: npm run document-schema:update, and read the diff: a Java validator takes the new file.",
    ).toEqual(JSON.parse(json(generated)));
  });

  it("is draft 2020-12, with the body at the root and the two field shapes in $defs", () => {
    expect(generated.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    const defs = Object.keys(generated.$defs as object);
    expect(defs).toEqual(expect.arrayContaining(["field-line", "field-lines"]));
    expect(defs).toEqual([...defs].sort());
  });

  it("gives a list inside a table cell its own definitions, and nothing else", () => {
    const defs = Object.keys(generated.$defs as object);
    expect(defs.filter((name) => name.endsWith("-in-cell"))).toEqual([
      "bulletList-in-cell",
      "listItem-in-cell",
      "orderedList-in-cell",
    ]);
  });
});

// ── 2. Agreement with the check ──────────────────────────────────────────────

describe("the golden cases", () => {
  describe.each(caseSlugs())("%s", (slug) => {
    const input = readInput(slug);

    it("body: the schema and the check agree", () => {
      expect(disagreement(input.body)).toBeNull();
    });

    it("channel fields: the schema and the check agree", () => {
      for (const field of ALL_CHANNEL_FIELDS) {
        const value = channelFieldValue(input.channelFields, field);
        if (!value) continue;
        expect(
          schemaAcceptsField(field, value),
          `${field.id}: ${JSON.stringify(value)}`,
        ).toBe(fieldProblem(field, value) === null);
      }
    });
  });

  // The cases the engine refuses for the document (details.reason "document"), by who refuses them.
  it.each([
    "error-heading-in-cell-list",
    "error-heading-level",
    "error-list-start",
    "error-numbering-style",
    "error-table-bad-span", // a colspan of 0: each span is an integer of at least 1
    "error-table-in-cell",
    "error-unknown-node",
  ])("%s is refused by the check and by the schema", (slug) => {
    const { body } = readInput(slug);
    expect(bodyProblem(body)).not.toBeNull();
    expect(schemaAcceptsBody(body)).toBe(false);
  });

  it.each([
    ["error-list-too-deep", "listDepth"],
    ["error-table-ragged", "tableShape"],
    ["error-table-too-wide", "tableColumns"],
  ] as const)(
    "%s is refused by the check for a rule the schema leaves to code, so the schema accepts it",
    (slug, problem) => {
      const { body } = readInput(slug);
      expect(bodyProblem(body)).toBe(problem);
      expect(schemaAcceptsBody(body)).toBe(true);
    },
  );

  it.each([
    ["error-email-field", "email", "subject"],
    ["error-push-field", "push", "body"],
    ["error-sms-field", "sms", "text"],
  ] as const)(
    "%s: the field is refused by the check and by the schema",
    (slug, channel, key) => {
      const field = ALL_CHANNEL_FIELDS.find(
        (f) => f.channel === channel && f.key === key,
      )!;
      const value = channelFieldValue(readInput(slug).channelFields, field)!;
      expect(fieldProblem(field, value)).not.toBeNull();
      expect(schemaAcceptsField(field, value)).toBe(false);
    },
  );
});

describe("starters and seeded templates", () => {
  const NOW = new Date("2026-10-04T12:00:00.000Z");
  const starters = [
    ...STARTER_KEYS.document.map((starterKey) => ({
      family: "document" as const,
      starterKey,
    })),
    ...STARTER_KEYS.message.map((starterKey) => ({
      family: "message" as const,
      starterKey,
    })),
  ].map((choice) => ({
    label: `starter ${choice.family}/${choice.starterKey}`,
    ...buildStarter(choice, { scope: "UC-TEST01", now: NOW }),
  }));

  const ctx = createContext(NOW.getTime());
  seedCoralTemplates(ctx);
  seedDepositsTemplates(ctx);
  seedCardStatementsTemplates(ctx);
  seedCoralAlerts(ctx);
  const seeded = ctx.sink.versions.map((version) => ({
    label: `${version.templateId} v${version.number ?? "draft"}`,
    body: version.body,
    channelFields: version.channelFields,
  }));

  it.each([...starters, ...seeded].map((source) => [source.label, source]))(
    "%s: body and fields pass the check and the schema",
    (_name, source) => {
      expect(bodyProblem(source.body)).toBeNull();
      expect(schemaAcceptsBody(source.body)).toBe(true);
      for (const field of ALL_CHANNEL_FIELDS) {
        const value = channelFieldValue(source.channelFields ?? {}, field);
        if (!value) continue;
        expect(fieldProblem(field, value), field.id).toBeNull();
        expect(schemaAcceptsField(field, value), field.id).toBe(true);
      }
    },
  );
});

describe("hand-written documents", () => {
  const cellOf = (...content: Node[]): Node => td(...content);
  const tableWith = (...content: Node[]): Node =>
    table(row(cellOf(...content)));
  const mark = (name: string, attrs?: Record<string, unknown>) => ({
    type: name,
    ...(attrs ? { attrs } : {}),
  });
  const textWith = (...marks: unknown[]): Node =>
    ({ type: "text", text: "x", marks }) as Node;
  const inDoc = (...content: unknown[]) =>
    ({ type: "doc", content }) as JSONContent;

  // [name, the document, whether the editor's schema allows it]
  const CASES: [string, unknown, boolean][] = [
    ["a paragraph", doc(para("Hello")), true],
    ["a paragraph with no content", doc(p()), true],
    ["no marks on the root", { ...doc(para("Hello")), marks: [] }, true],
    [
      "every mark, in any order",
      doc(
        p(
          textWith(
            mark("underline"),
            mark("link", { href: "https://a.example" }),
            mark("bold"),
            mark("italic"),
          ),
        ),
      ),
      true,
    ],
    ["a link with no attrs", doc(p(textWith(mark("link")))), true],
    [
      "a marked variable and a hard break",
      doc(p(v("name", bold, italic), br, t("x"))),
      true,
    ],
    ["levels 1 to 3", doc(h(1, t("a")), h(2, t("b")), h(3, t("c"))), true],
    ["a required section", doc(section(2, "legal_notices", t("Legal"))), true],
    [
      "a heading with no level",
      inDoc({ type: "heading", content: [t("a")] }),
      true,
    ],
    [
      "lists with styles",
      doc(
        ul(item("a", ul(item("b")))),
        ol({ start: 0, format: "upper-roman", delimiter: "parens" }, item("c")),
        ol({ start: 9999, format: null, delimiter: null }, item("d")),
      ),
      true,
    ],
    [
      "an unnamed numbering and TipTap's type",
      inDoc({
        type: "orderedList",
        attrs: { type: null, start: null },
        content: [li(para("a"))],
      }),
      true,
    ],
    [
      "blocks after a list item's paragraph",
      doc(
        ul(
          li(
            para("a"),
            h(2, t("b")),
            table(row(cell("c"))),
            callout(para("d")),
            rule,
            ul(item("e")),
          ),
        ),
      ),
      true,
    ],
    ["a callout and a rule", doc(callout(para("a"), para("b")), rule), true],
    [
      "a table with spans",
      doc(
        table(
          row(head("a"), span(head("b"), 2)),
          row(cell("c"), cell("d"), cell("e")),
        ),
      ),
      true,
    ],
    [
      "lists in a cell, nested",
      doc(tableWith(para("a"), ul(item("b", ol({}, item("c")))))),
      true,
    ],
    [
      "attributes nothing checks",
      inDoc(
        {
          type: "paragraph",
          attrs: { id: 7, unknown: true },
          content: [t("a")],
        },
        {
          type: "heading",
          attrs: { level: 2, requiredKey: 5 },
          content: [t("a")],
        },
        {
          type: "paragraph",
          content: [{ type: "variable", attrs: { key: 3 } }],
        },
      ),
      true,
    ],
    [
      "colwidth and align",
      inDoc(
        table(
          row({
            type: "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: [100], align: "left" },
            content: [p()],
          }),
        ),
      ),
      true,
    ],
    [
      "a node's own extra keys",
      inDoc({
        type: "paragraph",
        zzz: 1,
        content: [{ type: "text", text: "a", attrs: { x: 1 } }],
      }),
      true,
    ],

    ["an unknown node", inDoc({ type: "blockquote", content: [p()] }), false],
    ["an unknown mark", doc(p(textWith(mark("strike")))), false],
    ["a mark twice", doc(p(textWith(mark("bold"), mark("bold")))), false],
    [
      "two links",
      doc(
        p(
          textWith(
            mark("link", { href: "https://a.example" }),
            mark("link", { href: "https://b.example" }),
          ),
        ),
      ),
      false,
    ],
    ["an empty text node", doc(p(t(""))), false],
    ["a text node without text", inDoc(p({ type: "text" })), false],
    [
      "a text node with a number",
      inDoc({ type: "paragraph", content: [{ type: "text", text: 5 }] }),
      false,
    ],
    [
      "a mark on a block",
      inDoc({ type: "paragraph", marks: [mark("bold")] }),
      false,
    ],
    [
      "a mark of an unknown type on the root",
      { ...doc(para("a")), marks: [mark("nope")] },
      false,
    ],
    [
      "marks on the root that is a string",
      { ...doc(para("a")), marks: "bold" },
      false,
    ],
    ["an empty document", { type: "doc" }, false],
    ["a document with no blocks", inDoc(), false],
    ["a root that is not a doc", p(), false],
    ["text straight in the doc", inDoc(t("x")), false],
    ["a hard break in the doc", inDoc(br), false],
    ["a block in a paragraph", inDoc(p(p())), false],
    ["a node with no type", inDoc({}), false],
    ["a list item that starts with a rule", inDoc(ul(li(rule))), false],
    ["an empty list item", inDoc(ul({ type: "listItem" })), false],
    ["an empty list", inDoc({ type: "bulletList" }), false],
    ["a list with no list items", inDoc(ul(para("a"))), false],
    ["an empty callout", inDoc({ type: "callout" }), false],
    ["a heading in a callout", inDoc(callout(h(2, t("a")))), false],
    [
      "a rule with content",
      inDoc({ type: "horizontalRule", content: [p()] }),
      false,
    ],
    ["a table row in the doc", inDoc(row(cell("a"))), false],
    ["a table with no rows", inDoc({ type: "table" }), false],
    ["a cell with no content", inDoc(table(row({ type: "tableCell" }))), false],
    ["a paragraph in a row", inDoc(table(row(para("a")))), false],
    ["a table in a cell", doc(tableWith(table(row(cell("a"))))), false],
    ["a heading in a cell", doc(tableWith(h(2, t("a")))), false],
    ["a rule in a cell", doc(tableWith(rule)), false],
    ["a callout in a cell", doc(tableWith(callout(para("a")))), false],
    [
      "a heading in a list in a cell",
      doc(tableWith(ul(li(para("a"), h(2, t("b")))))),
      false,
    ],
    [
      "a table in a list in a cell",
      doc(tableWith(ol({}, li(para("a"), table(row(cell("b"))))))),
      false,
    ],
    [
      "a heading in a list in a list in a cell",
      doc(tableWith(ul(item("a", ul(li(para("b"), h(3, t("c")))))))),
      false,
    ],
    ...[0, 4, 9, null, "2", 2.5].map((level): [string, unknown, boolean] => [
      `a heading of level ${JSON.stringify(level)}`,
      inDoc({ type: "heading", attrs: { level }, content: [t("a")] }),
      false,
    ]),
    ...[-1, 10000, 1.5, "1", true].map((start): [string, unknown, boolean] => [
      `a list that starts at ${JSON.stringify(start)}`,
      inDoc({
        type: "orderedList",
        attrs: { start },
        content: [li(para("a"))],
      }),
      false,
    ]),
    [
      "an unknown numbering format",
      inDoc({
        type: "orderedList",
        attrs: { markerFormat: "greek" },
        content: [li(para("a"))],
      }),
      false,
    ],
    [
      "an unknown delimiter",
      inDoc({
        type: "orderedList",
        attrs: { markerDelimiter: "" },
        content: [li(para("a"))],
      }),
      false,
    ],
    ...[0, -1, 1.5, "2", true].map((colspan): [string, unknown, boolean] => [
      `a cell with colspan ${JSON.stringify(colspan)}`,
      inDoc(
        table(row({ type: "tableCell", attrs: { colspan }, content: [p()] })),
      ),
      false,
    ]),
    [
      "a cell with rowspan 0",
      inDoc(
        table(
          row({ type: "tableCell", attrs: { rowspan: 0 }, content: [p()] }),
        ),
      ),
      false,
    ],
  ];

  it.each(CASES)("%s", (_name, value, allowed) => {
    expect(bodyProblem(value) === null, "the check").toBe(allowed);
    expect(schemaAcceptsBody(value), "the schema").toBe(allowed);
    expect(disagreement(value)).toBeNull();
  });

  it.each([
    [
      "a table whose rows are different lengths",
      doc(table(row(cell("a"), cell("b")), row(cell("c")))),
      "tableShape",
    ],
    [
      "a cell that runs past the last column",
      doc(table(row(span(cell("a"), 2)), row(cell("b")))),
      "tableShape",
    ],
    [
      "a rowspan that runs past the last row",
      doc(table(row(span(cell("a"), 1, 3)))),
      "tableShape",
    ],
    [
      "a table 13 columns wide",
      doc(table(row(...Array.from({ length: 13 }, () => cell("a"))))),
      "tableColumns",
    ],
    ["lists ten deep", doc(nestedOrdered(10, "deep")), "listDepth"],
  ] as const)(
    "%s: refused by the check, left to code by the schema",
    (_name, value, problem) => {
      expect(bodyProblem(value)).toBe(problem);
      expect(schemaAcceptsBody(value)).toBe(true);
    },
  );

  it("lists nine deep and tables twelve wide pass both", () => {
    for (const value of [
      doc(nestedOrdered(9, "deep")),
      doc(table(row(...Array.from({ length: 12 }, () => cell("a"))))),
    ]) {
      expect(bodyProblem(value)).toBeNull();
      expect(schemaAcceptsBody(value)).toBe(true);
    }
  });

  // The header of document-json-schema.ts: stricter than ProseMirror's parse in shape only. The editor
  // never writes these (its round trip writes objects and arrays), so the schema pins them.
  it.each([
    ["attrs that is a string", inDoc({ type: "paragraph", attrs: "x" })],
    ["attrs that is null", inDoc({ type: "paragraph", attrs: null })],
    ["content that is null", inDoc({ type: "paragraph", content: null })],
    ["marks that is null", inDoc({ type: "paragraph", marks: null })],
    ["marks that is null on the root", { ...doc(para("a")), marks: null }],
    [
      "a known mark on the root",
      { ...doc(para("a")), marks: [{ type: "bold" }] },
    ],
  ])("%s: the check accepts it, the schema refuses it", (_name, value) => {
    expect(bodyProblem(value)).toBeNull();
    expect(schemaAcceptsBody(value)).toBe(false);
  });

  describe("channel fields", () => {
    const FIELD = (shape: ChannelField["shape"]) =>
      ALL_CHANNEL_FIELDS.find((f) => f.shape === shape)!;
    const plain = line(t("a "), v("name"), t(" b"));

    it.each([
      ["a line of text and variables", "line", plain, true],
      ["an empty paragraph", "line", line(), true],
      ["a push body", "paragraph", plain, true],
      [
        "an SMS message with line breaks",
        "lines",
        line(t("a"), br, v("x"), br, t("b")),
        true,
      ],
      ["a hard break in a line field", "line", line(t("a"), br, t("b")), false],
      [
        "a hard break in a paragraph field",
        "paragraph",
        line(t("a"), br, t("b")),
        false,
      ],
      ["a mark on text", "line", line(t("a", bold)), false],
      ["a mark on a variable", "lines", line(v("name", italic)), false],
      ["a link", "lines", line(link("a", "https://a.example")), false],
      [
        "two paragraphs",
        "line",
        { type: "doc", content: [p(t("a")), p(t("b"))] },
        false,
      ],
      ["no paragraph", "line", { type: "doc", content: [] }, false],
      ["a heading", "line", { type: "doc", content: [h(1, t("a"))] }, false],
      ["a list", "lines", { type: "doc", content: [ul(item("a"))] }, false],
      [
        "a mark on the paragraph",
        "line",
        { type: "doc", content: [{ ...p(t("a")), marks: [bold] }] },
        false,
      ],
      [
        "text with a mark in the middle",
        "lines",
        line(t("a"), t("b", underline), t("c")),
        false,
      ],
      ["an empty text node", "line", line(t("")), false],
    ] as [string, ChannelField["shape"], JSONContent, boolean][])(
      "%s",
      (_name, shape, value, allowed) => {
        const field = FIELD(shape);
        expect(fieldProblem(field, value) === null, "the check").toBe(allowed);
        expect(schemaAcceptsField(field, value), "the schema").toBe(allowed);
      },
    );
  });
});

// ── Random mutations of real documents ───────────────────────────────────────

describe("mutations of real documents", () => {
  // A small seeded generator, so a failure replays: mulberry32.
  function random(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NODE_TYPES = Object.keys(editorSchema().nodes).concat(["nope"]);
  const MARK_TYPES = Object.keys(editorSchema().marks).concat(["nope"]);
  const ATTRS = [
    "level",
    "start",
    "markerFormat",
    "markerDelimiter",
    "colspan",
    "rowspan",
    "id",
    "key",
  ];
  const VALUES: unknown[] = [
    null,
    0,
    1,
    2,
    3,
    4,
    12,
    9999,
    10000,
    -1,
    1.5,
    "x",
    "2",
    true,
    "decimal",
    "parens",
    "",
  ];

  const corpus: JSONContent[] = caseSlugs()
    .map((slug) => readInput(slug).body)
    .filter((body) => bodyProblem(body) === null);

  /** Every node (and text) in the document, as the array that holds it and its index. */
  function slots(
    root: JSONContent,
  ): { parent: JSONContent[]; index: number }[] {
    const found: { parent: JSONContent[]; index: number }[] = [];
    const visit = (node: JSONContent) => {
      node.content?.forEach((child, index) => {
        found.push({ parent: node.content!, index });
        visit(child);
      });
    };
    visit(root);
    return found;
  }

  function mutate(source: JSONContent, next: () => number): JSONContent {
    const copy = structuredClone(source);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)]!;
    const all = slots(copy);
    if (all.length === 0) return copy;
    const { parent, index } = pick(all);
    const node = parent[index]!;
    switch (Math.floor(next() * 8)) {
      case 0:
        node.type = pick(NODE_TYPES);
        break;
      case 1:
        parent.splice(index, 1);
        break;
      case 2:
        parent.splice(
          Math.floor(next() * (parent.length + 1)),
          0,
          structuredClone(pick(all).parent[0] ?? node),
        );
        break;
      case 3: {
        const other = Math.floor(next() * parent.length);
        [parent[index], parent[other]] = [parent[other]!, parent[index]!];
        break;
      }
      case 4:
        node.attrs = { ...node.attrs, [pick(ATTRS)]: pick(VALUES) };
        break;
      case 5:
        if (node.type === "text" || node.type === "variable")
          node.marks = [
            ...(node.marks ?? []),
            { type: pick(MARK_TYPES), attrs: { href: "https://a.example" } },
          ];
        else node.marks = [{ type: pick(MARK_TYPES) }];
        break;
      case 6:
        if (node.type === "text") node.text = pick(["", "a"]);
        else delete node.content;
        break;
      default:
        node.content = [];
    }
    return copy;
  }

  it("the schema and the check agree on 1,500 of them (seed 1)", () => {
    const next = random(1);
    const failures: string[] = [];
    const verdicts = { accepted: 0, refused: 0 };
    for (let n = 0; n < 1500; n++) {
      const source = corpus[Math.floor(next() * corpus.length)]!;
      const mutated = mutate(source, next);
      // Two mutations in a row reach documents one change can't.
      const value = n % 2 === 0 ? mutate(mutated, next) : mutated;
      const problem = disagreement(value);
      if (problem) failures.push(problem);
      if (bodyProblem(value) === null) verdicts.accepted++;
      else verdicts.refused++;
    }
    expect(failures.slice(0, 3)).toEqual([]);
    // The mutations reach both verdicts often, so agreement is not just two validators saying yes.
    expect(verdicts.accepted).toBeGreaterThan(200);
    expect(verdicts.refused).toBeGreaterThan(200);
  }, 30_000);
});

// ── The generator ────────────────────────────────────────────────────────────

describe("the generator", () => {
  const schemaOf = (
    nodes: Record<string, object>,
    marks: Record<string, object> = {},
  ) =>
    new Schema({
      nodes: {
        doc: { content: "block+" },
        text: { group: "inline" },
        variable: { group: "inline", inline: true, atom: true },
        hardBreak: { group: "inline", inline: true },
        ...nodes,
      },
      marks,
    });
  const paragraph = { content: "inline*", group: "block" };

  it("states the editor's own schema", () => {
    expect(documentJsonSchema(schemaOf({ paragraph }))).toMatchObject({
      type: "object",
      required: ["type", "content"],
      properties: {
        type: { const: "doc" },
        content: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/paragraph" },
        },
      },
    });
  });

  it("has no rule for an attribute the editor's schema no longer has", () => {
    const owners = [
      ...Object.values(editorSchema().nodes),
      ...Object.values(editorSchema().marks),
    ];
    const attributes = owners.flatMap((owner) =>
      Object.keys(owner.spec.attrs ?? {}).map((name) => [owner.name, name]),
    );
    const stale = Object.keys(ATTRIBUTE_RULES).filter(
      (rule) =>
        !attributes.some(
          ([owner, name]) => rule === `${owner}.${name}` || rule === name,
        ),
    );
    expect(stale).toEqual([]);
  });

  it("refuses an attribute it has no rule for", () => {
    expect(() =>
      documentJsonSchema(
        schemaOf({
          paragraph: { ...paragraph, attrs: { surprise: { default: null } } },
        }),
      ),
    ).toThrow(/No JSON Schema rule for the attribute paragraph\.surprise/);
  });

  it("refuses a content expression it can't state", () => {
    expect(() =>
      documentJsonSchema(
        schemaOf({
          paragraph,
          pair: { content: "(paragraph paragraph)+", group: "block" },
        }),
      ),
    ).toThrow(/can't be stated in JSON Schema/);
  });

  it("refuses a mark that excludes others", () => {
    expect(() =>
      documentJsonSchema(schemaOf({ paragraph }, { code: { excludes: "_" } })),
    ).toThrow(/sets `excludes`/);
  });

  it("refuses parents that allow different marks on the same node", () => {
    expect(() =>
      documentJsonSchema(
        schemaOf(
          {
            paragraph,
            plain: { content: "inline*", group: "block", marks: "" },
          },
          { bold: {} },
        ),
      ),
    ).toThrow(/allow different marks/);
  });
});

// ── 3. The spec ──────────────────────────────────────────────────────────────

describe("docs/render-spec.md section 2", () => {
  const spec = readFileSync(SPEC_FILE, "utf8");

  it.each([...SCHEMA_GAPS])(
    "lists the rule the schema leaves to code: %s",
    (gap) => {
      expect(spec).toContain(gap);
    },
  );

  it("names the schema file and says block ids are UUID v4", () => {
    expect(spec).toContain("docs/reference/document.schema.json");
    expect(spec).toMatch(/block ids? (?:is|are) UUID v4/i);
  });

  it("the schema's own description lists the same rules", () => {
    for (const gap of SCHEMA_GAPS)
      expect((generated as JsonSchema).description).toContain(gap);
  });
});
