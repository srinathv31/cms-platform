import { describe, expect, it } from "vitest";
import type { JSONContent, Variable, VariableType } from "../types";
import { ResolveError, resolveDocument, resolveInlineField, safeHref } from "./resolve";
import type { CanonicalValues, ResolveContext } from "./types";

// ── Builders ─────────────────────────────────────────────────────────────────

type Mark = { type: string; attrs?: Record<string, unknown> };
const text = (value: string, ...marks: Mark[]): JSONContent => (marks.length ? { type: "text", text: value, marks } : { type: "text", text: value });
const chip = (key: string, ...marks: Mark[]): JSONContent => (marks.length ? { type: "variable", attrs: { key }, marks } : { type: "variable", attrs: { key } });
const br: JSONContent = { type: "hardBreak" };
const bold: Mark = { type: "bold" };
const italic: Mark = { type: "italic" };
const underline: Mark = { type: "underline" };
const link = (href: string): Mark => ({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", class: null } });
const p = (id: string | null, ...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  ...(id ? { attrs: { id } } : {}),
  ...(content.length ? { content } : {}),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

const v = (key: string, type: VariableType, required = true): Variable => ({ key, label: key, type, required, sample: "" });

const VARIABLES: Variable[] = [
  v("first_name", "text"),
  v("annual_fee", "currency"),
  v("purchase_apr", "percent"),
  v("offer_end_date", "date"),
  v("bonus_points", "number"),
  v("home_state", "us_state"),
  v("promo_code", "text", false),
];

const VALUES: CanonicalValues = {
  first_name: "Maya",
  annual_fee: "1000",
  purchase_apr: "21.99",
  offer_end_date: "2027-03-04",
  bonus_points: "20000",
  home_state: "NJ",
};

const CTX: ResolveContext = { variables: VARIABLES, values: VALUES };

/** The inline content of a paragraph (followed by another, so an empty one isn't a trailing line). */
function inline(...content: JSONContent[]) {
  const [block] = resolveDocument(doc(p("p1", ...content), p("end", text("."))), CTX);
  if (block?.type !== "paragraph") throw new Error("expected a paragraph");
  return block.content;
}

// ── Variables ────────────────────────────────────────────────────────────────

describe("variables", () => {
  it.each([
    ["first_name", "Maya"],
    ["annual_fee", "$1,000"],
    ["purchase_apr", "21.99%"],
    ["offer_end_date", "March 4, 2027"],
    ["bonus_points", "20,000"],
    ["home_state", "New Jersey"],
  ])("%s renders as %s", (key, formatted) => {
    expect(inline(chip(key))).toEqual([{ type: "text", text: formatted, variable: key }]);
  });

  it("keeps the chip's marks", () => {
    expect(inline(chip("purchase_apr", bold, italic))).toEqual([
      { type: "text", text: "21.99%", bold: true, italic: true, variable: "purchase_apr" },
    ]);
  });

  it("renders nothing for an optional variable without a value", () => {
    expect(inline(text("Code: "), chip("promo_code"), text("."))).toEqual([
      { type: "text", text: "Code: ." },
    ]);
  });

  it("renders nothing for a key that isn't in the list (an unknown chip)", () => {
    expect(inline(text("Hi "), chip("nickname"), text("!"))).toEqual([{ type: "text", text: "Hi !" }]);
  });

  it("renders nothing for a chip without a key", () => {
    expect(inline({ type: "variable", attrs: { key: null } })).toEqual([]);
    expect(inline({ type: "variable" })).toEqual([]);
  });

  it("ignores values whose key isn't in the list", () => {
    const ctx = { variables: [], values: { first_name: "Maya" } };
    expect(resolveDocument(doc(p("p1", chip("first_name")), p("p2", text("."))), ctx)[0]).toEqual({
      type: "paragraph",
      id: "p1",
      content: [],
    });
  });

  it("never merges a variable's run with the text around it", () => {
    expect(inline(text("Hi "), chip("first_name"), text(", welcome."))).toEqual([
      { type: "text", text: "Hi " },
      { type: "text", text: "Maya", variable: "first_name" },
      { type: "text", text: ", welcome." },
    ]);
  });

  it("keeps two adjacent chips apart", () => {
    expect(inline(chip("first_name"), chip("home_state"))).toEqual([
      { type: "text", text: "Maya", variable: "first_name" },
      { type: "text", text: "New Jersey", variable: "home_state" },
    ]);
  });

  it("turns a line break inside a text value into a space, and trims it", () => {
    const ctx = { variables: VARIABLES, values: { ...VALUES, first_name: "  Maya\nChen  " } };
    const [block] = resolveDocument(doc(p("p1", chip("first_name"))), ctx);
    expect(block).toEqual({ type: "paragraph", id: "p1", content: [{ type: "text", text: "Maya Chen", variable: "first_name" }] });
  });
});

// ── Text and marks ───────────────────────────────────────────────────────────

describe("text and marks", () => {
  it("maps bold, italic and underline", () => {
    expect(inline(text("a", bold), text("b", italic), text("c", underline))).toEqual([
      { type: "text", text: "a", bold: true },
      { type: "text", text: "b", italic: true },
      { type: "text", text: "c", underline: true },
    ]);
  });

  it("merges adjacent runs with identical marks, in any mark order", () => {
    expect(inline(text("Hello ", bold, italic), text("world", italic, bold), text("!"))).toEqual([
      { type: "text", text: "Hello world", bold: true, italic: true },
      { type: "text", text: "!" },
    ]);
  });

  it("doesn't merge runs whose marks differ", () => {
    expect(inline(text("a", bold), text("b", bold, underline))).toHaveLength(2);
    expect(inline(text("a", link("https://a.example")), text("b", link("https://b.example")))).toHaveLength(2);
  });

  it("merges runs with the same link", () => {
    expect(inline(text("Coral ", link("https://coral.example")), text("Bank", link("https://coral.example")))).toEqual([
      { type: "text", text: "Coral Bank", href: "https://coral.example" },
    ]);
  });

  it("turns a hard break into a break", () => {
    expect(inline(text("Line one"), br, text("Line two"))).toEqual([
      { type: "text", text: "Line one" },
      { type: "break" },
      { type: "text", text: "Line two" },
    ]);
  });

  it("never merges across a break", () => {
    expect(inline(text("a"), br, text("b"))).toHaveLength(3);
  });

  it("turns a newline in the JSON's text into a break", () => {
    expect(inline(text("one\ntwo\r\nthree", bold))).toEqual([
      { type: "text", text: "one", bold: true },
      { type: "break" },
      { type: "text", text: "two", bold: true },
      { type: "break" },
      { type: "text", text: "three", bold: true },
    ]);
  });

  it("skips empty text", () => {
    expect(inline(text(""), text("a"))).toEqual([{ type: "text", text: "a" }]);
  });
});

describe("links", () => {
  it.each([
    "https://coral.example/terms",
    "http://coral.example",
    "HTTPS://CORAL.EXAMPLE",
    "mailto:help@coral.example",
    "tel:+18005550100",
  ])("keeps %s", (href) => {
    expect(inline(text("here", link(href)))).toEqual([{ type: "text", text: "here", href }]);
  });

  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:x",
    "/relative/path",
    "coral.example",
    "ftp://coral.example",
    "https://coral.example/\u0000x",
    "",
  ])("drops %j and keeps the text", (href) => {
    expect(inline(text("here", link(href)))).toEqual([{ type: "text", text: "here" }]);
  });

  it("trims whitespace around a safe href", () => {
    expect(safeHref("  https://coral.example  ")).toBe("https://coral.example");
    expect(safeHref(null)).toBeNull();
    expect(safeHref(42)).toBeNull();
  });

  it("links a chip inside a link", () => {
    expect(inline(chip("first_name", link("https://coral.example")))).toEqual([
      { type: "text", text: "Maya", href: "https://coral.example", variable: "first_name" },
    ]);
  });

  it("drops an unsafe link but keeps the other marks", () => {
    expect(inline(text("x", bold, link("javascript:void(0)")))).toEqual([{ type: "text", text: "x", bold: true }]);
  });
});

// ── Blocks ───────────────────────────────────────────────────────────────────

describe("blocks", () => {
  it("resolves headings with their level and required section", () => {
    const body = doc(
      { type: "heading", attrs: { id: "h1", level: 2, requiredKey: "legal_notices" }, content: [text("Legal notices")] },
      { type: "heading", attrs: { id: "h2", level: 3, requiredKey: null }, content: [text("Details")] },
      { type: "heading", attrs: { id: "h3", level: 1 }, content: [text("Title")] },
    );
    expect(resolveDocument(body, CTX)).toEqual([
      { type: "heading", id: "h1", level: 2, section: "legal_notices", content: [{ type: "text", text: "Legal notices" }] },
      { type: "heading", id: "h2", level: 3, section: null, content: [{ type: "text", text: "Details" }] },
      { type: "heading", id: "h3", level: 1, section: null, content: [{ type: "text", text: "Title" }] },
    ]);
  });

  it("clamps an out-of-range heading level", () => {
    const [h4, missing] = resolveDocument(
      doc({ type: "heading", attrs: { level: 4 }, content: [text("a")] }, { type: "heading", content: [text("b")] }),
      CTX,
    );
    expect(h4).toMatchObject({ level: 3 });
    expect(missing).toMatchObject({ level: 1 });
  });

  it("uses attrs.id, or null without one", () => {
    expect(resolveDocument(doc(p(null, text("a")), p("p2", text("b"))), CTX).map((b) => b.id)).toEqual([null, "p2"]);
    expect(resolveDocument(doc({ type: "paragraph", attrs: { id: "" }, content: [text("a")] }), CTX)[0]!.id).toBeNull();
  });

  it("resolves bulleted lists, with nested lists inside items", () => {
    const body = doc({
      type: "bulletList",
      attrs: { id: "l1" },
      content: [
        { type: "listItem", attrs: { id: "li1" }, content: [p("a", text("One"))] },
        {
          type: "listItem",
          content: [
            p("b", text("Two")),
            { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p("c", chip("first_name"))] }] },
          ],
        },
      ],
    });
    expect(resolveDocument(body, CTX)).toEqual([
      {
        type: "list",
        id: "l1",
        ordered: false,
        start: 1,
        items: [
          { content: [{ type: "paragraph", id: "a", content: [{ type: "text", text: "One" }] }] },
          {
            content: [
              { type: "paragraph", id: "b", content: [{ type: "text", text: "Two" }] },
              {
                type: "list",
                id: null,
                ordered: true,
                start: 1,
                items: [{ content: [{ type: "paragraph", id: "c", content: [{ type: "text", text: "Maya", variable: "first_name" }] }] }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("keeps an ordered list's start, defaulting to 1", () => {
    const item = { type: "listItem", content: [p(null, text("x"))] };
    const [started, plain, bad] = resolveDocument(
      doc(
        { type: "orderedList", attrs: { id: "o1", start: 4 }, content: [item] },
        { type: "orderedList", content: [item] },
        { type: "orderedList", attrs: { start: "x" }, content: [item] },
      ),
      CTX,
    );
    expect(started).toMatchObject({ type: "list", ordered: true, start: 4 });
    expect(plain).toMatchObject({ ordered: true, start: 1 });
    expect(bad).toMatchObject({ start: 1 });
  });

  it("resolves tables: header cells, spans (defaulting to 1) and blocks in cells", () => {
    const cell = (type: "tableHeader" | "tableCell", content: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({
      type,
      ...(attrs ? { attrs } : {}),
      content,
    });
    const body = doc({
      type: "table",
      attrs: { id: "t1" },
      content: [
        {
          type: "tableRow",
          content: [
            cell("tableHeader", [p("h1", text("Fee"))], { colspan: 1, rowspan: 1, colwidth: null }),
            cell("tableHeader", [p("h2", text("Amount"))]),
          ],
        },
        { type: "tableRow", content: [cell("tableCell", [p("c1", text("Annual fee"))], { colspan: 2, rowspan: 1 })] },
        {
          type: "tableRow",
          content: [
            cell("tableCell", [p("c2", text("APR"))], { rowspan: 2, colspan: 0 }),
            cell("tableCell", [p("c3", chip("purchase_apr")), { type: "bulletList", content: [{ type: "listItem", content: [p(null, text("Variable"))] }] }]),
          ],
        },
      ],
    });
    expect(resolveDocument(body, CTX)).toEqual([
      {
        type: "table",
        id: "t1",
        rows: [
          {
            cells: [
              { header: true, colspan: 1, rowspan: 1, content: [{ type: "paragraph", id: "h1", content: [{ type: "text", text: "Fee" }] }] },
              { header: true, colspan: 1, rowspan: 1, content: [{ type: "paragraph", id: "h2", content: [{ type: "text", text: "Amount" }] }] },
            ],
          },
          {
            cells: [
              { header: false, colspan: 2, rowspan: 1, content: [{ type: "paragraph", id: "c1", content: [{ type: "text", text: "Annual fee" }] }] },
            ],
          },
          {
            cells: [
              { header: false, colspan: 1, rowspan: 2, content: [{ type: "paragraph", id: "c2", content: [{ type: "text", text: "APR" }] }] },
              {
                header: false,
                colspan: 1,
                rowspan: 1,
                content: [
                  { type: "paragraph", id: "c3", content: [{ type: "text", text: "21.99%", variable: "purchase_apr" }] },
                  {
                    type: "list",
                    id: null,
                    ordered: false,
                    start: 1,
                    items: [{ content: [{ type: "paragraph", id: null, content: [{ type: "text", text: "Variable" }] }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("resolves callouts and rules", () => {
    const body = doc(
      { type: "callout", attrs: { id: "co" }, content: [p("x", text("State terms for ")), p("y", chip("home_state"))] },
      { type: "horizontalRule", attrs: { id: "hr" } },
      p("z", text("End")),
    );
    expect(resolveDocument(body, CTX)).toEqual([
      {
        type: "callout",
        id: "co",
        content: [
          { type: "paragraph", id: "x", content: [{ type: "text", text: "State terms for " }] },
          { type: "paragraph", id: "y", content: [{ type: "text", text: "New Jersey", variable: "home_state" }] },
        ],
      },
      { type: "rule", id: "hr" },
      { type: "paragraph", id: "z", content: [{ type: "text", text: "End" }] },
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(resolveDocument({ type: "doc" }, CTX)).toEqual([]);
    expect(resolveDocument(doc(), CTX)).toEqual([]);
  });
});

describe("trailing lines", () => {
  it("drops the editor's trailing empty paragraphs", () => {
    const body = doc(p("a", text("Body")), p("t1"), p("t2", { type: "text", text: "" }));
    expect(resolveDocument(body, CTX).map((b) => b.id)).toEqual(["a"]);
  });

  it("keeps empty paragraphs inside the document", () => {
    const body = doc(p("a", text("One")), p("gap"), p("b", text("Two")), p("trail"));
    expect(resolveDocument(body, CTX)).toEqual([
      { type: "paragraph", id: "a", content: [{ type: "text", text: "One" }] },
      { type: "paragraph", id: "gap", content: [] },
      { type: "paragraph", id: "b", content: [{ type: "text", text: "Two" }] },
    ]);
  });

  it("drops a last line that only held an unfilled optional chip", () => {
    expect(resolveDocument(doc(p("a", text("One")), p("b", chip("promo_code"))), CTX).map((b) => b.id)).toEqual(["a"]);
  });

  it("keeps a last line that holds only a break, and trailing empty lines inside a callout", () => {
    expect(resolveDocument(doc(p("a", br)), CTX)).toEqual([{ type: "paragraph", id: "a", content: [{ type: "break" }] }]);
    const [callout] = resolveDocument(doc({ type: "callout", content: [p("x", text("a")), p("y")] }), CTX);
    expect(callout).toMatchObject({ type: "callout", content: [{ id: "x" }, { id: "y", content: [] }] });
  });

  it("returns nothing for a document that is only a trailing line", () => {
    expect(resolveDocument(doc(p("t")), CTX)).toEqual([]);
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────

describe("JSON the resolver doesn't know", () => {
  it("throws on an unknown block node", () => {
    expect(() => resolveDocument(doc({ type: "blockquote", content: [p(null, text("x"))] }), CTX)).toThrow(ResolveError);
    expect(() => resolveDocument(doc({ type: "blockquote" }), CTX)).toThrow('Unknown node "blockquote".');
  });

  it("throws on an unknown inline node", () => {
    expect(() => inline({ type: "mention", attrs: { id: "x" } })).toThrow('Unknown node "mention".');
    expect(() => inline({ type: "image" })).toThrow(ResolveError);
  });

  it("throws on an unknown mark", () => {
    expect(() => inline(text("x", { type: "strike" }))).toThrow('Unknown mark "strike".');
    expect(() => inline(chip("first_name", { type: "code" }))).toThrow('Unknown mark "code".');
  });

  it("throws on a known node in the wrong place", () => {
    expect(() => resolveDocument(doc(text("loose")), CTX)).toThrow('A "text" node can\'t appear where a block belongs.');
    expect(() => inline(p(null, text("x")))).toThrow('A "paragraph" node can\'t appear where inline content belongs.');
    expect(() => resolveDocument(doc({ type: "bulletList", content: [p(null, text("x"))] }), CTX)).toThrow(ResolveError);
    expect(() => resolveDocument(doc({ type: "table", content: [p(null)] }), CTX)).toThrow(ResolveError);
    expect(() => resolveDocument(doc({ type: "table", content: [{ type: "tableRow", content: [p(null)] }] }), CTX)).toThrow(
      ResolveError,
    );
  });

  it("throws when the body isn't a doc", () => {
    expect(() => resolveDocument(p("a", text("x")), CTX)).toThrow('Expected a "doc" node, got "paragraph".');
  });
});

// ── One-line fields ──────────────────────────────────────────────────────────

describe("resolveInlineField", () => {
  const field = (...content: JSONContent[]) => doc(p(null, ...content));

  it("gives the plain text with variables resolved", () => {
    expect(resolveInlineField(field(text("Your purchase APR is changing on "), chip("offer_end_date")), CTX)).toBe(
      "Your purchase APR is changing on March 4, 2027",
    );
  });

  it("collapses whitespace left by empty chips, and trims", () => {
    expect(resolveInlineField(field(text("  Hi "), chip("promo_code"), text("  there, "), chip("first_name"), text(" ")), CTX)).toBe(
      "Hi there, Maya",
    );
  });

  it("reads marks and breaks without keeping them", () => {
    expect(resolveInlineField(field(text("Hi", bold), br, text("there", link("https://x.example"))), CTX)).toBe("Hi there");
  });

  it("gives an empty string for null, an empty field, or only an empty chip", () => {
    expect(resolveInlineField(null, CTX)).toBe("");
    expect(resolveInlineField(doc(p(null)), CTX)).toBe("");
    expect(resolveInlineField(field(chip("promo_code")), CTX)).toBe("");
  });

  it("accepts a bare paragraph and joins several paragraphs with a space", () => {
    expect(resolveInlineField(p(null, text("Hi "), chip("first_name")), CTX)).toBe("Hi Maya");
    expect(resolveInlineField(doc(p(null, text("One")), p(null, text("Two"))), CTX)).toBe("One Two");
  });

  it("throws on JSON it doesn't know", () => {
    expect(() => resolveInlineField(field({ type: "emoji" }), CTX)).toThrow(ResolveError);
  });
});
