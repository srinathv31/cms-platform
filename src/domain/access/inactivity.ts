// Inactivity: measured from the latest of the last sign-in, the date added, and a Team Admin's last Keep
// (or reinstatement). Flagged at 90 days; the Team Admin may Suspend or Keep; suspended automatically at
// 120 days. Boundaries are inclusive: the instant a day count is reached, it applies.

import { DAY_MS } from "../dates";
import {
  INACTIVITY_FLAG_DAYS,
  INACTIVITY_SUSPEND_DAYS,
  type MembershipFacts,
} from "../access-types";

/** The instant the inactivity clock runs from: the latest of last sign-in, date added, and last Keep. */
export function inactivityAnchor(
  m: Pick<MembershipFacts, "addedAt" | "lastActiveAt" | "inactivityKeptAt">,
): Date {
  const times = [m.addedAt, m.lastActiveAt, m.inactivityKeptAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  return new Date(Math.max(...times));
}

export type InactivityState = "ok" | "flagged" | "suspend_due";

export interface Inactivity {
  /** Whole days since the anchor (floor). */
  daysInactive: number;
  /** anchor + 90 days: flagged from this instant. */
  flagAt: Date;
  /** anchor + 120 days: suspended automatically from this instant. */
  suspendAt: Date;
  state: InactivityState;
}

export function inactivity(
  m: Pick<MembershipFacts, "addedAt" | "lastActiveAt" | "inactivityKeptAt">,
  now: Date,
): Inactivity {
  const anchor = inactivityAnchor(m).getTime();
  const flagAt = new Date(anchor + INACTIVITY_FLAG_DAYS * DAY_MS);
  const suspendAt = new Date(anchor + INACTIVITY_SUSPEND_DAYS * DAY_MS);
  const t = now.getTime();
  const state: InactivityState =
    t >= suspendAt.getTime()
      ? "suspend_due"
      : t >= flagAt.getTime()
        ? "flagged"
        : "ok";
  return {
    daysInactive: Math.max(0, Math.floor((t - anchor) / DAY_MS)),
    flagAt,
    suspendAt,
    state,
  };
}

/**
 * The 90-day flag already recorded for the CURRENT inactivity clock. A flag set before a sign-in
 * (which moves the clock) is stale and doesn't count, so the next 90 days flag again.
 */
export function flaggedFor(m: MembershipFacts, idle: Inactivity): boolean {
  return (
    m.inactivityFlaggedAt !== null &&
    m.inactivityFlaggedAt.getTime() >= idle.flagAt.getTime()
  );
}

/**
 * The automatic suspension was already held back for the current clock: the sweep marks a held
 * last Team Admin with `inactivityFlaggedAt = suspendAt` (they stay flagged), so it says so once.
 */
export function suspensionHeld(m: MembershipFacts, idle: Inactivity): boolean {
  return (
    m.inactivityFlaggedAt !== null &&
    m.inactivityFlaggedAt.getTime() >= idle.suspendAt.getTime()
  );
}
