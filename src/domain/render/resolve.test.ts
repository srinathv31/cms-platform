import { describe, expect, it } from "vitest";
import { DOCUMENT_MESSAGES } from "@/editor/model/document-check";
import { formatMarker } from "@/editor/model/list-markers";
import { INVISIBLE_CHARACTERS, normalizeLink } from "@/editor/model/links";
import type { JSONContent, Variable, VariableType } from "../types";
import { ResolveError, resolveDocument, resolveInlineField } from "./resolve";
import type { CanonicalValues, RenderBlock, RenderInline, RenderList, ResolveContext } from "./types";

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
const h = (level: unknown, ...content: JSONContent[]): JSONContent => ({ type: "heading", attrs: { level }, ...(content.length ? { content } : {}) });
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const ul = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const ol = (attrs: Record<string, unknown>, ...items: JSONContent[]): JSONContent => ({ type: "orderedList", attrs, content: items });
const cell = (content: JSONContent[], attrs?: Record<string, unknown>, type: "tableCell" | "tableHeader" = "tableCell"): JSONContent => ({
  type,
  ...(attrs ? { attrs } : {}),
  content,
});
const td = (value: string, attrs?: Record<string, unknown>) => cell([p(null, text(value))], attrs);
const tr = (...cells: JSONContent[]): JSONContent => ({ type: "tableRow", content: cells });
const table = (...rows: JSONContent[]): JSONContent => ({ type: "table", content: rows });
const callout = (...content: JSONContent[]): JSONContent => ({ type: "callout", content });
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
  v("promo_note", "text", false),
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
const withValues = (values: CanonicalValues): ResolveContext => ({ variables: VARIABLES, values: { ...VALUES, ...values } });

const resolve = (...content: JSONContent[]) => resolveDocument(doc(...content), CTX);

/** The inline content of a paragraph (followed by another, so an empty one isn't a trailing line). */
function inline(...content: JSONContent[]): RenderInline[] {
  const [block] = resolveDocument(doc(p("p1", ...content), p("end", text("."))), CTX);
  if (block?.type !== "paragraph" || block.id !== "p1") throw new Error("expected paragraph p1");
  return block.content;
}

/** The markers of every list in the document, outermost first, as "marker marker | marker". */
function markers(blocks: readonly RenderBlock[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly RenderBlock[]) => {
    for (const b of list) {
      if (b.type === "list") {
        out.push(b.items.map((item) => item.marker).join(" "));
        b.items.forEach((item) => walk(item.content));
      } else if (b.type === "table") {
        b.rows.forEach((row) => row.cells.forEach((c) => walk(c.content)));
      }
    }
  };
  walk(blocks);
  return out;
}

/** A list nested `kinds.length` deep: each level one item holding a paragraph and the next level. */
function nested(kinds: readonly ("ol" | "ul")[], depth = 0): JSONContent {
  const kids = depth + 1 < kinds.length ? [nested(kinds, depth + 1)] : [];
  const item = li(p(null, text(`level ${depth + 1}`)), ...kids);
  return kinds[depth] === "ol" ? ol({}, item) : ul(item);
}

const expectRefusal = (fn: () => unknown, message: string) => {
  expect(fn).toThrow(ResolveError);
  expect(fn).toThrow(message);
};

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

  it("renders nothing for an optional variable without a value, and the text around it stays", () => {
    expect(inline(text("Code: "), chip("promo_code"), text("."))).toEqual([{ type: "text", text: "Code: ." }]);
  });

  it("renders nothing for a key that isn't in the list (an unknown chip)", () => {
    expect(inline(text("Hi "), chip("nickname"), text("!"))).toEqual([{ type: "text", text: "Hi !" }]);
  });

  it("renders nothing for a chip without a key", () => {
    expect(inline(text("a"), { type: "variable", attrs: { key: null } }, { type: "variable" })).toEqual([{ type: "text", text: "a" }]);
  });

  it("ignores values whose key isn't in the list", () => {
    const ctx = { variables: [], values: { first_name: "Maya" } };
    expect(resolveDocument(doc(p("p1", text("Hi "), chip("first_name")), p("p2", text("."))), ctx)[0]).toEqual({
      type: "paragraph",
      id: "p1",
      content: [{ type: "text", text: "Hi " }],
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

  it("shows a text value on one line: formatValue turns its line breaks into spaces and trims it", () => {
    const [block] = resolveDocument(doc(p("p1", chip("first_name"))), withValues({ first_name: "  Maya\nChen  " }));
    expect(block).toEqual({ type: "paragraph", id: "p1", content: [{ type: "text", text: "Maya Chen", variable: "first_name" }] });
  });

  it("turns a U+2028 or U+2029 left in a value into a space, and a tab into a space", () => {
    const [block] = resolveDocument(doc(p("p1", chip("first_name"))), withValues({ first_name: "Maya\u2028Chen\u2029Jr\tII" }));
    expect(block).toMatchObject({ content: [{ text: "Maya Chen Jr II" }] });
  });

  it("removes zero-width and control characters from a value, and NFC-normalizes it", () => {
    const [block] = resolveDocument(doc(p("p1", chip("first_name"))), withValues({ first_name: "Ze\u200Bo\u0301e\u0007" }));
    expect(block).toMatchObject({ content: [{ text: "Zeóe" }] });
  });

  it("counts a value whose display text is empty after the character rules as no value", () => {
    const ctx = withValues({ promo_code: "\u200B\u200D\uFEFF" });
    expect(resolveDocument(doc(p("a", text("x")), p("b", chip("promo_code")), p("c", text("y"))), ctx).map((b) => b.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("keeps the spaces inside a value exactly", () => {
    const [block] = resolveDocument(doc(p("p1", chip("first_name"))), withValues({ first_name: "Maya   Chen" }));
    expect(block).toMatchObject({ content: [{ text: "Maya   Chen" }] });
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

  it("skips empty text", () => {
    expect(inline(text(""), text("a"))).toEqual([{ type: "text", text: "a" }]);
  });
});

describe("spaces", () => {
  it.each([
    ["leading spaces", "   Lead"],
    ["trailing spaces", "Trail   "],
    ["a run of spaces", "A   B"],
    ["no-break spaces", "NB\u00A0\u00A0\u00A0Z"],
    ["other Unicode spaces", "a\u2003b\u3000c\u202Fd"],
    ["only spaces", "   "],
  ])("keeps %s exactly as typed", (_, typed) => {
    expect(inline(text(typed))).toEqual([{ type: "text", text: typed }]);
  });

  it("keeps spaces across runs and after a break", () => {
    expect(inline(text("  a  ", bold), text("  b"), br, text("    indented"))).toEqual([
      { type: "text", text: "  a  ", bold: true },
      { type: "text", text: "  b" },
      { type: "break" },
      { type: "text", text: "    indented" },
    ]);
  });

  it("turns a tab into one space", () => {
    expect(inline(text("Tab\tX\t\tY"))).toEqual([{ type: "text", text: "Tab X  Y" }]);
  });
});

describe("characters", () => {
  it.each([
    ["U+200B zero width space", "\u200B"],
    ["U+200C zero width non-joiner", "\u200C"],
    ["U+200D zero width joiner", "\u200D"],
    ["U+2060 word joiner", "\u2060"],
    ["U+FEFF byte order mark", "\uFEFF"],
    ["U+00AD soft hyphen", "\u00AD"],
    ["U+034F combining grapheme joiner", "\u034F"],
    ["U+061C Arabic letter mark", "\u061C"],
    ["U+180E Mongolian vowel separator", "\u180E"],
    ["U+200E left-to-right mark", "\u200E"],
    ["U+200F right-to-left mark", "\u200F"],
    ["U+202A left-to-right embedding", "\u202A"],
    ["U+202E right-to-left override", "\u202E"],
    ["U+2066 left-to-right isolate", "\u2066"],
    ["U+2069 pop directional isolate", "\u2069"],
    ["U+FE0F variation selector-16", "\uFE0F"],
    ["U+E0001 language tag", "\u{E0001}"],
  ])("removes %s (invisible in the editor)", (_, ch) => {
    expect(inline(text(`ZW${ch}space${ch}`))).toEqual([{ type: "text", text: "ZWspace" }]);
  });

  it.each([
    ["U+0000", "\u0000"],
    ["U+0008", "\u0008"],
    ["U+000B", "\u000B"],
    ["U+000C", "\u000C"],
    ["U+000E", "\u000E"],
    ["U+001F", "\u001F"],
    ["U+007F", "\u007F"],
    ["U+0085", "\u0085"],
    ["U+009F", "\u009F"],
  ])("removes the control character %s", (_, ch) => {
    expect(inline(text(`a${ch}b`))).toEqual([{ type: "text", text: "ab" }]);
  });

  it("keeps every other character, such as emoji and right-to-left text", () => {
    const typed = "Plain 😀👍🏽🇺🇸 שלום «§©» \u00A0\u2003\u202F\u3000";
    expect(inline(text(typed))).toEqual([{ type: "text", text: typed }]);
  });

  it("NFC-normalizes text", () => {
    expect(inline(text("Cafe\u0301 A\u030A"))).toEqual([{ type: "text", text: "Café Å" }]);
  });

  it("NFC-normalizes after merging, so a combining mark in the next run composes", () => {
    expect(inline(text("e"), text("\u0301"))).toEqual([{ type: "text", text: "é" }]);
  });

  it("normalizes each run on its own when the marks differ", () => {
    expect(inline(text("e", bold), text("\u0301"))).toEqual([
      { type: "text", text: "e", bold: true },
      { type: "text", text: "\u0301" },
    ]);
  });

  it("drops a run left empty by the character rules, so the runs around it merge", () => {
    expect(inline(text("a", bold), text("\u200B"), text("b", bold))).toEqual([{ type: "text", text: "ab", bold: true }]);
  });
});

describe("breaks", () => {
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

  it("turns each line break character in the JSON's text into a break (CR LF once)", () => {
    expect(inline(text("one\ntwo\r\nthree\rfour\u2028five\u2029six", bold))).toEqual([
      { type: "text", text: "one", bold: true },
      { type: "break" },
      { type: "text", text: "two", bold: true },
      { type: "break" },
      { type: "text", text: "three", bold: true },
      { type: "break" },
      { type: "text", text: "four", bold: true },
      { type: "break" },
      { type: "text", text: "five", bold: true },
      { type: "break" },
      { type: "text", text: "six", bold: true },
    ]);
  });

  it("keeps breaks at the start of a paragraph", () => {
    expect(inline(br, br, text("x"))).toEqual([{ type: "break" }, { type: "break" }, { type: "text", text: "x" }]);
  });

  it("keeps every break at the end of a paragraph: each ends a line the editor shows", () => {
    expect(inline(text("x"), br)).toEqual([{ type: "text", text: "x" }, { type: "break" }]);
    expect(inline(text("x"), br, br, text("\n"))).toEqual([{ type: "text", text: "x" }, { type: "break" }, { type: "break" }, { type: "break" }]);
  });

  it("keeps a break that an empty variable leaves at the end", () => {
    expect(inline(text("x"), br, chip("promo_code"))).toEqual([{ type: "text", text: "x" }, { type: "break" }]);
  });

  it("keeps the breaks at the end of a heading", () => {
    expect(resolve(h(2, text("Title"), br, br))).toEqual([
      { type: "heading", id: null, level: 2, section: null, content: [{ type: "text", text: "Title" }, { type: "break" }, { type: "break" }] },
    ]);
  });

  it("keeps a paragraph of only breaks as it is: n breaks, n + 1 blank lines", () => {
    expect(resolve(p("a", text("A")), p("gap", br, br), p("b", text("B")))[1]).toEqual({
      type: "paragraph",
      id: "gap",
      content: [{ type: "break" }, { type: "break" }],
    });
  });
});

// ── Links ────────────────────────────────────────────────────────────────────

describe("links", () => {
  it.each([
    "https://coral.example/terms",
    "http://coral.example",
    "mailto:help@coral.example",
    "mailto:help@coral.example?subject=Card%20terms",
    "tel:+18005550100",
  ])("keeps %s", (href) => {
    expect(inline(text("here", link(href)))).toEqual([{ type: "text", text: "here", href }]);
  });

  it.each([
    ["  https://coral.example  ", "https://coral.example"],
    ["HTTPS://Coral.Example/Terms", "https://Coral.Example/Terms"],
    ["https://coral.example/café", "https://coral.example/caf%C3%A9"],
  ])("normalizes %j to %j (the one link rule)", (href, normalized) => {
    expect(inline(text("here", link(href)))).toEqual([{ type: "text", text: "here", href: normalized }]);
    expect(normalizeLink(href)).toBe(normalized);
  });

  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:x",
    "/relative/path",
    "#section",
    "coral.example",
    "ftp://coral.example",
    "sms:+15551234",
    "https://coral.example/card terms",
    "https://bank.example@evil.example/",
    "https://coral.example/\u0000x",
    "https://coral.example/\u200Bx",
    "",
  ])("drops %j and keeps the text", (href) => {
    expect(inline(text("here", link(href)))).toEqual([{ type: "text", text: "here" }]);
  });

  it("drops a link with no href", () => {
    expect(inline(text("here", { type: "link", attrs: {} }), text("x", { type: "link" }))).toEqual([{ type: "text", text: "herex" }]);
  });

  it("merges runs with the same link, also when the hrefs only match once normalized", () => {
    expect(inline(text("Coral ", link("https://coral.example")), text("Bank", link(" HTTPS://coral.example ")))).toEqual([
      { type: "text", text: "Coral Bank", href: "https://coral.example" },
    ]);
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

  it("takes an absent heading level as 1, the schema's default", () => {
    expect(resolve({ type: "heading", content: [text("b")] })[0]).toMatchObject({ level: 1 });
  });

  it.each([[0], [4], [6], ["2"], [null], [2.5]])("refuses heading level %j", (level) => {
    expectRefusal(() => resolve(h(level, text("x"))), DOCUMENT_MESSAGES.heading);
  });

  it("refuses an invalid heading level even when the heading would be removed", () => {
    expectRefusal(() => resolve(p(null, text("x")), h(5, chip("promo_code"))), DOCUMENT_MESSAGES.heading);
  });

  it("uses attrs.id, or null without one", () => {
    expect(resolve(p(null, text("a")), p("p2", text("b"))).map((b) => b.id)).toEqual([null, "p2"]);
    expect(resolve({ type: "paragraph", attrs: { id: "" }, content: [text("a")] })[0]!.id).toBeNull();
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

  it("doesn't change the JSON it reads, and gives the same result every time", () => {
    const body = doc(p("a", text("e\u0301  x", bold), text("y", bold), br), ol({ start: 3 }, li(p(null, chip("first_name")))));
    const before = JSON.stringify(body);
    const first = resolveDocument(body, CTX);
    expect(JSON.stringify(body)).toBe(before);
    expect(resolveDocument(body, CTX)).toEqual(first);
  });
});

// ── Blank lines ──────────────────────────────────────────────────────────────

describe("blank paragraphs", () => {
  it("keeps empty paragraphs inside the document: blank lines the author typed", () => {
    expect(resolve(p("a", text("One")), p("gap"), p("b", text("Two")), p("trail"))).toEqual([
      { type: "paragraph", id: "a", content: [{ type: "text", text: "One" }] },
      { type: "paragraph", id: "gap", content: [] },
      { type: "paragraph", id: "b", content: [{ type: "text", text: "Two" }] },
    ]);
  });

  it("keeps paragraphs of only spaces, everywhere", () => {
    const body = resolve(
      p("s", text("   ")),
      ul(li(p("li", text("x")), p("li-blank"))),
      table(tr(cell([p("c1", text("x")), p("c-blank", text("\u00A0"))]))),
      callout(p("co", text("x")), p("co-blank")),
      p("end", text("End")),
    );
    expect(body[0]).toEqual({ type: "paragraph", id: "s", content: [{ type: "text", text: "   " }] });
    expect(body[1]).toMatchObject({ items: [{ content: [{ id: "li" }, { id: "li-blank", content: [] }] }] });
    expect(body[2]).toMatchObject({ rows: [{ cells: [{ content: [{ id: "c1" }, { id: "c-blank", content: [{ text: "\u00A0" }] }] }] }] });
    expect(body[3]).toMatchObject({ content: [{ id: "co" }, { id: "co-blank", content: [] }] });
  });

  it("keeps an empty heading", () => {
    expect(resolve(h(2), p(null, text("after")))[0]).toEqual({ type: "heading", id: null, level: 2, section: null, content: [] });
  });
});

describe("the end of the document", () => {
  it("drops the editor's trailing empty paragraphs", () => {
    expect(resolve(p("a", text("Body")), p("t1"), p("t2", { type: "text", text: "" })).map((b) => b.id)).toEqual(["a"]);
  });

  it("keeps a trailing paragraph of hard breaks: the author made those lines", () => {
    expect(resolve(p("a", text("Body")), p("t", br, br)).map((b) => b.id)).toEqual(["a", "t"]);
  });

  it("drops a trailing paragraph whose only content was zero-width characters", () => {
    expect(resolve(p("a", text("Body")), p("t", text("\u200B"))).map((b) => b.id)).toEqual(["a"]);
  });

  it("keeps a trailing paragraph of spaces: spaces are content", () => {
    expect(resolve(p("a", text("A")), p("s", text("  "))).map((b) => b.id)).toEqual(["a", "s"]);
  });

  it("drops a last line that only held an unfilled optional chip, then the empty lines before it", () => {
    expect(resolve(p("a", text("One")), p("gap"), p("b", chip("promo_code"))).map((b) => b.id)).toEqual(["a"]);
  });

  it("keeps trailing empty lines inside a callout or a list item", () => {
    const [co, list] = resolve(callout(p("x", text("a")), p("y")), ul(li(p("i", text("a")), p("j"))));
    expect(co).toMatchObject({ type: "callout", content: [{ id: "x" }, { id: "y", content: [] }] });
    expect(list).toMatchObject({ items: [{ content: [{ id: "i" }, { id: "j", content: [] }] }] });
  });

  it("returns nothing for a document that is only a trailing line", () => {
    expect(resolve(p("t"))).toEqual([]);
  });
});

// ── Removal ──────────────────────────────────────────────────────────────────

describe("removal: paragraphs of empty optional variables", () => {
  it("removes a paragraph that is only an optional variable without a value", () => {
    expect(resolve(p("a", text("A")), p("b", chip("promo_note")), p("c", text("C"))).map((b) => b.id)).toEqual(["a", "c"]);
  });

  it("removes it with blank characters and breaks around the variables", () => {
    const blanks = " \u00A0\u2003\u3000\t\u200B\u00AD\u200E\uFE0F";
    expect(resolve(p("a", text("A")), p("b", text(blanks), chip("promo_note"), text(" "), br, chip("promo_code"), br), p("c", text("C"))).map((b) => b.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("removes a paragraph whose chip has a key that isn't in the list", () => {
    expect(resolve(p("a", text("A")), p("b", chip("nickname")), p("c", text("C"))).map((b) => b.id)).toEqual(["a", "c"]);
  });

  it("keeps a paragraph when any text beside the variable isn't blank", () => {
    expect(resolve(p("a", text("Rate: "), chip("promo_code")), p("c", text("C")))[0]).toEqual({
      type: "paragraph",
      id: "a",
      content: [{ type: "text", text: "Rate: " }],
    });
  });

  it("keeps a paragraph when one of its variables has a value", () => {
    expect(resolve(p("a", chip("promo_code"), text(" "), chip("first_name")))[0]).toMatchObject({
      content: [{ text: " " }, { text: "Maya", variable: "first_name" }],
    });
  });

  it("keeps a paragraph without variables, however blank", () => {
    expect(resolve(p("a", text("A")), p("b", br), p("c", text("C"))).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("removes a heading made only of empty optional variables", () => {
    expect(resolve(h(2, chip("promo_note")), p("c", text("C"))).map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("removes a numbered item left with nothing, and the list renumbers", () => {
    const [list] = resolve(ol({}, li(p(null, text("one"))), li(p(null, chip("promo_note"))), li(p(null, text("three")))));
    expect(list).toMatchObject({
      ordered: true,
      start: 1,
      items: [
        { marker: "1.", content: [{ content: [{ text: "one" }] }] },
        { marker: "2.", content: [{ content: [{ text: "three" }] }] },
      ],
    });
  });

  it("renumbers from the list's start", () => {
    const [list] = resolve(ol({ start: 5, markerFormat: "lower-roman", markerDelimiter: "parens" }, li(p(null, chip("promo_note"))), li(p(null, text("a"))), li(p(null, text("b")))));
    expect(markers([list!])).toEqual(["(v) (vi)"]);
  });

  it("removes a bullet item left with nothing", () => {
    const [list] = resolve(ul(li(p(null, chip("promo_code"))), li(p(null, text("kept")))));
    expect(list).toMatchObject({ items: [{ marker: "\u2022", content: [{ content: [{ text: "kept" }] }] }] });
  });

  it("keeps an item while one of its blocks is left", () => {
    const [list] = resolve(ul(li(p(null, chip("promo_code")), ul(li(p(null, text("nested")))))));
    expect(list).toMatchObject({ items: [{ content: [{ type: "list", bullet: "circle" }] }] });
  });

  it("cascades: an item whose blocks were all removed (a nested list included) goes, then an empty list goes", () => {
    const body = resolve(
      p("a", text("A")),
      ol({}, li(p(null, chip("promo_code")), ol({}, li(p(null, chip("promo_note")))))),
      p("b", text("B")),
    );
    expect(body.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("removes a callout whose paragraphs were all removed, and keeps one with a paragraph left", () => {
    expect(resolve(callout(p("x", chip("promo_code"))), p("c", text("C"))).map((b) => b.type)).toEqual(["paragraph"]);
    expect(resolve(callout(p("x", chip("promo_code")), p("y")), p("c", text("C")))[0]).toMatchObject({
      type: "callout",
      content: [{ id: "y", content: [] }],
    });
  });

  it("never removes a table cell: it stays, empty", () => {
    const [t] = resolve(table(tr(cell([p(null, chip("promo_code"))]), cell([ul(li(p(null, chip("promo_note"))))]), td("x"))));
    expect(t).toMatchObject({ type: "table", columns: 3, rows: [{ cells: [{ content: [] }, { content: [] }, { content: [{ type: "paragraph" }] }] }] });
  });

  it("counts a variable whose value has only zero-width characters as having no value", () => {
    const ctx = withValues({ promo_note: "\u200B" });
    expect(resolveDocument(doc(p("a", text("A")), p("b", chip("promo_note")), p("c", text("C"))), ctx).map((b) => b.id)).toEqual(["a", "c"]);
  });
});

// ── Lists ────────────────────────────────────────────────────────────────────

describe("lists", () => {
  it("resolves bulleted lists, with nested lists inside items", () => {
    const body = doc({
      type: "bulletList",
      attrs: { id: "l1" },
      content: [
        { type: "listItem", attrs: { id: "li1" }, content: [p("a", text("One"))] },
        {
          type: "listItem",
          content: [p("b", text("Two")), { type: "orderedList", attrs: { start: 1 }, content: [li(p("c", chip("first_name")))] }],
        },
      ],
    });
    expect(resolveDocument(body, CTX)).toEqual([
      {
        type: "list",
        id: "l1",
        ordered: false,
        bullet: "disc",
        items: [
          { marker: "\u2022", content: [{ type: "paragraph", id: "a", content: [{ type: "text", text: "One" }] }] },
          {
            marker: "\u2022",
            content: [
              { type: "paragraph", id: "b", content: [{ type: "text", text: "Two" }] },
              {
                type: "list",
                id: null,
                ordered: true,
                start: 1,
                format: "decimal",
                delimiter: "period",
                items: [{ marker: "1.", content: [{ type: "paragraph", id: "c", content: [{ type: "text", text: "Maya", variable: "first_name" }] }] }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("numbers unstyled ordered lists by ordered depth: 1. a. i. then 1. again", () => {
    expect(markers(resolve(nested(["ol", "ol", "ol", "ol"])))).toEqual(["1.", "a.", "i.", "1."]);
  });

  it("doesn't count bullet lists in the ordered depth", () => {
    expect(markers(resolve(nested(["ol", "ul", "ol"])))).toEqual(["1.", "\u2022", "a."]);
  });

  it("cycles bullets \u2022 \u25E6 \u25AA by bullet depth, not counting ordered lists", () => {
    expect(markers(resolve(nested(["ul", "ol", "ul", "ul", "ul"])))).toEqual(["\u2022", "1.", "\u25E6", "\u25AA", "\u2022"]);
    const [list] = resolve(nested(["ul", "ul", "ul"]));
    expect((list as RenderList).ordered === false && list).toMatchObject({ bullet: "disc" });
  });

  it("counts depth through tables", () => {
    const [list] = resolve(ol({}, li(p(null, text("x")), table(tr(cell([ol({}, li(p(null, text("in a cell"))))]))))));
    expect(markers([list!])).toEqual(["1.", "a."]);
  });

  it("prints the author's numbering style, with the resolved style on the list", () => {
    const [list] = resolve(ol({ start: 25, markerFormat: "lower-alpha", markerDelimiter: "parens" }, li(p(null, text("a"))), li(p(null, text("b"))), li(p(null, text("c")))));
    expect(list).toMatchObject({ ordered: true, start: 25, format: "lower-alpha", delimiter: "parens" });
    expect(markers([list!])).toEqual(["(y) (z) (aa)"]);
  });

  it.each([
    [{ markerFormat: "upper-roman" }, 0, "upper-roman", "period", "I."],
    [{ markerDelimiter: "paren-right" }, 0, "decimal", "paren-right", "1)"],
    [{ markerDelimiter: "paren-right" }, 2, "lower-roman", "paren-right", "i)"],
    [{ markerFormat: null, markerDelimiter: null }, 1, "lower-alpha", "period", "a."],
  ])("falls back attribute by attribute: %j at ordered depth %i", (attrs, depth, format, delimiter, first) => {
    let node: JSONContent = ol(attrs, li(p(null, text("x"))));
    for (let d = 0; d < depth; d += 1) node = ol({}, li(p(null, text("outer")), node));
    const lists: RenderList[] = [];
    const walk = (blocks: readonly RenderBlock[]) =>
      blocks.forEach((b) => {
        if (b.type === "list") {
          lists.push(b);
          b.items.forEach((i) => walk(i.content));
        }
      });
    walk(resolve(node));
    expect(lists.at(-1)).toMatchObject({ format, delimiter, items: [{ marker: first }] });
  });

  it("gives a child of a styled list the default for its own depth", () => {
    expect(markers(resolve(ol({ markerFormat: "lower-alpha", markerDelimiter: "parens" }, li(p(null, text("x")), ol({}, li(p(null, text("y"))))))))).toEqual([
      "(a)",
      "a.",
    ]);
  });

  it.each([
    [0, "decimal", "period", "0. 1."],
    [3998, "upper-roman", "period", "MMMCMXCVIII. MMMCMXCIX."],
    [9999, "decimal", "paren-right", "9999) 10000)"],
    [0, "lower-alpha", "period", "0. a."],
  ])("honours start %i (%s, %s) without clamping", (start, markerFormat, markerDelimiter, expected) => {
    const [list] = resolve(ol({ start, markerFormat, markerDelimiter }, li(p(null, text("a"))), li(p(null, text("b")))));
    expect(list).toMatchObject({ start });
    expect(markers([list!])).toEqual([expected]);
  });

  it("takes an absent or null start as 1", () => {
    expect(resolve(ol({}, li(p(null, text("x")))))[0]).toMatchObject({ start: 1 });
    expect(resolve(ol({ start: null }, li(p(null, text("x")))))[0]).toMatchObject({ start: 1 });
  });

  it("ignores TipTap's own `type` attribute", () => {
    expect(markers(resolve(ol({ type: "A" }, li(p(null, text("x"))))))).toEqual(["1."]);
  });

  it("writes every marker with formatMarker", () => {
    const [list] = resolve(ol({ start: 7, markerFormat: "upper-alpha", markerDelimiter: "paren-right" }, ...Array.from({ length: 30 }, () => li(p(null, text("x"))))));
    expect((list as RenderList).items.map((i) => i.marker)).toEqual(Array.from({ length: 30 }, (_, i) => formatMarker(7 + i, "upper-alpha", "paren-right")));
  });

  it.each([[-1], [10000], [1.5], ["3"], [Number.NaN]])("refuses start %j", (start) => {
    expectRefusal(() => resolve(ol({ start }, li(p(null, text("x"))))), DOCUMENT_MESSAGES.listStart);
  });

  it.each([
    [{ markerFormat: "lower-greek" }],
    [{ markerFormat: "Decimal" }],
    [{ markerFormat: 1 }],
    [{ markerDelimiter: "colon" }],
    [{ markerDelimiter: "" }],
  ])("refuses an unknown numbering style %j", (attrs) => {
    expectRefusal(() => resolve(ol(attrs, li(p(null, text("x"))))), DOCUMENT_MESSAGES.numbering);
  });

  it("refuses an invalid style even on a list whose items are all removed", () => {
    expectRefusal(() => resolve(ol({ start: -1 }, li(p(null, chip("promo_code"))))), DOCUMENT_MESSAGES.listStart);
  });

  it("accepts lists nested 9 deep, of either kind, and refuses a 10th level", () => {
    const nine = Array.from({ length: 9 }, (_, i) => (i % 2 ? "ul" : "ol") as "ol" | "ul");
    expect(markers(resolve(nested(nine)))).toHaveLength(9);
    expectRefusal(() => resolve(nested([...nine, "ul"])), DOCUMENT_MESSAGES.listDepth);
  });

  it("resolves deep lists in linear time", () => {
    const wide = (depth: number): JSONContent =>
      depth === 0 ? li(p(null, text("leaf"))) : li(p(null, text("x")), ol({}, ...Array.from({ length: 3 }, () => wide(depth - 1))));
    const started = performance.now();
    resolve(ol({}, wide(8)));
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

// ── Tables ───────────────────────────────────────────────────────────────────

describe("tables", () => {
  it("resolves header cells, spans (absent or null meaning 1), columns and lists in cells", () => {
    const body = doc({
      type: "table",
      attrs: { id: "t1" },
      content: [
        tr(cell([p("h1", text("Fee"))], { colspan: 1, rowspan: 1, colwidth: null }, "tableHeader"), cell([p("h2", text("Amount"))], undefined, "tableHeader")),
        tr(cell([p("c1", text("Annual fee"))], { colspan: 2, rowspan: null })),
        tr(
          cell([p("c2", text("APR"))], { rowspan: 2 }),
          cell([p("c3", chip("purchase_apr")), ul(li(p(null, text("Variable"))))]),
        ),
        tr(td("c4")),
      ],
    });
    expect(resolveDocument(body, CTX)).toEqual([
      {
        type: "table",
        id: "t1",
        columns: 2,
        rows: [
          {
            cells: [
              { header: true, colspan: 1, rowspan: 1, content: [{ type: "paragraph", id: "h1", content: [{ type: "text", text: "Fee" }] }] },
              { header: true, colspan: 1, rowspan: 1, content: [{ type: "paragraph", id: "h2", content: [{ type: "text", text: "Amount" }] }] },
            ],
          },
          { cells: [{ header: false, colspan: 2, rowspan: 1, content: [{ type: "paragraph", id: "c1", content: [{ type: "text", text: "Annual fee" }] }] }] },
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
                    bullet: "disc",
                    items: [{ marker: "\u2022", content: [{ type: "paragraph", id: null, content: [{ type: "text", text: "Variable" }] }] }],
                  },
                ],
              },
            ],
          },
          { cells: [{ header: false, colspan: 1, rowspan: 1, content: [{ type: "paragraph", id: null, content: [{ type: "text", text: "c4" }] }] }] },
        ],
      },
    ]);
  });

  it("accepts 12 columns", () => {
    const cells = Array.from({ length: 12 }, (_, i) => td(String(i)));
    expect(resolve(table(tr(...cells)))[0]).toMatchObject({ columns: 12 });
    expect(resolve(table(tr(td("wide", { colspan: 12 }))))[0]).toMatchObject({ columns: 12 });
  });

  it("refuses more than 12 columns", () => {
    expectRefusal(() => resolve(table(tr(...Array.from({ length: 13 }, () => td("x"))))), DOCUMENT_MESSAGES.tableColumns);
    expectRefusal(() => resolve(table(tr(td("x", { colspan: 1_000_000_000 })))), DOCUMENT_MESSAGES.tableColumns);
    expectRefusal(() => resolve(table(tr(td("x", { colspan: 1e14 })), tr(td("y")))), DOCUMENT_MESSAGES.tableShape);
  });

  it("checks the shape before the width, as the document check does", () => {
    expectRefusal(() => resolve(table(tr(...Array.from({ length: 13 }, () => td("x"))), tr(td("y")))), DOCUMENT_MESSAGES.tableShape);
  });

  it.each([
    ["colspan 0", table(tr(td("a", { colspan: 0 })))],
    ["a fractional colspan", table(tr(td("a", { colspan: 1.5 })))],
    ["a string rowspan", table(tr(td("a", { rowspan: "2" })))],
    ["a rowspan past the last row", table(tr(td("a", { rowspan: 2 }), td("b")))],
    ["a huge rowspan", table(tr(td("a", { rowspan: 1_000_000 })))],
    ["a ragged row", table(tr(td("a"), td("b")), tr(td("c")))],
    ["a cell over a rowspan", table(tr(td("a"), td("b", { rowspan: 2 }), td("c")), tr(td("d", { colspan: 2 }), td("e")))],
    ["no rows", { type: "table", content: [] }],
  ])("refuses %s", (_, node) => {
    expectRefusal(() => resolve(node), DOCUMENT_MESSAGES.tableShape);
  });

  it.each([
    ["a heading", h(2, text("x"))],
    ["a table", table(tr(td("x")))],
    ["a callout", callout(p(null, text("x")))],
    ["a rule", { type: "horizontalRule" }],
  ])("refuses %s in a cell, and in a list item at any depth inside a cell", (_, node) => {
    expectRefusal(() => resolve(table(tr(cell([p(null, text("x")), node])))), DOCUMENT_MESSAGES.cell);
    expectRefusal(() => resolve(table(tr(cell([ul(li(p(null, text("x")), node))])))), DOCUMENT_MESSAGES.cell);
    expectRefusal(() => resolve(table(tr(cell([ol({}, li(p(null, text("x")), ul(li(p(null, text("y")), node))))])))), DOCUMENT_MESSAGES.cell);
  });

  it("keeps a heading, table, callout or rule in a list item outside a table", () => {
    const blocks = resolve(ul(li(p(null, text("x")), h(2, text("y")), table(tr(td("z"))), callout(p(null, text("w"))), { type: "horizontalRule" })));
    expect(blocks[0]?.type === "list" && blocks[0].items[0]?.content.map((b) => b.type)).toEqual(["paragraph", "heading", "table", "callout", "rule"]);
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────

describe("JSON the resolver doesn't know", () => {
  // One sentence, never a node or mark name from the stored JSON (it is shown to API callers).
  const unsupported = (fn: () => unknown) => expectRefusal(fn, DOCUMENT_MESSAGES.unsupported);

  it("throws on an unknown block node", () => {
    unsupported(() => resolve({ type: "blockquote", content: [p(null, text("x"))] }));
    unsupported(() => resolve({ type: "blockquote" }));
  });

  it("throws on an unknown inline node", () => {
    unsupported(() => inline({ type: "mention", attrs: { id: "x" } }));
    unsupported(() => inline({ type: "image" }));
  });

  it("throws on an unknown mark, even on a paragraph that would be removed", () => {
    unsupported(() => inline(text("x", { type: "strike" })));
    unsupported(() => inline(chip("first_name", { type: "code" })));
    unsupported(() => resolve(p(null, text("x")), p(null, chip("promo_code", { type: "code" }))));
  });

  it("throws on a known node in the wrong place", () => {
    unsupported(() => resolve(text("loose")));
    unsupported(() => inline(p(null, text("x"))));
    unsupported(() => resolve({ type: "bulletList", content: [p(null, text("x"))] }));
    unsupported(() => resolve({ type: "table", content: [p(null)] }));
    unsupported(() => resolve({ type: "table", content: [{ type: "tableRow", content: [p(null)] }] }));
    unsupported(() => resolve({ type: "callout", content: [h(2, text("x"))] }));
  });

  it("throws on a list, item or callout with nothing in it", () => {
    unsupported(() => resolve({ type: "bulletList", content: [] }));
    unsupported(() => resolve(ol({})));
    unsupported(() => resolve(ul({ type: "listItem", content: [] })));
    unsupported(() => resolve({ type: "callout" }));
  });

  it("throws when the body isn't a doc", () => {
    unsupported(() => resolveDocument(p("a", text("x")), CTX));
  });
});

// ── Invariants ───────────────────────────────────────────────────────────────

describe("the RenderDoc's invariants", () => {
  const FORBIDDEN = new RegExp(`[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029${INVISIBLE_CHARACTERS}]`, "u");

  /** Checks spec section 9's invariants on every block, recursively. */
  function check(blocks: readonly RenderBlock[], top: boolean) {
    for (const b of blocks) {
      switch (b.type) {
        case "paragraph":
        case "heading":
          for (const run of b.content) {
            if (run.type !== "text") continue;
            expect(run.text).not.toBe("");
            expect(run.text.normalize("NFC")).toBe(run.text);
            expect(run.text).not.toMatch(FORBIDDEN);
            if (run.href !== undefined) expect(normalizeLink(run.href)).toBe(run.href);
          }
          break;
        case "list":
          expect(b.items.length).toBeGreaterThan(0);
          b.items.forEach((item, i) => {
            expect(item.content.length).toBeGreaterThan(0);
            expect(item.marker).toBe(b.ordered ? formatMarker(b.start + i, b.format, b.delimiter) : { disc: "\u2022", circle: "\u25E6", square: "\u25AA" }[b.bullet]);
            check(item.content, false);
          });
          break;
        case "table":
          expect(b.columns).toBeGreaterThanOrEqual(1);
          expect(b.columns).toBeLessThanOrEqual(12);
          b.rows.forEach((row) => row.cells.forEach((c) => {
            c.content.forEach((x) => expect(["paragraph", "list"]).toContain(x.type));
            check(c.content, false);
          }));
          break;
        case "callout":
          expect(b.content.length).toBeGreaterThan(0);
          check(b.content, false);
          break;
        case "rule":
          break;
      }
    }
    if (top && blocks.length) expect(blocks.at(-1)!.type === "paragraph" && (blocks.at(-1) as { content: unknown[] }).content.length === 0).toBe(false);
  }

  it("hold for a document that exercises every rule", () => {
    const body = resolve(
      h(1, text("Ti\u200Btle\t"), br),
      p("a", text("e\u0301 \u0007x\u00AD", bold), text("y", bold), text("\u200B\u200E"), text("z", bold, link(" HTTPS://x.example/é ")), br, br),
      p("blank"),
      p("gone", chip("promo_code"), br),
      ul(li(p(null, chip("promo_note"))), li(p(null, text("one\r\ntwo")), ol({ start: 0, markerFormat: "upper-roman" }, li(p(null, chip("promo_code"))), li(p(null, text("k"))))), li(p(null, br))),
      table(tr(cell([p(null, chip("promo_code"))], undefined, "tableHeader"), td("b")), tr(td("c", { colspan: 2 }))),
      callout(p(null, chip("promo_code")), p(null, text("\u2028kept"))),
      { type: "horizontalRule" },
      p("end", text("\uFEFF")),
      p("end2"),
    );
    check(body, true);
    expect(body.map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph", "list", "table", "callout", "rule"]);
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

  it("keeps runs of spaces inside, and trims the ends", () => {
    expect(resolveInlineField(field(text("  Hi "), chip("promo_code"), text("  there, "), chip("first_name"), text(" ")), CTX)).toBe(
      "Hi   there, Maya",
    );
  });

  it("trims every JavaScript whitespace character at the ends, including no-break and ideographic spaces", () => {
    expect(resolveInlineField(field(text("\u00A0\u3000\u2003Hi\u00A0\u202F")), CTX)).toBe("Hi");
  });

  it("keeps a no-break space inside", () => {
    expect(resolveInlineField(field(text("A\u00A0B")), CTX)).toBe("A\u00A0B");
  });

  it("turns each line break character and hard break into one space (CR LF once)", () => {
    expect(resolveInlineField(field(text("a\r\nb\nc\rd\u2028e\u2029f"), br, text("g")), CTX)).toBe("a b c d e f g");
  });

  it("applies the character rules and NFC", () => {
    expect(resolveInlineField(field(text("Cafe\u0301\u200B\tbar\u0007")), CTX)).toBe("Café bar");
  });

  it("reads marks without keeping them", () => {
    expect(resolveInlineField(field(text("Hi", bold), text(" there", link("https://x.example"))), CTX)).toBe("Hi there");
  });

  it("has no removal rule: an empty chip simply gives nothing", () => {
    expect(resolveInlineField(field(text("Code: "), chip("promo_code")), CTX)).toBe("Code:");
    expect(resolveInlineField(field(chip("promo_code")), CTX)).toBe("");
  });

  it("gives an empty string for null or an empty field", () => {
    expect(resolveInlineField(null, CTX)).toBe("");
    expect(resolveInlineField(doc(p(null)), CTX)).toBe("");
    expect(resolveInlineField(doc(), CTX)).toBe("");
  });

  it("accepts a bare paragraph and joins several paragraphs with a space", () => {
    expect(resolveInlineField(p(null, text("Hi "), chip("first_name")), CTX)).toBe("Hi Maya");
    expect(resolveInlineField(doc(p(null, text("One")), p(null, text("Two"))), CTX)).toBe("One Two");
  });

  it("throws on JSON it doesn't know, or on a block that isn't a line of text", () => {
    expectRefusal(() => resolveInlineField(field({ type: "emoji" }), CTX), DOCUMENT_MESSAGES.unsupported);
    expectRefusal(() => resolveInlineField(field(text("x", { type: "strike" })), CTX), DOCUMENT_MESSAGES.unsupported);
    expectRefusal(() => resolveInlineField(doc(ul(li(p(null, text("x"))))), CTX), DOCUMENT_MESSAGES.unsupported);
  });
});
