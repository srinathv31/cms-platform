// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  ATTR_BREAK,
  FULL_DOC,
  HOSTILE_DOC,
  br,
  bullets,
  cellOf,
  docOf,
  heading,
  numbered,
  para,
  t,
} from "./__fixtures__/web-email-docs";
import { PALETTE } from "./look";
import { renderWeb } from "./web";

// Parse the output the way a browser would, then look at the DOM rather than at the string.
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

const html = renderWeb(FULL_DOC);
const dom = parse(html);
const body = dom.querySelector("main")!;
const css = dom.querySelector("style")!.textContent!;

/** The <main> markup of a document. */
const main = (...blocks: Parameters<typeof docOf>) => {
  const out = renderWeb(docOf(...blocks));
  return out.slice(out.indexOf('<main class="doc">\n') + 19, out.indexOf("\n</main>"));
};

/** The declarations of the stylesheet rule whose selector is exactly `selector`. */
const rule = (selector: string) => {
  const found = css.split("}").find((r) => r.split("{")[0] === selector);
  return found?.split("{")[1] ?? "";
};

describe("renderWeb: the document", () => {
  it("is a complete HTML document with lang, charset, viewport and the template name as title", () => {
    expect(html.startsWith("<!doctype html>\n")).toBe(true);
    expect(dom.documentElement.getAttribute("lang")).toBe("en");
    expect(dom.querySelector("meta[charset]")?.getAttribute("charset")).toBe("utf-8");
    expect(dom.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
      "width=device-width, initial-scale=1",
    );
    expect(dom.title).toBe("Cash Back Welcome Bonus — Terms");
  });

  it("never prints the template name in the body", () => {
    expect(dom.body.textContent).not.toContain("Cash Back Welcome Bonus — Terms");
  });

  it("has one <style> block, no scripts and no external resources", () => {
    expect(dom.querySelectorAll("style")).toHaveLength(1);
    expect(dom.querySelectorAll("script, link, img, iframe, object, embed")).toHaveLength(0);
    expect(html).not.toMatch(/\bsrc=|@import|url\(/i);
  });

  it("styles a readable, responsive measure", () => {
    expect(css).toContain("max-width:42rem");
    expect(css).toContain("line-height:1.6");
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toMatch(/\.table-wrap\{[^}]*overflow-x:auto/);
    expect(css).toMatch(/system-ui/);
  });

  it("gives the same bytes for the same document", () => {
    expect(renderWeb(FULL_DOC)).toBe(html);
  });
});

describe("renderWeb: blocks", () => {
  it("renders headings at their levels", () => {
    expect([...body.querySelectorAll("h1, h2, h3")].map((h) => `${h.tagName}:${h.textContent}`)).toEqual([
      "H1:Your Cash Back welcome bonus",
      "H2:Offer details",
      "H3:How to claim",
      "H2:Rates and fees",
      "H2:Legal notices",
    ]);
  });

  it("renders marks as strong, em and u", () => {
    const p = [...body.querySelectorAll("p")].find((el) => el.textContent?.startsWith("Bold"))!;
    expect(p.innerHTML).toBe(
      "<strong>Bold</strong> <em>italic</em> <u>underlined</u> <strong><em><u>all three</u></em></strong>",
    );
  });

  it("joins consecutive runs with the same link into one anchor", () => {
    const links = [...body.querySelectorAll("a")];
    const terms = links.filter((a) => a.getAttribute("href") === "https://coral.example/terms");
    expect(terms).toHaveLength(1);
    expect(terms[0]!.innerHTML).toBe("<em>full terms</em> and <strong>rewards rules</strong>");
  });

  it("keeps mailto and tel links", () => {
    const hrefs = [...body.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("mailto:help@coral.example");
    expect(hrefs).toContain("tel:+18005550100");
  });

  it("turns hard breaks into <br>", () => {
    const p = [...body.querySelectorAll("p")].find((el) => el.textContent?.startsWith("Coral Bank, N.A.PO"))!;
    expect(p.querySelectorAll("br")).toHaveLength(2);
  });

  it("renders tables with a header row, scopes and spans, inside a scroll wrapper", () => {
    const wrap = body.querySelector(".table-wrap")!;
    const table = wrap.querySelector("table")!;
    expect([...table.querySelectorAll("thead th")].map((th) => [th.textContent, th.getAttribute("scope")])).toEqual([
      ["Rate or fee", "col"],
      ["What you pay", "col"],
    ]);
    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect([...rows[0]!.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Purchase APR", "21.99%"]);
    const spanned = rows[1]!.querySelector("td")!;
    expect(spanned.getAttribute("colspan")).toBe("2");
    expect(spanned.querySelectorAll("p")).toHaveLength(2);
  });

  it("keeps a cell whose content was removed, empty", () => {
    expect(main({ type: "table", id: null, columns: 2, rows: [{ cells: [cellOf([]), cellOf([para(null, t("x"))])] }] })).toContain(
      "<tr><td></td><td><p>x</p></td></tr>",
    );
  });

  it("renders callouts as a note with an (i) glyph drawn as inline SVG", () => {
    const callout = body.querySelector(".callout")!;
    expect(callout.getAttribute("role")).toBe("note");
    expect(callout.querySelectorAll("p")).toHaveLength(2);
    expect(callout.textContent).toContain("New Jersey residents");
    const glyph = callout.querySelector("svg.callout-glyph")!;
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.getAttribute("stroke")).toBe("currentColor");
    // Sized by attribute too, so it stays glyph-sized if a site replaces the stylesheet.
    expect([glyph.getAttribute("width"), glyph.getAttribute("height")]).toEqual(["18", "18"]);
    expect(glyph.querySelectorAll("circle, path")).toHaveLength(3);
    expect(glyph.textContent).toBe("");
  });

  it("styles callouts like the PDF's: stone tint and hairline, its radius and padding, no accent rule", () => {
    const callout = rule(".callout");
    expect(callout).toContain(`background:${PALETTE.callout.fill}`);
    expect(callout).toContain(`border:1px solid ${PALETTE.callout.line}`);
    expect(callout).toContain("border-radius:0.4em");
    expect(callout).toContain("padding:0.9em 1.2em 0.9em 3em");
    expect(callout).not.toContain("border-left");
    const glyph = rule(".callout-glyph");
    expect(glyph).toContain(`color:${PALETTE.callout.glyph}`);
    expect(glyph).toContain("left:1.1em");
    expect(glyph).toContain("width:1.05em");
  });

  it("renders the rule", () => {
    expect(body.querySelectorAll("hr")).toHaveLength(1);
  });

  it("renders every paragraph of the document, blank ones included", () => {
    const count = (blocks: readonly { type: string }[]): number =>
      blocks.reduce((n, b) => {
        const block = b as (typeof FULL_DOC.blocks)[number];
        if (block.type === "paragraph") return n + 1;
        if (block.type === "list") return n + block.items.reduce((m, item) => m + count(item.content), 0);
        if (block.type === "table") return n + block.rows.reduce((m, row) => m + row.cells.reduce((k, c) => k + count(c.content), 0), 0);
        if (block.type === "callout") return n + block.content.length;
        return n;
      }, 0);
    expect(body.querySelectorAll("p")).toHaveLength(count(FULL_DOC.blocks));
  });
});

describe("renderWeb: lists print the RenderDoc's markers as text", () => {
  it("turns off the browser's numbering and never writes start or type", () => {
    expect(rule("ul,ol")).toContain("list-style:none");
    expect(html).not.toMatch(/<ol[^>]*\b(start|type)=/);
    expect(css).not.toMatch(/list-style-type|counter\(/);
  });

  it("prints each item's marker as text, before the item's content", () => {
    const ul = body.querySelector("main > ul")!;
    expect([...ul.children].map((li) => li.querySelector(".marker")!.textContent)).toEqual(["\u2022", "\u2022"]);
    expect(ul.children[0]!.innerHTML).toBe('<span class="marker">\u2022</span><div><p>Open your account by March 4, 2027.</p></div>');
    expect(ul.querySelector("li > div > ul > li")!.textContent).toBe("\u25E6Balance transfers don't count.");
    const ol = body.querySelector("ol")!;
    expect([...ol.children].map((li) => li.textContent)).toEqual(["3.Sign in.", "4.Choose Redeem."]);
  });

  it.each([
    [numbered(4, "lower-roman", "parens", [para(null, t("x"))]), "(iv)"],
    [numbered(0, "decimal", "period", [para(null, t("x"))]), "0."],
    [numbered(10000, "decimal", "paren-right", [para(null, t("x"))]), "10000)"],
    [numbered(27, "upper-alpha", "period", [para(null, t("x"))]), "AA."],
    [bullets("square", [para(null, t("x"))]), "\u25AA"],
  ])("prints the marker it is given: %#", (list, marker) => {
    expect(main(list)).toContain(`<li><span class="marker">${marker}</span><div><p>x</p></div></li>`);
  });

  it("lays items out as a hanging indent: markers right-aligned in their own column", () => {
    expect(rule("ul,ol")).toContain("display:grid");
    expect(rule("li")).toContain("grid-template-columns:subgrid");
    expect(rule(".marker")).toContain("text-align:right");
  });

  it("puts an item's further blocks after its marker, in the same column as its first", () => {
    const out = main(bullets("disc", [para(null, t("first")), para(null), bullets("circle", [para(null, t("nested"))])]));
    expect(out).toBe(
      [
        "<ul>",
        '<li><span class="marker">\u2022</span><div><p>first</p>',
        "<p><br></p>",
        "<ul>",
        '<li><span class="marker">\u25E6</span><div><p>nested</p></div></li>',
        "</ul></div></li>",
        "</ul>",
      ].join("\n"),
    );
  });
});

describe("renderWeb: blank lines, spaces and breaks", () => {
  it("renders a blank paragraph as one line", () => {
    expect(main(para(null, t("A")), para(null), para(null, t("B")))).toBe("<p>A</p>\n<p><br></p>\n<p>B</p>");
  });

  it("renders blank paragraphs inside list items, cells and callouts", () => {
    const out = main(
      bullets("disc", [para(null)]),
      { type: "table", id: null, columns: 1, rows: [{ cells: [cellOf([para(null)])] }] },
      { type: "callout", id: null, content: [para(null, t("a")), para(null)] },
    );
    expect(out.match(/<p><br><\/p>/g)).toHaveLength(3);
  });

  it("renders an empty heading as one line of its level", () => {
    expect(main(heading(2), para(null, t("after")))).toBe("<h2><br></h2>\n<p>after</p>");
  });

  it("styles exactly the elements that hold text pre-wrap, so spaces render as typed", () => {
    expect(rule("p,h1,h2,h3")).toBe("white-space:pre-wrap");
    // Block containers aren't: their source newlines between children would show as lines.
    expect(css).not.toMatch(/(?:^|[},])(?:li|td|th|ul|ol|\.callout|\.doc|body)[^{]*\{[^}]*white-space:pre/);
  });

  it("writes spaces as typed: leading, trailing and runs, across runs and after a break", () => {
    expect(main(para(null, t("   Lead"), t("  a  ", { bold: true }), t("b   "), br, t("    indented")))).toBe(
      "<p>   Lead<strong>  a  </strong>b   <br>    indented</p>",
    );
  });

  it("writes a paragraph of spaces as a line holding them", () => {
    expect(main(para(null, t("   ")), para(null, t("x")))).toBe("<p>   </p>\n<p>x</p>");
  });

  it("writes every no-break space as &nbsp;", () => {
    expect(main(para(null, t("a\u00A0\u00A0b")))).toBe("<p>a&nbsp;&nbsp;b</p>");
    expect(parse(renderWeb({ ...docOf(), templateName: "A\u00A0B" })).head.innerHTML).toContain("<title>A&nbsp;B</title>");
  });

  it("keeps a break at the start of a paragraph", () => {
    expect(main(para(null, br, t("x")))).toBe("<p><br>x</p>");
  });
});

describe("renderWeb: links", () => {
  it("writes a link's normalized href, and no link for one that fails the link rule", () => {
    expect(main(para(null, t("a", { href: "HTTPS://Coral.example/café" }), t(" "), t("b", { href: "https://coral.example/card terms" })))).toBe(
      '<p><a href="https://Coral.example/caf%C3%A9">a</a> b</p>',
    );
  });

  it("keeps a break inside a link only when the link goes on after it", () => {
    const href = "https://coral.example";
    expect(main(para(null, t("a", { href }), br, t("b", { href })))).toBe(`<p><a href="${href}">a<br>b</a></p>`);
    expect(main(para(null, t("a", { href }), br, t("b")))).toBe(`<p><a href="${href}">a</a><br>b</p>`);
  });
});

describe("renderWeb: escaping", () => {
  const hostile = renderWeb(HOSTILE_DOC);
  const hdom = parse(hostile);

  it("leaves a <script> value inert, as text", () => {
    expect(hdom.querySelectorAll("script")).toHaveLength(0);
    expect(hostile).not.toContain("<script>");
    expect(hdom.querySelector("h2")!.textContent).toBe("<script>alert(1)</script>");
    expect(hdom.querySelector("td")!.textContent).toBe("<script>alert(1)</script>");
  });

  it("keeps an attribute-breaking value inside its text", () => {
    expect(hdom.querySelectorAll("img")).toHaveLength(0);
    expect(hdom.querySelector(".callout")!.textContent!.trim()).toBe(ATTR_BREAK);
    expect(hdom.querySelectorAll("[onerror], [onmouseover]")).toHaveLength(0);
  });

  it("escapes the template name in <title>", () => {
    expect(hdom.title).toBe("Terms</title><script>alert(1)</script>");
    expect(hdom.head.querySelectorAll("script")).toHaveLength(0);
  });

  it("drops links that aren't http(s), mailto or tel, and keeps their text", () => {
    const hrefs = [...hdom.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(['https://coral.example/a"onmouseover="alert(1)']);
    expect(hdom.body.textContent).toContain("click me");
    expect(hdom.body.textContent).toContain("sneaky");
    expect(hdom.body.textContent).toContain("data link");
  });
});
