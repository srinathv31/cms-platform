import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { stepperState } from "@/domain/approval-chain";
import { canComment } from "@/domain/comments";
import { describeChanges } from "@/domain/contract";
import { REFUSALS } from "@/domain/lifecycle";
import { canSeeSpace } from "@/domain/permissions";
import type { ApprovalStage, ReviewQueue, ReviewQueueRow, ReviewScreenData } from "@/domain/review-types";
import type { ContractChange, PermissionResult, VersionState } from "@/domain/types";
import { db } from "@/server/db/client";
import { approvals, teams, templates, versions } from "@/server/db/schema/ucomp";
import { demoNow } from "./dynamic";
import {
  chainFor,
  dayOf,
  decideCheck,
  getChains,
  getPeople,
  iso,
  isoOrUndefined,
  loadApprovedBy,
  loadChain,
  loadConsumerUsage,
  personOf,
  requireReviewVersion,
  stageApproverIds,
  waitingStage,
  type People,
} from "./review-shared";
import { requireSpace, type SpaceContext } from "./spaces";
import { loadThreads } from "./threads";

// The review queue and the review screen.

const DAY_MS = 86_400_000;
/** "Recently decided" looks back this far. */
export const DECIDED_WINDOW_DAYS = 30;

// ── Queue ─────────────────────────────────────────────────────

const queueColumns = {
  versionId: versions.id,
  versionNumber: versions.number,
  state: versions.state,
  submittedBy: versions.submittedBy,
  submittedAt: versions.submittedAt,
  writers: versions.writers,
  createdBy: versions.createdBy,
  createdAt: versions.createdAt,
  currentStage: versions.currentStage,
  contractChanges: versions.contractChanges,
  templateId: templates.id,
  templateName: templates.name,
  contentTypeId: templates.contentTypeId,
  teamId: teams.id,
  teamSlug: teams.slug,
  teamName: teams.name,
};

interface QueueVersion {
  versionId: string;
  versionNumber: number | null;
  state: VersionState;
  submittedBy: string | null;
  submittedAt: Date | null;
  writers: string[];
  createdBy: string;
  createdAt: Date;
  currentStage: number;
  contractChanges: ContractChange[] | null;
  templateId: string;
  templateName: string;
  contentTypeId: string;
  teamId: string;
  teamSlug: string;
  teamName: string;
}

/** One team's space reads that team; "All teams" reads every team (requireSpace already let the viewer in). */
function inScope(space: SpaceContext) {
  return space.isAll || !space.teamId ? undefined : eq(templates.teamId, space.teamId);
}

function queueRow(
  v: QueueVersion,
  people: People,
  stage: { position: number; name: string; count: number },
): ReviewQueueRow {
  return {
    templateId: v.templateId,
    templateName: v.templateName,
    teamSlug: v.teamSlug,
    teamName: v.teamName,
    versionId: v.versionId,
    versionNumber: v.versionNumber ?? 0,
    state: v.state,
    author: personOf(people, v.submittedBy ?? v.createdBy),
    submittedAt: iso(v.submittedAt ?? v.createdAt),
    stage,
    breaking: (v.contractChanges ?? []).some((c) => c.breaking),
  };
}

function currentStageOf(chain: readonly ApprovalStage[], currentStage: number) {
  const stage = waitingStage(chain, currentStage);
  return { position: stage.position, name: stage.name, count: chain.length };
}

const newestSubmitted = (a: ReviewQueueRow, b: ReviewQueueRow) =>
  b.submittedAt.localeCompare(a.submittedAt) || a.templateName.localeCompare(b.templateName);

/**
 * In-review versions in the space, and the ones the viewer may decide now. Cached: the badge and the
 * queue share it. A version on a team the viewer can't see joins `waiting` when its current stage
 * names them (Phase 6: a Legal reviewer covers every team), so they find it from their own space.
 */
const loadInReview = cache(async (spaceSlug: string) => {
  const space = await requireSpace(spaceSlug);
  const [all, chains, people] = await Promise.all([
    db
      .select(queueColumns)
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .innerJoin(teams, eq(teams.id, templates.teamId))
      .where(eq(versions.state, "in_review")),
    getChains(),
    getPeople(),
  ]);
  const viewer = space.viewer;
  const inSpace = (v: QueueVersion) => space.isAll || v.teamId === space.teamId;
  const namedElsewhere = (v: QueueVersion) =>
    !canSeeSpace(viewer, v.teamSlug) &&
    stageApproverIds(waitingStage(chainFor(chains, v.contentTypeId), v.currentStage)).includes(viewer.userId);
  const rows = all.filter((v) => inSpace(v) || namedElsewhere(v));
  const approvedBy = await loadApprovedBy(db, rows.map((v) => v.versionId));

  const waiting: ReviewQueueRow[] = [];
  const submitted: ReviewQueueRow[] = [];
  for (const v of rows) {
    const chain = chainFor(chains, v.contentTypeId);
    const row = queueRow(v, people, currentStageOf(chain, v.currentStage));
    if (v.submittedBy === viewer.userId) {
      if (inSpace(v)) submitted.push(row);
      continue;
    }
    const check = decideCheck(viewer, {
      teamId: v.teamId,
      submittedBy: v.submittedBy,
      writers: v.writers,
      stage: waitingStage(chain, v.currentStage),
      approvedBy: approvedBy.get(v.versionId) ?? [],
    });
    if (check.ok) waiting.push(row);
  }
  return { space, waiting: waiting.sort(newestSubmitted), submitted: submitted.sort(newestSubmitted) };
});

/**
 * The three tabs of `/{team}/review`.
 * - waiting: in review on the space's teams, at a stage the viewer may act on, not submitted by them;
 * - submitted: the viewer's own versions still in review;
 * - decided: the latest decision on each version decided in the last 30 days, newest first.
 * "All teams" spans every team (it's open only to cross-team viewers).
 */
export const getReviewQueue = cache(async (spaceSlug: string): Promise<ReviewQueue> => {
  const { space, waiting, submitted } = await loadInReview(spaceSlug);
  const nowDate = await demoNow();
  const since = new Date(nowDate.getTime() - DECIDED_WINDOW_DAYS * DAY_MS);

  const [rows, chains, people] = await Promise.all([
    db
      .select({
        ...queueColumns,
        stagePosition: approvals.stagePosition,
        stageName: approvals.stageName,
        decision: approvals.decision,
        decidedBy: approvals.actorId,
        decidedAt: approvals.decidedAt,
      })
      .from(approvals)
      .innerJoin(versions, eq(versions.id, approvals.versionId))
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .innerJoin(teams, eq(teams.id, templates.teamId))
      .where(and(gte(approvals.decidedAt, since), inScope(space)))
      .orderBy(desc(approvals.decidedAt), desc(approvals.id)),
    getChains(),
    getPeople(),
  ]);

  const decided: ReviewQueueRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.versionId)) continue; // newest first: the first row is the version's latest decision
    seen.add(r.versionId);
    const chain = chainFor(chains, r.contentTypeId);
    decided.push({
      ...queueRow(r, people, { position: r.stagePosition, name: r.stageName, count: chain.length }),
      decision: { kind: r.decision, by: personOf(people, r.decidedBy), at: iso(r.decidedAt) },
    });
  }

  return { waiting, submitted, decided };
});

/** The sidebar badge: how many versions wait on this viewer in the space. */
export const getReviewBadgeCount = cache(async (spaceSlug: string): Promise<number> => {
  return (await loadInReview(spaceSlug)).waiting.length;
});

// ── Review screen ─────────────────────────────────────────────

/** Approve and Request changes share one answer: the decide check, then the version's state. */
function decideOnScreen(check: PermissionResult, state: string): PermissionResult {
  if (!check.ok) return check;
  return state === "in_review" ? check : { ok: false, reason: REFUSALS.notInReview };
}

/** Everything `/{team}/review/{templateId}/{n}` shows. 404 when the version doesn't exist or isn't visible. */
export const getReviewScreen = cache(
  async (spaceSlug: string, templateId: string, versionNumber: number): Promise<ReviewScreenData> => {
    const { space, template, version } = await requireReviewVersion(spaceSlug, templateId, versionNumber);
    const number = version.number!;

    const nowDate = await demoNow();
    const [active, chain, people, decisionRows, threads, consumerUsage] = await Promise.all([
      db.query.versions.findFirst({
        columns: { id: true, number: true, body: true, variables: true },
        where: and(eq(versions.templateId, template.id), eq(versions.state, "active")),
      }),
      loadChain(db, template.contentTypeId),
      getPeople(),
      db
        .select()
        .from(approvals)
        .where(eq(approvals.versionId, version.id))
        .orderBy(asc(approvals.decidedAt), asc(approvals.id)),
      // A submitted version is a record: the threads that began after it are not part of it.
      loadThreads(template.id, version.body, { throughVersion: number }),
      loadConsumerUsage(db, template.id, nowDate),
    ]);

    const submittedBy = version.submittedBy ?? version.createdBy;
    const stage = waitingStage(chain, version.currentStage);
    const decideInput = { teamId: template.teamId, submittedBy: version.submittedBy, writers: version.writers, stage };
    const decide = decideOnScreen(decideCheck(space.viewer, decideInput), version.state);
    const inReview = version.state === "in_review";
    // Two stages need two people: someone who approved an earlier stage can't approve this one.
    const approvedBy = inReview ? decisionRows.filter((d) => d.decision === "approved").map((d) => d.actorId) : [];
    const approve = decideOnScreen(decideCheck(space.viewer, { ...decideInput, approvedBy }), version.state);
    const contractChanges = version.contractChanges ?? [];

    return {
      template: {
        id: template.id,
        name: template.name,
        teamId: template.teamId,
        teamSlug: template.teamSlug,
        teamName: template.teamName,
      },
      version: {
        id: version.id,
        number,
        state: version.state,
        body: version.body,
        variables: version.variables,
        channels: version.channels,
        sampleSets: version.sampleSets,
        emailSubject: version.emailSubject,
        emailPreheader: version.emailPreheader,
        submittedBy: personOf(people, submittedBy),
        submittedAt: iso(version.submittedAt ?? version.createdAt),
        submitNote: version.submitNote,
        sunsetAt: isoOrUndefined(version.sunsetAt) ?? null,
        contractChanges,
        contractLines: describeChanges(contractChanges, number),
      },
      baseline:
        active && active.id !== version.id && active.number !== null
          ? { id: active.id, number: active.number, body: active.body, variables: active.variables }
          : null,
      steps: stepperState(
        chain,
        decisionRows.map((d) => ({
          stagePosition: d.stagePosition,
          decision: d.decision,
          by: personOf(people, d.actorId),
          at: iso(d.decidedAt),
        })),
        { state: version.state, currentStage: version.currentStage },
      ),
      threads,
      can: {
        approve,
        requestChanges: decide,
        // Authors and approvers on the team, and whoever the waiting stage names (any team), while it is in review.
        comment: canComment(space.viewer, {
          teamId: template.teamId,
          version: { state: version.state, stageApproverIds: stageApproverIds(stage) },
        }),
      },
      consumerUsage,
      today: dayOf(nowDate),
    };
  },
);
