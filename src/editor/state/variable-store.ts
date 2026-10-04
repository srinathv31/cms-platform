// The variable list of one <EditorRoot>, in a small vanilla zustand store.
// Chips subscribe to their own key, so renaming a label re-renders only the chips that use it;
// panel rows subscribe the same way.
//
// Besides the list it keeps what the rest of the editor needs to stay consistent:
//   renames     { newKey: keyAtLoad } for the contract diff (a renamed key isn't "removed + added")
//   forwards    { oldKey: currentKey } so a chip that comes back with an old key (undo, paste)
//               lands on the variable it belongs to
//   tombstones  deleted variables, so undo can bring a variable back with the chips it restores

import { createStore, type StoreApi } from "zustand/vanilla";
import type { Variable } from "../model/types";
import { isValidKey } from "../model/variables";

export type VariableResult = { ok: true } | { ok: false; reason: "invalid_key" | "duplicate_key" | "not_found" };

export interface Tombstone {
  variable: Variable;
  /** Where it sat in the list. */
  index: number;
  /** Its key at load, when it had been renamed. */
  renamedFrom: string | null;
}

export interface VariableStoreState {
  variables: readonly Variable[];
  byKey: ReadonlyMap<string, Variable>;
  renames: Readonly<Record<string, string>>;
  forwards: Readonly<Record<string, string>>;
  tombstones: ReadonlyMap<string, Tombstone>;

  /** Replace the list. Unchanged variables keep their object identity (no chip re-render). */
  setVariables: (next: readonly Variable[]) => void;
  /** Adds a variable (at the end, or at `index`). */
  create: (variable: Variable, index?: number) => VariableResult;
  /** Changes any field, including the key (tracked as a rename). */
  update: (key: string, patch: Partial<Variable>) => VariableResult;
  /** Deletes a variable and keeps a tombstone of it. */
  remove: (key: string) => VariableResult;
  /** Brings a deleted variable back from its tombstone, at its old place. */
  restore: (key: string) => VariableResult;
}

export type VariableStore = StoreApi<VariableStoreState>;

const OK: VariableResult = { ok: true };
const NO_RECORD: Readonly<Record<string, string>> = Object.freeze({});
const NO_TOMBSTONES: ReadonlyMap<string, Tombstone> = new Map();

export function createVariableStore(initial: readonly Variable[] = []): VariableStore {
  return createStore<VariableStoreState>()((set, get) => {
    const commit = (variables: readonly Variable[], extra: Partial<VariableStoreState> = {}) =>
      set({ variables, byKey: indexByKey(variables), ...extra });

    return {
      variables: initial,
      byKey: indexByKey(initial),
      renames: NO_RECORD,
      forwards: NO_RECORD,
      tombstones: NO_TOMBSTONES,

      setVariables: (next) => {
        const { variables: prev, byKey: prevByKey } = get();
        if (prev === next) return;
        let changed = prev.length !== next.length;
        const merged = next.map((variable, i) => {
          const old = prevByKey.get(variable.key);
          if (old && sameVariable(old, variable)) {
            if (prev[i] !== old) changed = true;
            return old;
          }
          changed = true;
          return variable;
        });
        if (changed) commit(merged);
      },

      create: (variable, index) => {
        const { variables, byKey, tombstones } = get();
        if (!isValidKey(variable.key)) return { ok: false, reason: "invalid_key" };
        if (byKey.has(variable.key)) return { ok: false, reason: "duplicate_key" };
        const next = [...variables];
        next.splice(index ?? next.length, 0, variable);
        commit(next, { tombstones: without(tombstones, variable.key) });
        return OK;
      },

      update: (key, patch) => {
        const { variables, byKey, renames, forwards } = get();
        const old = byKey.get(key);
        if (!old) return { ok: false, reason: "not_found" };
        const nextKey = patch.key ?? key;
        if (nextKey !== key) {
          if (!isValidKey(nextKey)) return { ok: false, reason: "invalid_key" };
          if (byKey.has(nextKey)) return { ok: false, reason: "duplicate_key" };
        }
        const updated: Variable = { ...old, ...patch, key: nextKey };
        if (sameVariable(old, updated)) return OK;
        const next = variables.map((v) => (v === old ? updated : v));
        if (nextKey === key) {
          commit(next);
          return OK;
        }
        commit(next, { renames: renamed(renames, key, nextKey), forwards: forwarded(forwards, key, nextKey) });
        return OK;
      },

      remove: (key) => {
        const { variables, byKey, renames, tombstones } = get();
        const old = byKey.get(key);
        if (!old) return { ok: false, reason: "not_found" };
        const index = variables.indexOf(old);
        const nextTombstones = new Map(tombstones);
        nextTombstones.set(key, { variable: old, index, renamedFrom: renames[key] ?? null });
        commit(
          variables.filter((v) => v !== old),
          { tombstones: nextTombstones, renames: omit(renames, key) },
        );
        return OK;
      },

      restore: (key) => {
        const { variables, byKey, renames, tombstones } = get();
        const tombstone = tombstones.get(key);
        if (!tombstone) return { ok: false, reason: "not_found" };
        if (byKey.has(key)) return { ok: false, reason: "duplicate_key" };
        const next = [...variables];
        next.splice(Math.min(tombstone.index, next.length), 0, tombstone.variable);
        commit(next, {
          tombstones: without(tombstones, key),
          renames: tombstone.renamedFrom ? { ...renames, [key]: tombstone.renamedFrom } : renames,
        });
        return OK;
      },
    };
  });
}

/** { newKey: keyAtLoad }: chains a→b→c into { c: a }; renaming back to the load key drops it. */
function renamed(renames: Readonly<Record<string, string>>, from: string, to: string): Record<string, string> {
  const origin = renames[from] ?? from;
  const next = omit(renames, from);
  if (origin !== to) next[to] = origin;
  return next;
}

/** { oldKey: currentKey }: every old name of a variable points at its current key. */
function forwarded(forwards: Readonly<Record<string, string>>, from: string, to: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [old, current] of Object.entries(forwards)) {
    const target = current === from ? to : current;
    if (old !== to && old !== target) next[old] = target;
  }
  next[from] = to;
  return next;
}

function omit(record: Readonly<Record<string, string>>, key: string): Record<string, string> {
  const next = { ...record };
  delete next[key];
  return next;
}

function without<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

function indexByKey(list: readonly Variable[]): Map<string, Variable> {
  return new Map(list.map((v) => [v.key, v]));
}

export function sameVariable(a: Variable, b: Variable): boolean {
  return (
    a.key === b.key &&
    a.label === b.label &&
    a.type === b.type &&
    a.required === b.required &&
    a.sample === b.sample
  );
}
