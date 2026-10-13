import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import {
  currentStageOf,
  ownStages,
  stageApproverIds,
} from "@/domain/approval-chain";
import { sunsetDay, todayIn } from "@/domain/business-zone";
import { anchorIdsOf } from "@/domain/comments";
import { diffVariables } from "@/domain/contract";
import { reviewScreenBaselines } from "@/domain/lifecycle/baselines";
import { sunsetPassed } from "@/domain/lifecycle/sunset";
import { canSeeSpace } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import {
  mayOpenRound,
  reviewScreenActions,
  roundToOpen,
  type ReviewPlace,
  type RoundAccessFacts,
} from "@/domain/review-access";
import type { ApprovalStage } from "@/domain/review-types";
import { asNumbered, replacedBy } from "@/domain/rounds";
import type { Variable, VersionState, Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import { approvals, teams, versions } from "@/server/db/schema/ucomp";
import type { ReviewService } from "../review";
import type { ReviewScreenFacts, VersionContentFacts } from "../review-reads";
import { refusal } from "../results";
import { readBusinessZone } from "./business-zone";
import { loadChain, loadFamily, loadMessageRules } from "./chain";
import type { LocalDeps } from "./command";
import { loadConsumerUsage } from "./consumer-usage";
import { loadPeople } from "./people";
import { loadThreads, peopleIn } from "./threads";
import { findTemplate, type TemplateRow } from "./visible-template";

// One round's review screen on this app's own database (`ReviewService.screen` in src/server/services/review.ts
// says what it promises). It runs in named steps, each a question the screen answers:
//
//   1. openRound          which round the URL opens for the viewer, or Not found (`roundToOpen`)
//   2. the baselines      what the round is set beside: the redline, the Active version approving it replaces,
//                         the version that still renders after a revoke, and the name a rename shows against
//                         (`reviewScreenBaselines`)
//   3. replacedBy         where a sent-back round's work went, when the viewer may open it (`mayOpenRound`)
//   4. can                what the viewer may do on it (`reviewScreenActions`)
//   5. the rest           its threads, who renders the template, the message setup, the people
//
// Every rule is the domain's (src/domain/review-access.ts, src/domain/lifecycle/baselines.ts); this file reads
// the facts they take and the content they pick.

export function localReviewScreen(deps: LocalDeps): ReviewService["screen"] {
  return async (ctx, input) => {
    // 1. The round the URL opens for the viewer, from a space they may enter.
    if (!canSeeSpace(ctx.viewer, input.teamId))
      return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
    const opened = await openRound(ctx.viewer, input);
    if (!opened) return refusal(404, REQUEST_REFUSALS.versionUnavailable);
    const { template, chain, place, rows, numbered, shown } = opened;
    const asOf = await deps.clock();
    const [zone, version, decisions] = await Promise.all([
      readBusinessZone(db),
      loadVersion(shown.id),
      loadDecisions(shown.id),
    ]);
    const round = asNumbered(version);

    // 2. The baselines, then the content of the ones the screen shows.
    const baselines = reviewScreenBaselines(rows, shown, asOf);
    const [baseline, stillRendersVariables] = await Promise.all([
      baselines.redline ? loadContent(baselines.redline.id) : null,
      baselines.stillRenders ? loadVariables(baselines.stillRenders.id) : null,
    ]);

    // 3. Where its work went: the number's head, linked only when the viewer may open it (a stage reviewer
    // from another team may not), so the screen never links to a Not found.
    const head = replacedBy(numbered, round);
    const next =
      head && mayOpenRound(ctx.viewer, place, head) ? asNumbered(head) : null;

    // 4. What the viewer may do on it.
    const stage = currentStageOf(version, chain);
    const can = reviewScreenActions(ctx.viewer, {
      teamId: template.teamId,
      submittedBy: version.submittedBy,
      writers: version.writers,
      stage,
      decisions: decisions.map((d) => ({
        stageId: d.stageId,
        actorId: d.actorId,
        decision: d.decision,
      })),
      state: version.state,
    });

    // 5. Its threads (a submitted round is a record: the threads that began after it are not part of it), who
    // renders the template, and what the phone preview needs.
    const [threads, consumerUsage, family, rules, senders] = await Promise.all([
      loadThreads(template.id, anchorIdsOf(version), { through: round }),
      loadConsumerUsage(db, template.id, asOf),
      loadFamily(db, template.contentTypeId),
      loadMessageRules(db, template.contentTypeId),
      loadSenders(template.teamId),
    ]);
    const submittedBy = version.submittedBy ?? version.createdBy;

    const facts: ReviewScreenFacts = {
      asOf: asOf.toISOString(),
      template: {
        id: template.id,
        teamId: template.teamId,
        teamSlug: template.teamSlug,
        teamName: template.teamName,
        family,
      },
      version: {
        id: version.id,
        number: round.number,
        round: round.round,
        state: version.state,
        name: version.name,
        body: version.body,
        variables: version.variables,
        channels: version.channels,
        channelFields: version.channelFields,
        sampleSets: version.sampleSets,
        smsFooter: version.smsFooter,
        submittedBy,
        submittedAt: (version.submittedAt ?? version.createdAt).toISOString(),
        submitNote: version.submitNote,
        sunsetDay: version.sunsetAt ? sunsetDay(version.sunsetAt, zone) : null,
        sunsetPassed: sunsetPassed(version, asOf),
        contractChanges: version.contractChanges ?? [],
        // Its own stages, recorded at submit; each stage's rule is read from the chain now.
        stages: ownStages(version.stages, chain),
        currentStage: version.currentStage,
        decisions: decisions.map((d) => ({
          stageId: d.stageId,
          kind: d.decision,
          by: d.actorId,
          at: d.decidedAt.toISOString(),
        })),
      },
      baseline,
      previousNumber: baselines.replaces?.number ?? null,
      // What submit stored was diffed against whatever was Active then, which may be a version revoked since:
      // what the consumers of the version that still renders have to map is worked out again, against it.
      stillRenders:
        baselines.stillRenders &&
        baselines.stillRenders.number !== null &&
        stillRendersVariables
          ? {
              number: baselines.stillRenders.number,
              sunsetDay: baselines.stillRenders.sunsetAt
                ? sunsetDay(baselines.stillRenders.sunsetAt, zone)
                : null,
              contractChanges: diffVariables(
                stillRendersVariables,
                version.variables,
              ),
            }
          : null,
      replacedBy: next,
      liveName: baselines.renamedFrom?.name ?? null,
      threads,
      can,
      consumerUsage,
      sunsetCalendar: { zone, today: todayIn(asOf, zone) },
      // A reviewed version is submitted: its SMS ends with the footer frozen into it, not the content type's now.
      messageRules: { ...rules, smsFooter: version.smsFooter },
      senders,
      people: await loadPeople([
        submittedBy,
        ...decisions.map((d) => d.actorId),
        ...peopleIn(threads),
        ctx.viewer.userId,
      ]),
    };
    return { ok: true, ...facts };
  };
}

// ── 1. Which round the URL opens ──────────────────────────────

/** A row of the template's versions (the open draft included), as the baselines read it. */
interface ScreenRow {
  id: string;
  number: number | null;
  round: number | null;
  state: VersionState;
  name: string;
  sunsetAt: Date | null;
  basedOnVersionId: string | null;
}

/** A submitted row, with what deciding who may open it reads (`RoundAccessFacts`). */
type OpenableRow = ScreenRow & RoundAccessFacts;

/**
 * The round `/{space}/review/{templateId}/{number}?round=N` opens for the viewer (`roundToOpen`), with the
 * template, its rows, and its submitted rows as who may open them; null for Not found: no such template,
 * number or round, or none the viewer may open from the space.
 */
async function openRound(
  viewer: Viewer,
  input: {
    teamId: string | null;
    templateId: string;
    versionNumber: number;
    round: number | null;
  },
): Promise<{
  template: TemplateRow;
  /** Its content type's approval chain: each stage's rule now. */
  chain: ApprovalStage[];
  place: ReviewPlace;
  rows: ScreenRow[];
  numbered: OpenableRow[];
  shown: OpenableRow;
} | null> {
  const { versionNumber, round } = input;
  if (!Number.isInteger(versionNumber) || versionNumber < 1) return null;
  if (round !== null && (!Number.isInteger(round) || round < 1)) return null;
  const template = await findTemplate(input.templateId);
  if (!template) return null;

  const [rows, chain] = await Promise.all([
    db
      .select({
        id: versions.id,
        number: versions.number,
        round: versions.round,
        state: versions.state,
        name: versions.name,
        sunsetAt: versions.sunsetAt,
        basedOnVersionId: versions.basedOnVersionId,
        stages: versions.stages,
        currentStage: versions.currentStage,
      })
      .from(versions)
      .where(eq(versions.templateId, template.id)),
    loadChain(db, template.contentTypeId),
  ]);
  const deciders = await loadDeciders(rows.map((v) => v.id));
  const numbered = rows.flatMap((v): OpenableRow[] =>
    v.number === null || v.round === null
      ? []
      : [
          {
            ...v,
            number: v.number,
            round: v.round,
            // Read only while it waits on a stage: who that stage names may open it from any team.
            stageApproverIds:
              v.state === "in_review"
                ? stageApproverIds(currentStageOf(v, chain))
                : [],
            decidedBy: deciders.get(v.id) ?? [],
          },
        ],
  );
  const place: ReviewPlace = {
    spaceTeamId: input.teamId,
    teamId: template.teamId,
  };
  const shown = roundToOpen(viewer, place, numbered, {
    number: versionNumber,
    round,
  });
  return shown ? { template, chain, place, rows, numbered, shown } : null;
}

// ── Loaders ───────────────────────────────────────────────────

/** Who decided each version (its approvals' actors), by version id. */
async function loadDeciders(
  versionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byVersion = new Map<string, string[]>();
  if (versionIds.length === 0) return byVersion;
  const rows = await db
    .select({ versionId: approvals.versionId, actorId: approvals.actorId })
    .from(approvals)
    .where(inArray(approvals.versionId, [...versionIds]));
  for (const { versionId, actorId } of rows)
    byVersion.set(versionId, [...(byVersion.get(versionId) ?? []), actorId]);
  return byVersion;
}

/** The round on screen, every column. */
async function loadVersion(id: string) {
  const row = await db.query.versions.findFirst({ where: eq(versions.id, id) });
  if (!row) throw new Error(`Version ${id} was read a moment ago and is gone.`);
  return row;
}

/** The round's decisions, oldest first: the stepper's who and when, and who already approved a stage of it. */
function loadDecisions(versionId: string) {
  return db
    .select()
    .from(approvals)
    .where(eq(approvals.versionId, versionId))
    .orderBy(asc(approvals.decidedAt), asc(approvals.id));
}

/** The redline's baseline: only its content is read. */
async function loadContent(id: string): Promise<VersionContentFacts | null> {
  const [row] = await db
    .select({
      id: versions.id,
      number: versions.number,
      state: versions.state,
      body: versions.body,
      variables: versions.variables,
      channels: versions.channels,
      channelFields: versions.channelFields,
      smsFooter: versions.smsFooter,
    })
    .from(versions)
    .where(eq(versions.id, id))
    .limit(1);
  return row && row.number !== null ? { ...row, number: row.number } : null;
}

/** One version's variable list: what the round's contract changes are worked out against. */
async function loadVariables(id: string): Promise<Variable[]> {
  const [row] = await db
    .select({ variables: versions.variables })
    .from(versions)
    .where(eq(versions.id, id))
    .limit(1);
  return row?.variables ?? [];
}

/** Who the team's messages come from on the phone preview: the push's app, the SMS's short code. */
async function loadSenders(teamId: string) {
  const [team] = await db
    .select({ appName: teams.appName, smsSender: teams.smsSender })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return {
    appName: team?.appName ?? null,
    smsSender: team?.smsSender ?? null,
  };
}
