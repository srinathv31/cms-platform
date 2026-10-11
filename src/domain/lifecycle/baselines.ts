// The versions a draft or a round is compared with: the contract baseline (what consumers can still
// render) and the review baseline (what the review screen redlines against).

import { isReleased } from "../rounds";
import type { VersionState } from "../types";
import { sunsetPassed } from "./sunset";

/**
 * The version a draft's contract changes are worked out against: the newest one consumers can still
 * render. That is the Active version when there is one. When there's none (the Active version was
 * revoked), it is the highest-numbered Superseded version whose sunset hasn't passed. A version
 * waiting on a revoke confirmation still renders, so it counts. Null when nothing renders, the same
 * as for a first version. Submit stores the diff against it, and the submit dialog and the
 * workspace's variable flags compare with the same version.
 */
export function contractBaseline<V extends { state: VersionState; number: number | null; sunsetAt: Date | null }>(
  versions: readonly V[],
  now: Date,
): V | null {
  const active = versions.find((v) => v.state === "active");
  if (active) return active;
  return versions
    .filter((v) => v.state === "superseded" && !sunsetPassed(v, now))
    .reduce<V | null>((best, v) => (best === null || (v.number ?? 0) > (best.number ?? 0) ? v : best), null);
}

/** What `reviewBaseline` reads of each of the template's versions. */
export interface BaselineFacts {
  id: string;
  state: VersionState;
  number: number | null;
  sunsetAt: Date | null;
  /** The version its draft was copied from (`DraftFields.basedOnVersionId`). */
  basedOnVersionId: string | null;
}

/**
 * The version the review screen compares `versionId` with: its redline, the "vs vN" label and the
 * change count. The Active version when there is one (null when that is the version itself).
 *
 * With none Active (it was revoked), the released version the draft was based on: the revoked text
 * the correction started from, since checking the fix to it is the approver's job here. A draft a
 * change request opened is based on the version sent back, so the walk goes on through those to the
 * released one. When the walk finds none (a first version, or a based-on version that is missing),
 * the newest version that still renders (`contractBaseline`); null when nothing does, as for a first
 * version (decision 0031).
 *
 * A round is never compared with its own number: a round sent back before its number went live (High-Yield
 * v2, round 1, now that v2 is Active) takes the same walk, to the released version it was drafted from.
 *
 * Not the Approve dialog's previous version: that is the Active one only.
 */
export function reviewBaseline<V extends BaselineFacts>(versions: readonly V[], versionId: string, now: Date): V | null {
  const own = ownNumber(versions, versionId);
  const active = versions.find((v) => v.state === "active");
  if (active?.id === versionId) return null;
  if (active && !own(active)) return active;

  const byId = new Map(versions.map((v) => [v.id, v]));
  const seen = new Set([versionId]);
  for (let id = byId.get(versionId)?.basedOnVersionId ?? null; id !== null && !seen.has(id); ) {
    seen.add(id);
    const base = byId.get(id);
    if (!base) break;
    if (isReleased(base.state) && base.number !== null) return base;
    if (base.state !== "changes_requested") break;
    id = base.basedOnVersionId;
  }

  const live = contractBaseline(versions, now);
  return live && !own(live) ? live : null;
}

/**
 * The version whose name the review screen shows a rename against: what customers get today
 * (`contractBaseline`). For a round sent back before its number went live, that is its own number's
 * release, so it is what the round was drafted from instead (`reviewBaseline`). Null when what customers
 * get is this version, or nothing renders.
 */
export function renameBaseline<V extends BaselineFacts>(versions: readonly V[], versionId: string, now: Date): V | null {
  const live = contractBaseline(versions, now);
  if (!live || live.id === versionId) return null;
  return ownNumber(versions, versionId)(live) ? reviewBaseline(versions, versionId, now) : live;
}

/** Whether a row is the version `versionId` or another round of its number. */
function ownNumber<V extends BaselineFacts>(versions: readonly V[], versionId: string): (v: V) => boolean {
  const number = versions.find((v) => v.id === versionId)?.number ?? null;
  return (v) => v.id === versionId || (number !== null && v.number === number);
}
