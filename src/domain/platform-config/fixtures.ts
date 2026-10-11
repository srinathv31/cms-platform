import type { Channel, RequiredSection } from "../types";

export const NOW = new Date("2026-10-05T12:00:00.000Z");
export const riley = { id: "riley", name: "Riley Brooks" };
export const alex = { id: "alex", name: "Alex Kim" };

export const SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];
export const disclosure = { id: "ct_disclosure", name: "Disclosure", requiredSections: SECTIONS, allowedChannels: ["pdf", "web", "email"] as Channel[] };
