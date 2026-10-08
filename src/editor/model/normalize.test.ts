// Save normalization (normalize.ts), rule by rule: docs/render-spec.md §3. The same function runs on
// paste (as a slice, with open edges), on import and at save; these rows pin what it does.

import { describe, expect, it } from "vitest";
import { documentProblem } from "./document-check";
import { normalizeDocument, normalizeField, normalizeFragment } from "./normalize";
import { tableGrid } from "./table-grid";
import type { JSONContent } from "./types";

const t = (text: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "text", text, ...(marks ? { marks } : {}) });
const br: JSONContent = { type: "hardBreak" };
const p = (...content: JSONContent[]): JSONContent => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const h = (level: number, ...content: JSONContent[]): JSONContent => ({ type: "heading", attrs: { level }, content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const ol = (attrs: Record<string, unknown>, ...items: JSONContent[]): JSONContent => ({ type: "orderedList", attrs, content: items });
const ul = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const td = (content: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({ type: "tableCell", ...(attrs ? { attrs } : {}), content });
const th = (content: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({ type: "tableHeader", ...(attrs ? { attrs } : {}), content });
const tr = (...cells: JSONContent[]): JSONContent => ({ type: "tableRow", content: cells });
const table = (...rows: JSONContent[]): JSONContent => ({ type: "table", content: rows });
const cell = (text: string) => td([p(t(text))]);
const link = (href: string) => ({ type: "link", attrs: { href, target: "_blank" } });

/** The body's first block, normalized. */
const first = (block: JSONContent) => normalizeDocument(doc(block)).content?.[0];

describe("text", () => {
  it("a tab becomes one space", () => {
    expect(first(p(t("Fee:\tWaived\t\tfirst year")))).toEqual(p(t("Fee: Waived  first year")));
  });

  it("CR LF, CR, LF, U+2028 and U+2029 become hard breaks", () => {
    expect(first(p(t("a\r\nb\rc\nd\u2028e\u2029f")))).toEqual(
      p(t("a"), br, t("b"), br, t("c"), br, t("d"), br, t("e"), br, t("f")),
    );
  });

  it("other control characters are removed; NBSP and the other spaces stay", () => {
    expect(first(p(t("a\u0000b\u0007c\u000Bd\u000Ce\u001Ff\u007Fg\u0085h\u009Fi")))).toEqual(p(t("abcdefghi")));
    expect(first(p(t("a\u00A0b\u2003c\u202Fd\u3000e")))).toEqual(p(t("a\u00A0b\u2003c\u202Fd\u3000e")));
  });

  it.each([
    ["U+00AD soft hyphen", "\u00AD"],
    ["U+034F combining grapheme joiner", "\u034F"],
    ["U+061C Arabic letter mark", "\u061C"],
    ["U+200B zero width space", "\u200B"],
    ["U+200C zero width non-joiner", "\u200C"],
    ["U+200D zero width joiner", "\u200D"],
    ["U+200E left-to-right mark", "\u200E"],
    ["U+200F right-to-left mark", "\u200F"],
    ["U+202A left-to-right embedding", "\u202A"],
    ["U+202E right-to-left override", "\u202E"],
    ["U+2060 word joiner", "\u2060"],
    ["U+2066 left-to-right isolate", "\u2066"],
    ["U+2069 pop directional isolate", "\u2069"],
    ["U+FE0F variation selector-16", "\uFE0F"],
    ["U+FEFF byte order mark", "\uFEFF"],
    ["U+E0001 language tag", "\u{E0001}"],
  ])("the invisible character %s is removed (the editor shows nothing for it)", (_, ch) => {
    expect(first(p(t(`Ver${ch}sicherung`)))).toEqual(p(t("Versicherung")));
    expect(first(p(t("x"), t(ch, [{ type: "bold" }])))).toEqual(p(t("x")));
    expect(first(p(t(ch)))).toEqual(p());
    expect(normalizeField(doc(p(t(`a${ch}b`))))).toEqual(doc(p(t("ab"))));
  });

  it("a text node left empty goes; marks stay on every piece", () => {
    expect(first(p(t("x"), t("\u0001")))).toEqual(p(t("x")));
    expect(first(p(t("a\nb", [{ type: "bold" }])))).toEqual(p(t("a", [{ type: "bold" }]), br, t("b", [{ type: "bold" }])));
  });

  it("every hard break stays, those ending a paragraph or heading too (the editor shows their lines)", () => {
    expect(first(p(t("x"), br, br))).toEqual(p(t("x"), br, br));
    expect(first(p(br))).toEqual(p(br));
    expect(first(p(br, t("x")))).toEqual(p(br, t("x")));
    expect(first(p(t("x"), br, t(" ")))).toEqual(p(t("x"), br, t(" ")));
    expect(first(h(2, t("Title"), br))).toEqual(h(2, t("Title"), br));
    // A line break character at the end is a hard break at the end.
    expect(first(p(t("x\n")))).toEqual(p(t("x"), br));
    // An invisible character after a break goes; the break stays.
    expect(first(p(t("x"), br, t("\u200B")))).toEqual(p(t("x"), br));
  });

  it("spaces are content: nothing is trimmed", () => {
    expect(first(p(t("   ")))).toEqual(p(t("   ")));
  });
});

describe("links", () => {
  it("a link that passes the check keeps its mark, with the normalized href and its other attributes", () => {
    expect(first(p(t("Terms", [link(" HTTPS://Coral.Example/café ")])))).toEqual(
      p(t("Terms", [{ type: "link", attrs: { href: "https://Coral.Example/caf%C3%A9", target: "_blank" } }])),
    );
  });

  it("a link that fails it loses the mark; the text and other marks stay", () => {
    for (const href of ["javascript:alert(1)", "/terms", "#top", "ftp://x.example", "coral.example", "https://a b.example", 42]) {
      expect(first(p(t("Terms", [{ type: "bold" }, { type: "link", attrs: { href } }])))).toEqual(p(t("Terms", [{ type: "bold" }])));
    }
    expect(first(p(t("Terms", [link("data:text/html,x")])))).toEqual(p(t("Terms")));
  });

  it("chips carry links too", () => {
    const chip = { type: "variable", attrs: { key: "apply_url" }, marks: [link("sms:+1555")] };
    expect(first(p(chip))).toEqual(p({ type: "variable", attrs: { key: "apply_url" } }));
  });
});

describe("attributes", () => {
  it("headings 4, 5 and 6 become 3; 1–3 stay; anything else is left for the check", () => {
    for (const level of [4, 5, 6]) expect(first(h(level, t("x")))?.attrs?.level).toBe(3);
    for (const level of [1, 2, 3]) expect(first(h(level, t("x")))?.attrs?.level).toBe(level);
    for (const level of [0, 7, "2", null]) expect(first(h(level as number, t("x")))?.attrs?.level).toBe(level);
  });

  it("TipTap's orderedList `type` goes; the numbering attributes stay", () => {
    const list = ol({ start: 3, type: "a", markerFormat: "lower-alpha", markerDelimiter: "parens" }, li(p(t("x"))));
    expect(first(list)?.attrs).toEqual({ start: 3, markerFormat: "lower-alpha", markerDelimiter: "parens" });
    expect(first(ol({ type: null }, li(p(t("x")))))).not.toHaveProperty("attrs");
  });

  it("cell `align` and `colwidth` go; spans stay", () => {
    const out = first(table(tr(th([p(t("a"))], { colspan: 2, rowspan: 1, align: "center", colwidth: [120, 80] })), tr(cell("b"), cell("c"))));
    expect(out?.content?.[0].content?.[0].attrs).toEqual({ colspan: 2, rowspan: 1 });
  });

  it("a list start, a numbering style or a depth it can't fix is left as it is", () => {
    const list = ol({ start: 20000, markerFormat: "greek" }, li(p(t("x"))));
    expect(first(list)).toEqual(list);
  });

  it("a pasted list's start is brought into 0 to 9999, so the editor shows what renders (saved documents are left for the check)", () => {
    const pasted = (start: unknown) => normalizeFragment([ol({ start }, li(p(t("x"))))], { openStart: 0, openEnd: 0 })[0]?.attrs?.start;
    expect([20000, 10000, 9999, 0, -1, -0, 2.7, Number.NaN, Number.POSITIVE_INFINITY].map(pasted)).toEqual([9999, 9999, 9999, 0, 0, 0, 2, 1, 9999]);
    expect([null, undefined, "3"].map(pasted)).toEqual([null, undefined, "3"]);
    expect(first(ol({ start: -5 }, li(p(t("x")))))?.attrs?.start).toBe(-5);
  });
});

describe("table cells hold paragraphs and lists", () => {
  it("a heading becomes a paragraph with the same content (and id)", () => {
    const out = first(table(tr(td([{ type: "heading", attrs: { id: "h1", level: 5 }, content: [t("Fees", [{ type: "bold" }])] }]))));
    expect(out?.content?.[0].content?.[0].content).toEqual([{ type: "paragraph", attrs: { id: "h1" }, content: [t("Fees", [{ type: "bold" }])] }]);
  });

  it("a callout gives its paragraphs; a rule becomes an empty line; lists stay", () => {
    const out = first(
      table(tr(td([p(t("a")), { type: "callout", content: [p(t("note 1")), p(t("note 2"))] }, { type: "horizontalRule" }, ul(li(p(t("b"))))]))),
    );
    expect(out?.content?.[0].content?.[0].content).toEqual([p(t("a")), p(t("note 1")), p(t("note 2")), p(), ul(li(p(t("b"))))]);
  });

  it("a table gives its cells' content, in reading order (tables inside it too)", () => {
    const inner = table(tr(th([h(2, t("In H"))]), cell("in 2")), tr(td([table(tr(cell("deep")))]), cell("in 4")));
    const out = first(table(tr(td([p(t("before")), inner, p(t("after"))]))));
    expect(out?.content?.[0].content?.[0].content).toEqual([
      p(t("before")),
      p(t("In H")),
      p(t("in 2")),
      p(t("deep")),
      p(t("in 4")),
      p(t("after")),
    ]);
  });

  it("an empty cell gets an empty paragraph", () => {
    expect(first(table(tr(td([]))))?.content?.[0].content?.[0].content).toEqual([p()]);
  });

  it("the same at every depth: a list item inside a cell holds paragraphs and lists too", () => {
    const inner = table(tr(cell("x"), cell("y")));
    const list = ul(
      li(p(t("a")), h(2, t("b")), { type: "horizontalRule" }, { type: "callout", content: [p(t("c"))] }, inner),
      li(p(t("d")), ol({}, li(p(t("e")), h(3, t("f"))))),
    );
    expect(first(table(tr(td([list]))))?.content?.[0].content?.[0].content).toEqual([
      ul(li(p(t("a")), p(t("b")), p(), p(t("c")), p(t("x")), p(t("y"))), li(p(t("d")), ol({}, li(p(t("e")), p(t("f")))))),
    ]);
  });

  it("outside a table, a list item keeps its headings, rules, callouts and tables", () => {
    const list = ul(li(p(t("a")), h(2, t("b")), { type: "horizontalRule" }, table(tr(cell("x")))));
    expect(first(list)).toEqual(list);
  });

  it("a pasted fragment landing in a cell becomes a cell's content, but a table stays (the table plugin pastes its cells)", () => {
    const pasted = [p(t("a")), h(2, t("b")), { type: "callout", content: [p(t("c"))] }, { type: "horizontalRule" }, ul(li(p(t("d")), h(1, t("e"))))];
    expect(normalizeFragment(pasted, { openStart: 0, openEnd: 0 }, false, true)).toEqual([
      p(t("a")),
      p(t("b")),
      p(t("c")),
      p(),
      ul(li(p(t("d")), p(t("e")))),
    ]);
    const cells = table(tr(cell("x"), cell("y")));
    expect(normalizeFragment([cells], { openStart: 0, openEnd: 0 }, false, true)).toEqual([cells]);
    expect(normalizeFragment([h(2, t("b"))], { openStart: 0, openEnd: 0 })).toEqual([h(2, t("b"))]);
  });
});

describe("table shape", () => {
  it("a ragged table gets empty cells at row ends, of the row's kind", () => {
    const out = first(table(tr(th([p(t("A"))]), th([p(t("B"))]), th([p(t("C"))])), tr(cell("a")), tr(cell("x"), cell("y"))));
    expect(out).toEqual(
      table(
        tr(th([p(t("A"))]), th([p(t("B"))]), th([p(t("C"))])),
        tr(cell("a"), td([p()]), td([p()])),
        tr(cell("x"), cell("y"), td([p()])),
      ),
    );
  });

  it("padding fills the slots a rowspan from above leaves free", () => {
    const out = first(table(tr(cell("a"), cell("b"), td([p(t("c"))], { rowspan: 2 })), tr(cell("d"))));
    expect(out?.content?.[1]).toEqual(tr(cell("d"), td([p()])));
    expect(documentProblem(doc(out!))).toBeNull();
  });

  it("bad spans, overlaps and overlong rowspans are left for the check", () => {
    for (const bad of [
      table(tr(td([p(t("a"))], { colspan: 0 }))),
      table(tr(td([p(t("a"))], { rowspan: 3 })), tr(cell("b"))),
      table(tr(cell("a"), td([p(t("b"))], { rowspan: 2 })), tr(td([p(t("c"))], { colspan: 2 }))),
    ]) {
      expect(first(bad)).toEqual(bad);
      expect(documentProblem(doc(bad))).toBe("tableShape");
    }
  });

  it("a table wider than 12 columns is split into tables of at most 12, keeping every cell", () => {
    const head = tr(...Array.from({ length: 14 }, (_, i) => th([p(t(`H${i + 1}`))])));
    const body = tr(...Array.from({ length: 14 }, (_, i) => cell(`c${i + 1}`)));
    const out = normalizeDocument(doc({ ...table(head, body), attrs: { id: "t1" } }));
    expect(out.content).toHaveLength(2);
    const [left, right] = out.content!;
    expect(left.attrs).toEqual({ id: "t1" });
    expect(right).not.toHaveProperty("attrs");
    expect(tableGrid(left).width).toBe(12);
    expect(tableGrid(right).width).toBe(2);
    expect(right.content?.[0].content?.map((c) => c.content?.[0].content?.[0].text)).toEqual(["H13", "H14"]);
    expect(right.content?.[1].content?.map((c) => c.content?.[0].content?.[0].text)).toEqual(["c13", "c14"]);
    expect(documentProblem(out)).toBeNull();
  });

  it("a cell spanning the split keeps its content once and leaves an empty cell of the rest", () => {
    const wide = table(
      tr(...Array.from({ length: 11 }, (_, i) => cell(`a${i}`)), td([p(t("span"))], { colspan: 3, rowspan: 2 })),
      tr(...Array.from({ length: 11 }, (_, i) => cell(`b${i}`))),
    );
    const out = normalizeDocument(doc(wide));
    const [left, right] = out.content!;
    expect(left.content?.[0].content?.at(-1)).toEqual(td([p(t("span"))], { colspan: 1, rowspan: 2 }));
    expect(right.content?.[0].content).toEqual([td([p()], { colspan: 2, rowspan: 2 })]);
    expect(right.content?.[1].content).toEqual([]); // covered by the rowspan
    expect(documentProblem(out)).toBeNull();
  });

  it("leaves a table wider than 1,000 columns for the check (a colspan of a billion would be a billion empty cells)", () => {
    const huge = table(tr(td([p(t("a"))], { colspan: 1_000_000_000 })));
    expect(first(huge)).toEqual(huge);
    expect(documentProblem(doc(huge))).toBe("tableColumns");
    const ragged = table(tr(td([p(t("a"))], { colspan: 1_000_000_000 })), tr(cell("b")));
    expect(first(ragged)).toEqual(ragged); // not padded with a billion cells
    expect(documentProblem(doc(ragged))).toBe("tableShape");
    const widest = normalizeDocument(doc(table(tr(td([p(t("a"))], { colspan: 1000 })), tr(cell("b")))));
    expect(widest.content).toHaveLength(84);
    expect(documentProblem(widest)).toBeNull();
  });

  it("splits a 30-column table into three", () => {
    const out = normalizeDocument(doc(table(tr(...Array.from({ length: 30 }, (_, i) => cell(`${i}`))))));
    expect(out.content?.map((block) => tableGrid(block).width)).toEqual([12, 12, 6]);
  });
});

describe("normalizeDocument", () => {
  const messy = doc(
    h(5, t("Title\t"), br),
    p(t("a\tb", [link("HTTPS://x.example")]), t("\r\n")),
    ol({ type: "i", start: 2 }, li(p(t("one")), ul(li(p(t("x\u0002")))))),
    table(tr(td([h(1, t("H"))], { align: "left", colwidth: [50] }), cell("b")), tr(cell("c"))),
    { type: "callout", content: [p(t("note"), br)] },
  );

  it("is idempotent", () => {
    const once = normalizeDocument(messy);
    expect(normalizeDocument(once)).toEqual(once);
  });

  it("doesn't change its input", () => {
    const copy = structuredClone(messy);
    normalizeDocument(messy);
    expect(messy).toEqual(copy);
  });

  it("leaves a document that already conforms as it is", () => {
    const clean = normalizeDocument(messy);
    expect(documentProblem(clean)).toBeNull();
    const plain = doc(h(2, t("Offer")), p(t("Hi "), { type: "variable", attrs: { key: "first_name" } }), p());
    expect(normalizeDocument(plain)).toEqual(plain);
  });
});

describe("normalizeFragment (a pasted slice)", () => {
  it("normalizes text and attributes on the open edges, but not their structure", () => {
    // Pasting into the middle of a paragraph: the paragraph is open on both sides.
    expect(normalizeFragment([p(t("a\tb\u00AD"), br)], { openStart: 1, openEnd: 1 })).toEqual([p(t("a b"), br)]);
    // A closed paragraph in the middle keeps its break too.
    expect(normalizeFragment([p(t("a")), p(t("b"), br), p(t("c"))], { openStart: 1, openEnd: 1 })).toEqual([
      p(t("a")),
      p(t("b"), br),
      p(t("c")),
    ]);
  });

  it("an open table keeps its rows as they are (they join the table they land in); a closed one is fixed", () => {
    const ragged = table(tr(cell("a"), cell("b")), tr(td([h(4, t("c"))], { align: "right" })));
    expect(normalizeFragment([ragged], { openStart: 3, openEnd: 3 })).toEqual([
      table(tr(cell("a"), cell("b")), tr(td([p(t("c"))]))),
    ]);
    expect(normalizeFragment([ragged], { openStart: 0, openEnd: 0 })).toEqual([
      table(tr(cell("a"), cell("b")), tr(td([p(t("c"))]), td([p()]))),
    ]);
  });
});

describe("normalizeField (email subject, preheader)", () => {
  it("line breaks and hard breaks become spaces, marks go, tabs become spaces", () => {
    const field = doc(p(t("Your\tAPR", [{ type: "bold" }]), br, t("is\nchanging"), { type: "variable", attrs: { key: "apr" }, marks: [{ type: "italic" }] }));
    expect(normalizeField(field)).toEqual(doc(p(t("Your APR"), t(" "), t("is changing"), { type: "variable", attrs: { key: "apr" } })));
  });

  it("several paragraphs join into one line", () => {
    expect(normalizeField(doc(p(t("a")), p(), p(t("b"))))).toEqual(doc(p(t("a"), t(" "), t("b"))));
  });
});
