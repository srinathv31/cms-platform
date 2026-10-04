// The editor's own variable list, held in a small vanilla zustand store (one per editor).
// Chips subscribe to their own key, so renaming a label re-renders only the chips that use it.
// Phase 2: the VariablesPanel and InlineVariableField read and write the same store.

import { createStore, type StoreApi } from "zustand/vanilla";
import type { Variable } from "../model/types";

export interface VariableStoreState {
  variables: readonly Variable[];
  byKey: ReadonlyMap<string, Variable>;
  /** Replace the list. Unchanged variables keep their object identity (no chip re-render). */
  setVariables: (next: readonly Variable[]) => void;
}

export type VariableStore = StoreApi<VariableStoreState>;

export function createVariableStore(initial: readonly Variable[] = []): VariableStore {
  return createStore<VariableStoreState>()((set, get) => ({
    variables: initial,
    byKey: indexByKey(initial),
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
      if (!changed) return;
      set({ variables: merged, byKey: indexByKey(merged) });
    },
  }));
}

function indexByKey(list: readonly Variable[]): Map<string, Variable> {
  return new Map(list.map((v) => [v.key, v]));
}

function sameVariable(a: Variable, b: Variable): boolean {
  return (
    a.key === b.key &&
    a.label === b.label &&
    a.type === b.type &&
    a.required === b.required &&
    a.sample === b.sample
  );
}
