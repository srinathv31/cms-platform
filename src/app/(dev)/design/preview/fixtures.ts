// Fixtures for the Preview split-view mock: the Spring Travel Rewards disclosure, its variables, the
// sample sets and the email fields. Self-contained apart from the variable list and the template model
// borrowed from the workspace study.

import type { JSONContent } from "@/editor";
import { CORAL_VARIABLES, modelFor } from "../workspace/fixtures";
import type { ChannelId, TemplateModel } from "../workspace/types";
import type { PreviewSet } from "./types";

export const TEMPLATE_NAME = "Spring Travel Rewards — Terms";
export const TEMPLATE_ID = "UC-4F7K2Q";
export const VARIABLES = CORAL_VARIABLES;
export const ALL_CHANNELS: ChannelId[] = ["pdf", "web", "email"];

export function draftModel(name: string, channels: ChannelId[]): TemplateModel {
  return modelFor("draft", name, channels);
}

// ── tiny builders ────────────────────────────────────────────────

type Inline = JSONContent;
type Mark = NonNullable<JSONContent["marks"]>[number];

const t = (text: string, ...marks: Mark[]): Inline => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const v = (key: string): Inline => ({ type: "variable", attrs: { key } });
const bold: Mark = { type: "bold" };
const p = (...content: Inline[]): JSONContent => ({ type: "paragraph", content });
const h2 = (text: string, requiredKey: string): JSONContent => ({
  type: "heading",
  attrs: { level: 2, requiredKey },
  content: [t(text)],
});
const ul = (...items: Inline[][]): JSONContent => ({
  type: "bulletList",
  content: items.map((content) => ({ type: "listItem", content: [p(...content)] })),
});
const ol = (...items: Inline[][]): JSONContent => ({
  type: "orderedList",
  content: items.map((content) => ({ type: "listItem", content: [p(...content)] })),
});
const row = (cells: Inline[][], header = false): JSONContent => ({
  type: "tableRow",
  content: cells.map((content) => ({ type: header ? "tableHeader" : "tableCell", content: [p(...content)] })),
});
const callout = (...content: Inline[]): JSONContent => ({ type: "callout", content: [p(...content)] });

const ID_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "table", "callout", "horizontalRule"]);

/** A deterministic id per block, so the server paint and the client agree. */
function withIds(blocks: JSONContent[]): JSONContent {
  let n = 0;
  const visit = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node };
    if (node.type && ID_TYPES.has(node.type)) next.attrs = { id: `spring-${++n}`, ...node.attrs };
    if (node.content) next.content = node.content.map(visit);
    return next;
  };
  return { type: "doc", content: blocks.map(visit) };
}

// ── the document ─────────────────────────────────────────────────

export const SPRING_DOC: JSONContent = withIds([
  p(
    t("Hi "),
    v("first_name"),
    t(" "),
    v("last_name"),
    t(", your Spring Travel Rewards offer is ready. Here is what the card includes and the terms that come with it."),
  ),
  h2("Offer details", "offer_details"),
  p(
    t("Earn "),
    v("bonus_points"),
    t(" bonus points after you spend $4,000 on purchases in your first three months. Apply by "),
    v("offer_end_date"),
    t(" to lock in the terms below."),
  ),
  ul(
    [t("Triple points on flights, hotels and rental cars booked with your card.")],
    [t("Double points on dining and groceries, and one point on everything else.")],
    [t("Points "), t("never expire", bold), t(" while your account is open and in good standing.")],
  ),
  p(t("This offer is available to residents of "), v("home_state"), t(" with a valid U.S. mailing address.")),
  h2("Rates and fees", "rates_and_fees"),
  {
    type: "table",
    content: [
      row([[t("Interest rates and fees")], [t("Terms")]], true),
      row([[t("Annual percentage rate (APR) for purchases")], [v("purchase_apr"), t(" — varies with the Prime Rate.")]]),
      row([[t("Annual fee")], [v("annual_fee"), t(", billed on your first statement.")]]),
      row([[t("Late payment fee")], [t("Up to $41")]]),
      row([[t("Foreign transaction fee")], [t("None")]]),
    ],
  },
  callout(
    t("The APR is variable. ", bold),
    t("It can change when the Prime Rate changes, and a higher rate applies to your balance from the next billing cycle."),
  ),
  h2("Legal notices", "legal_notices"),
  p(
    t("This offer is not transferable and expires on "),
    v("offer_end_date"),
    t(". The terms above are accurate as of the date this notice was prepared and may change after that date."),
  ),
  ol(
    [t("Credit approval is required. Terms may vary based on your creditworthiness.")],
    [t("Bonus points post within eight weeks of meeting the spending requirement.")],
    [t("Your account must be open and in good standing to redeem points.")],
    [t("Residents of "), v("home_state"), t(": state-specific terms are in your cardmember agreement.")],
  ),
  p(t("Questions? Call the number on the back of your card or visit our help center. Coral Bank, N.A. Member FDIC.")),
]);

/** Email details: inline content, so the rail can show chips and the preview can resolve them. */
export const EMAIL_SUBJECT: Inline[] = [v("first_name"), t(", your Spring Travel Rewards terms")];
export const EMAIL_PREHEADER: Inline[] = [
  t("Your offer ends "),
  v("offer_end_date"),
  t(". Here is what the card includes."),
];

/** How many times each variable appears in the document, for the Variables panel. */
export function countUses(): Record<string, number> {
  const uses: Record<string, number> = {};
  const visit = (node: JSONContent) => {
    if (node.type === "variable" && typeof node.attrs?.key === "string") {
      uses[node.attrs.key] = (uses[node.attrs.key] ?? 0) + 1;
    }
    node.content?.forEach(visit);
  };
  visit(SPRING_DOC);
  return uses;
}

// ── sample sets ──────────────────────────────────────────────────

export const SAMPLE_SETS: PreviewSet[] = [
  {
    id: "typical",
    name: "Typical customer",
    values: {
      first_name: "Maya",
      last_name: "Chen",
      purchase_apr: "21.99",
      home_state: "NJ",
      offer_end_date: "2027-03-04",
      annual_fee: "95",
      bonus_points: "20000",
    },
  },
  {
    id: "long",
    name: "Long name and maximum values",
    values: {
      first_name: "Bartholomew-Alexander",
      last_name: "Montgomery-Featherstonehaugh",
      purchase_apr: "29.99",
      home_state: "DC",
      offer_end_date: "2027-12-31",
      annual_fee: "1495",
      bonus_points: "1250000",
    },
  },
  {
    id: "minimum",
    name: "Minimum values",
    values: {
      first_name: "Jo",
      last_name: "Li",
      purchase_apr: "9.99",
      home_state: "WY",
      offer_end_date: "2027-01-05",
      annual_fee: "0",
      bonus_points: "1000",
    },
  },
];
