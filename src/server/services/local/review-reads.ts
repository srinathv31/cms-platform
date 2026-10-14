import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { chainFor, currentStageOf, ownStages } from "@/domain/approval-chain";
import { DAY_MS } from "@/domain/dates";
import { canSeeSpace } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ApprovalStage, VersionStage } from "@/domain/review-types";
import { queuePlacement } from "@/domain/review-access";
import { asNumbered } from "@/domain/rounds";
import type { ContractChange, VersionState, Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  approvals,
  teams,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import type { ReviewService } from "../review";
import {
  DECIDED_WINDOW_DAYS,
  type DecidedRow,
  type QueueRow,
} from "../review-reads";
import { refusal } from "../results";
import { getChains, loadDecisions } from "./chain";
import type { LocalDeps } from "./command";
import { loadPeople } from "./people";
import { localReviewScreen } from "./review-screen";

// The review area's reads on this app's own database (src/server/services/review.ts says what each promises):
// the review queue of a space and its sidebar badge here, the review screen in ./review-screen.ts. Which rounds
// wait on whom is the domain's (`queuePlacement`, src/domain/review-access.ts).

type ReviewReads = Pick<ReviewService, "queue" | "badgeCount" | "screen">;

export function localReviewReads(deps: LocalDeps): ReviewReads {
  return {
    async queue(ctx, { teamId }) {
      // A space the viewer may not enter reads as one that doesn't exist.
      if (!canSeeSpace(ctx.viewer, teamId))
        return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
      const asOf = await deps.clock();
      const [{ waiting, submitted }, decided] = await Promise.all([
        roundsInReview(ctx.viewer, teamId),
        decidedSince(
          teamId,
          new Date(asOf.getTime() - DECIDED_WINDOW_DAYS * DAY_MS),
        ),
      ]);
      return {
        ok: true,
        asOf: asOf.toISOString(),
        waiting,
        submitted,
        decided,
        people: await loadPeople([
          ...[...waiting, ...submitted, ...decided].map((r) => r.authorId),
          ...decided.map((r) => r.decision.by),
        ]),
      };
    },

    async badgeCount(ctx, { teamId }) {
      if (!canSeeSpace(ctx.viewer, teamId))
        return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
      const { waiting } = await roundsInReview(ctx.viewer, teamId);
      return { ok: true, count: waiting.length };
    },

    screen: localReviewScreen(deps),
  };
}

// A round as the queue reads it: the version row with its template and team. The row's name is the round's: an
// approver reviews the name it was submitted with.
const roundColumns = {
  versionId: versions.id,
  number: versions.number,
  round: versions.round,
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

interface RoundRow {
  versionId: string;
  number: number | null;
  round: number | null;
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

/** A queue row from a round's row, with its stage as the row shows it. */
function queueRow(v: RoundRow, stage: QueueRow["stage"]): QueueRow {
  return {
    templateId: v.templateId,
    templateName: v.templateName,
    teamId: v.teamId,
    teamSlug: v.teamSlug,
    teamName: v.teamName,
    versionId: v.versionId,
    round: asNumbered(v),
    authorId: v.submittedBy ?? v.createdBy,
    submittedAt: (v.submittedAt ?? v.createdAt).toISOString(),
    stage,
    breaking: (v.contractChanges ?? []).some((c) => c.breaking),
  };
}

/** "Stage 2 of 3": a position in the round's own stages (recorded at submit), with the name it recorded. */
function stageAt(
  v: Pick<RoundRow, "stages">,
  chain: readonly ApprovalStage[],
  position: number,
): QueueRow["stage"] {
  const own = ownStages(v.stages, chain);
  return { position, name: own[position]?.name ?? "", count: own.length };
}

/** The rounds in review that wait on the viewer in the space, and the ones they submitted there. */
async function roundsInReview(
  viewer: Viewer,
  spaceTeamId: string | null,
): Promise<{ waiting: QueueRow[]; submitted: QueueRow[] }> {
  // Every team's: a round on a team the viewer can't see waits on them when its stage names them.
  const [rows, chains] = await Promise.all([
    db
      .select(roundColumns)
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .innerJoin(teams, eq(teams.id, templates.teamId))
      .where(eq(versions.state, "in_review")),
    getChains(),
  ]);
  const decisions = await loadDecisions(
    db,
    rows.map((v) => v.versionId),
  );
  const waiting: QueueRow[] = [];
  const submitted: QueueRow[] = [];
  for (const v of rows) {
    const chain = chainFor(chains, v.contentTypeId);
    const placement = queuePlacement(viewer, spaceTeamId, {
      teamId: v.teamId,
      submittedBy: v.submittedBy,
      writers: v.writers,
      stage: currentStageOf(v, chain),
      decisions: decisions.get(v.versionId) ?? [],
    });
    if (placement === null) continue;
    (placement === "waiting" ? waiting : submitted).push(
      queueRow(v, stageAt(v, chain, v.currentStage)),
    );
  }
  return { waiting, submitted };
}

/** Each round decided in the space since `since`, with its latest decision, newest first. */
async function decidedSince(
  spaceTeamId: string | null,
  since: Date,
): Promise<DecidedRow[]> {
  const [rows, chains] = await Promise.all([
    db
      .select({
        ...roundColumns,
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
      .where(
        and(
          gte(approvals.decidedAt, since),
          spaceTeamId === null ? undefined : eq(templates.teamId, spaceTeamId),
        ),
      )
      .orderBy(desc(approvals.decidedAt), desc(approvals.id)),
    getChains(),
  ]);
  const decided: DecidedRow[] = [];
  const seen = new Set<string>();
  for (const d of rows) {
    // Newest first: a round's first row is its latest decision.
    if (seen.has(d.versionId)) continue;
    seen.add(d.versionId);
    const { count } = stageAt(d, chainFor(chains, d.contentTypeId), 0);
    decided.push({
      ...queueRow(d, {
        position: d.stagePosition,
        name: d.stageName,
        count,
      }),
      decision: {
        kind: d.decision,
        by: d.decidedBy,
        at: d.decidedAt.toISOString(),
      },
    });
  }
  return decided;
}
