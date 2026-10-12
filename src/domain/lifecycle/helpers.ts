// Small helpers the transitions share.
//
// A notification about a round names it as people read it (`versionLabel` in rounds.ts): "v2" until the
// number has been sent back, then "v2, round 2". Sunset and revoke are about released versions: "v2".

import { versionLabel, type NumberedRound, type RoundRow } from "../rounds";
import type { NotificationEffect, Recipients } from "../review-types";
import type { VersionState } from "../types";
import { LifecycleError } from "./types";

export function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** A version past Draft always has its number; a missing one is a bug, not a refusal. */
export function numberOf(version: {
  number: number | null;
  state: VersionState;
}): number {
  if (version.number === null)
    throw new LifecycleError(`A ${version.state} version has no number.`);
  return version.number;
}

/** A version past Draft always has its number and its round; a missing one is a bug, not a refusal. */
export function roundOf(version: RoundRow): NumberedRound {
  const number = numberOf(version);
  if (version.round === null)
    throw new LifecycleError(`A ${version.state} version has no round.`);
  return { number, round: version.round, state: version.state };
}

/** The version as a sentence names it: "v2", or "v2, round 2" once its number was sent back. */
export function sentence(v: NumberedRound): string {
  return versionLabel(v, { style: "sentence" });
}

/** Text with surrounding whitespace removed; null when nothing is left. */
export function trimmed(value: string | null | undefined): string | null {
  const t = value?.trim() ?? "";
  return t === "" ? null : t;
}

export function teamApproversExcept(...userIds: string[]): Recipients {
  return { kind: "team_role", role: "approver", exceptUserIds: userIds };
}

/** A notification effect; `body` is left out when there is none. */
export function notify(
  n: Omit<NotificationEffect, "kind" | "body"> & { body?: string | null },
): NotificationEffect {
  const { body, ...rest } = n;
  return body
    ? { kind: "notification", ...rest, body }
    : { kind: "notification", ...rest };
}
