// The Content page's draft as it is on screen, ahead of autosave: each channel field's value and the
// sample sets. The message composer writes a field here on every keystroke, and the sample-set
// switcher writes the sets; the phone preview and the composer's meta line and warnings read them, so
// a push or an SMS re-renders in the browser as it is typed (decision 0036), never waiting for a save.
// Autosave still gets every change through the workspace session; this only holds the latest values.
//
// One per Content page (and per revert: the page makes a new one when it remounts its fields). Plain
// TypeScript with a `useSyncExternalStore` hook for each part, so a keystroke re-renders only what
// reads that part, not the editor around it.

import { useSyncExternalStore } from "react";
import type { ChannelFieldId, ChannelFieldValues } from "@/domain/channel-fields";
import type { JSONContent, SampleSet } from "@/domain/types";

export interface LiveDraft {
  subscribe: (listener: () => void) => () => void;
  /** Every channel field by id, null when it has none. The same object until a field changes. */
  getFields: () => ChannelFieldValues;
  setField: (id: ChannelFieldId, value: JSONContent | null) => void;
  /** The sample sets as saved, then edited here. The same array until they change. */
  getSampleSets: () => SampleSet[];
  setSampleSets: (sets: SampleSet[]) => void;
}

export function createLiveDraft(initial: { fields: ChannelFieldValues; sampleSets: SampleSet[] }): LiveDraft {
  let fields = initial.fields;
  let sampleSets = initial.sampleSets;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getFields: () => fields,
    setField(id, value) {
      if (fields[id] === value) return;
      fields = { ...fields, [id]: value };
      emit();
    },
    getSampleSets: () => sampleSets,
    setSampleSets(sets) {
      if (sets === sampleSets) return;
      sampleSets = sets;
      emit();
    },
  };
}

/** The channel fields as typed. */
export function useLiveFields(draft: LiveDraft): ChannelFieldValues {
  return useSyncExternalStore(draft.subscribe, draft.getFields, draft.getFields);
}

/** The sample sets as edited. */
export function useLiveSampleSets(draft: LiveDraft): SampleSet[] {
  return useSyncExternalStore(draft.subscribe, draft.getSampleSets, draft.getSampleSets);
}
