import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { sweepSunsets, type PassedSunset, type SunsetFacts } from "@/domain/lifecycle";
import { now } from "@/server/clock";
import { db, type Db } from "@/server/db/client";
import { auditEvents, templates, versions } from "@/server/db/schema/ucomp";
import { readBusinessZone } from "./business-zone";
import { inTransaction, writeEffects, type Tx } from "./effects";

// The clock-driven sunset sweep (domain/lifecycle.ts `sweepSunsets`): one `version.sunset_passed` audit row
// for each sunset the demo clock has passed, dated at the sunset, so the audit log and the Activity tab say
// when a version stopped rendering. It records; it decides nothing: whether a version renders is
// `sunsetPassed` at the moment of the render, swept or not.
//
// It runs where the access sweep runs (`runAccessSweep`): Advance clock, a persona switch, and the start of
// every access action. There's no timer yet. The scheduled job belongs to the sign-in work (handoff review
// S4), and `runSunsetSweep()` is the one call it needs. Running it twice writes nothing the second time.

type Reader = Pick<Db, "select"> | Pick<Tx, "select">;

/** Every version with a sunset, with its team and whether a `version.sunset_passed` row records it. */
export async function loadSunsetFacts(r: Reader): Promise<SunsetFacts[]> {
  const rows = await r
    .select({
      id: versions.id,
      templateId: versions.templateId,
      teamId: templates.teamId,
      number: versions.number,
      state: versions.state,
      sunsetAt: versions.sunsetAt,
      revoke: versions.revoke,
    })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .where(isNotNull(versions.sunsetAt))
    .orderBy(versions.id);
  if (rows.length === 0) return [];
  const recorded = await r
    .select({ versionId: auditEvents.versionId })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, "version.sunset_passed"), inArray(auditEvents.versionId, rows.map((v) => v.id))));
  const passed = new Set(recorded.map((a) => a.versionId));
  return rows.map(({ revoke, ...v }) => ({
    ...v,
    revokedAt: revoke?.confirmedAt ? new Date(revoke.confirmedAt) : null,
    passedRecorded: passed.has(v.id),
  }));
}

/**
 * Records every sunset the demo clock has passed since the last sweep and returns them. A read outside the
 * transaction keeps the common case (nothing new) free of a write lock; when there is work, the transaction
 * reads again and decides from that, so two sweeps at once write each row once.
 */
export async function runSunsetSweep(): Promise<PassedSunset[]> {
  const at = await now();
  const found = sweepSunsets({ versions: await loadSunsetFacts(db), now: at, zone: await readBusinessZone(db) });
  if (found.length === 0) return [];
  return inTransaction(db, async (tx) => {
    const passed = sweepSunsets({ versions: await loadSunsetFacts(tx), now: at, zone: await readBusinessZone(tx) });
    for (const p of passed) {
      await writeEffects(tx, p.effects, {
        at: p.at,
        actorId: null,
        teamId: p.teamId,
        templateId: p.templateId,
        versionId: p.versionId,
      });
    }
    return passed;
  });
}
