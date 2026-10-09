// The consumer contract in plain English. A version's variable list is the API its consumers call;
// the diff itself (and which changes are breaking) lives in the editor's pure model, so the variables
// panel can flag changes live. This module words them, one line per change, for the submit dialog, the
// review screen, the Versions tab and the notices sent to consumers:
//   "v2 adds required `annual_fee` (Currency)."

import { TYPE_META } from "@/editor/model/variables";
import type { ContractChange } from "./types";

export { diffVariables, isBreaking } from "@/editor/model/contract";

/** One sentence per change, in the order given (the diff lists removals last). */
export function describeChanges(changes: readonly ContractChange[], versionNumber: number): string[] {
  return changes.map((change) => describeChange(change, versionNumber));
}

/**
 *   added          v2 adds required `annual_fee` (Currency). / v2 adds optional `promo_code` (Text).
 *   removed        v2 removes `promo_code` (Text).
 *   key_renamed    v2 renames `fee` to `annual_fee`.
 *   type_changed   v2 changes `annual_fee` from Text to Currency.
 *   made_required  v2 makes `promo_code` required.
 *   made_optional  v2 makes `promo_code` optional.
 *   label_changed  v2 changes the label of `annual_fee` to “Annual fee”.
 */
export function describeChange(change: ContractChange, versionNumber: number): string {
  const v = `v${versionNumber}`;
  const key = code(change.key);

  switch (change.kind) {
    case "added":
      return `${v} adds ${change.required ? "required" : "optional"} ${key} (${typeLabel(change.type)}).`;
    case "removed":
      return `${v} removes ${key} (${typeLabel(change.type)}).`;
    case "key_renamed":
      return `${v} renames ${code(change.from)} to ${code(change.to)}.`;
    case "type_changed":
      return `${v} changes ${key} from ${typeLabel(change.from)} to ${typeLabel(change.to)}.`;
    case "made_required":
      return `${v} makes ${key} required.`;
    case "made_optional":
      return `${v} makes ${key} optional.`;
    case "label_changed":
      return `${v} changes the label of ${key} to “${change.to}”.`;
  }
}

/** "Currency", "US state"; an unknown type reads as itself. */
export function typeLabel(type: string | undefined): string {
  if (!type) return "an unknown type";
  return (TYPE_META as Record<string, { label: string } | undefined>)[type]?.label ?? type;
}

/**
 * True when `value` has the fields its kind of contract change has: how a change stored as JSON (a
 * notice's payload) is read back, so a reader never needs a fallback for a missing field. A type is
 * any string here (`typeLabel` words one it doesn't know as itself).
 */
export function isContractChange(value: unknown): value is ContractChange {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  const text = (x: unknown) => typeof x === "string";
  if (!text(c.key) || typeof c.breaking !== "boolean") return false;
  switch (c.kind) {
    case "added":
    case "removed":
      return text(c.type) && typeof c.required === "boolean";
    case "key_renamed":
    case "type_changed":
    case "label_changed":
      return text(c.from) && text(c.to);
    case "made_required":
    case "made_optional":
      return true;
    default:
      return false;
  }
}

function code(key: string): string {
  return `\`${key}\``;
}
