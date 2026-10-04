import type { SeedCtx } from "../context";
import { callout, disclosure, inlineDoc, p, table, ul } from "../content";
import { buildTemplate } from "./build";
import type { SeedTemplate } from "./types";

// Card Statements: statement inserts. Marcus writes, Hana approves. No switchable persona belongs
// to this team, which is how the demo shows that teams are isolated.

const ISSUER = "Coral Bank, N.A. Member FDIC.";
const STATE_TERMS = "State-specific terms for {home_state} residents are in your cardmember agreement.";

function rateChangeInsert() {
  return disclosure("statement-rate-change", {
    offer: [
      p(
        "intro",
        "Hi {first_name}, the purchase APR on your account will change to {purchase_apr} on {effective_date}.",
      ),
      ul("what_it_means", [
        "The new rate applies to purchases made on or after the effective date.",
        "Your current balance keeps the rate shown on this statement.",
        "No action is needed to keep your account open.",
      ]),
    ],
    rates: [
      table(
        "rates_table",
        ["Rate", "Your account"],
        [
          ["New purchase APR", "{purchase_apr}"],
          ["Effective date", "{effective_date}"],
        ],
      ),
    ],
    legal: [
      callout(
        "reject_callout",
        "You can reject this change by calling the number on the back of your card before the effective date.",
      ),
      p("state_terms", STATE_TERMS),
      p("issuer", ISSUER),
    ],
  });
}

function paperlessInsert() {
  return disclosure("statement-paperless", {
    offer: [
      p("intro", "Hi {first_name}, go paperless and get your statement the moment it closes."),
      ul("benefits", [
        "Statements are ready online and in the app on the day they close.",
        "You get an email when a new statement is available.",
        "You can switch back to paper at any time.",
      ]),
    ],
    rates: [
      table(
        "fee_table",
        ["Statement type", "Fee"],
        [
          ["Paperless statements", "$0"],
          ["Paper statements", "$2 per month"],
        ],
      ),
    ],
    legal: [
      callout(
        "consent_callout",
        "By enrolling, you agree to receive your statements electronically and to keep your email address up to date.",
      ),
      p("state_terms", STATE_TERMS),
      p("issuer", ISSUER),
    ],
  });
}

function privacyInsert() {
  return disclosure("statement-privacy", {
    offer: [
      p(
        "intro",
        "Hi {first_name}, once a year we remind you how we collect, use and protect your personal information.",
      ),
      p("link", "Read the full notice at [coral.example/privacy](https://coral.example/privacy)."),
    ],
    rates: [p("no_fees", "There is no fee associated with this notice.")],
    legal: [p("state_terms", STATE_TERMS), p("issuer", ISSUER)],
  });
}

export function seedCardStatementsTemplates(ctx: SeedCtx) {
  const { vars } = ctx;

  const templates: SeedTemplate[] = [
    {
      key: "statement-rate-change",
      teamId: "card-statements",
      name: "Statement Insert — Rate Change",
      createdBy: "marcus",
      createdAt: 110,
      consumers: ["deposits-online"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "active",
          body: rateChangeInsert(),
          variables: vars.list(["first_name", "purchase_apr", "effective_date", "home_state"]),
          channels: ["pdf", "web"],
          createdBy: "marcus",
          createdAt: 110,
          submittedBy: "marcus",
          submittedAt: 106,
          submitNote: "Statement insert for APR changes.",
          approvals: [{ actor: "hana", decision: "approved", at: 104, seen: ["typical", "long", "minimum"] }],
          activatedAt: 104,
        },
      ],
    },
    {
      key: "statement-paperless",
      teamId: "card-statements",
      name: "Statement Insert — Paperless Enrollment",
      createdBy: "marcus",
      createdAt: 95,
      consumers: ["deposits-online"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "active",
          body: paperlessInsert(),
          variables: vars.list(["first_name", "home_state"]),
          channels: ["pdf", "web", "email"],
          email: {
            subject: inlineDoc("{first_name}, go paperless and skip the stack"),
            preheader: inlineDoc("Switch in one step. Switch back any time."),
          },
          createdBy: "marcus",
          createdAt: 95,
          submittedBy: "marcus",
          submittedAt: 92,
          submitNote: "Paperless enrollment insert.",
          approvals: [{ actor: "hana", decision: "approved", at: 91, seen: ["typical", "minimum"] }],
          activatedAt: 91,
        },
      ],
    },
    {
      key: "statement-privacy",
      teamId: "card-statements",
      name: "Statement Insert — Annual Privacy Notice",
      createdBy: "marcus",
      createdAt: 9,
      consumers: ["deposits-online"],
      versions: [
        {
          ref: "draft",
          number: null,
          state: "draft",
          body: privacyInsert(),
          variables: vars.list(["first_name", "home_state"]),
          channels: ["pdf", "web"],
          createdBy: "marcus",
          createdAt: 9,
          updatedAt: 2,
          editSessions: 3,
          rev: 18,
        },
      ],
    },
  ];

  for (const t of templates) buildTemplate(ctx, t);
}
