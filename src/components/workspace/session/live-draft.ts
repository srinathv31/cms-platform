// The Content page's draft as it is on screen, ahead of autosave: each channel field's value and the
// sample sets. The message composer writes a field here on every keystroke, and the sample-set
// switcher writes the sets; the phone preview and the composer's meta line and warnings read them, so
// a push or an SMS re-renders in the browser as it is typed (decision 0036), never waiting for a save.
// Autosave still gets every change through the workspace session; this only holds the latest values.
//
// One per Content page (and per revert: the page makes a new one when it remounts its fields). The
// values live in a vanilla zustand store, like the workspace session's state (decision 0044), with a
// `useSyncExternalStore` hook for each part, so a keystroke re-renders only what reads that part, not
// the editor around it.

import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
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

interface LiveDraftState {
  fields: ChannelFieldValues;
  sampleSets: SampleSet[];
}

export function createLiveDraft(initial: LiveDraftState): LiveDraft {
  const store = createStore<LiveDraftState>()(() => ({ fields: initial.fields, sampleSets: initial.sampleSets }));
  return {
    // The listener is called with no arguments (zustand passes it the state), once per change.
    subscribe(listener) {
      const unsubscribe = store.subscribe(() => listener());
      return () => {
        unsubscribe();
      };
    },
    getFields: () => store.getState().fields,
    setField(id, value) {
      const { fields } = store.getState();
      // zustand notifies on every `setState`: a write that changes nothing writes nothing.
      if (fields[id] === value) return;
      store.setState({ fields: { ...fields, [id]: value } });
    },
    getSampleSets: () => store.getState().sampleSets,
    setSampleSets(sets) {
      if (sets === store.getState().sampleSets) return;
      store.setState({ sampleSets: sets });
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
