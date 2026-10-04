import { useSyncExternalStore } from "react";
import type { StoreApi } from "zustand/vanilla";

/**
 * Like zustand's `useStore`, but the server and hydration render read the store's current state
 * instead of its initial one. The root's usage store is filled during the first render pass (the
 * document registers its content as it renders), so a panel rendered after the document shows its
 * counts on the server already, and hydrates to the same markup. The selector must return a
 * primitive or a stable reference.
 */
export function useLiveStore<S, T>(store: StoreApi<S>, selector: (state: S) => T): T {
  const read = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, read, read);
}
