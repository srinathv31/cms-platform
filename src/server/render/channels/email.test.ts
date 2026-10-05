// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ATTR_BREAK, FULL_DOC, HOSTILE_DOC, SCRIPT } from "./__fixtures__/web-email-docs";
import { renderEmail } from "./email";
import { PALETTE } from "./look";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

const fields = { subject: "Maya, your bonus is waiting", preheader: "Earn $200 cash back in your first 3 months." };
const email = renderEmail(FULL_DOC, fields);
const dom = parse(email.html);

describe("renderEmail: subject and preheader", () => {
  it("returns the fields it was given", () => {
    expect(email.subject).toBe(fields.subject);
    expect(email.preheader).toBe(fields.preheader);
  });

  it("keeps subject and preheader on one line", () => {
    const out = renderEmail(FULL_DOC, { subject: "  Hello\r\nBcc: x@evil.example ", preheader: "a\n\n b" });
    expect(out.subject).toBe("Hello Bcc: x@evil.example");
    expect(out.preheader).toBe("a b");
  });

  it("puts the preheader in a hidden span at the very top of the body", () => {
    const first = dom.body.firstElementChild!;
    expect(first.tagName).toBe("SPAN");
    expect(first.getAttribute("style")).toContain("display:none");
    expect(first.getAttribute("style")).toContain("mso-hide:all");
    expect(first.textContent!.startsWith(fields.preheader)).toBe(true);
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
});

describe("renderEmail: HTML", () => {
  it("lays out in a 600px table container", () => {
    const card = dom.querySelector('table[width="600"]')!;
    expect(card).not.toBeNull();
    expect(card.getAttribute("style")).toContain("max-width:600px");
    expect(card.getAttribute("role")).toBe("presentation");
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

  it("renders headings, marks, links, lists, tables, callouts and the rule", () => {
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
    expect(content.querySelector("ol")!.getAttribute("start")).toBe("3");
    expect(content.querySelector("ul ul li")!.textContent).toBe("Balance transfers don't count.");
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

describe("renderEmail: plain text", () => {
  const text = email.text;

  it("underlines H1 with = and H2 with -, and leaves H3 as a line", () => {
    expect(text).toContain("Your Cash Back welcome bonus\n============================");
    expect(text).toContain("Offer details\n-------------");
    expect(text).toContain("\n\nHow to claim\n\n");
  });

  it("separates paragraphs with blank lines", () => {
    expect(text).toContain(
      "Hi Maya, earn $200 cash back after you spend $500 in the first 3 months.\n\nRead the full terms and rewards rules (https://coral.example/terms).",
    );
  });

  it("writes links as text (url), with bare mailto and tel addresses", () => {
    expect(text).toContain("full terms and rewards rules (https://coral.example/terms)");
    expect(text).toContain("Email help@coral.example or call 1-800-555-0100 (+18005550100).");
  });

  it("keeps hard breaks as newlines", () => {
    expect(text).toContain("Coral Bank, N.A.\nPO Box 1000\nWilmington, DE 19801");
  });

  it("marks lists with - and numbers, nested items indented", () => {
    expect(text).toContain(
      "- Open your account by March 4, 2027.\n- Spend $500 on purchases.\n  - Balance transfers don't count.",
    );
    expect(text).toContain("3. Sign in.\n4. Choose Redeem.");
  });

  it("writes tables as rows, with the header row underlined", () => {
    expect(text).toContain(
      "Rate or fee | What you pay\n--------------------------\nPurchase APR | 21.99%\nNo annual fee. No foreign transaction fee.",
    );
  });

  it("frames callouts", () => {
    expect(text).toContain(
      "+---------------------------------------\n| State-specific terms for New Jersey residents are in your cardmember agreement.\n|\n| Interest starts on the transaction date.\n+---------------------------------------",
    );
  });

  it("has no blank-paragraph gaps, no markup and ends with one newline", () => {
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text.endsWith("Coral Bank, N.A. Member FDIC.\n")).toBe(true);
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
