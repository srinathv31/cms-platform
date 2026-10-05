// Fixture documents for /editor-lab. Deterministic (stable ids) so the server paint and the
// client hydrate to identical markup.

import type { JSONContent, ThreadAnchor, Variable } from "@/editor";

export const LAB_VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "last_name", label: "Last name", type: "text", required: true, sample: "Chen" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
  { key: "home_state", label: "Home state", type: "us_state", required: false, sample: "NJ" },
  { key: "offer_end_date", label: "Offer end date", type: "date", required: true, sample: "2027-03-04" },
  { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
];

// ── tiny builders ────────────────────────────────────────────────

type Inline = JSONContent;
type Mark = NonNullable<JSONContent["marks"]>[number];

const t = (text: string, ...marks: Mark[]): Inline => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const v = (key: string): Inline => ({ type: "variable", attrs: { key } });
const bold: Mark = { type: "bold" };
const link = (href: string): Mark => ({ type: "link", attrs: { href } });

const p = (...content: Inline[]): JSONContent => ({ type: "paragraph", content });
const h = (level: 1 | 2 | 3, text: string, requiredKey?: string): JSONContent => ({
  type: "heading",
  attrs: { level, ...(requiredKey ? { requiredKey } : {}) },
  content: text ? [t(text)] : [],
});
const ul = (...items: Inline[][]): JSONContent => ({
  type: "bulletList",
  content: items.map((content) => ({ type: "listItem", content: [p(...content)] })),
});
const ol = (...items: Inline[][]): JSONContent => ({
  type: "orderedList",
  content: items.map((content) => ({ type: "listItem", content: [p(...content)] })),
});
const table = (header: string[], rows: Inline[][][]): JSONContent => ({
  type: "table",
  content: [
    { type: "tableRow", content: header.map((cell) => ({ type: "tableHeader", content: [p(t(cell))] })) },
    ...rows.map((row) => ({
      type: "tableRow",
      content: row.map((cell) => ({ type: "tableCell", content: [p(...cell)] })),
    })),
  ],
});
const callout = (...paragraphs: Inline[][]): JSONContent => ({
  type: "callout",
  content: paragraphs.map((content) => p(...content)),
});
const hr = (): JSONContent => ({ type: "horizontalRule" });

const ID_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "table", "callout", "horizontalRule"]);

/** Gives every block a deterministic id (`<prefix>-<n>`), like the seed does with ensureBlockIds. */
function withIds(prefix: string, blocks: JSONContent[]): JSONContent {
  let n = 0;
  const visit = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node };
    if (node.type && ID_TYPES.has(node.type)) next.attrs = { id: `${prefix}-${++n}`, ...node.attrs };
    if (node.content) next.content = node.content.map(visit);
    return next;
  };
  return { type: "doc", content: blocks.map(visit) };
}

// ── documents ────────────────────────────────────────────────────

export const LONG_DISCLOSURE = withIds("long", [
  h(1, "Cash Rewards Card offer"),
  p(
    t("Hi "),
    v("first_name"),
    t(" "),
    v("last_name"),
    t(", you’re pre-approved for the Cash Rewards Card. Here is what the offer includes and the terms that come with it."),
  ),

  h(2, "Offer details", "offer_details"),
  p(
    t("Earn 2% cash back on every purchase, with no categories to track and no cap on what you can earn. Apply by "),
    v("offer_end_date"),
    t(" to lock in the terms below."),
  ),
  ul(
    [t("A variable purchase APR of "), v("purchase_apr"), t(", based on the Prime Rate.")],
    [t("An annual fee of "), v("annual_fee"), t(", billed on your first statement.")],
    [t("Cash back that "), t("never expires", bold), t(" while your account is open.")],
  ),
  p(t("This offer is available to residents of "), v("home_state"), t(" with a valid U.S. mailing address.")),

  h(2, "Rates and fees", "rates_and_fees"),
  table(
    ["Interest rates and fees", "Terms"],
    [
      [[t("Annual percentage rate (APR) for purchases")], [v("purchase_apr"), t(" — varies with the market based on the Prime Rate.")]],
      [[t("APR for balance transfers")], [v("purchase_apr")]],
      [[t("Annual fee")], [v("annual_fee")]],
      [[t("Late payment fee")], [t("Up to $41")]],
      [[t("Foreign transaction fee")], [t("None")]],
    ],
  ),
  callout([
    t("How we calculate your balance: ", bold),
    t("we use a method called “average daily balance (including new purchases).” See your cardholder agreement for details."),
  ]),
  p(
    t(
      "Paying interest: your due date is at least 25 days after the close of each billing cycle. We will not charge you interest on purchases if you pay your entire balance by the due date each month.",
    ),
  ),
  h(3, "Minimum interest charge"),
  p(t("If you are charged interest, the charge will be no less than $1.00. Minimum interest charges do not apply in every state.")),

  h(2, "Legal notices", "legal_notices"),
  p(
    t("This offer is not transferable and expires on "),
    v("offer_end_date"),
    t(". The terms above are accurate as of the date this notice was prepared and may change after that date."),
  ),
  ol(
    [t("Credit approval is required. Terms may vary based on your creditworthiness.")],
    [t("Cash back is earned on net purchases: purchases minus returns and credits.")],
    [t("Your account must be open and in good standing to redeem rewards.")],
  ),
  hr(),
  p(
    t("Questions? Visit "),
    t("our help center", link("https://example.com/help")),
    t(" or call the number on the back of your card."),
  ),
  p(v("first_name"), t(", thank you for being a customer.")),
]);

export const BLANK_DISCLOSURE = withIds("blank", [
  h(2, "Offer details", "offer_details"),
  h(2, "Rates and fees", "rates_and_fees"),
  h(2, "Legal notices", "legal_notices"),
]);

const STRESS_KEYS = LAB_VARIABLES.map((variable) => variable.key);

// Thirty chips in wrapping sentences (line height must not move where a chip lands), plus one
// unknown key.
export const CHIP_STRESS = withIds("stress", [
  h(1, "Account summary"),
  ...Array.from({ length: 6 }, (_, row) =>
    p(
      ...Array.from({ length: 5 }, (_, i) => {
        const key = STRESS_KEYS[(row * 5 + i) % STRESS_KEYS.length];
        return [t(i === 0 ? "Dear " : i % 2 ? ", then " : " and "), v(key)];
      }).flat(),
      t(". These terms apply to your account from the date of this notice until we tell you otherwise in writing."),
    ),
  ),
  p(t("Use code "), v("promo_code"), t(" when you call.")),
]);

/** The Active version's list, for the contract-change fixture. Against LAB_VARIABLES:
 *  purchase_apr was a Number (breaking) · home_state was required (now optional, non-breaking) ·
 *  annual_fee is new and required (breaking) · promo_code was removed (breaking) ·
 *  offer_end_date's label changed (not flagged). */
export const LAB_BASELINE: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "last_name", label: "Last name", type: "text", required: true, sample: "Chen" },
  { key: "purchase_apr", label: "Purchase APR", type: "number", required: true, sample: "21.99" },
  { key: "home_state", label: "Home state", type: "us_state", required: true, sample: "NJ" },
  { key: "offer_end_date", label: "Offer expiry", type: "date", required: true, sample: "2027-03-04" },
  { key: "promo_code", label: "Promo code", type: "text", required: false, sample: "SPRING" },
];

/** LAB_VARIABLES plus one the document never uses (its panel row is muted). */
export const LAB_VARIABLES_WITH_UNUSED: Variable[] = [
  ...LAB_VARIABLES,
  { key: "bonus_points", label: "Bonus points", type: "number", required: false, sample: "20000" },
];

export const LAB_SUBJECT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [v("first_name"), t(", your Cash Rewards offer ends "), v("offer_end_date")] }],
};

export type FixtureId = "long" | "contract" | "unused" | "email" | "blank" | "stress" | "readonly" | "static";

export interface Fixture {
  id: FixtureId;
  label: string;
  content: JSONContent;
  variables?: Variable[];
  /** The Active version's list (contract flags). */
  baseline?: Variable[];
  /** Shows an "Email subject" inline field above the document. */
  subject?: JSONContent | null;
  readOnly?: boolean;
}

export const FIXTURES: Fixture[] = [
  { id: "long", label: "Long disclosure", content: LONG_DISCLOSURE },
  { id: "contract", label: "Contract changes", content: LONG_DISCLOSURE, baseline: LAB_BASELINE },
  { id: "unused", label: "Unused variable", content: LONG_DISCLOSURE, variables: LAB_VARIABLES_WITH_UNUSED },
  { id: "email", label: "Email subject", content: LONG_DISCLOSURE, subject: LAB_SUBJECT },
  { id: "blank", label: "Blank", content: BLANK_DISCLOSURE },
  { id: "stress", label: "30 chips", content: CHIP_STRESS },
  { id: "readonly", label: "Read-only", content: LONG_DISCLOSURE, readOnly: true },
  { id: "static", label: "Server paint", content: LONG_DISCLOSURE, readOnly: true },
];

// ── review threads (the Comments toggle) ─────────────────────────

const plain = (node: JSONContent): string => (node.text ?? "") + (node.content ?? []).map(plain).join("");

/** The id of the long disclosure's first top-level block whose text starts with `prefix`. */
function blockStarting(prefix: string): string {
  const block = LONG_DISCLOSURE.content?.find((b) => plain(b).startsWith(prefix));
  return String(block?.attrs?.id ?? "");
}

/** Two quoted threads and one about a whole block, on the long disclosure. */
export const LAB_THREADS: ThreadAnchor[] = [
  { id: "lab-earn", blockId: blockStarting("Earn 2% cash back"), quote: "2% cash back on every purchase", status: "open" },
  { id: "lab-balance", blockId: blockStarting("How we calculate"), quote: "average daily balance", status: "open" },
  { id: "lab-minimum", blockId: blockStarting("If you are charged interest"), quote: null, status: "open" },
];
