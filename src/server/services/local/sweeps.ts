import "server-only";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { sweepAccess } from "@/domain/access/sweep";
import type { SweepInput, SweepResult } from "@/domain/access-types";
import {
  sweepSunsets,
  type PassedSunset,
  type SunsetFacts,
} from "@/domain/lifecycle/sunset";
import { db } from "@/server/db/client";
import {
  auditEvents,
  recertifications,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import {
  loadMembershipFacts,
  loadPeopleNamed,
  loadRecertFacts,
  loadTeamsNamed,
  type Reader,
} from "./access-facts";
import { applyMembershipChange, writeAccessEffects } from "./access-effects";
import { readBusinessZone } from "./business-zone";
import { writeEffects } from "./effects";
import { inTransaction, type Tx } from "./transaction";

// The backend's scheduled jobs, on this app's own database: the access sweep (recertification lapses, the 90-day
// inactivity flag, the 120-day suspension) and the sunset sweep (a passed sunset recorded, and the template's
// consumers told). Each applies every deadline its instant has crossed since the last run, dated when the deadline
// fell due, and decides with the domain (`sweepAccess`, `sweepSunsets`); running one twice changes nothing.
//
// Nothing runs them on a timer yet (handoff review S4): the demo runs them at its clock when it moves the clock or
// switches persona (./demo.ts), and the access commands run them before they act, the local implementation's lazy
// trigger (./access.ts). After the port they are the Java API's scheduled jobs; the contract suite runs them at an
// instant it names (`runScheduledJobs`). The fake's twins are in services/fake/sweeps.ts.

// ── The access sweep ──────────────────────────────────────────

/** Everything `sweepAccess` reads: every membership, the open reviews, team and people names. */
async function loadSweepInput(r: Reader, at: Date): Promise<SweepInput> {
  const [ms, recerts, teamList, people] = [
    await loadMembershipFacts(r),
    await loadRecertFacts(r, isNull(recertifications.completedAt)),
    await loadTeamsNamed(r),
    await loadPeopleNamed(r),
  ];
  return { now: at, memberships: ms, recerts, teams: teamList, people };
}

const isEmpty = (r: SweepResult) =>
  r.membershipChanges.length === 0 &&
  r.recertsClosed.length === 0 &&
  r.effects.length === 0;

/** Writes a sweep's result inside the caller's transaction: memberships, closed reviews, then effects. */
async function applySweep(
  tx: Tx,
  result: SweepResult,
  at: Date,
): Promise<void> {
  for (const change of result.membershipChanges)
    await applyMembershipChange(tx, change);
  for (const closed of result.recertsClosed) {
    await tx
      .update(recertifications)
      .set({ completedAt: closed.completedAt })
      .where(
        and(
          eq(recertifications.id, closed.id),
          isNull(recertifications.completedAt),
        ),
      );
  }
  // Team Admin recipients are read after the changes: nobody whose access just ended is told.
  await writeAccessEffects(tx, result.effects, { now: at, actorId: null });
}

/**
 * Applies every access deadline `at` has crossed since the last sweep (lapses at a review's deadline, the 90-day
 * flag, the 120-day automatic suspension), each backdated to when it fell due, and returns what it did. A read
 * outside the transaction keeps the common case (nothing to do) free of a write lock; when there is work, the
 * transaction reads again and decides from that, so two sweeps at once apply it only once.
 */
export async function runAccessSweep(at: Date): Promise<SweepResult> {
  if (isEmpty(sweepAccess(await loadSweepInput(db, at)))) {
    return { membershipChanges: [], recertsClosed: [], effects: [] };
  }
  return inTransaction(db, async (tx) => {
    const result = sweepAccess(await loadSweepInput(tx, at));
    if (!isEmpty(result)) await applySweep(tx, result, at);
    return result;
  });
}

// ── The sunset sweep ──────────────────────────────────────────

/**
 * Which of `versionIds` already have their passed sunset recorded: the sweep's "once". Today a
 * `version.sunset_passed` audit row records it, the one read of the audit log a rule makes; after the port it is
 * the `versions.sunset_recorded_at` column (decision 0066), so no business rule reads the audit log. Keep this the
 * only place that asks.
 */
async function recordedSunsets(
  r: Reader,
  versionIds: readonly string[],
): Promise<ReadonlySet<string | null>> {
  const rows = await r
    .select({ versionId: auditEvents.versionId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, "version.sunset_passed"),
        inArray(auditEvents.versionId, [...versionIds]),
      ),
    );
  return new Set(rows.map((a) => a.versionId));
}

/**
 * Every version with a sunset, with its team, whether its passed sunset is recorded, and its template's Active
 * version number. Ordered by id.
 */
async function loadSunsetFacts(r: Reader): Promise<SunsetFacts[]> {
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
  const [recorded, active] = await Promise.all([
    recordedSunsets(
      r,
      rows.map((v) => v.id),
    ),
    r
      .select({ templateId: versions.templateId, number: versions.number })
      .from(versions)
      .where(
        and(
          eq(versions.state, "active"),
          inArray(versions.templateId, [
            ...new Set(rows.map((v) => v.templateId)),
          ]),
        ),
      ),
  ]);
  const activeNumber = new Map(active.map((a) => [a.templateId, a.number]));
  return rows.map(({ revoke, ...v }) => ({
    ...v,
    revokedAt: revoke?.confirmedAt ? new Date(revoke.confirmedAt) : null,
    passedRecorded: recorded.has(v.id),
    activeNumber: activeNumber.get(v.templateId) ?? null,
  }));
}

/**
 * Records every sunset `at` has passed that nothing records yet, and tells the template's consumers, and returns
 * them. Each `version.sunset_passed` row is dated at its sunset; the notices are created at `at`, when they can
 * first be read, and go to the consumers that rendered the template from 90 days before the sunset on. A read
 * outside the transaction keeps the common case free of a write lock; the transaction reads again, so two sweeps
 * at once write each row and each notice once. It only records: whether a version renders is `sunsetPassed` at
 * the moment of the render, swept or not.
 */
export async function runSunsetSweep(at: Date): Promise<PassedSunset[]> {
  const found = sweepSunsets({
    versions: await loadSunsetFacts(db),
    now: at,
    zone: await readBusinessZone(db),
  });
  if (found.length === 0) return [];
  return inTransaction(db, async (tx) => {
    const passed = sweepSunsets({
      versions: await loadSunsetFacts(tx),
      now: at,
      zone: await readBusinessZone(tx),
    });
    for (const p of passed) {
      await writeEffects(tx, p.effects, {
        at: p.at,
        writtenAt: at,
        actorId: null,
        teamId: p.teamId,
        templateId: p.templateId,
        versionId: p.versionId,
      });
    }
    return passed;
  });
}

// ── Both ──────────────────────────────────────────────────────

/**
 * Runs the scheduled jobs at `at`: the access sweep, then the sunset sweep, each in its own transaction (a
 * command that triggers them and then refuses doesn't roll them back). Answers whether either changed anything.
 */
export async function runScheduledJobs(
  at: Date,
): Promise<{ changed: boolean }> {
  const access = await runAccessSweep(at);
  const sunsets = await runSunsetSweep(at);
  return { changed: !isEmpty(access) || sunsets.length > 0 };
}
