import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { sunsetDay, todayIn } from "@/domain/business-zone";
import { describeChanges } from "@/domain/contract";
import { DAY_MS } from "@/domain/dates";
import { REFUSALS, revokePending, sunsetPassed } from "@/domain/lifecycle";
import { can } from "@/domain/permissions";
import { refuse, type Refusal } from "@/domain/refusals";
import type { CompareOption, RoundHistoryItem, VersionTimelineItem, VersionsData } from "@/domain/review-types";
import { approvedOnRound, asNumbered, compareRounds, headOf, roundsOf, versionLabel } from "@/domain/rounds";
import type { ContractChange, PermissionResult, RevokeRecord, VersionState, Viewer } from "@/domain/types";
import { getBusinessZone } from "@/server/business-zone";
import { db } from "@/server/db/client";
import { approvals, renderLog, versions } from "@/server/db/schema/ucomp";
import { demoNow } from "./dynamic";
import {
  getPeople,
  iso,
  loadConsumerUsage,
  personOf,
  requireTemplate,
} from "./review-shared";

// The Versions tab: the template's versions as a timeline, with what the viewer may do on each. A number
// is one entry, its head (domain/rounds.ts `headOf`: the released row, else the latest round), carrying
// every round of it as its review history.

/**
 * What the viewer may do on one version right now: the permission (with its code and reason) first,
 * then the version's state, as the domain words it (`REFUSALS`, the same refusals the transitions return).
 * A pending revoke is checked before the confirm permission, so the starter reads "You started this
 * revoke. Another approver must confirm it." only while there is one to confirm. A Superseded
 * version's passed sunset comes before the permission: it is a fact about the version, final for
 * everyone, and the Versions tab shows it at the disabled control to anyone who can see the version.
 */
export function versionActions(
  viewer: Viewer,
  teamId: string,
  version: { state: VersionState; sunsetAt: Date | null; revoke: RevokeRecord | null },
  now: Date,
): VersionTimelineItem["can"] {
  const pending = revokePending(version);
  const then = (permission: PermissionResult, blocked: Refusal | null): PermissionResult =>
    !permission.ok ? permission : blocked ? refuse(blocked) : permission;
  const noPending = refuse(version.state === "revoked" ? REFUSALS.alreadyRevoked : REFUSALS.noRevokePending);

  return {
    setSunset:
      version.state === "superseded" && sunsetPassed(version, now)
        ? refuse(REFUSALS.sunsetPassed)
        : then(
            can(viewer, "version.setSunset", { teamId }),
            version.state === "superseded" ? null : REFUSALS.sunsetNotSuperseded,
          ),
    startRevoke: then(
      can(viewer, "version.revoke.start", { teamId }),
      version.state === "revoked"
        ? REFUSALS.alreadyRevoked
        : version.state !== "active" && version.state !== "superseded"
          ? REFUSALS.notRevocable
          : pending
            ? REFUSALS.revokePending
            : null,
    ),
    confirmRevoke: pending
      ? can(viewer, "version.revoke.confirm", { teamId, revokeStartedBy: version.revoke!.startedBy })
      : noPending,
    // The starter may withdraw, and another approver may decline: anyone who could start one.
    cancelRevoke: pending ? can(viewer, "version.revoke.start", { teamId }) : noPending,
  };
}

/**
 * One line per change, each with its own change's breaking flag (worded one at a time, so a line's flag
 * never depends on how the sentences are grouped). Same order as `describeChanges`.
 */
export function contractItems(changes: readonly ContractChange[], versionNumber: number): VersionTimelineItem["contractItems"] {
  return changes.flatMap((change) =>
    describeChanges([change], versionNumber).map((text) => ({ text, breaking: change.breaking })),
  );
}

/**
 * `/{team}/templates/{id}/versions`: the open draft on top, then one entry per number, newest first. Compare
 * offers every row, rounds included (`compareOptions`).
 */
export const getVersions = cache(async (spaceSlug: string, templateId: string): Promise<VersionsData> => {
  const { space, template } = await requireTemplate(spaceSlug, templateId);
  const nowDate = await demoNow();
  const zone = await getBusinessZone();
  const since = nowDate.getTime() - 30 * DAY_MS;

  const rows = await db
    .select({
      id: versions.id,
      number: versions.number,
      round: versions.round,
      state: versions.state,
      createdBy: versions.createdBy,
      createdAt: versions.createdAt,
      submittedBy: versions.submittedBy,
      submittedAt: versions.submittedAt,
      submitNote: versions.submitNote,
      activatedAt: versions.activatedAt,
      supersededAt: versions.supersededAt,
      sunsetAt: versions.sunsetAt,
      revoke: versions.revoke,
      contractChanges: versions.contractChanges,
    })
    .from(versions)
    .where(eq(versions.templateId, template.id));

  const ids = rows.map((r) => r.id);
  const [people, decisionRows, renderRows, consumerUsage] = await Promise.all([
    getPeople(),
    ids.length
      ? db
          .select()
          .from(approvals)
          .where(inArray(approvals.versionId, ids))
          .orderBy(asc(approvals.decidedAt), asc(approvals.id))
      : [],
    db
      .select({
        versionId: renderLog.versionId,
        lastRenderAt: sql<number>`max(${renderLog.at})`,
        renders30d: sql<number>`sum(case when ${renderLog.at} >= ${since} then 1 else 0 end)`,
      })
      .from(renderLog)
      .where(and(eq(renderLog.templateId, template.id), eq(renderLog.isPreview, false), isNotNull(renderLog.consumerId)))
      .groupBy(renderLog.versionId),
    loadConsumerUsage(db, template.id, nowDate),
  ]);
  const renders = new Map(renderRows.map((r) => [r.versionId, r]));
  const decisionsOf = (versionId: string) => decisionRows.filter((d) => d.versionId === versionId);

  // Newest first, the open draft on top: every row for Compare, one head per number for the timeline.
  const newest = [...rows].sort((a, b) => compareRounds(b, a));
  const compareOptions: CompareOption[] = newest.map((v) => ({
    id: v.id,
    label: v.number === null ? "Draft" : versionLabel(asNumbered(v), { history: true }),
    state: v.state,
  }));
  const shown = newest.filter((v) => v.number === null || headOf(rows, v.number) === v);

  /** A round as the review history lists it, with its closing decision (its last approvals row) once decided. */
  const roundItem = (v: (typeof rows)[number]): RoundHistoryItem => {
    const last = v.state === "in_review" ? undefined : decisionsOf(v.id).at(-1);
    return {
      id: v.id,
      round: asNumbered(v).round,
      state: v.state,
      ...(v.submittedAt ? { submittedAt: iso(v.submittedAt) } : {}),
      submittedBy: personOf(people, v.submittedBy ?? v.createdBy),
      ...(last
        ? {
            decision: {
              kind: last.decision,
              by: personOf(people, last.actorId),
              at: iso(last.decidedAt),
              stageName: last.stageName,
              ...(last.reason ? { reason: last.reason } : {}),
            },
          }
        : {}),
    };
  };

  const items = shown.map((v): VersionTimelineItem => {
    const usage = renders.get(v.id);
    const head = v.number === null ? null : asNumbered(v);
    const rounds = v.number === null ? [] : roundsOf(rows, v.number);
    const item: VersionTimelineItem = {
      id: v.id,
      number: head?.number ?? null,
      round: head?.round ?? null,
      label: head ? versionLabel(head) : null,
      approvedOnRound: head ? approvedOnRound(head) : null,
      rounds: rounds.length > 1 ? rounds.map(roundItem) : null,
      state: v.state,
      createdAt: iso(v.createdAt),
      author: personOf(people, v.submittedBy ?? v.createdBy),
      sunsetPassed: sunsetPassed(v, nowDate),
      contractLines: v.number !== null && v.contractChanges ? describeChanges(v.contractChanges, v.number) : [],
      contractItems: v.number !== null && v.contractChanges ? contractItems(v.contractChanges, v.number) : [],
      decisions: decisionsOf(v.id).map((d) => ({
        kind: d.decision,
        stageName: d.stageName,
        by: personOf(people, d.actorId),
        at: iso(d.decidedAt),
        ...(d.reason ? { reason: d.reason } : {}),
      })),
      lastRenderAt: usage ? new Date(Number(usage.lastRenderAt)).toISOString() : null,
      renders30d: usage ? Number(usage.renders30d ?? 0) : 0,
      can: versionActions(space.viewer, template.teamId, v, nowDate),
    };
    if (v.submittedAt) {
      item.submittedAt = iso(v.submittedAt);
      item.submitNote = v.submitNote;
    }
    if (v.activatedAt) item.activatedAt = iso(v.activatedAt);
    if (v.supersededAt) item.supersededAt = iso(v.supersededAt);
    if (v.sunsetAt) item.sunsetDay = sunsetDay(v.sunsetAt, zone);
    if (v.revoke) {
      item.revoke = {
        reason: v.revoke.reason,
        startedBy: personOf(people, v.revoke.startedBy),
        startedAt: v.revoke.startedAt,
        ...(v.revoke.confirmedBy ? { confirmedBy: personOf(people, v.revoke.confirmedBy) } : {}),
        ...(v.revoke.confirmedAt ? { confirmedAt: v.revoke.confirmedAt } : {}),
      };
    }
    return item;
  });

  return {
    template: { id: template.id, name: template.name, teamSlug: template.teamSlug },
    items,
    compareOptions,
    consumerUsage,
    sunsetCalendar: { zone, today: todayIn(nowDate, zone) },
  };
});
