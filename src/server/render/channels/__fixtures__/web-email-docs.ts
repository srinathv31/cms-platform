// RenderDoc fixtures for the web and email adapter tests. Hand-built, already resolved: variables
// appear as text runs carrying their key, as resolveDocument produces them.

import type { RenderBlock, RenderDoc, RenderInline, RenderText } from "@/domain/render/types";

const t = (text: string, marks: Omit<RenderText, "type" | "text"> = {}): RenderText => ({ type: "text", text, ...marks });
const v = (variable: string, text: string): RenderText => ({ type: "text", text, variable });
const br: RenderInline = { type: "break" };
const para = (id: string | null, ...content: RenderInline[]): RenderBlock => ({ type: "paragraph", id, content });

/** Every block type and mark the contract has, in a realistic disclosure. */
export const FULL_DOC: RenderDoc = {
  templateId: "UC-4F7K2Q",
  templateName: "Cash Back Welcome Bonus — Terms",
  versionNumber: 2,
  blocks: [
    { type: "heading", id: "b_title", level: 1, section: null, content: [t("Your Cash Back welcome bonus")] },
    para("b_intro", t("Hi "), v("first_name", "Maya"), t(", earn "), t("$200 cash back", { bold: true }), t(" after you spend $500 in the first 3 months.")),
    para("b_terms", t("Read the "), t("full terms", { href: "https://coral.example/terms", italic: true }), t(" and ", { href: "https://coral.example/terms" }), t("rewards rules", { href: "https://coral.example/terms", bold: true }), t(".")),
    para("b_marks", t("Bold", { bold: true }), t(" "), t("italic", { italic: true }), t(" "), t("underlined", { underline: true }), t(" "), t("all three", { bold: true, italic: true, underline: true })),
    para("b_contact", t("Questions? Email "), t("help@coral.example", { href: "mailto:help@coral.example" }), t(" or call "), t("1-800-555-0100", { href: "tel:+18005550100" }), t(".")),
    para("b_address", t("Coral Bank, N.A."), br, t("PO Box 1000"), br, t("Wilmington, DE 19801")),
    para("b_blank"),
    { type: "heading", id: "b_h_offer", level: 2, section: "offer_details", content: [t("Offer details")] },
    {
      type: "list",
      id: "b_elig",
      ordered: false,
      start: 1,
      items: [
        { content: [para(null, t("Open your account by "), v("offer_end_date", "March 4, 2027"), t("."))] },
        {
          content: [
            para(null, t("Spend $500 on purchases.")),
            { type: "list", id: null, ordered: false, start: 1, items: [{ content: [para(null, t("Balance transfers don't count."))] }] },
          ],
        },
      ],
    },
    { type: "heading", id: "b_steps", level: 3, section: null, content: [t("How to claim")] },
    {
      type: "list",
      id: "b_steps_list",
      ordered: true,
      start: 3,
      items: [{ content: [para(null, t("Sign in."))] }, { content: [para(null, t("Choose "), t("Redeem", { bold: true }), t("."))] }],
    },
    { type: "heading", id: "b_h_rates", level: 2, section: "rates_and_fees", content: [t("Rates and fees")] },
    {
      type: "table",
      id: "b_rates",
      rows: [
        {
          cells: [
            { header: true, colspan: 1, rowspan: 1, content: [para(null, t("Rate or fee"))] },
            { header: true, colspan: 1, rowspan: 1, content: [para(null, t("What you pay"))] },
          ],
        },
        {
          cells: [
            { header: false, colspan: 1, rowspan: 1, content: [para(null, t("Purchase APR"))] },
            { header: false, colspan: 1, rowspan: 1, content: [para(null, v("purchase_apr", "21.99%"))] },
          ],
        },
        {
          cells: [
            { header: false, colspan: 2, rowspan: 1, content: [para(null, t("No annual fee.")), para(null, t("No foreign transaction fee."))] },
          ],
        },
      ],
    },
    { type: "rule", id: "b_rule" },
    { type: "heading", id: "b_h_legal", level: 2, section: "legal_notices", content: [t("Legal notices")] },
    {
      type: "callout",
      id: "b_callout",
      content: [
        para(null, t("State-specific terms for "), v("home_state", "New Jersey"), t(" residents are in your cardmember agreement.")),
        para(null, t("Interest starts on the transaction date.")),
      ],
    },
    para("b_issuer", t("Coral Bank, N.A. Member FDIC.")),
  ],
};

/** Hostile values everywhere a value or a document string can land. */
export const SCRIPT = "<script>alert(1)</script>";
export const ATTR_BREAK = '"><img src=x onerror=alert(1)>';

export const HOSTILE_DOC: RenderDoc = {
  templateId: "UC-4F7K2Q",
  templateName: `Terms</title>${SCRIPT}`,
  versionNumber: null,
  blocks: [
    { type: "heading", id: "b_h", level: 2, section: null, content: [v("first_name", SCRIPT)] },
    para("b_p", t("Hi "), v("first_name", SCRIPT), t(" & "), v("last_name", ATTR_BREAK)),
    para("b_js", t("click me", { href: "javascript:alert(1)" })),
    para("b_js2", t("sneaky", { href: " JaVaScRiPt:alert(1)" })),
    para("b_data", t("data link", { href: "data:text/html,<script>alert(1)</script>" })),
    para("b_quote", t("quoted", { href: 'https://coral.example/a"onmouseover="alert(1)' })),
    {
      type: "table",
      id: "b_t",
      rows: [{ cells: [{ header: false, colspan: 1, rowspan: 1, content: [para(null, v("first_name", SCRIPT))] }] }],
    },
    { type: "callout", id: "b_c", content: [para(null, v("last_name", ATTR_BREAK))] },
  ],
};
