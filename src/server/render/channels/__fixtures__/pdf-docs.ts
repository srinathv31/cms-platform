// RenderDoc fixtures for the PDF adapter. Hand-built and already resolved: variables are text runs
// carrying their key, formatted as resolveDocument formats them.

import type { RenderBlock, RenderDoc, RenderInline, RenderListItem, RenderTableCell, RenderText } from "@/domain/render/types";

const t = (text: string, marks: Omit<RenderText, "type" | "text"> = {}): RenderText => ({ type: "text", text, ...marks });
const v = (variable: string, text: string): RenderText => ({ type: "text", text, variable });
const b = (text: string) => t(text, { bold: true });
const br: RenderInline = { type: "break" };

const p = (id: string | null, ...content: RenderInline[]): RenderBlock => ({ type: "paragraph", id, content });
const h = (id: string, level: 1 | 2 | 3, text: string, section: string | null = null): RenderBlock => ({
  type: "heading",
  id,
  level,
  section,
  content: [t(text)],
});
const item = (...content: RenderBlock[]): RenderListItem => ({ content });
const li = (...content: RenderInline[]): RenderListItem => item(p(null, ...content));
const ul = (id: string | null, ...items: RenderListItem[]): RenderBlock => ({ type: "list", id, ordered: false, start: 1, items });
const ol = (id: string | null, start: number, ...items: RenderListItem[]): RenderBlock => ({ type: "list", id, ordered: true, start, items });
const cell = (header: boolean, content: RenderInline[], colspan = 1, rowspan = 1): RenderTableCell => ({
  header,
  colspan,
  rowspan,
  content: [p(null, ...content)],
});
const th = (text: string, colspan = 1) => cell(true, [t(text)], colspan);
const td = (...content: RenderInline[]) => cell(false, content);
const table = (id: string, rows: RenderTableCell[][]): RenderBlock => ({ type: "table", id, rows: rows.map((cells) => ({ cells })) });
const callout = (id: string, ...content: RenderBlock[]): RenderBlock => ({ type: "callout", id, content });
const rule = (id: string): RenderBlock => ({ type: "rule", id });

// ── Card offer terms (typical and long-name) ─────────────────────────────────

export interface CardValues {
  first_name: string;
  last_name: string;
  purchase_apr: string;
  annual_fee: string;
  credit_limit: string;
  home_state: string;
  offer_end_date: string;
  effective_date: string;
}

export const TYPICAL_VALUES: CardValues = {
  first_name: "Maya",
  last_name: "Chen",
  purchase_apr: "21.99%",
  annual_fee: "$95.00",
  credit_limit: "$8,500.00",
  home_state: "New Jersey",
  offer_end_date: "November 18, 2026",
  effective_date: "November 3, 2026",
};

export const LONG_VALUES: CardValues = {
  first_name: "Alexandria-Marguerite",
  last_name: "Featherstonehaugh-Villiers",
  purchase_apr: "29.99%",
  annual_fee: "$695.00",
  credit_limit: "$1,000,000.00",
  home_state: "District of Columbia",
  offer_end_date: "September 30, 2027",
  effective_date: "September 30, 2027",
};

function cardTermsBlocks(x: CardValues): RenderBlock[] {
  const V = (key: keyof CardValues) => v(key, x[key]);
  return [
    h("b_title", 1, "Spring Travel Rewards — Card offer terms"),
    p("b_for", t("Prepared for "), V("first_name"), t(" "), V("last_name"), t(". This offer is valid until "), V("offer_end_date"), t(", and these terms take effect on "), V("effective_date"), t(".")),
    p(
      "b_intro",
      V("first_name"),
      t(", thank you for considering the Spring Travel Rewards card. This document sets out the offer, the rates and fees that apply to your account, and the notices we are required to give you. "),
      t("Please read it carefully", { italic: true }),
      t(" and keep it with your records."),
    ),

    h("b_h_offer", 2, "Offer details", "offer_details"),
    p("b_offer", t("Spend $2,000 on purchases in your first 3 months and earn "), b("60,000 bonus points"), t(", worth $600 toward travel when you redeem through Coral Travel. Your credit limit is "), V("credit_limit"), t(".")),
    ul(
      "b_how",
      li(t("Purchases must post to your account within 3 months of the account opening date.")),
      item(
        p(null, t("These transactions "), t("don't", { underline: true }), t(" count toward the spend requirement:")),
        ul(null, li(t("Cash advances, balance transfers and convenience checks.")), li(t("Fees, interest charges and returned or refunded purchases."))),
      ),
      li(t("The bonus points post within 2 billing cycles after you qualify, as long as your account is open and not in default.")),
      li(t("Points never expire while your account is open. If you close your account, unredeemed points are forfeited.")),
    ),
    h("b_h_qualify", 3, "How to qualify"),
    ol(
      "b_steps",
      1,
      li(t("Apply by "), V("offer_end_date"), t(" using the offer code on your invitation.")),
      li(t("Make $2,000 in eligible purchases within 3 months of opening your account.")),
      li(t("Keep your account open and in good standing until the bonus points post.")),
    ),
    table("b_summary", [
      [th("Cardmember"), th("Credit limit"), th("Home state"), th("Offer ends")],
      [td(V("first_name"), t(" "), V("last_name")), td(V("credit_limit")), td(V("home_state")), td(V("offer_end_date"))],
    ]),

    h("b_h_rates", 2, "Rates and fees", "rates_and_fees"),
    p("b_rates_intro", t("The table below summarizes the interest rates and fees for your account. Rates are variable and move with the Prime Rate.")),
    table("b_rates", [
      [th("Interest rates and interest charges"), th("What you pay")],
      [td(b("Annual percentage rate (APR) for purchases")), td(V("purchase_apr"), t(". This APR will vary with the market based on the Prime Rate."))],
      [td(b("APR for balance transfers")), td(V("purchase_apr"), t(". This APR will vary with the market based on the Prime Rate."))],
      [td(b("APR for cash advances")), td(t("29.99%. This APR will vary with the market based on the Prime Rate."))],
      [td(b("Penalty APR and when it applies")), td(t("Up to 29.99%. This APR may be applied to your account if you make a late payment or make a payment that is returned. If we apply the penalty APR, it will continue until you make six consecutive minimum payments when due."))],
      [td(b("Paying interest")), td(t("Your due date is at least 25 days after the close of each billing cycle. We will not charge you interest on purchases if you pay your entire balance by the due date each month."))],
      [td(b("Minimum interest charge")), td(t("If you are charged interest, the charge will be no less than $0.50."))],
      [th("Fees", 2)],
      [td(b("Annual fee")), td(V("annual_fee"))],
      [td(b("Foreign transaction fee")), td(t("None"))],
      [td(b("Balance transfer fee")), td(t("Either $5 or 5% of the amount of each transfer, whichever is greater."))],
      [td(b("Cash advance fee")), td(t("Either $10 or 5% of the amount of each cash advance, whichever is greater."))],
      [td(b("Late payment fee")), td(t("Up to $40"))],
      [td(b("Returned payment fee")), td(t("Up to $40"))],
    ]),
    p("b_interest", t("Interest on purchases starts on the transaction date unless you pay your full statement balance by the due date. Interest on cash advances starts on the transaction date.")),
    h("b_h_balance", 3, "How we calculate your balance"),
    p(
      "b_balance",
      t("We use a method called "),
      t("average daily balance (including new purchases)", { italic: true }),
      t(". We take the beginning balance of your account each day, add any new purchases, advances and fees, and subtract any unpaid interest or other finance charges and any payments or credits. This gives us the daily balance. We then add up all the daily balances for the billing cycle and divide the total by the number of days in the billing cycle."),
    ),
    h("b_h_rights", 3, "Your billing rights"),
    p(
      "b_rights",
      t("If you think there is an error on your statement, write to us within 60 days after the error appeared on your statement. While we investigate whether there has been an error, you do not have to pay the amount in question, and we cannot try to collect it or report you as delinquent on that amount. "),
      b("You must notify us of any potential errors in writing."),
      t(" You may call us, but if you do we are not required to investigate any potential errors and you may have to pay the amount in question."),
    ),

    h("b_h_legal", 2, "Legal notices", "legal_notices"),
    p("b_state", t("State-specific terms for "), V("home_state"), t(" residents are in your cardmember agreement. If any part of these terms conflicts with the law of "), V("home_state"), t(", the law controls and the rest of these terms stay in effect.")),
    callout(
      "b_tax",
      p(null, b("The value of bonus points may be taxable."), t(" We may report it to the IRS on Form 1099-MISC. Talk to a tax advisor about your situation.")),
      p(null, t("Covered borrowers under the Military Lending Act can call 1-800-555-0142 for oral disclosures.")),
    ),
    p(
      "b_arbitration",
      t("Your cardmember agreement includes an arbitration provision. Unless you reject it, disputes between you and us will be resolved by individual arbitration, and you waive your right to a jury trial and to take part in a class action. You can reject the arbitration provision within 60 days of opening your account."),
    ),
    rule("b_rule"),
    p("b_more", t("Read the full cardmember agreement at "), t("coralbank.com/agreements", { href: "https://www.coralbank.com/agreements" }), t(", or write to us:")),
    p("b_address", t("Coral Bank, N.A."), br, t("PO Box 6500"), br, t("Wilmington, DE 19801")),
    p("b_fdic", t("Coral Bank, N.A. Member FDIC. Credit approval required. Offer not available to existing cardmembers.", { italic: true })),
  ];
}

/** A 2–3 page disclosure with every block type and mark, for a typical customer. */
export const TYPICAL_DOC: RenderDoc = {
  templateId: "UC-4F7K2Q",
  templateName: "Spring Travel Rewards — Terms",
  versionNumber: 2,
  blocks: cardTermsBlocks(TYPICAL_VALUES),
};

/** The same template with the long-name and maximum-value sample set. */
export const LONG_NAME_DOC: RenderDoc = {
  ...TYPICAL_DOC,
  blocks: cardTermsBlocks(LONG_VALUES),
};

// ── A long cardmember agreement (10+ pages, an unsubmitted draft) ────────────

const SENTENCES = [
  "We may change the terms of this agreement, including the APRs and fees, as permitted by law.",
  "If we do, we will send you a written notice at least 45 days before the change takes effect, and the notice will explain your right to reject it.",
  "You must pay at least the minimum payment due by the payment due date shown on your statement.",
  "Payments received by 5 p.m. Eastern time on a business day are credited as of that day.",
  "We apply the amount of your payment above the minimum to the balance with the highest APR first, and any remaining portion to the other balances in descending order of APR.",
  "You may not use your account for any illegal transaction, and we may decline any transaction for any reason.",
  "Authorized users may make charges on your account, but you remain responsible for paying for all of them.",
  "We may report information about your account to credit bureaus, and late payments, missed payments or other defaults may be reflected in your credit report.",
  "If you believe a transaction is unauthorized, call us immediately at the number on the back of your card.",
  "We will not hold you responsible for unauthorized charges made with your card, provided you report the loss or theft promptly.",
  "Rewards have no cash value except as described in the program terms and may not be transferred or sold.",
  "We may suspend your ability to earn or redeem rewards while your account is past due or closed.",
];

const prose = (seed: number, count: number): RenderInline[] => {
  const out: RenderInline[] = [];
  for (let i = 0; i < count; i += 1) {
    const s = SENTENCES[(seed * 7 + i * 5) % SENTENCES.length];
    out.push(i === 1 && seed % 3 === 0 ? b(s) : t(s));
    if (i < count - 1) out.push(t(" "));
  }
  return out;
};

/** A card's fee schedule: name and amount, one line each. */
const FEES: readonly [string, string][] = [
  ["Annual fee", "$95, charged on your first statement and every 12 months after"],
  ["Additional card fee", "None"],
  ["Balance transfer fee", "5% of each transfer, minimum $5"],
  ["Cash advance fee", "5% of each advance, minimum $10"],
  ["Foreign transaction fee", "None"],
  ["Late payment fee", "Up to $40"],
  ["Returned payment fee", "Up to $40"],
  ["Overlimit fee", "None"],
  ["Expedited card delivery", "$15 per card"],
  ["Statement copy", "$5 per statement older than 24 months"],
  ["Paper statement", "None"],
  ["Card replacement", "None"],
  ["Stop payment on convenience check", "$29"],
  ["Returned convenience check", "$35"],
  ["Wire transfer to your account", "$15"],
  ["Rush payment by phone", "$12"],
  ["Research request", "$10 per hour, refunded if we made an error"],
  ["Copy of a sales slip", "$3 per copy"],
  ["Travel insurance claim processing", "None"],
  ["Points transfer to a partner program", "None"],
  ["Points redemption for cash back", "None"],
  ["Rewards catalog shipping", "Included in the redemption value"],
  ["Card design change", "None"],
  ["Account closure", "None"],
  ["Dormant account fee", "None"],
  ["Collection costs", "As permitted by applicable law"],
  ["Legal fees", "As permitted by applicable law"],
  ["Foreign currency conversion", "Network rate, no markup"],
  ["Check by mail refund", "None"],
  ["Balance inquiry at an ATM", "$2.50"],
];

const feeRows = (fees: readonly (readonly [string, string])[]) =>
  [[th("Fee"), th("Amount")], ...fees.map(([name, amount]) => [td(t(name)), td(t(amount))])];

function feeTable(id: string): RenderBlock {
  return table(id, feeRows(FEES));
}

function longBlocks(): RenderBlock[] {
  const blocks: RenderBlock[] = [
    h("l_title", 1, "Coral Bank Cardmember Agreement"),
    p("l_intro", t("This agreement covers your Coral Bank credit card account. Please read it and keep it for your records. "), ...prose(1, 3)),
    h("l_h_offer", 2, "Offer details", "offer_details"),
    p("l_offer", ...prose(2, 5)),
  ];
  const topics = [
    "Using your account",
    "Authorized users",
    "Payments",
    "How we apply payments",
    "Interest charges",
    "Promotional rates",
    "Fees",
    "Rewards",
    "Credit reporting",
    "Lost or stolen cards",
    "Closing your account",
    "Default",
    "Changes to this agreement",
    "Communications",
  ];
  topics.forEach((topic, i) => {
    const id = `l_${i}`;
    if (i === 4) blocks.push(h("l_h_rates", 2, "Rates and fees", "rates_and_fees"));
    if (i === 10) blocks.push(h("l_h_legal", 2, "Legal notices", "legal_notices"));
    blocks.push(h(`${id}_h`, i % 4 === 0 ? 2 : 3, topic));
    blocks.push(p(`${id}_p1`, ...prose(i + 3, 4 + (i % 3))));
    if (i % 3 === 0) {
      blocks.push(
        ol(
          `${id}_ol`,
          i === 6 ? 5 : 1,
          li(...prose(i + 4, 2)),
          item(
            p(null, ...prose(i + 5, 1)),
            ol(null, 1, li(...prose(i + 6, 1)), li(...prose(i + 7, 2)), item(p(null, ...prose(i + 8, 1)), ul(null, li(...prose(i + 9, 1)), li(...prose(i + 10, 1))))),
          ),
          li(...prose(i + 11, 3)),
        ),
      );
    }
    if (i % 3 === 1) blocks.push(ul(`${id}_ul`, li(...prose(i + 2, 1)), li(...prose(i + 3, 2)), li(...prose(i + 4, 1))));
    if (i === 6) blocks.push(p("l_fees_intro", t("The following fees may apply to your account.")), feeTable("l_fees"));
    if (i === 8) {
      blocks.push(
        callout(
          "l_callout_long",
          p(null, b("Important information about your rights. "), ...prose(i, 5)),
          p(null, ...prose(i + 1, 5)),
          p(null, ...prose(i + 2, 4)),
          p(null, ...prose(i + 3, 5)),
        ),
      );
    }
    if (i === 2) {
      blocks.push(
        p(
          "l_address",
          t("Send payments to Coral Bank, Attn. Łukasz Wiśniewski-Őrsi, ul. Piotrkowska 104, 90-006 Łódź, Poland, or to our Győr office. For online payments use "),
          t(
            "https://payments.coralbank.example/cardmember/servicing/payments/one-time-payment?source=agreement&campaign=spring-travel-rewards-2026",
            { href: "https://payments.coralbank.example/cardmember/servicing/payments/one-time-payment?source=agreement&campaign=spring-travel-rewards-2026" },
          ),
          t("."),
        ),
      );
    }
    blocks.push(p(`${id}_p2`, ...prose(i + 12, 3 + (i % 4))));
    if (i % 5 === 2) blocks.push(callout(`${id}_note`, p(null, ...prose(i + 1, 2))));
    if (i === 12) blocks.push(rule("l_rule"));
  });
  blocks.push(p("l_end", t("Coral Bank, N.A. Member FDIC.", { italic: true })));
  return blocks;
}

/** A long agreement: 10+ pages, with a fee table that crosses pages. Rendered as a draft. */
export const LONG_DOC: RenderDoc = {
  templateId: "UC-9M3T8A",
  templateName: "Coral Bank Cardmember Agreement",
  versionNumber: null,
  blocks: longBlocks(),
};

// ── Fee tables at a page break (widow and orphan control) ────────────────────

/**
 * A short fee notice: `lead` sentences of prose push the fee table down page 1, so `lead` and the
 * fees set where the table meets the page break. Tuned against the layout: if spacing or type
 * changes, re-tune `lead` so each case below still lands where its comment says.
 */
function tableAtBreak(id: string, lead: number, fees: readonly (readonly [string, string])[]): RenderDoc {
  return {
    templateId: "UC-7H2W5R",
    templateName: "Fee schedule",
    versionNumber: 1,
    blocks: [
      h(`${id}_title`, 1, "Your fee schedule"),
      p(`${id}_lead`, ...prose(3, lead)),
      h(`${id}_h_rates`, 2, "Rates and fees", "rates_and_fees"),
      p(`${id}_intro`, t("The following fees may apply to your account.")),
      table(`${id}_fees`, feeRows(fees)),
      p(`${id}_end`, t("Coral Bank, N.A. Member FDIC.", { italic: true })),
    ],
  };
}

/**
 * Ten fees ending with "Late payment fee", which falls just past the bottom of page 1. Without
 * widow control it sat alone at the top of page 2, under the repeated header.
 */
export const TABLE_WIDOW_DOC = tableAtBreak("tw", 15, [...FEES.slice(0, 5), ...FEES.slice(6, 10), FEES[5]]);

/** Eight fees starting where only the header and one row fit on page 1 (that row was left alone). */
export const TABLE_ORPHAN_DOC = tableAtBreak("to", 25, FEES.slice(0, 8));

/** Three fees at the same spot: the table split one row and two before; it must never split. */
export const TABLE_SHORT_DOC = tableAtBreak("ts", 25, FEES.slice(0, 3));
