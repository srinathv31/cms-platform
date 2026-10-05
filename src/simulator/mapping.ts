// Mapping template variables to Coral's fields. Pure TypeScript (no server code), tested in
// mapping.test.ts. Values leave here as canonical strings; UCOMP validates them on render.

import type { ApiVariable } from "@/contracts/api-v1";
import { simField } from "./fields";
import type { SimCustomerRecord, SimFieldPath, SimOfferRecord } from "./types";

/**
 * Keys the simulator is sure about. `annual_fee` is deliberately absent: a fee can come from the
 * customer's card or from the offer, so the person picks.
 */
const AUTO: Readonly<Record<string, SimFieldPath>> = {
  first_name: "customer.firstName",
  last_name: "customer.lastName",
  full_name: "customer.fullName",
  email: "customer.email",
  purchase_apr: "customer.purchaseApr",
  home_state: "customer.homeState",
  offer_end_date: "offer.endsOn",
};

function fits(path: string | null | undefined, variable: ApiVariable): path is SimFieldPath {
  const field = simField(path);
  return field !== null && field.fits.includes(variable.type);
}

/**
 * A mapping for `variables`: current mappings that still fit their variable's type are kept, then
 * known keys are auto-mapped. Keys that aren't variables are dropped; uncertain keys stay unmapped.
 */
export function suggestMapping(
  variables: readonly ApiVariable[],
  current: Readonly<Record<string, SimFieldPath | string | null>> = {},
): Record<string, SimFieldPath> {
  const out: Record<string, SimFieldPath> = {};
  for (const variable of variables) {
    const kept = Object.hasOwn(current, variable.key) ? current[variable.key] : null;
    if (fits(kept, variable)) out[variable.key] = kept;
    else if (Object.hasOwn(AUTO, variable.key) && fits(AUTO[variable.key], variable)) out[variable.key] = AUTO[variable.key];
  }
  return out;
}

/** Required variables with no (known) field mapped, in contract order. */
export function missingRequired(
  variables: readonly ApiVariable[],
  mapping: Readonly<Record<string, SimFieldPath | string | null>>,
): ApiVariable[] {
  return variables.filter((v) => v.required && simField(Object.hasOwn(mapping, v.key) ? mapping[v.key] : null) === null);
}

/** One field's canonical value for a customer and offer, or null when Coral has none. */
export function fieldValue(path: SimFieldPath, customer: SimCustomerRecord, offer: SimOfferRecord): string | null {
  switch (path) {
    case "customer.firstName":
      return customer.firstName;
    case "customer.lastName":
      return customer.lastName;
    case "customer.fullName":
      return `${customer.firstName} ${customer.lastName}`;
    case "customer.email":
      return customer.email;
    case "customer.homeState":
      return customer.homeState;
    case "customer.purchaseApr":
      return customer.purchaseApr;
    case "customer.annualFee":
      return customer.annualFee;
    case "offer.name":
      return offer.name;
    case "offer.headline":
      return offer.headline;
    case "offer.spend":
      return String(offer.terms.spend);
    case "offer.bonus":
      return String(offer.terms.bonus);
    case "offer.months":
      return String(offer.terms.months);
    case "offer.annualFee":
      return offer.terms.annualFee === undefined ? null : String(offer.terms.annualFee);
    case "offer.endsOn":
      return offer.terms.endsOn ?? null;
  }
}

/**
 * The render body's `values` for one customer. A field Coral has no value for is left out, so UCOMP
 * answers with its own missing_variables error (for a required key) instead of a made-up value.
 */
export function valuesFor(
  mapping: Readonly<Record<string, SimFieldPath>>,
  customer: SimCustomerRecord,
  offer: SimOfferRecord,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, path] of Object.entries(mapping)) {
    if (simField(path) === null) continue;
    const value = fieldValue(path, customer, offer);
    if (value !== null) values[key] = value;
  }
  return values;
}

/** "A", "A and B", "A, B and C". */
function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Map First name and Annual fee to send." Empty when nothing is missing. */
export function blockedSentence(missing: readonly Pick<ApiVariable, "label">[]): string {
  return missing.length === 0 ? "" : `Map ${joinWithAnd(missing.map((v) => v.label))} to send.`;
}
