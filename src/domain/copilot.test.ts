// The Copilot prompt: the draft as Markdown, and the prompt text (snapshot: it is deterministic).
// The round trip through the editor's Markdown paste is in components/workspace/copilot.

import { describe, expect, it } from "vitest";
import { buildCopilotPrompt, documentToMarkdown } from "./copilot";
import type { CopilotPromptInput } from "./import-types";
import type { JSONContent, RequiredSection, Variable } from "./types";

const text = (value: string, marks?: string[]): JSONContent =>
  marks ? { type: "text", text: value, marks: marks.map((type) => ({ type })) } : { type: "text", text: value };
const chip = (key: string, marks?: string[]): JSONContent =>
  marks ? { type: "variable", attrs: { key }, marks: marks.map((type) => ({ type })) } : { type: "variable", attrs: { key } };
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const h = (level: number, title: string, requiredKey: string | null = null): JSONContent => ({
  type: "heading",
  attrs: { id: `h-${title}`, level, requiredKey },
  content: [text(title)],
});
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const cell = (type: "tableHeader" | "tableCell", ...content: JSONContent[]): JSONContent => ({ type, content: [p(...content)] });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

const SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
  { key: "promo_code", label: "Promo code", type: "text", required: false, sample: "" },
];

const DRAFT = doc(
  h(2, "Offer details", "offer_details"),
  p(text("Hi "), chip("first_name"), text(", earn a "), text("$200 ", ["bold"]), text("credit", ["bold", "italic"]), text(".")),
  {
    type: "bulletList",
    content: [
      li(p(text("Spend $2,000 in 3 months"))),
      li(p(text("Then more")), { type: "orderedList", attrs: { start: 1 }, content: [li(p(text("Nested")))] }),
    ],
  },
  { type: "paragraph" },
  h(2, "Rates and fees", "rates_and_fees"),
  {
    type: "table",
    content: [
      { type: "tableRow", content: [cell("tableHeader", text("Rate")), cell("tableHeader", text("What you pay"))] },
      { type: "tableRow", content: [cell("tableCell", text("Purchase APR")), cell("tableCell", chip("purchase_apr"))] },
    ],
  },
  h(3, "How interest works"),
  p(text("See "), { type: "text", text: "the terms", marks: [{ type: "link", attrs: { href: "https://example.com/terms" } }] }, text(" [and *more*].")),
  { type: "horizontalRule" },
  h(2, "Legal notices", "legal_notices"),
  { type: "callout", content: [p(text("Terms apply."))] },
);

const input = (body: JSONContent, overrides: Partial<CopilotPromptInput> = {}): CopilotPromptInput => ({
  templateName: "Spring offer",
  teamName: "Coral Offers",
  contentTypeName: "Disclosure",
  channels: ["email", "pdf"],
  requiredSections: SECTIONS,
  variables: VARIABLES,
  body,
  ...overrides,
});

describe("documentToMarkdown", () => {
  it("headings, paragraphs, lists, tables, rules, marks, links and chips", () => {
    expect(documentToMarkdown(DRAFT)).toBe(
      [
        "## Offer details",
        "",
        "Hi {{first_name}}, earn a **$200** ***credit***.",
        "",
        "- Spend $2,000 in 3 months\n- Then more\n  1. Nested",
        "",
        "## Rates and fees",
        "",
        "| Rate | What you pay |\n| --- | --- |\n| Purchase APR | {{purchase_apr}} |",
        "",
        "### How interest works",
        "",
        "See [the terms](https://example.com/terms) \\[and \\*more\\*\\].",
        "",
        "---",
        "",
        "## Legal notices",
        "",
        "Terms apply.",
      ].join("\n"),
    );
  });

  it("an empty body is empty", () => {
    expect(documentToMarkdown(doc())).toBe("");
    expect(documentToMarkdown(doc({ type: "paragraph" }))).toBe("");
  });
});

describe("buildCopilotPrompt", () => {
  it("with a draft: the template, sections, placeholders, rules, then the draft (snapshot)", () => {
    const prompt = buildCopilotPrompt(input(DRAFT));
    expect(prompt.includesDraft).toBe(true);
    expect(prompt.text).toMatchInlineSnapshot(`
      "Help me write the body of a disclosure for Coral Offers.

      Template: Spring offer
      Team: Coral Offers
      Content type: Disclosure
      Published as: PDF and email

      Use these section headings, exactly as written and in this order:
      ## Offer details
      ## Rates and fees
      ## Legal notices

      Placeholders for customer-specific values (write each exactly as shown, double braces included):
      - {{first_name}}: First name (Text, required)
      - {{purchase_apr}}: Purchase APR (Percent, required)
      - {{promo_code}}: Promo code (Text, optional)

      Rules:
      - Use only these placeholders for customer-specific values. If you need a new one, write it as {{lowercase_snake_case}}.
      - Leave every {{placeholder}} and every {{#if …}} or {{/if}} tag exactly as written: never rename it, translate it or fill in a value.
      - Do not invent rates, fees or legal terms; use a {{placeholder}}.
      - Use plain language a customer understands.
      - Answer in Markdown only: ## headings, paragraphs, - lists and pipe tables.
      - No preamble and no closing remarks: start with the first heading.

      Improve this draft:

      ## Offer details

      Hi {{first_name}}, earn a **$200** ***credit***.

      - Spend $2,000 in 3 months
      - Then more
        1. Nested

      ## Rates and fees

      | Rate | What you pay |
      | --- | --- |
      | Purchase APR | {{purchase_apr}} |

      ### How interest works

      See [the terms](https://example.com/terms) \\[and \\*more\\*\\].

      ---

      ## Legal notices

      Terms apply."
    `);
  });

  it("without text outside the required headings: \"Write it\" (snapshot)", () => {
    const blank = doc(h(2, "Offer details", "offer_details"), { type: "paragraph" }, h(2, "Rates and fees", "rates_and_fees"), h(2, "Legal notices", "legal_notices"));
    const prompt = buildCopilotPrompt(input(blank, { variables: [], channels: ["pdf", "web", "email"] }));
    expect(prompt.includesDraft).toBe(false);
    expect(prompt.text).toMatchInlineSnapshot(`
      "Help me write the body of a disclosure for Coral Offers.

      Template: Spring offer
      Team: Coral Offers
      Content type: Disclosure
      Published as: PDF, web page and email

      Use these section headings, exactly as written and in this order:
      ## Offer details
      ## Rates and fees
      ## Legal notices

      There are no placeholders yet.

      Rules:
      - Write customer-specific values as placeholders: {{lowercase_snake_case}}.
      - Leave every {{placeholder}} and every {{#if …}} or {{/if}} tag exactly as written: never rename it, translate it or fill in a value.
      - Do not invent rates, fees or legal terms; use a {{placeholder}}.
      - Use plain language a customer understands.
      - Answer in Markdown only: ## headings, paragraphs, - lists and pipe tables.
      - No preamble and no closing remarks: start with the first heading.

      Write the body now."
    `);
  });

  it("doesn't send the placeholder name \"Untitled template\"", () => {
    const text = buildCopilotPrompt(input(DRAFT, { templateName: "Untitled template" })).text;
    expect(text).not.toContain("Untitled");
    expect(text).not.toContain("Template:");
    expect(text).toContain("Team: Coral Offers");
  });

  it("a draft that opens with a greeting keeps its opening; one that opens with a heading starts at the first heading", () => {
    const greeting = doc(p(text("Dear "), chip("first_name"), text(",")), h(2, "Offer details", "offer_details"), p(text("Earn $200.")));
    const kept = buildCopilotPrompt(input(greeting)).text;
    expect(kept).toContain("- No preamble and no closing remarks: keep the draft's opening as it is.");
    expect(kept).not.toContain("start with the first heading");
    expect(buildCopilotPrompt(input(DRAFT)).text).toContain("start with the first heading.");
  });

  it("tells Copilot to leave logic tags alone and not to invent terms", () => {
    const text = buildCopilotPrompt(input(DRAFT)).text;
    expect(text).toContain("{{#if …}} or {{/if}} tag exactly as written");
    expect(text).toContain("Do not invent rates, fees or legal terms; use a {{placeholder}}.");
  });

  it("a chip alone counts as draft text", () => {
    expect(buildCopilotPrompt(input(doc(h(2, "Offer details", "offer_details"), p(chip("first_name"))))).includesDraft).toBe(true);
  });

  it("is deterministic, and channels follow the product's order", () => {
    expect(buildCopilotPrompt(input(DRAFT)).text).toBe(buildCopilotPrompt(input(DRAFT)).text);
    expect(buildCopilotPrompt(input(DRAFT, { channels: ["email", "web", "pdf"] })).text).toContain("Published as: PDF, web page and email");
  });
});
