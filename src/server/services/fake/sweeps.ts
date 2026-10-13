import { sweepSunsets, type SunsetFacts } from "@/domain/lifecycle/sunset";
import { writeFakeEffects } from "./effects";
import { businessZone } from "./settings";
import { activeVersion, templateById } from "./version-rows";
import type { FakeState } from "./state";
import type { FakeStore } from "./store";

// The backend's scheduled jobs, in memory: what src/server/sunset-sweep.ts does against the database, run by
// the contract harness at an instant it names (`runScheduledJobs`). The domain decides (`sweepSunsets`); this
// loads its facts and writes what it returns. The access sweep joins with the access area (plan P2).

/**
 * The versions a `version.sunset_passed` audit row already records: the sweep's "once". The only read of the
 * audit log behind it, kept by name so the Java API can answer it from a column (`versions.sunset_recorded_at`,
 * decision 0066).
 */
function recordedSunsets(state: FakeState): ReadonlySet<string | null> {
  return new Set(
    state.auditEvents
      .filter((e) => e.action === "version.sunset_passed")
      .map((e) => e.versionId),
  );
}

/** Records every sunset passed by `at` that nothing records yet, and tells the template's consumers. */
export function runFakeSunsetSweep(store: FakeStore, at: Date): void {
  store.command((tx) => {
    const { state } = tx;
    const recorded = recordedSunsets(state);
    const facts: SunsetFacts[] = state.versions
      .filter((v) => v.sunsetAt !== null)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((v) => ({
        id: v.id,
        templateId: v.templateId,
        teamId: templateById(state, v.templateId)!.teamId,
        number: v.number,
        state: v.state,
        sunsetAt: v.sunsetAt,
        revokedAt: v.revoke?.confirmedAt
          ? new Date(v.revoke.confirmedAt)
          : null,
        passedRecorded: recorded.has(v.id),
        activeNumber: activeVersion(state, v.templateId)?.number ?? null,
      }));
    for (const passed of sweepSunsets({
      versions: facts,
      now: at,
      zone: businessZone(state),
    }))
      writeFakeEffects(tx, passed.effects, {
        at: passed.at,
        writtenAt: at,
        actorId: null,
        teamId: passed.teamId,
        templateId: passed.templateId,
        versionId: passed.versionId,
      });
  });
}
