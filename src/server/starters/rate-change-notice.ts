import type { JSONContent, Variable } from "@/domain/types";
import { callout, disclosure, inlineDoc, p, table } from "../seed/content";
import type { VariableKit } from "../seed/variables";

// Rate change notice: the change-in-terms letter. Every declared variable is used. Like the seeded
// Rate Change Notice, it is also an email, so it ships with a subject and preheader.

export function rateChangeNoticeVariables(kit: VariableKit): Variable[] {
  return kit.list(["first_name", "last_name", "purchase_apr", "home_state", "effective_date"]);
}

export function rateChangeNoticeEmail() {
  return {
    subject: inlineDoc("Your purchase APR is changing on {effective_date}"),
    preheader: inlineDoc("Hi {first_name}, here is what is changing on your account."),
  };
}

export function rateChangeNoticeBody(scope: string): JSONContent {
  return disclosure(scope, {
    offer: [
      p("notice_for", "Notice of change in terms for {first_name} {last_name}."),
      p(
        "intro",
        "The purchase APR on your account is changing. Your new purchase APR is {purchase_apr}, effective {effective_date}.",
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
      callout("state_callout", "State-specific terms for {home_state} residents are in your cardmember agreement."),
      p("issuer", "Coral Bank, N.A. Member FDIC."),
    ],
  });
}
