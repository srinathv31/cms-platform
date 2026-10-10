// What Coral sends each kind of thing it links on. Pure data, for the link flow and `linkTemplate`: an
// offer goes out as documents, an alert to the customer's phone. Stencil's templates come in the same two
// families, so an offer links a document template and an alert an alert template.

import type { ApiChannel } from "@/contracts/api-v1";
import type { SimOfferKind } from "./types";

export const KIND_CHANNELS: Record<SimOfferKind, { channels: readonly ApiChannel[]; refusal: string }> = {
  offer: { channels: ["pdf", "web", "email"], refusal: "Coral sends offers as PDF, Web and Email." },
  alert: { channels: ["push", "sms"], refusal: "Coral sends alerts as Push and SMS." },
};

/** The channels of `channels` Coral sends a `kind` on, in the order given. */
export function sendable(kind: SimOfferKind, channels: readonly ApiChannel[]): ApiChannel[] {
  return channels.filter((c) => KIND_CHANNELS[kind].channels.includes(c));
}
