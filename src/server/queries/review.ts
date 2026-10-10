import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { approvedThisRound, currentStageOf, ownStages, stepperState } from "@/domain/approval-chain";
import { sunsetDay, todayIn } from "@/domain/business-zone";
import { canComment } from "@/domain/comments";
import { describeChanges } from "@/domain/contract";
import { DAY_MS, utcDay } from "@/domain/dates";
import { REFUSALS, contractBaseline, reviewBaseline } from "@/domain/lifecycle";
import { canSeeSpace } from "@/domain/permissions";
import type { MessageTypeRules, TeamSenders } from "@/domain/platform-config";
import { refuse } from "@/domain/refusals";
import type { ApprovalStage, ReviewQueue, ReviewQueueRow, ReviewScreenData, VersionStage } from "@/domain/review-types";
import type { ContractChange, PermissionResult, VersionState } from "@/domain/types";
import { getBusinessZone } from "@/server/business-zone";
import { db } from "@/server/db/client";
import { approvals, teams, templates, versions } from "@/server/db/schema/ucomp";
import { demoNow } from "./dynamic";
import {
  anchorIdsOf,
  chainFor,
  decideCheck,
  getChains,
  getPeople,
  iso,
  loadChain,
  loadConsumerUsage,
  loadDecisions,
  loadMessageRules,
  personOf,
  requireReviewVersion,
  stageApproverIds,
  type People,
} from "./review-shared";
import { requireSpace, type SpaceContext } from "./spaces";
import { loadThreads } from "./threads";

// The review queue and the review screen.

/** "Recently decided" looks back this far. */
export const DECIDED_WINDOW_DAYS = 30;

// ── Queue ─────────────────────────────────────────────────────

// A row is a version, so it carries that version's name: an approver reviews the name it was submitted with.
const queueColumns = {
  versionId: versions.id,
  versionNumber: versions.number,
  state: versions.state,
  submittedBy: versions.submittedBy,
  submittedAt: versions.submittedAt,
  writers: versions.writers,
  createdBy: versions.createdBy,
  createdAt: versions.createdAt,
  stages: versions.stages,
  currentStage: versions.currentStage,
  contractChanges: versions.contractChanges,
  templateId: templates.id,
  templateName: versions.name,
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
  stages: VersionStage[] | null;
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

/** The queue's "Stage 2 of 3": a position in the version's own stages, with the name it recorded. */
function queueStage(v: { stages: VersionStage[] | null }, chain: readonly ApprovalStage[], position: number) {
  const own = ownStages(v.stages, chain);
  return { position, name: own[position]?.name ?? "", count: own.length };
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
    stageApproverIds(currentStageOf(v, chainFor(chains, v.contentTypeId))).includes(viewer.userId);
  const rows = all.filter((v) => inSpace(v) || namedElsewhere(v));
  const decisions = await loadDecisions(db, rows.map((v) => v.versionId));

  const waiting: ReviewQueueRow[] = [];
  const submitted: ReviewQueueRow[] = [];
  for (const v of rows) {
    const chain = chainFor(chains, v.contentTypeId);
    const row = queueRow(v, people, queueStage(v, chain, v.currentStage));
    if (v.submittedBy === viewer.userId) {
      if (inSpace(v)) submitted.push(row);
      continue;
    }
    const check = decideCheck(viewer, {
      teamId: v.teamId,
      submittedBy: v.submittedBy,
      writers: v.writers,
      stage: currentStageOf(v, chain),
      approvedBy: approvedThisRound(decisions.get(v.versionId) ?? []),
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
    const count = ownStages(r.stages, chainFor(chains, r.contentTypeId)).length;
    decided.push({
      ...queueRow(r, people, { position: r.stagePosition, name: r.stageName, count }),
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
  return state === "in_review" ? check : refuse(REFUSALS.notInReview);
}

/** The baseline's content, for the redline: only the chosen version's body and channel fields are read. */
async function loadBaseline(
  base: { id: string; number: number | null; state: VersionState } | null,
): Promise<ReviewScreenData["baseline"]> {
  if (!base || base.number === null) return null;
  const row = await db.query.versions.findFirst({
    columns: { body: true, variables: true, channels: true, channelFields: true },
    where: eq(versions.id, base.id),
  });
  return row ? { id: base.id, number: base.number, state: base.state, ...row } : null;
}

/** Everything `/{team}/review/{templateId}/{n}` shows. 404 when the version doesn't exist or isn't visible. */
export const getReviewScreen = cache(
  async (spaceSlug: string, templateId: string, versionNumber: number): Promise<ReviewScreenData> => {
    const { space, template, version } = await requireReviewVersion(spaceSlug, templateId, versionNumber);
    const number = version.number!;

    const nowDate = await demoNow();
    const zone = await getBusinessZone();
    const [others, chain, people, decisionRows, threads, consumerUsage, messages] = await Promise.all([
      db
        .select({
          id: versions.id,
          number: versions.number,
          state: versions.state,
          sunsetAt: versions.sunsetAt,
          name: versions.name,
          basedOnVersionId: versions.basedOnVersionId,
        })
        .from(versions)
        .where(eq(versions.templateId, template.id)),
      loadChain(db, template.contentTypeId),
      getPeople(),
      db
        .select()
        .from(approvals)
        .where(eq(approvals.versionId, version.id))
        .orderBy(asc(approvals.decidedAt), asc(approvals.id)),
      // A submitted version is a record: the threads that began after it are not part of it.
      loadThreads(template.id, anchorIdsOf(version), { throughVersion: number }),
      loadConsumerUsage(db, template.id, nowDate),
      loadMessageSetup(template),
    ]);

    const submittedBy = version.submittedBy ?? version.createdBy;
    // The version's own stages (recorded at submit), each stage's rule read from the chain now.
    const own = ownStages(version.stages, chain);
    const stage = currentStageOf(version, chain);
    const decideInput = { teamId: template.teamId, submittedBy: version.submittedBy, writers: version.writers, stage };
    const decide = decideOnScreen(decideCheck(space.viewer, decideInput), version.state);
    const inReview = version.state === "in_review";
    // Two stages need two people: someone who approved a stage of this version can't approve another.
    const approvedBy = inReview ? approvedThisRound(decisionRows) : [];
    const approve = decideOnScreen(decideCheck(space.viewer, { ...decideInput, approvedBy }), version.state);
    const contractChanges = version.contractChanges ?? [];
    // What a rename is shown against: the name customers get today, the Active version's or, with none
    // Active, the newest that still renders (as submit's contract changes compare). Not this version's own.
    const live = contractBaseline(others, nowDate);
    // What the redline compares with: the Active version or, after a revoke, the revoked text the draft
    // corrects (decision 0031). The Approve dialog's previous version stays the Active one.
    const baseline = await loadBaseline(reviewBaseline(others, version.id, nowDate));
    const active = others.find((v) => v.state === "active");

    return {
      template: {
        id: template.id,
        teamId: template.teamId,
        teamSlug: template.teamSlug,
        teamName: template.teamName,
      },
      version: {
        id: version.id,
        number,
        state: version.state,
        name: version.name,
        body: version.body,
        variables: version.variables,
        channels: version.channels,
        sampleSets: version.sampleSets,
        channelFields: version.channelFields,
        submittedBy: personOf(people, submittedBy),
        submittedAt: iso(version.submittedAt ?? version.createdAt),
        submitNote: version.submitNote,
        sunsetDay: version.sunsetAt ? sunsetDay(version.sunsetAt, zone) : null,
        contractChanges,
        contractLines: describeChanges(contractChanges, number),
      },
      baseline,
      previousNumber: active && active.id !== version.id ? active.number : null,
      liveName: live && live.id !== version.id ? live.name : null,
      steps: stepperState(
        own,
        decisionRows.map((d) => ({
          stageId: d.stageId,
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
      today: utcDay(nowDate),
      sunsetCalendar: { zone, today: todayIn(nowDate, zone) },
      messageRules: messages.rules,
      senders: messages.senders,
    };
  },
);

/**
 * What the phone preview renders a message version with: its content type's SMS footer and part budget,
 * and who the team's messages come from (the push's app, the SMS's short code).
 */
async function loadMessageSetup(template: { teamId: string; contentTypeId: string }): Promise<{
  rules: MessageTypeRules;
  senders: TeamSenders;
}> {
  const [rules, team] = await Promise.all([
    loadMessageRules(db, template.contentTypeId),
    db.query.teams.findFirst({ where: eq(teams.id, template.teamId), columns: { appName: true, smsSender: true } }),
  ]);
  return { rules, senders: { appName: team?.appName ?? null, smsSender: team?.smsSender ?? null } };
}
