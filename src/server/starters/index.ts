import "server-only";
import { ensureBlockIds } from "@/editor/schema";
import type { StarterContent } from "@/domain/lifecycle";
import { assertNever } from "@/domain/assert-never";
import { VariableKit } from "../seed/variables";
import { blankAlert, cardActivity, paymentReminder, statementReady, type AlertStarter } from "./alerts";
import { blankBody } from "./blank";
import { cardOfferTermsBody, cardOfferTermsVariables } from "./card-offer-terms";
import { STARTERS, type StarterChoice, type StarterKey } from "./catalog";
import { feeScheduleBody, feeScheduleVariables } from "./fee-schedule";
import {
  rateChangeNoticeBody,
  rateChangeNoticeEmail,
  rateChangeNoticeVariables,
} from "./rate-change-notice";

export {
  STARTERS,
  STARTER_KEYS,
  isStarterKey,
  type StarterChoice,
  type StarterKey,
  type StarterMeta,
} from "./catalog";

export interface BuildStarterOptions {
  /**
   * Seeds the top-level block ids (they are derived from scope + block). Pass something unique to
   * the template, such as its new id, so two templates from one starter never share block ids.
   */
  scope: string;
  /** The demo clock: sample dates are set relative to it. */
  now: Date;
}

/**
 * A starter's content, ready to become a template's first draft. A document's body has the content
 * type's three required H2 sections in order; an alert's is one empty paragraph, beside its push and
 * SMS fields. Every block (nested ones too) has its id.
 */
export function buildStarter(choice: StarterChoice, { scope, now }: BuildStarterOptions): StarterContent {
  const kit = new VariableKit(now.getTime());
  const meta = STARTERS[choice.family].find((s) => s.key === choice.starterKey)!;

  const base = (body: StarterContent["body"], variables: StarterContent["variables"]): StarterContent => ({
    key: meta.key,
    name: meta.name,
    body: ensureBlockIds(body),
    variables,
    sampleSets: kit.sampleSets(variables),
  });
  const message = (starter: AlertStarter): StarterContent => ({
    ...base(starter.body, starter.variables),
    channels: starter.channels,
    channelFields: starter.channelFields,
  });

  switch (choice.family) {
    case "document":
      return documentStarter(choice.starterKey);
    case "message":
      return alertStarter(choice.starterKey);
    default:
      return assertNever(choice, "starter family");
  }

  function documentStarter(key: StarterKey<"document">): StarterContent {
    switch (key) {
      case "blank":
        return base(blankBody(scope), []);
      case "card_offer_terms":
        return base(cardOfferTermsBody(scope), cardOfferTermsVariables(kit));
      case "rate_change_notice":
        return {
          ...base(rateChangeNoticeBody(scope), rateChangeNoticeVariables(kit)),
          channels: ["pdf", "web", "email"],
          channelFields: { email: rateChangeNoticeEmail() },
        };
      case "fee_schedule":
        return base(feeScheduleBody(scope), feeScheduleVariables(kit));
      default:
        return assertNever(key, "document starter");
    }
  }

  function alertStarter(key: StarterKey<"message">): StarterContent {
    switch (key) {
      case "blank":
        return message(blankAlert(scope, kit));
      case "payment_reminder":
        return message(paymentReminder(scope, kit));
      case "card_activity":
        return message(cardActivity(scope, kit));
      case "statement_ready":
        return message(statementReady(scope, kit));
      default:
        return assertNever(key, "alert starter");
    }
  }
}
