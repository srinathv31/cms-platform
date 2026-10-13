import {
  DEFAULT_BUSINESS_ZONE,
  isBusinessZone,
  type BusinessZone,
} from "@/domain/business-zone";
import type { FakeState } from "./state";

// The platform's settings in memory: the twins of the local implementation's settings reads. The platform area
// (plan P2) adds its own lookups here.

/** A setting's value, or undefined. */
export function setting(state: FakeState, key: string): unknown {
  return state.settings.find((s) => s.key === key)?.value;
}

/** The business time zone sunset dates are read in (`readBusinessZone`). */
export function businessZone(state: FakeState): BusinessZone {
  const value = setting(state, "business_zone");
  return isBusinessZone(value) ? value : DEFAULT_BUSINESS_ZONE;
}
