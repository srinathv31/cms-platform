// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ATTR_BREAK, FULL_DOC, HOSTILE_DOC } from "./__fixtures__/web-email-docs";
import { PALETTE } from "./look";
import { renderWeb } from "./web";

// Parse the output the way a browser would, then look at the DOM rather than at the string.
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

const html = renderWeb(FULL_DOC);
const dom = parse(html);
const body = dom.querySelector("main")!;

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
    const css = dom.querySelector("style")!.textContent!;
    expect(css).toContain("max-width:42rem");
    expect(css).toContain("line-height:1.6");
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toMatch(/\.table-wrap\{[^}]*overflow-x:auto/);
    expect(css).toMatch(/system-ui/);
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

  it("drops blank paragraphs", () => {
    expect([...body.querySelectorAll("p")].filter((p) => p.textContent?.trim() === "")).toHaveLength(0);
  });

  it("renders bullet, nested and ordered lists, with the start number", () => {
    const ul = body.querySelector("main > ul")!;
    expect(ul.children).toHaveLength(2);
    expect(ul.children[0]!.textContent).toBe("Open your account by March 4, 2027.");
    expect(ul.querySelector("li > ul > li")?.textContent).toBe("Balance transfers don't count.");
    const ol = body.querySelector("ol")!;
    expect(ol.getAttribute("start")).toBe("3");
    expect([...ol.children].map((li) => li.textContent)).toEqual(["Sign in.", "Choose Redeem."]);
  });

  it("puts a single-paragraph list item's text straight in the <li>", () => {
    expect(body.querySelector("ol > li")!.innerHTML).toBe("Sign in.");
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
    const css = dom.querySelector("style")!.textContent!;
    const callout = css.match(/\.callout\{([^}]*)\}/)![1];
    expect(callout).toContain(`background:${PALETTE.callout.fill}`);
    expect(callout).toContain(`border:1px solid ${PALETTE.callout.line}`);
    expect(callout).toContain("border-radius:0.4em");
    expect(callout).toContain("padding:0.9em 1.2em 0.9em 3em");
    expect(callout).not.toContain("border-left");
    const glyph = css.match(/\.callout-glyph\{([^}]*)\}/)![1];
    expect(glyph).toContain(`color:${PALETTE.callout.glyph}`);
    expect(glyph).toContain("left:1.1em");
    expect(glyph).toContain("width:1.05em");
  });

  it("renders the rule", () => {
    expect(body.querySelectorAll("hr")).toHaveLength(1);
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
