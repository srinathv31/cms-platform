import "server-only";
import { ensureBlockIds } from "@/editor/schema";
import type { StarterContent } from "@/domain/lifecycle";
import { VariableKit } from "../seed/variables";
import { blankBody } from "./blank";
import { cardOfferTermsBody, cardOfferTermsVariables } from "./card-offer-terms";
import { STARTERS, type StarterKey, type StarterMeta } from "./catalog";
import { feeScheduleBody, feeScheduleVariables } from "./fee-schedule";
import {
  rateChangeNoticeBody,
  rateChangeNoticeEmail,
  rateChangeNoticeVariables,
} from "./rate-change-notice";

export { STARTERS, STARTER_KEYS, isStarterKey, type StarterKey, type StarterMeta } from "./catalog";

export interface BuildStarterOptions {
  /**
   * Seeds the top-level block ids (they are derived from scope + block). Pass something unique to
   * the template, such as its new id, so two templates from one starter never share block ids.
   */
  scope: string;
  /** The demo clock: sample dates are set relative to it. */
  now: Date;
}

const BY_KEY = new Map<StarterKey, StarterMeta>(STARTERS.map((s) => [s.key, s]));

/**
 * A starter's content, ready to become a template's first draft. Every body has the content
 * type's three required H2 sections in order, and every block (nested ones too) has its id.
 */
export function buildStarter(key: StarterKey, { scope, now }: BuildStarterOptions): StarterContent {
  const meta = BY_KEY.get(key)!;
  const kit = new VariableKit(now.getTime());

  const base = (body: StarterContent["body"], variables: StarterContent["variables"]): StarterContent => ({
    key: meta.key,
    name: meta.name,
    body: ensureBlockIds(body),
    variables,
    sampleSets: kit.sampleSets(variables),
  });

  switch (key) {
    case "blank":
      return base(blankBody(scope), []);
    case "card_offer_terms":
      return base(cardOfferTermsBody(scope), cardOfferTermsVariables(kit));
    case "rate_change_notice": {
      const email = rateChangeNoticeEmail();
      return {
        ...base(rateChangeNoticeBody(scope), rateChangeNoticeVariables(kit)),
        channels: ["pdf", "web", "email"],
        emailSubject: email.subject,
        emailPreheader: email.preheader,
      };
    }
    case "fee_schedule":
      return base(feeScheduleBody(scope), feeScheduleVariables(kit));
  }
}
