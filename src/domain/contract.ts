// The consumer contract in plain English. A version's variable list is the API its consumers call;
// the diff itself (and which changes are breaking) lives in the editor's pure model, so the variables
// panel can flag changes live. This module words them, one line per change, for the submit dialog, the
// review screen, the Versions tab and the notices sent to consumers:
//   "v2 adds required `annual_fee` (Currency)."

import { TYPE_META } from "@/editor/model/variables";
import type { ContractChange, VariableType } from "./types";

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
    case "added": {
      const required = change.required ?? change.breaking;
      return `${v} adds ${required ? "required" : "optional"} ${key}${typeSuffix(change.type)}.`;
    }
    case "removed":
      return `${v} removes ${key}${typeSuffix(change.type)}.`;
    case "key_renamed":
      return `${v} renames ${code(change.from ?? change.key)} to ${code(change.to ?? change.key)}.`;
    case "type_changed":
      return `${v} changes ${key} from ${typeLabel(change.from)} to ${typeLabel(change.to ?? change.type)}.`;
    case "made_required":
      return `${v} makes ${key} required.`;
    case "made_optional":
      return `${v} makes ${key} optional.`;
    case "label_changed":
      return `${v} changes the label of ${key} to “${change.to ?? ""}”.`;
  }
}

/** "Currency", "US state"; an unknown type reads as itself. */
export function typeLabel(type: string | undefined): string {
  if (!type) return "an unknown type";
  return (TYPE_META as Record<string, { label: string } | undefined>)[type]?.label ?? type;
}

function typeSuffix(type: VariableType | undefined): string {
  return type ? ` (${typeLabel(type)})` : "";
}

function code(key: string): string {
  return `\`${key}\``;
}
