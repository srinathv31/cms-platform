// RenderDoc fixtures for the web and email adapter tests. Hand-built, already resolved: variables
// appear as text runs carrying their key, as resolveDocument produces them.

import type {
  RenderBlock,
  RenderCellBlock,
  RenderDoc,
  RenderHeading,
  RenderInline,
  RenderList,
  RenderParagraph,
  RenderTableCell,
  RenderText,
} from "@/domain/render/types";
import { formatMarker, type MarkerDelimiter, type MarkerFormat } from "@/editor/model/list-markers";

export const t = (text: string, marks: Omit<RenderText, "type" | "text"> = {}): RenderText => ({ type: "text", text, ...marks });
export const v = (variable: string, text: string): RenderText => ({ type: "text", text, variable });
export const br: RenderInline = { type: "break" };
export const para = (id: string | null, ...content: RenderInline[]): RenderParagraph => ({ type: "paragraph", id, content });
export const heading = (level: 1 | 2 | 3, ...content: RenderInline[]): RenderHeading => ({ type: "heading", id: null, level, section: null, content });

/** A bulleted list; each item is its blocks. */
export const bullets = (bullet: "disc" | "circle" | "square", ...items: RenderBlock[][]): RenderList => ({
  type: "list",
  id: null,
  ordered: false,
  bullet,
  items: items.map((content) => ({ marker: { disc: "\u2022", circle: "\u25E6", square: "\u25AA" }[bullet], content })),
});

/** A numbered list with its markers written by formatMarker, as the resolver writes them. */
export const numbered = (start: number, format: MarkerFormat, delimiter: MarkerDelimiter, ...items: RenderBlock[][]): RenderList => ({
  type: "list",
  id: null,
  ordered: true,
  start,
  format,
  delimiter,
  items: items.map((content, i) => ({ marker: formatMarker(start + i, format, delimiter), content })),
});

export const cellOf = (content: RenderCellBlock[], extra: Partial<RenderTableCell> = {}): RenderTableCell => ({
  header: false,
  colspan: 1,
  rowspan: 1,
  content,
  ...extra,
});

/** A RenderDoc around some blocks. */
export const docOf = (...blocks: RenderBlock[]): RenderDoc => ({ templateId: "UC-TEST", templateName: "Test", versionNumber: 1, blocks });

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
      bullet: "disc",
      items: [
        { marker: "\u2022", content: [para(null, t("Open your account by "), v("offer_end_date", "March 4, 2027"), t("."))] },
        {
          marker: "\u2022",
          content: [
            para(null, t("Spend $500 on purchases.")),
            {
              type: "list",
              id: null,
              ordered: false,
              bullet: "circle",
              items: [{ marker: "\u25E6", content: [para(null, t("Balance transfers don't count."))] }],
            },
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
      format: "decimal",
      delimiter: "period",
      items: [
        { marker: "3.", content: [para(null, t("Sign in."))] },
        { marker: "4.", content: [para(null, t("Choose "), t("Redeem", { bold: true }), t("."))] },
      ],
    },
    { type: "heading", id: "b_h_rates", level: 2, section: "rates_and_fees", content: [t("Rates and fees")] },
    {
      type: "table",
      id: "b_rates",
      columns: 2,
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
      columns: 1,
      rows: [{ cells: [{ header: false, colspan: 1, rowspan: 1, content: [para(null, v("first_name", SCRIPT))] }] }],
    },
    { type: "callout", id: "b_c", content: [para(null, v("last_name", ATTR_BREAK))] },
  ],
};
