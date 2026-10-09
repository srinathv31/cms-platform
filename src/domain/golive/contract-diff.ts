// Contract changes as the consumer API publishes them. The diff itself and which changes break a
// consumer live in the editor's pure model (`diffVariables`); the sentences in domain/contract.ts.
// Pure TypeScript.

import { describeChange, diffVariables } from "../contract";
import type { ApiContractChange, ApiContractDiff, ContractChange, Variable } from "../golive-types";

/**
 * Each change with its sentence, worded for `versionNumber`: "v3 adds required `annual_fee` (Currency)."
 * A rename, a type change and a label change carry `from` and `to`; the other kinds say it in `text`.
 */
export function apiChanges(changes: readonly ContractChange[], versionNumber: number): ApiContractChange[] {
  return changes.map((change): ApiContractChange => {
    const text = describeChange(change, versionNumber);
    switch (change.kind) {
      case "key_renamed":
        return { kind: change.kind, key: change.key, breaking: change.breaking, from: change.from, to: change.to, text };
      case "type_changed":
        return { kind: change.kind, key: change.key, breaking: change.breaking, from: change.from, to: change.to, text };
      case "label_changed":
        return { kind: change.kind, key: change.key, breaking: change.breaking, from: change.from, to: change.to, text };
      default:
        return { kind: change.kind, key: change.key, breaking: change.breaking, text };
    }
  });
}

/** Kinds that ask a consumer for something new when the variable is required. */
const ASKS = new Set<ContractChange["kind"]>(["added", "key_renamed", "made_required", "type_changed"]);

/**
 * What changed from one released version's contract to another's. `newRequired` lists the required
 * keys (in the newer version's order) a consumer moving from `from` must newly supply: added as
 * required, renamed, made required, or retyped.
 */
export function contractDiff(
  from: { number: number; variables: readonly Variable[] },
  to: { number: number; variables: readonly Variable[] },
): ApiContractDiff {
  const changes = diffVariables(from.variables, to.variables);
  const asked = new Set(changes.filter((c) => ASKS.has(c.kind)).map((c) => c.key));
  return {
    since: from.number,
    to: to.number,
    breaking: changes.some((c) => c.breaking),
    items: apiChanges(changes, to.number),
    newRequired: to.variables.filter((v) => v.required && asked.has(v.key)).map((v) => v.key),
  };
}
