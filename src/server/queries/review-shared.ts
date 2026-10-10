import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { DEFAULT_CHAIN, canActOnStage, currentStageOf, type RecordedDecision } from "@/domain/approval-chain";
import { DAY_MS } from "@/domain/dates";
import { REFUSALS } from "@/domain/lifecycle";
import { ALL_SPACE, can, canSeeSpace } from "@/domain/permissions";
import { refuse } from "@/domain/refusals";
import type { ApprovalStage, ConsumerUsage, Person } from "@/domain/review-types";
import { roundsOf } from "@/domain/rounds";
import type { JSONContent, PermissionResult, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { db } from "@/server/db/client";
import { approvalStages, approvals, consumers, renderLog, teams, templates, users, versions } from "@/server/db/schema/ucomp";
import { findRound } from "./find-round";
import { requireSpace, type SpaceContext } from "./spaces";
import { currentName } from "./template-name";

// Helpers the Phase 4 read models (review, versions, activity, threads) and the review actions
// share: people, template access, the approval chain, the decide check and the render-log usage.

// ── People ────────────────────────────────────────────────────

export type People = ReadonlyMap<string, Person>;

/** Every user as a `Person` (the table is small: personas plus a few seeded colleagues). */
export const getPeople = cache(async (): Promise<People> => {
  const rows = await db
    .select({ id: users.id, name: users.name, initials: users.initials, hue: users.avatarHue })
    .from(users);
  return new Map(rows.map((r) => [r.id, r]));
});

/** The person, or a stand-in built from the id when the user row is gone. */
export function personOf(people: People, id: string): Person {
  return people.get(id) ?? { id, name: id, initials: id.slice(0, 2).toUpperCase(), hue: 0 };
}

// ── Dates ─────────────────────────────────────────────────────

export function iso(date: Date): string {
  return date.toISOString();
}

export function isoOrUndefined(date: Date | null | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

// ── Template access ───────────────────────────────────────────

export interface TemplateAccess {
  space: SpaceContext;
  /** `name` is the CMS's name for the template (`currentName`): its open draft's, otherwise its newest version's. */
  template: { id: string; name: string; teamId: string; teamSlug: string; teamName: string; contentTypeId: string };
}

/**
 * The template, as seen from a space: 404 when it doesn't exist, belongs to another team's space, or
 * sits on a team the viewer can't see (the same rule as the workspace header).
 */
export const requireTemplate = cache(async (spaceSlug: string, templateId: string): Promise<TemplateAccess> => {
  const space = await requireSpace(spaceSlug);
  const template = await findTemplate(templateId);
  if (!template || !seesInSpace(space, template)) notFound();
  return { space, template };
});

function findTemplate(templateId: string) {
  return db
    .select({
      id: templates.id,
      name: currentName(templates.id),
      teamId: templates.teamId,
      teamSlug: teams.slug,
      teamName: teams.name,
      contentTypeId: templates.contentTypeId,
    })
    .from(templates)
    .innerJoin(teams, eq(teams.id, templates.teamId))
    .where(eq(templates.id, templateId))
    .limit(1)
    .then((rows) => rows[0]);
}

/** The template belongs to the space (or the space is "All teams"), and the viewer sees its team. */
function seesInSpace(space: SpaceContext, template: { teamSlug: string }): boolean {
  if (space.slug !== ALL_SPACE && template.teamSlug !== space.slug) return false;
  return canSeeSpace(space.viewer, template.teamSlug);
}

export type ReviewVersionRow = typeof versions.$inferSelect;

/**
 * The review screen's template and version: the round asked for (`?round=`), or without one the number's
 * head, its released row or else its latest round (`findRound`). As `requireTemplate`, plus one way in
 * from outside the template's team (Phase 6, a stage that names a person): someone named on the stage a
 * version waits on opens it from their own space, in any team, and keeps seeing it once they decided it.
 * Any other version of that template stays a 404 for them. A round that doesn't exist is a 404.
 *
 * A bare link stored before a send-back (the notification that asked them, a comment's link) names no
 * round. Once the next round is in review at a stage that doesn't name them, the head is closed to them,
 * so for them the bare link opens the newest round of the number they may open (`roundsOf`), the one
 * they decided. The template's own team always gets the head.
 */
export const requireReviewVersion = cache(
  async (
    spaceSlug: string,
    templateId: string,
    versionNumber: number,
    round: number | null = null,
  ): Promise<TemplateAccess & { version: ReviewVersionRow }> => {
    const space = await requireSpace(spaceSlug);
    const template = await findTemplate(templateId);
    if (!template || !Number.isInteger(versionNumber) || versionNumber < 1) notFound();
    if (round !== null && (!Number.isInteger(round) || round < 1)) notFound();
    const version = await findRound(db, template.id, versionNumber, round);
    if (!version || version.number === null) notFound();
    if (seesInSpace(space, template)) return { space, template, version };
    if (await namedOnVersion(space.viewer, template, version)) return { space, template, version };
    if (round === null) {
      const rows = await db
        .select()
        .from(versions)
        .where(and(eq(versions.templateId, template.id), eq(versions.number, versionNumber)));
      for (const earlier of roundsOf(rows, versionNumber)) {
        if (earlier.id === version.id) continue;
        if (await namedOnVersion(space.viewer, template, earlier)) return { space, template, version: earlier };
      }
    }
    notFound();
  },
);

/**
 * Whether the viewer may open this round's review screen from the space, by the rule
 * `requireReviewVersion` lets them in by: the template's team in its space, or someone the round's stage
 * names or who decided it. A screen links to another round only when this holds, so it never links to a 404.
 */
export async function opensRound(access: TemplateAccess, versionId: string): Promise<boolean> {
  const { space, template } = access;
  if (seesInSpace(space, template)) return true;
  const version = await db.query.versions.findFirst({ where: eq(versions.id, versionId) });
  return version !== undefined && namedOnVersion(space.viewer, template, version);
}

async function namedOnVersion(
  viewer: Viewer,
  template: { teamId: string; contentTypeId: string },
  version: ReviewVersionRow,
): Promise<boolean> {
  if (version.state === "in_review") {
    const stage = currentStageOf(version, await loadChain(db, template.contentTypeId));
    if (can(viewer, "template.view", { teamId: template.teamId, stageApproverIds: stageApproverIds(stage) }).ok) return true;
  }
  const decided = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.versionId, version.id), eq(approvals.actorId, viewer.userId)))
    .limit(1);
  return decided.length > 0;
}

// ── The approval chain ────────────────────────────────────────

type Reader = Pick<Db, "select">;

/** The content type's stages in order (configuration, not code). Never empty. */
export async function loadChain(reader: Reader, contentTypeId: string): Promise<ApprovalStage[]> {
  const rows = await reader
    .select({ id: approvalStages.id, position: approvalStages.position, name: approvalStages.name, rule: approvalStages.approverRule })
    .from(approvalStages)
    .where(eq(approvalStages.contentTypeId, contentTypeId))
    .orderBy(asc(approvalStages.position));
  return rows.length > 0 ? rows : DEFAULT_CHAIN.map((stage) => ({ ...stage }));
}

/** Every content type's chain at once (the queue spans templates of several types). */
export const getChains = cache(async (): Promise<ReadonlyMap<string, ApprovalStage[]>> => {
  const rows = await db
    .select({
      contentTypeId: approvalStages.contentTypeId,
      id: approvalStages.id,
      position: approvalStages.position,
      name: approvalStages.name,
      rule: approvalStages.approverRule,
    })
    .from(approvalStages)
    .orderBy(asc(approvalStages.position));
  const chains = new Map<string, ApprovalStage[]>();
  for (const { contentTypeId, ...stage } of rows) {
    const chain = chains.get(contentTypeId);
    if (chain) chain.push(stage);
    else chains.set(contentTypeId, [stage]);
  }
  return chains;
});

export function chainFor(chains: ReadonlyMap<string, ApprovalStage[]>, contentTypeId: string): ApprovalStage[] {
  return chains.get(contentTypeId) ?? DEFAULT_CHAIN.map((stage) => ({ ...stage }));
}

/**
 * The users a stage names (`{kind:"user"}` rules): they may open, decide and comment on the version
 * waiting on it, on any team (`PermissionResource.stageApproverIds`). Empty for a team-role stage.
 */
export function stageApproverIds(stage: ApprovalStage | null | undefined): string[] {
  return stage?.rule.kind === "user" ? [stage.rule.userId] : [];
}

/** Each version's decisions, by stage id (the "two stages need two people" guard reads them). */
export async function loadDecisions(reader: Reader, versionIds: readonly string[]): Promise<Map<string, RecordedDecision[]>> {
  const byVersion = new Map<string, RecordedDecision[]>();
  if (versionIds.length === 0) return byVersion;
  const rows = await reader
    .select({ versionId: approvals.versionId, stageId: approvals.stageId, actorId: approvals.actorId, decision: approvals.decision })
    .from(approvals)
    .where(inArray(approvals.versionId, [...versionIds]));
  for (const { versionId, ...decision } of rows) byVersion.set(versionId, [...(byVersion.get(versionId) ?? []), decision]);
  return byVersion;
}

/**
 * May the viewer approve, or request changes on, a version at its current stage (`currentStageOf`;
 * null when that stage has left the chain)? The role grant (or being named on the stage) and
 * maker-checker (its submitter and `writers`) come from `can("version.decide")`; the stage's own rule
 * from `canActOnStage`. With `approvedBy` (the approve check, from `approvedThisRound`), someone who
 * already approved a stage of the version is refused. The queue, the review screen and the actions all
 * ask this one question.
 */
export function decideCheck(
  viewer: Viewer,
  input: {
    teamId: string;
    submittedBy: string | null;
    writers: readonly string[];
    stage: ApprovalStage | null;
    approvedBy?: readonly string[];
  },
): PermissionResult {
  const permitted = can(viewer, "version.decide", {
    teamId: input.teamId,
    submittedBy: input.submittedBy,
    writers: input.writers,
    stageApproverIds: stageApproverIds(input.stage),
  });
  if (!permitted.ok) return permitted;
  if (!input.stage) return refuse(REFUSALS.stageMissing);
  const onStage = canActOnStage(viewer, input.stage, input.teamId);
  if (!onStage.ok) return onStage;
  return input.approvedBy?.includes(viewer.userId) ? refuse(REFUSALS.approvedEarlierStage) : onStage;
}

// ── Render-log usage ──────────────────────────────────────────

/**
 * Per consumer and version: the last render and the renders in the last 30 days. Registered consumers
 * only, previews excluded, failed renders included (they still show the consumer is on that version).
 * Newest version first, then by consumer name.
 */
export async function loadConsumerUsage(reader: Reader, templateId: string, nowDate: Date): Promise<ConsumerUsage[]> {
  const since = nowDate.getTime() - 30 * DAY_MS;
  const rows = await reader
    .select({
      consumerId: consumers.id,
      consumerName: consumers.name,
      versionNumber: renderLog.versionNumber,
      lastRenderAt: sql<number>`max(${renderLog.at})`,
      renders30d: sql<number>`sum(case when ${renderLog.at} >= ${since} then 1 else 0 end)`,
    })
    .from(renderLog)
    .innerJoin(consumers, eq(consumers.id, renderLog.consumerId))
    .where(and(eq(renderLog.templateId, templateId), eq(renderLog.isPreview, false), isNotNull(renderLog.versionNumber)))
    .groupBy(consumers.id, renderLog.versionNumber);

  return rows
    .map((r) => ({
      consumerId: r.consumerId,
      consumerName: r.consumerName,
      versionNumber: r.versionNumber!,
      lastRenderAt: new Date(Number(r.lastRenderAt)).toISOString(),
      renders30d: Number(r.renders30d ?? 0),
    }))
    .sort((a, b) => b.versionNumber - a.versionNumber || a.consumerName.localeCompare(b.consumerName));
}

// ── Documents ─────────────────────────────────────────────────

/** Every block id in a document, in reading order (top-level blocks and any nested ones that carry an id). */
export function blockIdsOf(doc: JSONContent | null | undefined): string[] {
  const ids: string[] = [];
  const walk = (node: JSONContent) => {
    const id = node.attrs?.id;
    if (typeof id === "string" && id !== "") ids.push(id);
    for (const child of node.content ?? []) walk(child);
  };
  if (doc) for (const block of doc.content ?? []) walk(block);
  return ids;
}
