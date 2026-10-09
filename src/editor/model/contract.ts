// The consumer contract: how a variable list differs from its baseline's (the list consumers render now).
// Pure TypeScript. The variables panel flags these live; the submit and review dialogs list them.
// Rules (build plan, "Template lifecycle"):
//   breaking      a required variable added · a variable removed · a key renamed · a type changed ·
//                 optional made required
//   non-breaking  an optional variable added · made optional · a label changed

import type { ContractChange, Variable } from "./types";

/** What a variable is across renames: its id, or its key when it has none (`Variable.id`). */
export function identityOf(variable: Pick<Variable, "id" | "key">): string {
  return variable.id ?? variable.key;
}

/**
 * Changes from `baseline` to `current`, in `current` order, removals last.
 *
 * Variables are paired in two passes. A variable with an id pairs with the baseline variable of that
 * identity, whatever either is keyed now: that is a rename, so `a` → `b` → `c` is one rename `a` → `c`,
 * and renaming back to `a` is no change. Then every variable still unpaired pairs by key with a baseline
 * variable still unpaired. So a new variable that takes a renamed variable's old key is an addition
 * beside the rename, and one deleted and made again under the same key is the same variable.
 */
export function diffVariables(baseline: readonly Variable[], current: readonly Variable[]): ContractChange[] {
  const byIdentity = new Map(baseline.map((v) => [identityOf(v), v]));
  const byKey = new Map(baseline.map((v) => [v.key, v]));
  const paired = new Map<Variable, Variable>();
  const taken = new Set<Variable>();
  const pair = (v: Variable, old: Variable | undefined) => {
    if (!old || taken.has(old)) return;
    paired.set(v, old);
    taken.add(old);
  };

  for (const v of current) if (v.id !== undefined) pair(v, byIdentity.get(v.id));
  for (const v of current) if (!paired.has(v)) pair(v, byKey.get(v.key));

  const changes: ContractChange[] = [];
  for (const v of current) {
    const old = paired.get(v);
    if (!old) {
      changes.push({ kind: "added", key: v.key, breaking: v.required, type: v.type, required: v.required });
      continue;
    }
    if (old.key !== v.key) {
      changes.push({ kind: "key_renamed", key: v.key, breaking: true, from: old.key, to: v.key });
    }
    if (old.type !== v.type) {
      changes.push({ kind: "type_changed", key: v.key, breaking: true, from: old.type, to: v.type });
    }
    if (old.required !== v.required) {
      changes.push(
        v.required
          ? { kind: "made_required", key: v.key, breaking: true }
          : { kind: "made_optional", key: v.key, breaking: false },
      );
    }
    if (old.label !== v.label) {
      changes.push({ kind: "label_changed", key: v.key, breaking: false, from: old.label, to: v.label });
    }
  }

  for (const old of baseline) {
    if (taken.has(old)) continue;
    changes.push({ kind: "removed", key: old.key, breaking: true, type: old.type, required: old.required });
  }

  return changes;
}

/** True when any change would break a consumer that renders the baseline's contract. */
export function isBreaking(changes: readonly ContractChange[]): boolean {
  return changes.some((c) => c.breaking);
}

/**
 * Keys whose contract changed (anything but a label), for the panel's per-row flag.
 * Labels are display-only, so a label change alone isn't flagged.
 */
export function flaggedKeys(changes: readonly ContractChange[]): Set<string> {
  return new Set(changes.filter((c) => c.kind !== "label_changed").map((c) => c.key));
}
