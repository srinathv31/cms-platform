// The fields Coral can feed into a template variable: every customer.* and offer.* path, with the
// variable types its values are valid for. Pure data (no server code): the link flow and the mapping
// rows list these as combobox options.

import type { SimField, SimFieldPath } from "./types";

export const SIM_FIELDS: readonly SimField[] = [
  { path: "customer.firstName", source: "customer", label: "Customer · First name", fits: ["text"] },
  { path: "customer.lastName", source: "customer", label: "Customer · Last name", fits: ["text"] },
  { path: "customer.fullName", source: "customer", label: "Customer · Full name", fits: ["text"] },
  { path: "customer.email", source: "customer", label: "Customer · Email", fits: ["text"] },
  { path: "customer.homeState", source: "customer", label: "Customer · Home state", fits: ["us_state", "text"] },
  { path: "customer.purchaseApr", source: "customer", label: "Customer · Purchase APR", fits: ["percent", "number", "text"] },
  { path: "customer.annualFee", source: "customer", label: "Customer · Annual fee", fits: ["currency", "number", "text"] },
  { path: "offer.name", source: "offer", label: "Offer · Name", fits: ["text"] },
  { path: "offer.headline", source: "offer", label: "Offer · Headline", fits: ["text"] },
  { path: "offer.spend", source: "offer", label: "Offer · Spend", fits: ["currency", "number", "text"] },
  { path: "offer.bonus", source: "offer", label: "Offer · Bonus", fits: ["currency", "number", "text"] },
  { path: "offer.months", source: "offer", label: "Offer · Months", fits: ["number", "text"] },
  { path: "offer.annualFee", source: "offer", label: "Offer · Annual fee", fits: ["currency", "number", "text"] },
  { path: "offer.endsOn", source: "offer", label: "Offer · Ends on", fits: ["date", "text"] },
];

const BY_PATH: ReadonlyMap<string, SimField> = new Map(SIM_FIELDS.map((f) => [f.path, f]));

/** The field for a stored path, or null when the path isn't one of SIM_FIELDS (old or hand-edited data). */
export function simField(path: string | null | undefined): SimField | null {
  return path ? (BY_PATH.get(path) ?? null) : null;
}

export function isSimFieldPath(path: unknown): path is SimFieldPath {
  return typeof path === "string" && BY_PATH.has(path);
}
