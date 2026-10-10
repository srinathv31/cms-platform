// The starter gallery's catalog: keys, names and one-line descriptions, for each kind of template.
// Pure data (its one import is a type), so the gallery (a client component) and the server action can
// both read it.
//
// A template is a document or an alert for life (decision 0034), so each kind has its own starters,
// keyed by its channel family: a document's start from a body with the required sections, an alert's
// from a push and an SMS. Both open with Blank. The content of each starter lives beside this file and
// is built on the server (index.ts).

import type { ChannelFamily } from "@/domain/types";

export const STARTER_KEYS = {
  document: ["blank", "card_offer_terms", "rate_change_notice", "fee_schedule"],
  message: ["blank", "payment_reminder", "card_activity", "statement_ready"],
} as const satisfies { readonly [F in ChannelFamily]: readonly string[] };

/** A starter of one family: `StarterKey<"message">` is "blank" | "payment_reminder" | …. */
export type StarterKey<F extends ChannelFamily = ChannelFamily> = (typeof STARTER_KEYS)[F][number];

/** Which starter: its family, and its key within the family. What New template sends. */
export type StarterChoice = { [F in ChannelFamily]: { family: F; starterKey: StarterKey<F> } }[ChannelFamily];

export interface StarterMeta<F extends ChannelFamily = ChannelFamily> {
  key: StarterKey<F>;
  name: string;
  /** One line, shown on the gallery card. */
  description: string;
}

/** Each kind's starters, in gallery order: Blank first. */
export const STARTERS: { readonly [F in ChannelFamily]: readonly StarterMeta<F>[] } = {
  document: [
    { key: "blank", name: "Blank", description: "Just the required sections." },
    { key: "card_offer_terms", name: "Card offer terms", description: "A rewards offer with rates and fees." },
    { key: "rate_change_notice", name: "Rate change notice", description: "Tell customers a rate is changing, and when." },
    { key: "fee_schedule", name: "Fee schedule", description: "Account fees in a clear table." },
  ],
  message: [
    { key: "blank", name: "Blank", description: "Just a push and a text message." },
    { key: "payment_reminder", name: "Payment reminder", description: "A payment is due soon, and how much." },
    { key: "card_activity", name: "Card activity", description: "Ask about a purchase made with the card." },
    { key: "statement_ready", name: "Statement ready", description: "A new statement is ready to view." },
  ],
};

export function isStarterKey<F extends ChannelFamily>(family: F, value: unknown): value is StarterKey<F> {
  return typeof value === "string" && (STARTER_KEYS[family] as readonly string[]).includes(value);
}
