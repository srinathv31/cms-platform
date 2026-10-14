import { sweepAccess } from "@/domain/access/sweep";
import type { SweepResult } from "@/domain/access-types";
import { sweepSunsets, type SunsetFacts } from "@/domain/lifecycle/sunset";
import {
  applyFakeMembershipChange,
  membershipFacts,
  recertFacts,
} from "./access";
import { writeFakeAccessEffects } from "./access-effects";
import { writeFakeEffects } from "./effects";
import { businessZone } from "./settings";
import { activeVersion, templateById } from "./version-rows";
import type { FakeState } from "./state";
import type { FakeStore } from "./store";

// The backend's scheduled jobs, in memory: what services/local/sweeps.ts does against the database, run at an
// instant (the contract harness's `runScheduledJobs`, the demo's clock advance and persona switch). The domain
// decides (`sweepAccess`, `sweepSunsets`); this loads their facts and writes what they return. Each runs as one
// command, and a second run at the same instant writes nothing.

/** SQLite's default (BINARY) order, which the local implementation's ORDER BY uses. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Applies every access deadline `at` has crossed since the last sweep, backdated, as `runAccessSweep` does. */
export function runFakeAccessSweep(store: FakeStore, at: Date): SweepResult {
  return store.command((tx) => {
    const { state } = tx;
    const result = sweepAccess({
      now: at,
      memberships: membershipFacts(state),
      recerts: recertFacts(state, (r) => r.completedAt === null),
      teams: state.teams
        .map((t) => ({ id: t.id, name: t.name }))
        .sort((a, b) => byCodePoint(a.name, b.name)),
      people: state.users
        .map((u) => ({ id: u.id, name: u.name }))
        .sort((a, b) => byCodePoint(a.id, b.id)),
    });
    for (const change of result.membershipChanges)
      applyFakeMembershipChange(tx, change);
    for (const closed of result.recertsClosed) {
      const row = state.recertifications.find((r) => r.id === closed.id);
      if (row && row.completedAt === null)
        tx.update("recertifications", row, { completedAt: closed.completedAt });
    }
    // Team Admin recipients are read after the changes: nobody whose access just ended is told.
    writeFakeAccessEffects(tx, result.effects, { now: at, actorId: null });
    return result;
  });
}

/**
 * The versions a `version.sunset_passed` audit row already records: the sweep's "once". The only read of the
 * audit log behind it, kept by name so the Java API can answer it from a column (`versions.sunset_recorded_at`,
 * decision 0066), as the local `recordedSunsets` is.
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
      .sort((a, b) => byCodePoint(a.id, b.id))
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

/** Runs the scheduled jobs at `at`, as the local `runScheduledJobs`: the access sweep, then the sunset sweep. */
export function runFakeScheduledJobs(store: FakeStore, at: Date): void {
  runFakeAccessSweep(store, at);
  runFakeSunsetSweep(store, at);
}
