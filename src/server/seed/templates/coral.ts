import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { ContractChange } from "@/domain/types";
import type { SeedCtx } from "../context";
import { callout, disclosure, hr, inlineDoc, p, table, ul } from "../content";
import type { VarKey } from "../variables";
import { buildTemplate } from "./build";
import type { SeedTemplate } from "./types";

// Coral Offers: five templates that put every lifecycle state on screen (build plan, "Seed data").
// Times are days before the reset.

const CUSTOMER_KEYS: VarKey[] = ["first_name", "last_name", "purchase_apr", "home_state"];
const ISSUER = "Coral Bank, N.A. Member FDIC. Credit approval required.";
const STATE_TERMS = "State-specific terms for {home_state} residents are in your cardmember agreement.";

const addedEndDate: ContractChange = {
  kind: "added",
  key: "offer_end_date",
  breaking: false,
  type: "date",
  required: false,
};

/** Cash Back v3's change request: round 1 said a fee applies, not when it starts. */
const CASH_BACK_V3_REASON = "Say when the annual fee starts. \"An annual fee applies\" isn't enough.";
/** Annual Fee Waiver v1's change request. */
const WAIVER_V1_REASON =
  "The waiver isn't automatic. It depends on a first purchase within 30 days. Restate the eligibility rule and re-check the rates table.";

// ── Bodies ────────────────────────────────────────────────────

function balanceTransferBody(version: 1 | 2) {
  return disclosure("balance-transfer", {
    offer: [
      p(
        "intro",
        `Hi {first_name}, move a balance from another card to your Coral account within 60 days of opening it and pay 0% intro APR on that balance for ${version === 1 ? 12 : 15} months. After the intro period, your purchase APR of {purchase_apr} applies to any remaining balance.`,
      ),
      ...(version === 2 ? [p("end_date", "Open your account by {offer_end_date} to qualify for this offer.")] : []),
      ul("eligibility", [
        "Transfers must be requested within 60 days of account opening.",
        "Balances from other Coral accounts are not eligible.",
        "The transferred amount can't exceed your available credit.",
      ]),
    ],
    rates: [
      table(
        "rates_table",
        ["Rate or fee", "What you pay"],
        [
          ["Intro APR on balance transfers", `0% for ${version === 1 ? 12 : 15} months`],
          ["Purchase APR after the intro period", "{purchase_apr}"],
          ["Balance transfer fee", "3% of each transfer, $5 minimum"],
          ["Annual fee", "$0"],
        ],
      ),
    ],
    legal: [
      p("state_terms", STATE_TERMS),
      callout(
        "interest_callout",
        "A balance transfer isn't a purchase. Interest on new purchases starts on the transaction date unless you pay your full statement balance by the due date.",
      ),
      p("issuer", ISSUER),
    ],
  });
}

/** `round` is v3's: round 1 says a fee applies but not when it starts, which round 2 fixed. */
function cashBackBody(version: 1 | 2 | 3, round: 1 | 2 = 2) {
  const feeStarts = version === 3 && round === 2;
  return disclosure("cash-back", {
    offer: [
      p(
        "intro",
        "Hi {first_name}, spend $1,000 on purchases in your first 3 months and earn a $200 statement credit. Your purchase APR is {purchase_apr}.",
      ),
      ...(version >= 2 ? [p("end_date", "Open your account by {offer_end_date} to qualify for this offer.")] : []),
      ul("how_it_works", [
        "Purchases must post within 3 months of account opening.",
        "Cash advances, balance transfers and fees don't count toward the spend requirement.",
        "The statement credit posts within 2 billing cycles after you qualify.",
      ]),
      ...(version >= 2 ? [hr("rule")] : []),
    ],
    rates: [
      table(
        "rates_table",
        ["Rate or fee", "What you pay"],
        [
          ["Purchase APR", "{purchase_apr}"],
          ["Cash advance fee", "5% of each advance, $10 minimum"],
          ["Foreign transaction fee", "None"],
          [
            "Annual fee",
            version !== 3 ? "$0" : feeStarts ? "$0 the first year, then {annual_fee} per year" : "{annual_fee} per year",
          ],
        ],
      ),
      ...(version === 3
        ? [
            p(
              "fee_note",
              feeStarts
                ? "After your first year, an annual fee of {annual_fee} is billed to your account each year."
                : "An annual fee of {annual_fee} applies and is billed to your account each year.",
            ),
          ]
        : []),
    ],
    legal: [
      p("state_terms", STATE_TERMS),
      callout("tax_callout", "The statement credit may be taxable. Talk to a tax advisor about your situation."),
      p("issuer", ISSUER),
    ],
  });
}

function annualFeeWaiverBody(version: "v1" | "draft") {
  return disclosure("annual-fee-waiver", {
    offer: [
      p(
        "intro",
        "Hi {first_name}, open a Coral card and make your first purchase within 30 days to have your annual fee waived for the first year.",
      ),
      p("waiver_terms", "The waiver is automatic. You don't need to enroll or contact us."),
      p(
        "anniversary",
        version === "v1"
          ? "The waiver ends after your first year."
          : "The waiver ends on your first account anniversary.",
      ),
    ],
    rates: [
      table(
        "rates_table",
        ["Rate or fee", "What you pay"],
        [
          ["Annual fee, first year", "$0 (waived)"],
          ["Annual fee after the first year", "As stated in your cardmember agreement"],
          ["Purchase APR", "{purchase_apr}"],
        ],
      ),
    ],
    legal: [
      p("state_terms", STATE_TERMS),
      callout(
        "promo_callout",
        "This waiver is a promotional offer. Coral may change or withdraw it for new accounts at any time.",
      ),
      p("issuer", ISSUER),
    ],
  });
}

function holidayPointsBody(version: 1 | 2) {
  return disclosure("holiday-points", {
    offer: [
      p(
        "intro",
        `Hi {first_name}, this holiday season earn ${version === 1 ? "25,000" : "20,000"} bonus points when you spend $2,000 on purchases in your first 3 months. Your purchase APR is {purchase_apr}.`,
      ),
      ul("how_it_works", [
        "Points post within 8 weeks after you qualify.",
        "Bonus points are awarded once per new account.",
        "Points are forfeited if your account is closed.",
      ]),
      ...(version === 2 ? [hr("rule")] : []),
    ],
    rates: [
      table(
        "rates_table",
        ["Rate or fee", "What you pay"],
        [
          ["Purchase APR", "{purchase_apr}"],
          ["Points on purchases", "1 point per $1"],
          ["Annual fee", "$0"],
        ],
      ),
    ],
    legal: [
      p("state_terms", STATE_TERMS),
      callout(
        "points_callout",
        "Bonus points have no cash value until redeemed. Redemption terms are in the rewards program rules.",
      ),
      p("issuer", ISSUER),
    ],
  });
}

function rateChangeBody() {
  return disclosure("rate-change-notice", {
    offer: [
      p("notice_for", "Notice of change in terms for {first_name} {last_name}."),
      p(
        "intro",
        "Hi {first_name}, the purchase APR on your Coral account is changing. Your new purchase APR is {purchase_apr}, effective {effective_date}.",
      ),
      p(
        "scope",
        "This change applies to new purchases made on or after the effective date. Your existing balance isn't affected.",
      ),
    ],
    rates: [
      table(
        "rates_table",
        ["Rate", "Your account"],
        [
          ["New purchase APR", "{purchase_apr}"],
          ["Effective date", "{effective_date}"],
          ["Cash advance APR", "No change"],
          ["Annual fee", "No change"],
        ],
      ),
    ],
    legal: [
      p(
        "reject",
        "You can reject this change before it takes effect by calling the number on the back of your card. If you reject it, you can keep paying off your balance under your current terms, but you can't make new purchases.",
      ),
      callout("state_callout", STATE_TERMS),
      p("issuer", "Coral Bank, N.A. Member FDIC."),
    ],
  });
}

// ── Templates ─────────────────────────────────────────────────

export function seedCoralTemplates(ctx: SeedCtx) {
  const { vars } = ctx;
  const customer = vars.list(CUSTOMER_KEYS);
  const withEndDate = vars.list([...CUSTOMER_KEYS, "offer_end_date"]);

  const templates: SeedTemplate[] = [
    // v1 Superseded (sunset in 21 days, Coral still renders it); v2 Active.
    {
      key: "balance-transfer",
      teamId: "coral-offers",
      name: "Balance Transfer Intro — Terms",
      createdBy: "priya",
      createdAt: 160,
      consumers: ["coral"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "superseded",
          body: balanceTransferBody(1),
          variables: customer,
          channels: ["pdf", "web"],
          createdBy: "priya",
          createdAt: 160,
          submittedBy: "priya",
          submittedAt: 152,
          submitNote: "First version of the balance transfer intro terms.",
          approvals: [{ actor: "jordan", decision: "approved", at: 150, seen: ["typical", "long", "minimum"] }],
          activatedAt: 150,
          supersededAt: 47.5,
          sunset: { inDays: 21, setBy: "jordan", setAt: 2.2 },
        },
        {
          ref: "v2",
          number: 2,
          state: "active",
          basedOn: "v1",
          supersedes: "v1",
          body: balanceTransferBody(2),
          variables: withEndDate,
          channels: ["pdf", "web"],
          contractChanges: [addedEndDate],
          createdBy: "priya",
          createdAt: 55,
          submittedBy: "priya",
          submittedAt: 50,
          submitNote: "Extends the intro period to 15 months and adds an offer end date.",
          approvals: [{ actor: "jordan", decision: "approved", at: 47.5, seen: ["typical", "long"] }],
          activatedAt: 47.5,
        },
      ],
      threads: [
        {
          origin: "v2",
          block: "intro",
          quote: "pay 0% intro APR on that balance for 15 months",
          comments: [
            { author: "jordan", body: "Confirm 15 months matches the product sheet before this goes out.", at: 49.2 },
            { author: "priya", body: "Confirmed with Product. The sheet says 15 months.", at: 48.8 },
          ],
          resolved: { by: "priya", at: 48.7 },
        },
      ],
    },

    // v1 Superseded (no sunset), v2 Active, v3 In review on round 2 after one send-back (round 1, Changes
    // requested), with a breaking contract change.
    {
      key: "cash-back",
      teamId: "coral-offers",
      name: "Cash Back Welcome Bonus — Terms",
      createdBy: "maya",
      createdAt: 210,
      consumers: ["coral"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "superseded",
          body: cashBackBody(1),
          variables: customer,
          channels: ["pdf", "web"],
          createdBy: "maya",
          createdAt: 210,
          submittedBy: "maya",
          submittedAt: 205,
          submitNote: "Welcome bonus terms for the cash back card.",
          approvals: [{ actor: "alex", decision: "approved", at: 203, seen: ["typical", "long", "minimum"] }],
          activatedAt: 203,
          supersededAt: 86.5,
        },
        {
          ref: "v2",
          number: 2,
          state: "active",
          basedOn: "v1",
          supersedes: "v1",
          body: cashBackBody(2),
          variables: withEndDate,
          channels: ["pdf", "web"],
          contractChanges: [addedEndDate],
          createdBy: "maya",
          createdAt: 92,
          submittedBy: "maya",
          submittedAt: 88,
          submitNote: "Adds an offer end date.",
          approvals: [{ actor: "jordan", decision: "approved", at: 86.5, seen: ["typical", "long"] }],
          activatedAt: 86.5,
        },
        {
          ref: "v3r1",
          number: 3,
          round: 1,
          state: "changes_requested",
          basedOn: "v2",
          body: cashBackBody(3, 1),
          variables: vars.list([...CUSTOMER_KEYS, "offer_end_date", "annual_fee"]),
          channels: ["pdf", "web"],
          contractChanges: [
            { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
          ],
          createdBy: "maya",
          createdAt: 5,
          submittedBy: "maya",
          submittedAt: 3.2,
          submitNote: "Product added an annual fee. Rates table and copy updated.",
          approvals: [{ actor: "jordan", decision: "changes_requested", reason: CASH_BACK_V3_REASON, at: 2.6, seen: ["typical"] }],
        },
        {
          ref: "v3",
          number: 3,
          round: 2,
          state: "in_review",
          basedOn: "v3r1",
          body: cashBackBody(3),
          variables: vars.list([...CUSTOMER_KEYS, "offer_end_date", "annual_fee"]),
          channels: ["pdf", "web"],
          contractChanges: [
            { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
          ],
          createdBy: "maya",
          createdAt: 2.6,
          editSessions: 3,
          submittedBy: "maya",
          submittedAt: 0.9,
          submitNote: "Product confirmed an annual fee after the first year. Rates table and copy updated.",
        },
      ],
      threads: [
        {
          // The change request that sent round 1 back, answered by submitting round 2.
          origin: "v3r1",
          block: DOCUMENT_THREAD,
          comments: [{ author: "jordan", kind: "change_request", body: CASH_BACK_V3_REASON, at: 2.6 }],
          resolved: { by: "maya", at: 0.9 },
        },
      ],
    },

    // v1 Changes requested; an open draft with one resolved and one open comment thread.
    {
      key: "annual-fee-waiver",
      teamId: "coral-offers",
      name: "Annual Fee Waiver — Terms",
      createdBy: "maya",
      createdAt: 10,
      consumers: ["coral"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "changes_requested",
          body: annualFeeWaiverBody("v1"),
          variables: customer,
          channels: ["pdf", "web"],
          createdBy: "maya",
          createdAt: 10,
          submittedBy: "maya",
          submittedAt: 4.5,
          submitNote: "Waiver for new accounts, first year only.",
          approvals: [{ actor: "jordan", decision: "changes_requested", reason: WAIVER_V1_REASON, at: 3.9, seen: ["typical"] }],
        },
        {
          ref: "draft",
          number: null,
          state: "draft",
          basedOn: "v1",
          body: annualFeeWaiverBody("draft"),
          variables: customer,
          channels: ["pdf", "web"],
          createdBy: "maya",
          createdAt: 3.9,
          updatedAt: 0.8,
          editSessions: 4,
          rev: 23,
        },
      ],
      threads: [
        {
          origin: "v1",
          block: "anniversary",
          quote: "after your first year",
          comments: [
            {
              author: "jordan",
              body: "Say \"first account anniversary\" instead of \"first year\". A year is ambiguous for accounts opened mid-month.",
              at: 4.1,
            },
            { author: "maya", body: "Done. The new draft says \"first account anniversary\".", at: 3.5 },
          ],
          resolved: { by: "maya", at: 3.4 },
        },
        {
          // The change request that sent v1 back, still open: the draft hasn't been submitted.
          origin: "v1",
          block: DOCUMENT_THREAD,
          comments: [
            { author: "jordan", kind: "change_request", body: WAIVER_V1_REASON, at: 3.9 },
            {
              author: "maya",
              body: "Understood. I'm rewording the eligibility rule and will resubmit once Product confirms the 30-day window.",
              at: 3.2,
            },
          ],
        },
      ],
    },

    // v1 Revoked (wrong bonus amount); v2 Active.
    {
      key: "holiday-points",
      teamId: "coral-offers",
      name: "Holiday Points Promo — Terms",
      createdBy: "priya",
      createdAt: 175,
      consumers: ["coral"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "revoked",
          body: holidayPointsBody(1),
          variables: vars.list(CUSTOMER_KEYS, { purchase_apr: { label: "APR" } }),
          channels: ["pdf", "web"],
          createdBy: "priya",
          createdAt: 175,
          submittedBy: "priya",
          submittedAt: 170,
          submitNote: "Holiday bonus points promotion.",
          approvals: [{ actor: "jordan", decision: "approved", at: 168.5, seen: ["typical", "long"] }],
          activatedAt: 168.5,
          supersededAt: 35,
          revoke: {
            reason: "Wrong bonus amount",
            startedBy: "jordan",
            startedAt: 34.6,
            confirmedBy: "alex",
            confirmedAt: 34.3,
          },
        },
        {
          ref: "v2",
          number: 2,
          state: "active",
          basedOn: "v1",
          supersedes: "v1",
          body: holidayPointsBody(2),
          variables: customer,
          channels: ["pdf", "web"],
          contractChanges: [
            { kind: "label_changed", key: "purchase_apr", breaking: false, from: "APR", to: "Purchase APR" },
          ],
          createdBy: "priya",
          createdAt: 36,
          editSessions: 1,
          submittedBy: "priya",
          submittedAt: 35.6,
          submitNote: "Corrects the bonus from 25,000 to 20,000 points.",
          approvals: [{ actor: "alex", decision: "approved", at: 35, seen: ["typical"] }],
          activatedAt: 35,
        },
      ],
    },

    // v1 Active, created from a starter. The simple, settled template.
    {
      key: "rate-change-notice",
      teamId: "coral-offers",
      name: "Rate Change Notice",
      createdBy: "maya",
      createdAt: 130,
      starterKey: "rate_change_notice",
      consumers: ["coral"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "active",
          body: rateChangeBody(),
          variables: vars.list([...CUSTOMER_KEYS, "effective_date"]),
          channels: ["pdf", "web", "email"],
          email: {
            subject: inlineDoc("Your purchase APR is changing on {effective_date}"),
            preheader: inlineDoc("Hi {first_name}, here is what is changing on your Coral account."),
          },
          createdBy: "maya",
          createdAt: 130,
          submittedBy: "maya",
          submittedAt: 128,
          submitNote: "Started from the Rate change notice starter.",
          approvals: [{ actor: "alex", decision: "approved", at: 127, seen: ["typical", "long", "minimum"] }],
          activatedAt: 127,
        },
      ],
    },
  ];

  for (const t of templates) buildTemplate(ctx, t);
}
