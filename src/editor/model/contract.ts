// The consumer contract: how a variable list differs from the Active version's list.
// Pure TypeScript. The variables panel flags these live; the submit and review dialogs list them.
// Rules (build plan, "Template lifecycle"):
//   breaking      a required variable added · a variable removed · a key renamed · a type changed ·
//                 optional made required
//   non-breaking  an optional variable added · made optional · a label changed

import type { ContractChange, Variable } from "./types";

export interface DiffOptions {
  /**
   * Keys renamed since the baseline, as { newKey: oldKey }. Without it a renamed key reads as
   * "removed" plus "added". The editor's variable store tracks renames made in the panel.
   */
  renames?: Readonly<Record<string, string>>;
}

/** Changes from `baseline` (the Active version's list) to `current`, in `current` order, removals last. */
export function diffVariables(
  baseline: readonly Variable[],
  current: readonly Variable[],
  { renames = {} }: DiffOptions = {},
): ContractChange[] {
  const before = new Map(baseline.map((v) => [v.key, v]));
  const matched = new Set<string>();
  const changes: ContractChange[] = [];

  for (const v of current) {
    const renamedFrom = renames[v.key];
    const old = before.get(v.key) ?? (renamedFrom ? before.get(renamedFrom) : undefined);

    if (!old) {
      changes.push({ kind: "added", key: v.key, breaking: v.required, type: v.type, required: v.required });
      continue;
    }
    matched.add(old.key);

    if (old.key !== v.key) {
      changes.push({ kind: "key_renamed", key: v.key, breaking: true, from: old.key, to: v.key });
    }
    if (old.type !== v.type) {
      changes.push({ kind: "type_changed", key: v.key, breaking: true, from: old.type, to: v.type, type: v.type });
    }
    if (old.required !== v.required) {
      changes.push(
        v.required
          ? { kind: "made_required", key: v.key, breaking: true, required: true }
          : { kind: "made_optional", key: v.key, breaking: false, required: false },
      );
    }
    if (old.label !== v.label) {
      changes.push({ kind: "label_changed", key: v.key, breaking: false, from: old.label, to: v.label });
    }
  }

  for (const old of baseline) {
    if (matched.has(old.key)) continue;
    changes.push({ kind: "removed", key: old.key, breaking: true, type: old.type, required: old.required });
  }

  return changes;
}

/** True when any change would break a consumer that renders the Active version's contract. */
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
