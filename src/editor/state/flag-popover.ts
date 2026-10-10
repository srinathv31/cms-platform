// Which flag's popover is open in one field (at most one). The text-flags plugin opens it on a click on
// a flag, or when the caret is moved onto one (not by typing), and closes it when the caret leaves the
// flag, on an edit, on Esc and on blur; the React popover subscribes and mounts only while it's open.

import { createStore, type StoreApi } from "zustand/vanilla";

export interface FlagPopoverState {
  /** The open flag's index in the plugin's current flags, or null. */
  index: number | null;
  /** The open popup's element (focus moving into it doesn't close it). */
  element: HTMLElement | null;
  open: (index: number) => void;
  close: () => void;
  setElement: (element: HTMLElement | null) => void;
}

export type FlagPopoverStore = StoreApi<FlagPopoverState>;

export function createFlagPopoverStore(): FlagPopoverStore {
  return createStore<FlagPopoverState>()((set, get) => ({
    index: null,
    element: null,
    open: (index) => {
      if (get().index !== index) set({ index });
    },
    close: () => {
      if (get().index !== null) set({ index: null });
    },
    setElement: (element) => set({ element }),
  }));
}
