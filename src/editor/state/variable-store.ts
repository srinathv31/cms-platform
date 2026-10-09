// The variable list of one <EditorRoot>, in a small vanilla zustand store.
// Chips subscribe to their own key, so renaming a label re-renders only the chips that use it;
// panel rows subscribe the same way.
//
// Besides the list it keeps what the rest of the editor needs to stay consistent:
//   forwards    { oldKey: currentKey } so a chip that comes back with an old key (undo, paste)
//               lands on the variable it belongs to
//   tombstones  deleted variables, so undo can bring a variable back with the chips it restores
//
// It also gives variables their ids (`Variable.id`), which carry a rename into the saved list, and so
// into the contract diff after a reload, at submit and across versions: a created variable gets a fresh
// one, and one without gets the key it had when its key is first renamed (renamed back, it needs none).

import { createStore, type StoreApi } from "zustand/vanilla";
import { identityOf } from "../model/contract";
import type { Variable } from "../model/types";
import { isValidKey } from "../model/variables";

export type VariableResult = { ok: true } | { ok: false; reason: "invalid_key" | "duplicate_key" | "not_found" };

export interface Tombstone {
  /** As it was, its id included: restored, it is the same variable to the contract diff. */
  variable: Variable;
  /** Where it sat in the list. */
  index: number;
}

export interface VariableStoreState {
  variables: readonly Variable[];
  byKey: ReadonlyMap<string, Variable>;
  forwards: Readonly<Record<string, string>>;
  tombstones: ReadonlyMap<string, Tombstone>;

  /** Replace the list. Unchanged variables keep their object identity (no chip re-render). */
  setVariables: (next: readonly Variable[]) => void;
  /** Adds a variable (at the end, or at `index`) with a fresh id; an id it comes with is replaced. */
  create: (variable: Variable, index?: number) => VariableResult;
  /** Changes any field, the key included (the variable keeps its identity), but never the id. */
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

/**
 * A fresh variable id: a UUID, which is never a valid key, so it can't meet an id taken from a key.
 * `crypto.randomUUID` exists only in secure contexts (https and localhost); elsewhere the same shape
 * is made from random bytes.
 */
export function newVariableId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `newId` makes the id of each variable `create` adds (tests pass a counter). */
export function createVariableStore(
  initial: readonly Variable[] = [],
  newId: () => string = newVariableId,
): VariableStore {
  return createStore<VariableStoreState>()((set, get) => {
    const commit = (variables: readonly Variable[], extra: Partial<VariableStoreState> = {}) =>
      set({ variables, byKey: indexByKey(variables), ...extra });

    return {
      variables: initial,
      byKey: indexByKey(initial),
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
        next.splice(index ?? next.length, 0, { ...variable, id: newId() });
        commit(next, { tombstones: without(tombstones, variable.key) });
        return OK;
      },

      update: (key, patch) => {
        const { variables, byKey, forwards } = get();
        const old = byKey.get(key);
        if (!old) return { ok: false, reason: "not_found" };
        const nextKey = patch.key ?? key;
        if (nextKey !== key) {
          if (!isValidKey(nextKey)) return { ok: false, reason: "invalid_key" };
          if (byKey.has(nextKey)) return { ok: false, reason: "duplicate_key" };
        }
        const updated = withIdentity({ ...old, ...patch, key: nextKey }, identityOf(old));
        if (sameVariable(old, updated)) return OK;
        const next = variables.map((v) => (v === old ? updated : v));
        if (nextKey === key) {
          commit(next);
          return OK;
        }
        commit(next, { forwards: forwarded(forwards, key, nextKey) });
        return OK;
      },

      remove: (key) => {
        const { variables, byKey, tombstones } = get();
        const old = byKey.get(key);
        if (!old) return { ok: false, reason: "not_found" };
        const index = variables.indexOf(old);
        const nextTombstones = new Map(tombstones);
        nextTombstones.set(key, { variable: old, index });
        commit(
          variables.filter((v) => v !== old),
          { tombstones: nextTombstones },
        );
        return OK;
      },

      restore: (key) => {
        const { variables, byKey, tombstones } = get();
        const tombstone = tombstones.get(key);
        if (!tombstone) return { ok: false, reason: "not_found" };
        if (byKey.has(key)) return { ok: false, reason: "duplicate_key" };
        const next = [...variables];
        next.splice(Math.min(tombstone.index, next.length), 0, tombstone.variable);
        commit(next, { tombstones: without(tombstones, key) });
        return OK;
      },
    };
  });
}

/**
 * `variable` keeping the identity it had: as its id, unless its key is now that identity (renamed back
 * to the key it was known by), when it needs none. An id in a patch is ignored: nothing changes an identity.
 */
function withIdentity(variable: Variable, identity: string): Variable {
  const rest = { ...variable };
  delete rest.id;
  return identity === rest.key ? rest : { id: identity, ...rest };
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
    a.id === b.id &&
    a.key === b.key &&
    a.label === b.label &&
    a.type === b.type &&
    a.required === b.required &&
    a.sample === b.sample
  );
}
