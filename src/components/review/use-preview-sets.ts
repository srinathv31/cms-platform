"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { findSet, resolveSetValues, type SampleSetSwitcherHandle } from "@/components/preview/sample-sets";
import { listSets } from "@/editor/model/sample-sets";
import type { ReviewScreenData } from "@/server/queries/review-models";

/**
 * The sample sets the Preview renders with: the version's own, which one is chosen (in the tab bar), the values
 * it resolves to, and which sets the approver has had on screen (the approval records them).
 */
export function usePreviewSets(version: ReviewScreenData["version"], today: string) {
  const sets = useMemo(() => listSets(version.sampleSets, version.variables, today), [version.sampleSets, version.variables, today]);
  const [setId, setSetId] = useState("typical");
  const selectedSet = findSet(sets, setId) ?? findSet(sets, "typical") ?? sets[0];
  const values = useMemo(() => resolveSetValues(selectedSet, version.variables, today), [selectedSet, version.variables, today]);
  const [seen, setSeen] = useState<string[]>([]);
  const onSeen = useCallback((id: string) => setSeen((all) => (all.includes(id) ? all : [...all, id])), []);
  /** The switcher in the tab bar: the error state's Edit values opens its editor. */
  const switcher = useRef<SampleSetSwitcherHandle>(null);

  return { sets, selectedSet, setSetId, values, seen, onSeen, switcher };
}
