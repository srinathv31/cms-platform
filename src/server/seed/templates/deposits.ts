import type { SeedCtx } from "../context";
import { callout, disclosure, inlineDoc, ol, p, table, ul } from "../content";
import { buildTemplate } from "./build";
import type { SeedTemplate } from "./types";

// Deposits: savings and checking disclosures. Eli writes, Naomi approves. Priya is a Viewer here.

const FDIC =
  "Deposits are insured by the FDIC up to $250,000 per depositor, per insured bank, for each ownership category.";
const STATE_TERMS = "Account terms for {home_state} residents are in your deposit account agreement.";

function savingsBody(version: 1 | 2) {
  return disclosure("high-yield-savings", {
    offer: [
      p(
        "intro",
        "Hi {first_name}, your High-Yield Savings account earns {apy} annual percentage yield (APY) on balances of {minimum_balance} or more.",
      ),
      ul("features", [
        "Interest compounds daily and is credited monthly.",
        "There is no monthly maintenance fee.",
        "Transfers between your Coral accounts are free.",
      ]),
    ],
    rates: [
      table(
        "rates_table",
        ["Balance tier", "APY"],
        [
          ["Under {minimum_balance}", "0.10%"],
          ["{minimum_balance} and over", "{apy}"],
        ],
      ),
      ...(version === 2
        ? [p("withdrawals", "Excess withdrawals: $10 per withdrawal over 6 in each statement cycle.")]
        : []),
    ],
    legal: [
      p("fdic", FDIC),
      callout(
        "rate_callout",
        "Rates are variable and accurate as of {effective_date}. They may change after you open your account.",
      ),
      p("state_terms", STATE_TERMS),
    ],
  });
}

function checkingBody() {
  return disclosure("checking-fees", {
    offer: [
      p("intro", "Hi {first_name}, here are the fees for your Everyday Checking account."),
      ul("waivers", [
        "The monthly service fee is waived when your daily balance stays at or above {minimum_balance}.",
        "Your first set of checks is free.",
        "Online and mobile banking are always free.",
      ]),
    ],
    rates: [
      table(
        "fee_table",
        ["Fee", "Amount"],
        [
          ["Monthly service fee", "{monthly_fee}"],
          ["Out-of-network ATM fee", "$2.50"],
          ["Stop payment", "$25"],
          ["Overdraft fee", "$0"],
          ["Paper statement", "$3 per month"],
        ],
      ),
    ],
    legal: [
      p("fdic", FDIC),
      callout("changes_callout", "We may change fees with 30 days' written notice."),
      p("state_terms", STATE_TERMS),
    ],
  });
}

function overdraftBody() {
  return disclosure("overdraft-protection", {
    offer: [
      p(
        "intro",
        "Hi {first_name}, overdraft protection links your checking account to your savings account so a transfer covers any shortfall.",
      ),
      ol("how_it_works", [
        "We check your checking balance when a payment posts.",
        "If it's short, we move the difference from your linked savings account.",
        "We email you the same day with the amount transferred.",
      ]),
    ],
    rates: [
      table(
        "fee_table",
        ["Fee", "Amount"],
        [
          ["Overdraft transfer fee", "$0"],
          ["Minimum linked savings balance", "{minimum_balance}"],
        ],
      ),
    ],
    legal: [p("fdic", FDIC), p("state_terms", STATE_TERMS)],
  });
}

export function seedDepositsTemplates(ctx: SeedCtx) {
  const { vars } = ctx;

  const templates: SeedTemplate[] = [
    {
      key: "high-yield-savings",
      teamId: "deposits",
      name: "High-Yield Savings — Rate Disclosure",
      createdBy: "eli",
      createdAt: 200,
      consumers: ["deposits-online"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "superseded",
          body: savingsBody(1),
          variables: vars.list(["first_name", "home_state", "apy", "minimum_balance", "effective_date"]),
          channels: ["pdf", "web"],
          createdBy: "eli",
          createdAt: 200,
          submittedBy: "eli",
          submittedAt: 196,
          submitNote: "Rate disclosure for the High-Yield Savings launch.",
          approvals: [{ actor: "naomi", decision: "approved", at: 194, seen: ["typical", "long", "minimum"] }],
          activatedAt: 194,
          supersededAt: 70,
        },
        {
          ref: "v2",
          number: 2,
          state: "active",
          basedOn: "v1",
          supersedes: "v1",
          body: savingsBody(2),
          variables: vars.list(["first_name", "home_state", "apy", "minimum_balance", "effective_date"]),
          channels: ["pdf", "web", "email"],
          email: {
            subject: inlineDoc("Your High-Yield Savings rate: {apy} APY"),
            preheader: inlineDoc("Hi {first_name}, here are the details of your savings rate."),
          },
          contractChanges: [],
          createdBy: "eli",
          createdAt: 78,
          submittedBy: "eli",
          submittedAt: 74,
          submitNote: "Adds the excess withdrawal limit and an email version.",
          approvals: [{ actor: "naomi", decision: "approved", at: 70, seen: ["typical", "long"] }],
          activatedAt: 70,
        },
      ],
    },
    {
      key: "checking-fees",
      teamId: "deposits",
      name: "Everyday Checking — Fee Schedule",
      createdBy: "eli",
      createdAt: 150,
      consumers: ["deposits-online"],
      versions: [
        {
          ref: "v1",
          number: 1,
          state: "active",
          body: checkingBody(),
          variables: vars.list(["first_name", "home_state", "monthly_fee", "minimum_balance"]),
          channels: ["pdf", "web"],
          createdBy: "eli",
          createdAt: 150,
          submittedBy: "eli",
          submittedAt: 146,
          submitNote: "Fee schedule for Everyday Checking.",
          approvals: [{ actor: "naomi", decision: "approved", at: 144, seen: ["typical", "long", "minimum"] }],
          activatedAt: 144,
        },
      ],
    },
    {
      key: "overdraft-protection",
      teamId: "deposits",
      name: "Overdraft Protection — Terms",
      createdBy: "eli",
      createdAt: 12,
      consumers: ["deposits-online"],
      versions: [
        {
          ref: "draft",
          number: null,
          state: "draft",
          body: overdraftBody(),
          variables: vars.list(["first_name", "home_state", "minimum_balance"]),
          channels: ["pdf", "web"],
          createdBy: "eli",
          createdAt: 12,
          updatedAt: 1.5,
          editSessions: 4,
          rev: 31,
        },
      ],
    },
  ];

  for (const t of templates) buildTemplate(ctx, t);
}
