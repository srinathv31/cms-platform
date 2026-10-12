// The business time zone is one of `BUSINESS_ZONES` (business-zone.ts). Changing it moves no sunset
// already set: only dates picked afterwards end at 00:00 in the new zone.

import type { AccessEffect, Named, Ok, Refused } from "../access-types";
import { isBusinessZone, zoneLabel, type BusinessZone } from "../business-zone";
import { refuse, type Refusal } from "../refusals";
import { configChanged } from "./effects";
import { PLATFORM_REFUSALS } from "./refusals";

export interface ZoneChange {
  /** Why the zone picked can't be saved (one off the list), or null. */
  problem: Refusal | null;
  /** The zone picked differs from the one in force. */
  changed: boolean;
  /** "New sunset dates end at 00:00 Pacific (America/Los_Angeles).", once a different zone is picked. */
  lines: string[];
}

/**
 * What picking `next` does, as the admin picks it (the settings screen calls this; `setBusinessZone`
 * refuses with the same `problem`).
 */
export function describeZoneChange(input: {
  current: string;
  next: string;
}): ZoneChange {
  const problem = isBusinessZone(input.next)
    ? null
    : PLATFORM_REFUSALS.pickZone;
  const changed = input.next !== input.current;
  return {
    problem,
    changed,
    lines:
      changed && !problem
        ? [`New sunset dates end at 00:00 ${zoneLabel(input.next)}.`]
        : [],
  };
}

/**
 * What any change of zone leaves in place, from the stored facts (the read model returns it as
 * `consequences`): "2 sunsets already set don't move: their consumers have been told when they end."
 * Nothing with none set. A sunset already set keeps its instant (decision 0017).
 */
export function zoneChangeConsequences(pendingSunsets: number): string[] {
  if (pendingSunsets === 1)
    return [
      "1 sunset already set doesn't move: its consumers have been told when it ends.",
    ];
  if (pendingSunsets > 1)
    return [
      `${pendingSunsets} sunsets already set don't move: their consumers have been told when they end.`,
    ];
  return [];
}

/**
 * Sets the business time zone sunset dates are read in. One of `BUSINESS_ZONES` (`describeZoneChange`);
 * the same zone again changes nothing and records nothing. Nothing else is written: sunsets already set
 * keep their instants.
 */
export function setBusinessZone(input: {
  current: string;
  next: string;
  pendingSunsets: number;
  actor: Named;
  now: Date;
}): Ok<{ zone: BusinessZone; effects: AccessEffect[] }> | Refused {
  const { current, next, pendingSunsets } = input;
  const change = describeZoneChange({ current, next });
  if (change.problem || !isBusinessZone(next))
    return refuse(change.problem ?? PLATFORM_REFUSALS.pickZone);
  if (!change.changed) return { ok: true, zone: next, effects: [] };
  return {
    ok: true,
    zone: next,
    effects: [
      configChanged(
        "business_zone",
        null,
        `Set the business time zone to ${zoneLabel(next)}`,
        {
          from: current,
          to: next,
          pendingSunsets,
        },
      ),
    ],
  };
}
