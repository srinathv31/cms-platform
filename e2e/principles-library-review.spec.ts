import { expect, test } from "@playwright/test";
import {
  BALANCE,
  CARD_ABROAD,
  COLLECT,
  DEPOSIT,
  FEE_WAIVER,
  HEADS_UP,
  HIGH_YIELD,
  HOLIDAY,
  LIBRARY,
  PAYMENT_DUE,
  RATE_CHANGE,
  REQUEST_ACCESS,
  REVIEW,
  STATEMENT,
  describeRoutes,
  installCls,
} from "./helpers/principles";
import { versionsOf } from "./helpers/state";

// Phase 7 principle checks: the seed's template ids, the Library, the review queue and review screens, and Request access.
// The five checks, the personas and the route matrix are in e2e/helpers/principles.ts.

// The preview iframes are sandboxed: Playwright's trace injects scripts into frames and Chrome logs "Blocked script execution".
test.use({ trace: "off" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installCls);
});

const SEEDED: Record<string, string> = {
  [COLLECT]: "Cash Back Welcome Bonus — Terms",
  [BALANCE]: "Balance Transfer Intro — Terms",
  [FEE_WAIVER]: "Annual Fee Waiver — Terms",
  [HOLIDAY]: "Holiday Points Promo — Terms",
  [RATE_CHANGE]: "Rate Change Notice",
  [DEPOSIT]: "Everyday Checking — Fee Schedule",
  [HIGH_YIELD]: "High-Yield Savings — Rate Disclosure",
  [STATEMENT]: "Statement Insert — Rate Change",
  [PAYMENT_DUE]: "Payment Due Reminder",
  [CARD_ABROAD]: "Card Used Abroad",
  [HEADS_UP]: "Rate Change Heads-up",
};

test("the template ids this spec names are the seed's", async () => {
  const found: Record<string, string> = {};
  for (const id of Object.keys(SEEDED)) {
    // The newest numbered row, or the draft of a template that has nothing else.
    const versions = await versionsOf(id);
    const newest =
      versions.filter((v) => v.number !== null).at(-1) ?? versions[0];
    if (newest) found[id] = newest.name;
  }
  expect(
    found,
    "each id is the seeded template of that name (npm run db:reset, or update the ids)",
  ).toEqual(SEEDED);
});

describeRoutes(test, "Library", LIBRARY);
describeRoutes(test, "Review queue and review screen", REVIEW);
describeRoutes(test, "Request access", REQUEST_ACCESS);
