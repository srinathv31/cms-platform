// The starter gallery's catalog: keys, names and one-line descriptions. Pure data with no imports,
// so the gallery (a client component) and the server action can both read it.
//
// The content of each starter lives beside this file and is built on the server (index.ts).

export const STARTER_KEYS = ["blank", "card_offer_terms", "rate_change_notice", "fee_schedule"] as const;

export type StarterKey = (typeof STARTER_KEYS)[number];

export interface StarterMeta {
  key: StarterKey;
  name: string;
  /** One line, shown on the gallery card. */
  description: string;
}

/** In gallery order: Blank first. */
export const STARTERS: readonly StarterMeta[] = [
  { key: "blank", name: "Blank", description: "Just the required sections." },
  { key: "card_offer_terms", name: "Card offer terms", description: "A rewards offer with rates and fees." },
  { key: "rate_change_notice", name: "Rate change notice", description: "Tell customers a rate is changing, and when." },
  { key: "fee_schedule", name: "Fee schedule", description: "Account fees in a clear table." },
];

export function isStarterKey(value: unknown): value is StarterKey {
  return typeof value === "string" && (STARTER_KEYS as readonly string[]).includes(value);
}
