// Sunset: the date a Superseded version stops rendering, and the sweep that records it passing.
//
//   setSunset      Superseded → Superseded with a sunset date (or a moved one), until that date passes.
//                  A sunset date ends renders at 00:00 on that day in the business time zone (business-zone.ts).
//   sweepSunsets   the clock passed a sunset → its `version.sunset_passed` audit row, dated when renders stopped,
//                  and its `sunset_passed` consumer notice, once. Not a state change: `sunsetPassed` alone
//                  decides whether a version renders.

import {
  sunsetDay as sunsetDayIn,
  sunsetInstant,
  todayIn,
} from "../business-zone";
import { describeChanges } from "../contract";
import { refuse } from "../refusals";
import { formatLongDate } from "../dates";
import type { LifecycleEffect } from "../review-types";
import type { ContractChange, VersionState } from "../types";
import { numberOf, notify } from "./helpers";
import { REFUSALS } from "./refusals";
import type { Outcome, ReviewVersion } from "./types";

export type SetSunsetResult = Outcome<{
  changes: { sunsetAt: Date; sunsetSetBy: string };
  effects: LifecycleEffect[];
}>;

/**
 * True once a version's sunset has come: from that instant consumer renders of it fail. The one test of
 * "sunset passed": the render rule (`checkVersion`), the consumer API, the read models, `setSunset` and
 * `sweepSunsets` all call it. An instant comparison on the demo clock; the day is in business-zone.ts.
 */
export function sunsetPassed(
  version: { sunsetAt: Date | null },
  now: Date,
): boolean {
  return (
    version.sunsetAt !== null && version.sunsetAt.getTime() <= now.getTime()
  );
}

/**
 * Set, or move, the date a Superseded version stops rendering: `sunsetDay`, which ends at 00:00 in the
 * business time zone (`zone`, decision 0017), and must come after today there. Consumers still rendering
 * it are notified with the instant and, when given, the contract changes the Active version brought
 * (`contractChanges`, worded against `activeNumber`).
 *
 * Once the sunset has passed it is final: the version has stopped rendering and its consumers have
 * moved on, so a new date would bring withdrawn content back. There is no clearing a sunset either,
 * and `approve` sets one only on the version that was Active a moment ago, which was still rendering.
 */
export function setSunset(input: {
  version: ReviewVersion;
  actorId: string;
  now: Date;
  /** YYYY-MM-DD. */
  sunsetDay: string;
  /** The business time zone (`business-zone.ts`). */
  zone: string;
  activeNumber: number | null;
  templateName: string;
  contractChanges?: readonly ContractChange[] | null;
}): SetSunsetResult {
  const { version, actorId, now, sunsetDay, zone, activeNumber, templateName } =
    input;

  if (version.state !== "superseded")
    return refuse(REFUSALS.sunsetNotSuperseded);
  if (sunsetPassed(version, now)) return refuse(REFUSALS.sunsetPassed);
  if (!isAfterToday(sunsetDay, now, zone))
    return refuse(REFUSALS.sunsetAfterToday);

  const number = numberOf(version);
  const sunset = sunsetOn(sunsetDay, zone);
  const changes = [...(input.contractChanges ?? [])];

  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "version.sunset_set",
      details: {
        number,
        ...sunset.details,
        previousSunsetAt: version.sunsetAt?.toISOString() ?? null,
      },
    },
    {
      kind: "consumer_notice",
      notice: "sunset_scheduled",
      versionId: version.id,
      payload: {
        versionNumber: number,
        activeVersion: activeNumber,
        sunsetAt: sunset.details.sunsetAt,
        sunsetDay,
        zone,
        ...(changes.length > 0 && activeNumber !== null
          ? {
              contractChanges: changes,
              contractLines: describeChanges(changes, activeNumber),
            }
          : {}),
      },
    },
  ];
  // The version's author hears about it, unless they set it themselves.
  if (version.submittedBy && version.submittedBy !== actorId) {
    effects.push(
      notify({
        notification: "sunset_scheduled",
        to: { kind: "user", userId: version.submittedBy },
        title: `${templateName} v${number} will stop rendering on ${formatLongDate(sunsetDay)}.`,
        link: { to: "versions", templateId: version.templateId },
      }),
    );
  }

  return {
    ok: true,
    changes: { sunsetAt: sunset.at, sunsetSetBy: actorId },
    effects,
  };
}

/**
 * A sunset on `day`: the instant renders stop (00:00 there in `zone`) and what the audit row records
 * beside it, the day as picked and the zone it was read in, so the record keeps saying "March 1" whatever
 * the zone is later.
 */
export function sunsetOn(day: string, zone: string) {
  const at = sunsetInstant(day, zone);
  return { at, details: { sunsetAt: at.toISOString(), sunsetDay: day, zone } };
}

/** A version with a sunset, as `sweepSunsets` reads it. */
export interface SunsetFacts {
  id: string;
  templateId: string;
  teamId: string;
  number: number | null;
  state: VersionState;
  sunsetAt: Date | null;
  /** When a revoke was confirmed (`revoke.confirmedAt`); null when it wasn't revoked. */
  revokedAt: Date | null;
  /** Whether a `version.sunset_passed` row already records it. */
  passedRecorded: boolean;
  /** The template's Active version number at the sweep, the one its consumers move to; null when none is Active. */
  activeNumber: number | null;
}

/** One sunset the sweep found passed and unrecorded, with the row and the notice to write for it. */
export interface PassedSunset {
  versionId: string;
  templateId: string;
  teamId: string;
  /**
   * The instant renders stopped: the audit row is dated then, however late the sweep runs, and the notice
   * goes to the consumers that rendered the template from 90 days before it on.
   */
  at: Date;
  effects: LifecycleEffect[];
}

/**
 * The sunsets the clock has passed that nothing records yet, each with its `version.sunset_passed` audit
 * row (actor: the system) and its `sunset_passed` consumer notice. Both name the sunset's instant and its
 * day in `zone`, the business time zone at the sweep, which is the day the Versions screen shows for it.
 * The row is dated at the sunset. The notice names the version to move to, the template's Active one (or
 * none). Oldest first.
 *
 * - **Passed** is `sunsetPassed`, the render rule's own test, so the record says exactly when renders
 *   stopped.
 * - **Still rendering until then.** A version revoked at or before its sunset had already stopped, so its
 *   sunset ends nothing and isn't recorded. One revoked after its sunset (the only change a passed
 *   sunset allows) is.
 * - **Once.** A version with a record is skipped, so a second sweep writes nothing: no second row and no
 *   second notice. A passed sunset never moves (decision 0002), so one record per version is the whole
 *   story.
 *
 * No notification: the author was told the day when the sunset was set
 * ([decision 0026](../../docs/decisions/0026-a-passed-sunset-is-recorded-by-a-sweep.md)). Consumers get the
 * notice so that their notices say a version stopped rendering, as they say when one is revoked
 * ([decision 0032](../../docs/decisions/0032-consumers-are-told-when-a-sunset-passes.md)). It arrives when
 * the sweep runs, which can be after the instant; its `sunsetAt` says when renders stopped.
 */
export function sweepSunsets(input: {
  versions: readonly SunsetFacts[];
  now: Date;
  zone: string;
}): PassedSunset[] {
  const { now, zone } = input;
  const endedRenders = (
    v: SunsetFacts,
  ): v is SunsetFacts & { sunsetAt: Date; number: number } => {
    if (v.sunsetAt === null || v.number === null || !sunsetPassed(v, now))
      return false;
    if (v.state === "superseded") return true;
    return (
      v.state === "revoked" &&
      v.revokedAt !== null &&
      v.revokedAt.getTime() > v.sunsetAt.getTime()
    );
  };
  return input.versions
    .filter((v) => !v.passedRecorded)
    .filter(endedRenders)
    .sort(
      (a, b) =>
        a.sunsetAt.getTime() - b.sunsetAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((v) => {
      const sunset = {
        sunsetAt: v.sunsetAt.toISOString(),
        sunsetDay: sunsetDayIn(v.sunsetAt, zone),
        zone,
      };
      return {
        versionId: v.id,
        templateId: v.templateId,
        teamId: v.teamId,
        at: v.sunsetAt,
        effects: [
          {
            kind: "audit",
            action: "version.sunset_passed",
            details: { number: v.number, ...sunset },
          },
          {
            kind: "consumer_notice",
            notice: "sunset_passed",
            versionId: v.id,
            payload: {
              versionNumber: v.number,
              activeVersion: v.activeNumber,
              ...sunset,
            },
          },
        ],
      };
    });
}

/**
 * A sunset date (YYYY-MM-DD) must be a later day than today in the business time zone, on the demo clock.
 * Its sunset is 00:00 on that day there, so this is the same as "after now" for it: at 23:30 Eastern on
 * October 9 (03:30 UTC on the 10th), October 10 is still after today.
 */
export function isAfterToday(day: string, now: Date, zone: string): boolean {
  return day > todayIn(now, zone);
}
