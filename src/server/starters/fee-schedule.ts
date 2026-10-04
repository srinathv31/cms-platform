import type { JSONContent, Variable } from "@/domain/types";
import { callout, disclosure, p, table, ul } from "../seed/content";
import type { VariableKit } from "../seed/variables";

// Fee schedule: a checking account's fees as a table, with the ways to avoid the monthly fee.
// Every declared variable is used.

export function feeScheduleVariables(kit: VariableKit): Variable[] {
  return kit.list(["effective_date", "monthly_fee", "minimum_balance", "home_state"]);
}

export function feeScheduleBody(scope: string): JSONContent {
  return disclosure(scope, {
    offer: [
      p("intro", "These fees apply to your checking account starting {effective_date}."),
      ul("waivers", [
        "The monthly service fee is waived when your daily balance stays at or above {minimum_balance}.",
        "Online and mobile banking are always free.",
        "Your first set of checks is free.",
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
          ["Domestic wire transfer", "$15"],
          ["Paper statement", "$3 per month"],
          ["Overdraft fee", "$0"],
        ],
      ),
    ],
    legal: [
      p(
        "fdic",
        "Deposits are insured by the FDIC up to $250,000 per depositor, per insured bank, for each ownership category.",
      ),
      callout("changes_callout", "We may change fees with 30 days' written notice."),
      p("state_terms", "Account terms for {home_state} residents are in your deposit account agreement."),
    ],
  });
}
