// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { RenderBlock, RenderTableCell } from "@/domain/render/types";
import {
  ATTR_BREAK,
  FULL_DOC,
  HOSTILE_DOC,
  SCRIPT,
  br,
  bullets,
  cellOf,
  docOf,
  heading,
  numbered,
  para,
  t,
} from "./__fixtures__/web-email-docs";
import { renderEmail } from "./email";
import { noBreakSpaces } from "./html";
import { PALETTE } from "./look";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

const fields = { subject: "Maya, your bonus is waiting", preheader: "Earn $200 cash back in your first 3 months." };
const email = renderEmail(FULL_DOC, fields);
const dom = parse(email.html);

const NO_FIELDS = { subject: "s", preheader: "" };
/** The plain text of a document. */
const text = (...blocks: RenderBlock[]) => renderEmail(docOf(...blocks), NO_FIELDS).text;
/** The HTML inside the email's card. */
const card = (...blocks: RenderBlock[]) => {
  const html = renderEmail(docOf(...blocks), NO_FIELDS).html;
  const start = html.indexOf(">", html.indexOf('class="email-body"')) + 2;
  return html.slice(start, html.indexOf("\n</td></tr>\n</table>\n</td></tr>", start));
};
/** Markup without its inline styles and table layout attributes. */
const bare = (html: string) =>
  html.replace(/ style="[^"]*"/g, "").replace(/ (?:cellpadding|cellspacing|border|width|role)="[^"]*"/g, "");
const table = (...rows: RenderTableCell[][]): RenderBlock => ({ type: "table", id: null, columns: 2, rows: rows.map((cells) => ({ cells })) });

describe("renderEmail: subject and preheader", () => {
  it("returns the fields it was given", () => {
    expect(email.subject).toBe(fields.subject);
    expect(email.preheader).toBe(fields.preheader);
  });

  it("keeps runs of spaces as resolved", () => {
    const out = renderEmail(FULL_DOC, { subject: "Rate   change", preheader: "a  \u00A0b" });
    expect(out.subject).toBe("Rate   change");
    expect(out.preheader).toBe("a  \u00A0b");
  });

  it("can never start a new mail header: a line break becomes a space, the ends are trimmed", () => {
    const out = renderEmail(FULL_DOC, { subject: "  Hello\r\nBcc: x@evil.example ", preheader: "a\n\u2028b" });
    expect(out.subject).toBe("Hello Bcc: x@evil.example");
    expect(out.preheader).toBe("a  b");
  });

  it("puts the preheader in a hidden span at the very top of the body", () => {
    const first = dom.body.firstElementChild!;
    expect(first.tagName).toBe("SPAN");
    expect(first.getAttribute("style")).toContain("display:none");
    expect(first.getAttribute("style")).toContain("mso-hide:all");
    expect(first.textContent!.startsWith(fields.preheader)).toBe(true);
  });

  it("writes the preheader's spaces with the no-break space technique", () => {
    const html = renderEmail(FULL_DOC, { subject: "s", preheader: "a   b" }).html;
    expect(html).toContain(">a &nbsp; b&#847;");
  });

  it("leaves the preheader span out when there is no preheader", () => {
    const out = parse(renderEmail(FULL_DOC, { subject: "Hi", preheader: "" }).html);
    expect(out.body.firstElementChild!.tagName).toBe("TABLE");
  });

  it("titles the document with the subject, never the template name", () => {
    expect(dom.title).toBe(fields.subject);
    expect(email.html).not.toContain("Cash Back Welcome Bonus — Terms");
    expect(email.text).not.toContain("Cash Back Welcome Bonus — Terms");
  });

  it("gives the same bytes for the same document", () => {
    expect(renderEmail(FULL_DOC, fields)).toEqual(email);
  });
});

describe("renderEmail: HTML", () => {
  it("lays out in a 600px table container", () => {
    const container = dom.querySelector('table[width="600"]')!;
    expect(container).not.toBeNull();
    expect(container.getAttribute("style")).toContain("max-width:600px");
    expect(container.getAttribute("role")).toBe("presentation");
  });

  it("puts an inline style on every element in the body", () => {
    const content = dom.querySelector(".email-body")!;
    const unstyled = [...content.querySelectorAll("*")].filter(
      (el) => !["BR", "TR", "THEAD", "TBODY"].includes(el.tagName) && !el.getAttribute("style"),
    );
    expect(unstyled.map((el) => el.tagName)).toEqual([]);
  });

  it("only uses <style> for the mobile padding media query", () => {
    const styles = [...dom.querySelectorAll("style")];
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toMatch(/^@media only screen and \(max-width:620px\)/);
  });

  it("renders headings, marks, links, tables, callouts and the rule", () => {
    const content = dom.querySelector(".email-body")!;
    expect([...content.querySelectorAll("h1, h2, h3")].map((h) => h.textContent)).toEqual([
      "Your Cash Back welcome bonus",
      "Offer details",
      "How to claim",
      "Rates and fees",
      "Legal notices",
    ]);
    expect(content.querySelector("strong")!.textContent).toBe("$200 cash back");
    expect(content.querySelectorAll("em, u").length).toBeGreaterThanOrEqual(2);
    expect([...content.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://coral.example/terms",
      "mailto:help@coral.example",
      "tel:+18005550100",
    ]);
    const data = [...content.querySelectorAll("table")].find((t) => t.querySelector("th"))!;
    expect(data.getAttribute("cellpadding")).toBe("0");
    expect([...data.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Rate or fee", "What you pay"]);
    const callout = [...content.querySelectorAll("table[role=presentation] td")].find((td) =>
      td.textContent!.includes("New Jersey residents"),
    )!;
    expect(callout.getAttribute("style")).toContain(`background-color:${PALETTE.callout.fill}`);
    expect(content.querySelectorAll("hr")).toHaveLength(1);
  });

  it("styles callouts like the PDF's: stone tint and hairline, its radius and padding, no accent rule or glyph", () => {
    const content = dom.querySelector(".email-body")!;
    const callout = [...content.querySelectorAll("table[role=presentation] td")].find((td) =>
      td.textContent!.includes("New Jersey residents"),
    )!;
    const style = callout.getAttribute("style")!;
    expect(style).toContain(`background-color:${PALETTE.callout.fill}`);
    expect(style).toContain(`border:1px solid ${PALETTE.callout.line}`);
    expect(style).toContain("border-radius:6px");
    expect(style).toContain("padding:14px 19px");
    expect(style).not.toContain("border-left");
    expect(callout.querySelectorAll("svg, img")).toHaveLength(0);
    expect(callout.textContent!.trim().startsWith("State-specific terms")).toBe(true);
  });

  it("lets long values wrap instead of widening the card", () => {
    expect(dom.querySelector(".email-body")!.getAttribute("style")).toContain("word-break:break-word");
  });
});

describe("renderEmail: HTML lists print the RenderDoc's markers as text", () => {
  it("never uses the mail client's numbering", () => {
    const content = dom.querySelector(".email-body")!;
    expect(content.querySelectorAll("ul, ol, li")).toHaveLength(0);
    expect(email.html).not.toMatch(/list-style|\bstart=/);
  });

  it("writes each item as a row: the marker in its own right-aligned cell, then the content", () => {
    expect(bare(card(numbered(3, "decimal", "period", [para(null, t("Sign in."))], [para(null, t("Choose."))])))).toBe(
      ["<table>", "<tr><td>3.</td><td>Sign in.</td></tr>", "<tr><td>4.</td><td>Choose.</td></tr>", "</table>"].join("\n"),
    );
    const marker = parse(card(bullets("disc", [para(null, t("x"))]))).querySelector("td")!;
    expect(marker.getAttribute("style")).toContain("text-align:right");
    expect(marker.getAttribute("style")).toContain("vertical-align:top");
  });

  it.each([
    [numbered(4, "lower-roman", "parens", [para(null, t("x"))]), "(iv)"],
    [numbered(0, "decimal", "period", [para(null, t("x"))]), "0."],
    [numbered(10000, "decimal", "paren-right", [para(null, t("x"))]), "10000)"],
    [bullets("circle", [para(null, t("x"))]), "\u25E6"],
    [bullets("square", [para(null, t("x"))]), "\u25AA"],
  ])("prints the marker it is given: %#", (list, marker) => {
    expect(bare(card(list))).toBe(`<table>\n<tr><td>${marker}</td><td>x</td></tr>\n</table>`);
  });

  it("nests a list inside its item's content cell, after the item's paragraph", () => {
    const html = bare(card(bullets("disc", [para(null, t("Spend.")), bullets("circle", [para(null, t("Not transfers."))])])));
    expect(html).toBe(
      [
        "<table>",
        "<tr><td>\u2022</td><td><p>Spend.</p>",
        "<table>",
        "<tr><td>\u25E6</td><td>Not transfers.</td></tr>",
        "</table></td></tr>",
        "</table>",
      ].join("\n"),
    );
  });
});

describe("renderEmail: HTML blank lines, spaces and breaks", () => {
  it.each([
    ["a b", "a b"],
    ["a   b", "a \u00A0 b"],
    ["  Lead", "\u00A0 Lead"],
    ["End  ", "End \u00A0"],
    ["   ", "\u00A0 \u00A0"],
    [" ", "\u00A0"],
    ["a  b", "a \u00A0b"],
    ["a\u00A0 b", "a\u00A0 b"],
    ["", ""],
  ])("the no-break space technique writes %j as %j", (line, written) => {
    expect(noBreakSpaces(line)).toBe(written);
  });

  it("applies the technique per line, across runs, and writes every no-break space as &nbsp;", () => {
    expect(card(para(null, t("a "), t("  b", { bold: true }), br, t("  Lead"), br, t("End  ")))).toContain(
      '>a <strong style="font-weight:bold">&nbsp; b</strong><br>&nbsp; Lead<br>End &nbsp;</p>',
    );
  });

  it("writes the author's no-break spaces as &nbsp;", () => {
    expect(card(para(null, t("a\u00A0\u00A0b")))).toContain(">a&nbsp;&nbsp;b</p>");
  });

  it("keeps a blank paragraph as a line holding &nbsp;", () => {
    expect(bare(card(para(null, t("A")), para(null), para(null, t("B"))))).toBe("<p>A</p>\n<p>&nbsp;</p>\n<p>B</p>");
  });

  it("keeps a paragraph of spaces as a line", () => {
    expect(bare(card(para(null, t("   "))))).toBe("<p>&nbsp; &nbsp;</p>");
  });

  it("keeps an empty heading as a line of its level", () => {
    expect(bare(card(heading(2), para(null, t("x"))))).toBe("<h2>&nbsp;</h2>\n<p>x</p>");
  });

  it("keeps blank paragraphs inside list items, cells and callouts", () => {
    const html = bare(
      card(
        bullets("disc", [para(null)]),
        table([cellOf([para(null)]), cellOf([para(null, t("x")), para(null)])]),
        { type: "callout", id: null, content: [para(null, t("a")), para(null)] },
      ),
    );
    expect(html).toContain("<tr><td>\u2022</td><td>&nbsp;</td></tr>");
    expect(html).toContain("<tr><td>&nbsp;</td><td><p>x</p>\n<p>&nbsp;</p></td></tr>");
    expect(html).toContain("<p>a</p>\n<p>&nbsp;</p>");
  });

  it("keeps a break at the start of a paragraph", () => {
    expect(bare(card(para(null, br, t("x"))))).toBe("<p><br>x</p>");
  });
});

describe("renderEmail: plain text", () => {
  const plain = email.text;

  it("is the full layout of the fixture", () => {
    expect(plain).toBe(
      [
        "Your Cash Back welcome bonus",
        "============================",
        "",
        "Hi Maya, earn $200 cash back after you spend $500 in the first 3 months.",
        "",
        "Read the full terms and rewards rules (https://coral.example/terms).",
        "",
        "Bold italic underlined all three",
        "",
        "Questions? Email help@coral.example or call 1-800-555-0100 (+18005550100).",
        "",
        "Coral Bank, N.A.",
        "PO Box 1000",
        "Wilmington, DE 19801",
        "",
        "",
        "",
        "Offer details",
        "-------------",
        "",
        "\u2022 Open your account by March 4, 2027.",
        "\u2022 Spend $500 on purchases.",
        "  \u25E6 Balance transfers don't count.",
        "",
        "How to claim",
        "",
        "3. Sign in.",
        "4. Choose Redeem.",
        "",
        "Rates and fees",
        "--------------",
        "",
        "Rate or fee | What you pay",
        "--------------------------",
        "Purchase APR | 21.99%",
        "No annual fee.",
        "No foreign transaction fee.",
        "",
        "----------------------------------------",
        "",
        "Legal notices",
        "-------------",
        "",
        "+---------------------------------------",
        "| State-specific terms for New Jersey residents are in your cardmember agreement.",
        "|",
        "| Interest starts on the transaction date.",
        "+---------------------------------------",
        "",
        "Coral Bank, N.A. Member FDIC.",
        "",
      ].join("\n"),
    );
  });

  it("separates top-level blocks with an empty line and ends with one newline", () => {
    expect(text(para(null, t("A")), para(null, t("B")))).toBe("A\n\nB\n");
    expect(text()).toBe("\n");
  });

  it("writes a blank paragraph as an empty line", () => {
    expect(text(para(null, t("A")), para(null), para(null, t("B")))).toBe("A\n\n\n\nB\n");
  });

  it("writes spaces, no-break spaces and breaks as typed, trimming nothing", () => {
    expect(text(para(null, t("   Lead  "), t("x\u00A0\u00A0y", { bold: true })), para(null, t("   ")))).toBe("   Lead  x\u00A0\u00A0y\n\n   \n");
    expect(text(para(null, br, t("after a break")))).toBe("\nafter a break\n");
    expect(text(para(null, t("a"), br, br, t("b")))).toBe("a\n\nb\n");
  });

  describe("headings", () => {
    it("underlines level 1 with = and level 2 with -, as long as the longest line, and leaves level 3 bare", () => {
      expect(text(heading(1, t("Title")))).toBe("Title\n=====\n");
      expect(text(heading(2, t("A longer one"), br, t("two")))).toBe("A longer one\ntwo\n------------\n");
      expect(text(heading(3, t("How to claim")))).toBe("How to claim\n");
    });

    it("draws at least three underline characters, counting code points", () => {
      expect(text(heading(1, t("A")))).toBe("A\n===\n");
      expect(text(heading(2, t("\u{1F600}\u{1F600}\u{1F600}\u{1F600}")))).toBe("\u{1F600}\u{1F600}\u{1F600}\u{1F600}\n----\n");
    });

    it("writes a blank heading as its line, without an underline", () => {
      expect(text(heading(1), para(null, t("x")))).toBe("\n\nx\n");
      expect(text(heading(2, t("  ")))).toBe("  \n");
    });
  });

  describe("lists", () => {
    it("writes each item as its marker, a space and the item's first line", () => {
      expect(text(numbered(3, "decimal", "period", [para(null, t("Sign in."))], [para(null, t("Choose."))]))).toBe("3. Sign in.\n4. Choose.\n");
      expect(text(bullets("disc", [para(null, t("a"))]), bullets("square", [para(null, t("b"))]))).toBe("\u2022 a\n\n\u25AA b\n");
    });

    it.each([
      [numbered(4, "lower-roman", "parens", [para(null, t("x"))]), "(iv) x\n"],
      [numbered(0, "decimal", "period", [para(null, t("x"))]), "0. x\n"],
      [numbered(9999, "decimal", "paren-right", [para(null, t("x"))], [para(null, t("y"))]), "9999) x\n10000) y\n"],
      [numbered(25, "lower-alpha", "parens", [para(null, t("x"))], [para(null, t("y"))], [para(null, t("z"))]), "(y) x\n(z) y\n(aa) z\n"],
    ])("prints the marker it is given: %#", (list, expected) => {
      expect(text(list)).toBe(expected);
    });

    it("hangs further lines and blocks by the marker's width plus one; empty lines stay empty", () => {
      expect(
        text(numbered(1, "lower-roman", "parens", [para(null, t("first"), br, t("second")), para(null), para(null, t("third"))])),
      ).toBe("(i) first\n    second\n\n    third\n");
    });

    it("indents nested lists from their item", () => {
      expect(
        text(numbered(10, "decimal", "period", [para(null, t("ten")), bullets("circle", [para(null, t("in")), numbered(1, "lower-alpha", "period", [para(null, t("deep"))])])])),
      ).toBe("10. ten\n    \u25E6 in\n      a. deep\n");
    });

    it("keeps an empty item's marker", () => {
      expect(text(numbered(1, "decimal", "period", [para(null)], [para(null, t("second"))]))).toBe("1.\n2. second\n");
      expect(text(bullets("disc", [para(null)]))).toBe("\u2022\n");
    });
  });

  describe("tables", () => {
    it("writes single-line cells as a | b, with the header row underlined", () => {
      expect(text(table([cellOf([para(null, t("Fee"))], { header: true }), cellOf([para(null, t("Amount"))], { header: true })], [cellOf([para(null, t("Annual"))]), cellOf([para(null, t("$95"))])]))).toBe(
        "Fee | Amount\n------------\nAnnual | $95\n",
      );
    });

    it("doesn't underline a header row that is the table's last", () => {
      expect(text(table([cellOf([para(null, t("Only"))], { header: true }), cellOf([para(null, t("header"))], { header: true })]))).toBe("Only | header\n");
    });

    it("lays multi-line cells out side by side, padding all but the last cell to its longest line", () => {
      expect(
        text(table([cellOf([para(null, t("Fee"), br, t("Annual fee"))]), cellOf([para(null, t("$95")), para(null, t("waived"))])])),
      ).toBe("Fee        | $95\nAnnual fee | waived\n");
    });

    it("joins an empty last piece with ' |' and leaves no trailing space", () => {
      expect(text(table([cellOf([para(null, t("one"), br, t("two"))]), cellOf([para(null, t("x"))])]))).toBe("one | x\ntwo |\n");
    });

    it("writes an empty cell as one empty line, padded like any other", () => {
      expect(text(table([cellOf([]), cellOf([para(null, t("x"))])], [cellOf([para(null, t("y"))]), cellOf([])]))).toBe(" | x\ny |\n");
    });

    it("writes a list in a cell with its markers", () => {
      expect(text(table([cellOf([numbered(1, "decimal", "period", [para(null, t("a"))], [para(null, t("b"))])]), cellOf([para(null, t("x"))])]))).toBe(
        "1. a | x\n2. b |\n",
      );
    });

    it("writes cells in reading order; spans add no separators", () => {
      const spanned: RenderBlock = {
        type: "table",
        id: null,
        columns: 2,
        rows: [{ cells: [cellOf([para(null, t("A"))], { rowspan: 2 }), cellOf([para(null, t("B"))])] }, { cells: [cellOf([para(null, t("C"))])] }, { cells: [cellOf([para(null, t("D E"))], { colspan: 2 })] }],
      };
      expect(text(spanned)).toBe("A | B\nC\nD E\n");
    });
  });

  it("frames callouts, with an empty line between paragraphs and blank lines kept", () => {
    expect(text({ type: "callout", id: null, content: [para(null, t("One")), para(null), para(null, t("  Two"))] })).toBe(
      ["+---------------------------------------", "| One", "|", "|", "|", "|   Two", "+---------------------------------------", ""].join("\n"),
    );
  });

  it("writes a rule as 40 dashes", () => {
    expect(text({ type: "rule", id: null })).toBe(`${"-".repeat(40)}\n`);
  });

  describe("links", () => {
    it.each([
      [t("terms", { href: "https://coral.example/terms" }), "terms (https://coral.example/terms)"],
      [t("help@coral.example", { href: "mailto:help@coral.example" }), "help@coral.example"],
      [t("call us", { href: "tel:+18005550100" }), "call us (+18005550100)"],
      [t("coral.example", { href: "https://coral.example" }), "coral.example (https://coral.example)"],
      [t("https://Coral.example/", { href: "https://coral.example" }), "https://Coral.example/"],
      [t("HTTPS://coral.example/café", { href: "https://coral.example/caf%C3%A9" }), "HTTPS://coral.example/café"],
      [t("  ", { href: "https://coral.example" }), "https://coral.example"],
    ])("writes %j as %j", (run, expected) => {
      expect(text(para(null, run))).toBe(`${expected}\n`);
    });

    it("keeps a break after a link out of the link's text", () => {
      expect(text(para(null, t("terms", { href: "https://coral.example" }), br, t("next line")))).toBe("terms (https://coral.example)\nnext line\n");
    });

    it("never writes a link that fails the link rule", () => {
      expect(text(para(null, t("x", { href: "javascript:alert(1)" })))).toBe("x\n");
    });
  });
});

describe("renderEmail: escaping", () => {
  const hostile = renderEmail(HOSTILE_DOC, { subject: `Hi ${SCRIPT}`, preheader: ATTR_BREAK });
  const hdom = parse(hostile.html);

  it("leaves <script> values inert in the body, the title and the preheader", () => {
    expect(hostile.html).not.toContain("<script>");
    expect(hdom.querySelectorAll("script, img")).toHaveLength(0);
    expect(hdom.title).toBe(`Hi ${SCRIPT}`);
    expect(hdom.body.firstElementChild!.textContent!.startsWith(ATTR_BREAK)).toBe(true);
    expect(hdom.querySelector("h2")!.textContent).toBe(SCRIPT);
  });

  it("drops unsafe links in HTML and text", () => {
    expect([...hdom.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      'https://coral.example/a"onmouseover="alert(1)',
    ]);
    expect(hostile.text).not.toContain("javascript:");
    expect(hostile.text).toContain("click me");
  });

  it("keeps the text alternative literal (it is not HTML)", () => {
    expect(hostile.text).toContain(`Hi ${SCRIPT} & ${ATTR_BREAK}`);
  });
});
