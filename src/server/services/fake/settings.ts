import {
  DEFAULT_BUSINESS_ZONE,
  isBusinessZone,
  type BusinessZone,
} from "@/domain/business-zone";
import type { FakeState } from "./state";
import type { FakeTx } from "./store";

// The platform's settings in memory: the twins of the local implementation's settings reads and writes.

/** A setting's value, or undefined. */
export function setting(state: FakeState, key: string): unknown {
  return state.settings.find((s) => s.key === key)?.value;
}

/** Sets a setting inside a command, as the local `INSERT … ON CONFLICT DO UPDATE` does. */
export function putSetting(tx: FakeTx, key: string, value: unknown): void {
  const row = tx.state.settings.find((s) => s.key === key);
  if (row) tx.update("settings", row, { value });
  else tx.insert("settings", { key, value });
}

/** The business time zone sunset dates are read in (`readBusinessZone`). */
export function businessZone(state: FakeState): BusinessZone {
  const value = setting(state, "business_zone");
  return isBusinessZone(value) ? value : DEFAULT_BUSINESS_ZONE;
}

/** How many days the demo clock has been moved (`getClockOffsetDays`). */
export function clockOffsetDays(state: FakeState): number {
  const value = setting(state, "clock_offset_days");
  return typeof value === "number" ? value : 0;
}
