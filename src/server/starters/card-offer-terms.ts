import type { JSONContent, Variable } from "@/domain/types";
import { callout, disclosure, p, table, ul } from "../seed/content";
import type { VariableKit } from "../seed/variables";

// Card offer terms: a rewards offer written the way the Coral Offers templates are.
//
// `first_name` and `purchase_apr` are declared but not used in the body, on purpose: the author
// drags the first name in from the panel and types {{ to add the purchase APR (build plan, scenario 2).
// `offer_end_date` is left out for the same reason: the author creates it.

export function cardOfferTermsVariables(kit: VariableKit): Variable[] {
  return kit.list(["first_name", "purchase_apr", "home_state"]);
}

export function cardOfferTermsBody(scope: string): JSONContent {
  return disclosure(scope, {
    offer: [
      p("intro", "Spend $2,000 on purchases in your first 3 months and earn a $200 statement credit."),
      ul("how_it_works", [
        "Purchases must post to your account within 3 months of the account opening date.",
        "Cash advances, balance transfers, fees and interest don't count toward the spend requirement.",
        "The statement credit posts within 2 billing cycles after you qualify.",
      ]),
    ],
    rates: [
      table(
        "rates_table",
        ["Rate or fee", "What you pay"],
        [
          ["Annual fee", "$0"],
          ["Foreign transaction fee", "None"],
          ["Cash advance fee", "5% of each advance, $10 minimum"],
          ["Late payment fee", "Up to $40"],
        ],
      ),
      p(
        "interest",
        "Interest on purchases starts on the transaction date unless you pay your full statement balance by the due date.",
      ),
    ],
    legal: [
      p("state_terms", "State-specific terms for {home_state} residents are in your cardmember agreement."),
      callout("tax_callout", "The statement credit may be taxable. Talk to a tax advisor about your situation."),
      p("issuer", "Coral Bank, N.A. Member FDIC. Credit approval required."),
    ],
  });
}
