// Which chip's popover is open in one field (at most one). The field binding opens it on a click
// or Enter/Space on a selected chip, and closes it when the selection leaves the chip; the React
// popover subscribes and mounts only while it's open.

import { createStore, type StoreApi } from "zustand/vanilla";

export interface ChipPopoverState {
  /** Document position of the chip whose popover is open, or null. */
  pos: number | null;
  /** The open popup's element (focus moving into it doesn't close it). */
  element: HTMLElement | null;
  open: (pos: number) => void;
  close: () => void;
  setElement: (element: HTMLElement | null) => void;
}

export type ChipPopoverStore = StoreApi<ChipPopoverState>;

export function createChipPopoverStore(): ChipPopoverStore {
  return createStore<ChipPopoverState>()((set, get) => ({
    pos: null,
    element: null,
    open: (pos) => {
      if (get().pos !== pos) set({ pos });
    },
    close: () => {
      if (get().pos !== null) set({ pos: null });
    },
    setElement: (element) => set({ element }),
  }));
}
