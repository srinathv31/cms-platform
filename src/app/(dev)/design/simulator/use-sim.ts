"use client";

import { useCallback, useMemo, useState } from "react";
import {
  NEW_VARIABLE,
  SELECTED_DEFAULT,
  VARIABLES,
  resultsFor,
  type Channel,
  type Result,
  type Scenario,
  type ScreenId,
  type Variable,
  type ViewMode,
  type VariantId,
} from "./data";

export interface SimInitial {
  variant: VariantId;
  screen: ScreenId;
  scenario: Scenario;
  view: ViewMode;
  chrome: boolean;
  sent?: boolean;
}

/** All of the mock's state in one place. Every variant reads this and draws its own structure. */
export function useSim(initial: SimInitial) {
  const [variant, setVariant] = useState(initial.variant);
  const [screen, setScreenRaw] = useState<ScreenId>(initial.screen);
  const [scenario, setScenario] = useState(initial.scenario);
  const [view, setView] = useState(initial.view);
  const [picked, setPicked] = useState<string | null>(initial.screen === "link" ? null : "UC-7H2M9X");
  const [pin, setPin] = useState<1 | 2>(2);
  const [mapping, setMapping] = useState<Record<string, string>>(
    Object.fromEntries(
      VARIABLES.map((v) => [
        v.key,
        // Mapping starts with purchase_apr open on Link and Map, so the block is visible; later screens have it done.
        v.key === "purchase_apr" && initial.screen !== "link" && initial.screen !== "map" ? "customer.purchaseApr" : v.mapped,
      ]),
    ),
  );
  const [feeField, setFeeField] = useState("");
  const [selected, setSelected] = useState<string[]>(SELECTED_DEFAULT);
  const [channel, setChannel] = useState<Channel>("Email");
  const [sent, setSent] = useState(initial.sent ?? (initial.screen === "send" || initial.screen === "customer"));
  const [viewing, setViewing] = useState("c5");
  const [relinked, setRelinked] = useState(false);
  const [relinkStep, setRelinkStep] = useState<1 | 2 | 3>(initial.screen === "relink" ? 2 : 1);

  const setScreen = useCallback((next: ScreenId) => {
    setScreenRaw(next);
    if (next === "send") setSent(false);
  }, []);

  const variables: Variable[] = useMemo(
    () => VARIABLES.map((v) => ({ ...v, mapped: mapping[v.key] ?? "" })),
    [mapping],
  );
  const unmapped = variables.filter((v) => v.required && !v.mapped);

  const pinned: number = relinked ? 3 : 2;
  const results: Result[] = useMemo(
    () => resultsFor(relinked ? "live" : scenario, selected, channel, pinned),
    [scenario, selected, channel, pinned, relinked],
  );

  return {
    variant,
    setVariant,
    screen,
    setScreen,
    scenario,
    setScenario,
    view,
    setView,
    picked,
    setPicked,
    pin,
    setPin,
    mapping,
    setMapping,
    variables,
    unmapped,
    feeVariable: { ...NEW_VARIABLE, mapped: feeField },
    feeField,
    setFeeField,
    selected,
    setSelected,
    channel,
    setChannel,
    sent,
    setSent,
    results,
    viewing,
    setViewing,
    relinked,
    setRelinked,
    pinned,
    relinkStep,
    setRelinkStep,
    chrome: initial.chrome,
  };
}

export type Sim = ReturnType<typeof useSim>;
