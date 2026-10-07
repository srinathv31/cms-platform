// Fixtures for the workspace layout study. The Coral document is the editor lab's long disclosure
// (minus its own H1, since the template name already is the title); the Deposits one is small and
// local so the View only state reads as a different team's template.

import type { JSONContent, Variable } from "@/editor/model/types";
import { ensureBlockIds } from "@/editor/schema";
import { LAB_VARIABLES, LONG_DISCLOSURE } from "../../editor-lab/fixtures";
import type { ChannelId, TemplateModel, ViewId } from "./types";

// ── Coral Offers (Maya) ──────────────────────────────────────────

export const CORAL_DOC: JSONContent = {
  ...LONG_DISCLOSURE,
  content: (LONG_DISCLOSURE.content ?? []).filter(
    (node, i) => !(i === 0 && node.type === "heading" && node.attrs?.level === 1),
  ),
};

export const CORAL_VARIABLES: Variable[] = [
  ...LAB_VARIABLES,
  { key: "bonus_points", label: "Bonus points", type: "number", required: false, sample: "20000" },
];

// ── Deposits (Priya, Viewer) ─────────────────────────────────────

type Inline = JSONContent;
const t = (text: string): Inline => ({ type: "text", text });
const v = (key: string): Inline => ({ type: "variable", attrs: { key } });
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
  content: cells.map((content) => ({
    type: header ? "tableHeader" : "tableCell",
    content: [p(...content)],
  })),
});

export const DEPOSITS_DOC: JSONContent = ensureBlockIds({
  type: "doc",
  content: [
    p(
      t("Hi "),
      v("first_name"),
      t(", we’re updating the rate on your Everyday Savings account. Here is what changes and when."),
    ),
    h2("Offer details", "offer_details"),
    p(
      t("Starting "),
      v("effective_date"),
      t(", the annual percentage yield (APY) on your account changes from "),
      v("previous_apy"),
      t(" to "),
      v("new_apy"),
      t(". You don’t need to do anything to keep your account."),
    ),
    ul(
      [t("Minimum balance to earn this rate: "), v("minimum_balance"), t(".")],
      [t("Interest is compounded daily and credited monthly.")],
      [t("There is no monthly maintenance fee.")],
    ),
    h2("Rates and fees", "rates_and_fees"),
    {
      type: "table",
      content: [
        row([[t("Account feature")], [t("Details")]], true),
        row([[t("Annual percentage yield (APY)")], [v("new_apy"), t(" — variable, set by the Bank.")]]),
        row([[t("Minimum balance for this rate")], [v("minimum_balance")]]),
        row([[t("Monthly maintenance fee")], [t("None")]]),
        row([[t("Excess withdrawal fee")], [t("None")]]),
      ],
    },
    {
      type: "callout",
      content: [
        p(
          t("The rate can change. "),
          t("We may change the APY at any time. We will tell you before a change takes effect."),
        ),
      ],
    },
    h2("Legal notices", "legal_notices"),
    p(
      t("The APY is accurate as of "),
      v("effective_date"),
      t(". Fees could reduce the earnings on the account."),
    ),
    ol(
      [t("Rates apply to personal savings accounts in good standing.")],
      [t("Questions? Call us on "), v("support_phone"), t(".")],
    ),
  ],
});

export const DEPOSITS_VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Priya" },
  { key: "effective_date", label: "Effective date", type: "date", required: true, sample: "2027-01-15" },
  { key: "previous_apy", label: "Previous APY", type: "percent", required: true, sample: "3.75" },
  { key: "new_apy", label: "New APY", type: "percent", required: true, sample: "4.10" },
  { key: "minimum_balance", label: "Minimum balance", type: "currency", required: false, sample: "500" },
  { key: "support_phone", label: "Support phone", type: "text", required: false, sample: "1-800-555-0100" },
  { key: "branch_name", label: "Branch name", type: "text", required: false, sample: "Main Street" },
];

/** How many times each variable chip appears in a document. */
export function countUses(doc: JSONContent): Record<string, number> {
  const uses: Record<string, number> = {};
  const visit = (node: JSONContent) => {
    if (node.type === "variable" && typeof node.attrs?.key === "string") {
      uses[node.attrs.key] = (uses[node.attrs.key] ?? 0) + 1;
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return uses;
}

// ── The template on screen, per state ────────────────────────────

export const CORAL_NAME = "Cash Rewards Card — Offer Terms";
const CORAL_ID = "UC-4F7K2Q";
const DEPOSITS_NAME = "Savings Rate Change Notice";
const DEPOSITS_ID = "UC-8M2WQ3";

export const DEFAULT_CHANNELS: ChannelId[] = ["pdf", "web"];

/** Draft: Maya editing. Active: Maya looking at the live version. View only: Priya on Deposits. */
export function modelFor(view: ViewId, name: string, channels: ChannelId[]): TemplateModel {
  switch (view) {
    case "draft":
      return {
        name,
        id: CORAL_ID,
        status: "draft",
        versionLabel: "Based on v2",
        editing: true,
        viewOnly: false,
        canStartDraft: false,
        showRing: false,
        channels,
        docKey: "coral",
      };
    case "active":
      return {
        name: CORAL_NAME,
        id: CORAL_ID,
        status: "active",
        versionLabel: "v2",
        editing: false,
        viewOnly: false,
        canStartDraft: true,
        showRing: true,
        channels: DEFAULT_CHANNELS,
        docKey: "coral",
      };
    case "view":
      return {
        name: DEPOSITS_NAME,
        id: DEPOSITS_ID,
        status: "active",
        versionLabel: "v3",
        editing: false,
        viewOnly: true,
        canStartDraft: false,
        showRing: true,
        channels: ["pdf", "web", "email"],
        docKey: "deposits",
      };
  }
}
