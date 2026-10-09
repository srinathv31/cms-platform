"use server";

import { refresh, revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { canActOnStage, stageAt } from "@/domain/approval-chain";
import {
  approve,
  cancelRevoke as cancelRevokeTransition,
  confirmRevoke as confirmRevokeTransition,
  contractBaseline,
  requestChanges as requestChangesTransition,
  setSunset as setSunsetTransition,
  startRevoke as startRevokeTransition,
  submit,
  sunsetPassed,
  withWriter,
  REFUSALS,
  type DraftFields,
  type ReviewVersion,
} from "@/domain/lifecycle";
import { PermissionError, assertCan } from "@/domain/permissions";
import { DOCUMENT_THREAD, type ActionResult, type ApprovalStage, type LifecycleEffect } from "@/domain/review-types";
import type { Action, PermissionResource, Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { approvals, commentThreads, comments, templates, versions } from "@/server/db/schema/ucomp";
import { inTransaction, writeEffects, type Tx } from "@/server/effects";
import { newId } from "@/server/ids";
import { loadApprovedBy, loadChain, stageApproverIds, waitingStage } from "@/server/queries/review-shared";
import { getViewer } from "@/server/viewer";

// The review lifecycle: submit, request changes, approve, sunset, and the two-person revoke.
//
// Every action has the same shape:
//   1. `assertCan` on the template's team (a refusal is returned, not thrown);
//   2. ONE transaction that re-reads the version, asks the domain transition (domain/lifecycle.ts),
//      writes the changes with a compare-and-set on state and rev, and writes the transition's
//      effects (audit, notifications, consumer notices) through server/effects.ts;
//   3. `refresh()`, so the page the person is on re-renders in place.
// A double click or a slower colleague finds the version already moved on: the second transition
// is refused with the domain's sentence and writes nothing. SQLITE_BUSY is retried (`inTransaction`).
//
// A "use server" file may export only async functions: the helpers below stay private.

const NOTE_MAX = 2000;
const REASON_MAX = 2000;

const REASONS = {
  noTemplate: "This template no longer exists.",
  noVersion: "This version no longer exists.",
  noDraft: "There is no draft to submit.",
  draftChanged: "This draft changed. Try again.",
  noteTooLong: `Keep the note under ${NOTE_MAX.toLocaleString("en-US")} characters.`,
  reasonTooLong: `Keep the reason under ${REASON_MAX.toLocaleString("en-US")} characters.`,
  badDate: "Pick a valid date.",
  activeChanged: "The Active version changed. Try again.",
} as const;

// ── Helpers ───────────────────────────────────────────────────

/** A refusal raised inside a transaction: it rolls the transaction back and becomes the answer. */
class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "Refusal";
  }
}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

/** `assertCan`, with the refusal returned as the action's answer instead of thrown. */
function check(viewer: Viewer, action: Action, resource: PermissionResource): { ok: false; reason: string } | null {
  try {
    assertCan(viewer, action, resource);
    return null;
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, reason: error.reason };
    throw error;
  }
}

/** One transaction, retried when busy; a `Refusal` anywhere in it rolls it back and is returned. */
async function transact<T extends object>(run: (tx: Tx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await inTransaction(db, run);
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason };
    throw error;
  }
}

/** The pages a lifecycle change shows on: the Library rows, the template workspace, the review queue and screens. */
function refreshAfter() {
  revalidatePath("/[team]/library", "page");
  revalidatePath("/[team]/templates/[templateId]", "layout");
  revalidatePath("/[team]/review", "layout");
  refresh();
}

const TemplateRef = z.object({ templateId: z.string().min(1).max(32) });
const VersionRef = TemplateRef.extend({ versionNumber: z.number().int().positive() });

/** The template, read only to learn its team (and the version's people) for the permission check. */
async function findTemplate(templateId: string) {
  return db
    .select({ id: templates.id, teamId: templates.teamId, contentTypeId: templates.contentTypeId })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
    .then((rows) => rows[0]);
}

async function findVersion(templateId: string, number: number) {
  return db
    .select({
      templateId: templates.id,
      teamId: templates.teamId,
      contentTypeId: templates.contentTypeId,
      submittedBy: versions.submittedBy,
      writers: versions.writers,
      revoke: versions.revoke,
      state: versions.state,
      currentStage: versions.currentStage,
    })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .where(and(eq(versions.templateId, templateId), eq(versions.number, number)))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * The decide check's resource: the team, who submitted and wrote the version (maker-checker), and the
 * users the stage the version waits on names (they decide it on any team). The stage is read again in the
 * transaction.
 */
async function decideResource(found: FoundVersion | undefined): Promise<PermissionResource> {
  if (!found) return { teamId: null };
  const named =
    found.state === "in_review" ? stageApproverIds(waitingStage(await loadChain(db, found.contentTypeId), found.currentStage)) : [];
  return { teamId: found.teamId, submittedBy: found.submittedBy, writers: found.writers, stageApproverIds: named };
}

type FoundVersion = NonNullable<Awaited<ReturnType<typeof findVersion>>>;

/** The version as the transitions read it (a whole row), fresh inside the transaction. */
async function loadVersion(tx: Tx, found: FoundVersion, number: number) {
  const row = await tx.query.versions.findFirst({
    where: and(eq(versions.templateId, found.templateId), eq(versions.number, number)),
  });
  if (!row) refuse(REASONS.noVersion);
  return row satisfies ReviewVersion;
}

async function templateName(tx: Tx, templateId: string): Promise<string> {
  const row = await tx.select({ name: templates.name }).from(templates).where(eq(templates.id, templateId)).limit(1);
  return row[0]?.name ?? templateId;
}

async function activeVersion(tx: Tx, templateId: string) {
  return tx.query.versions.findFirst({
    columns: { id: true, number: true, contractChanges: true },
    where: and(eq(versions.templateId, templateId), eq(versions.state, "active")),
  });
}

/** The stage's own rule (who it names), asked of the stage the version waits on now. */
function assertStage(viewer: Viewer, chain: readonly ApprovalStage[], version: ReviewVersion, teamId: string) {
  if (version.state !== "in_review") return; // the transition refuses with its own sentence
  const stage = stageAt(chain, version.currentStage);
  if (!stage) return;
  const result = canActOnStage(viewer, stage, teamId);
  if (!result.ok) refuse(result.reason);
}

/**
 * Compare-and-set: the update lands only if the row still has the state, rev and stage it was read
 * with. Inside the transaction nothing can interleave, so a miss means the caller's read was wrong;
 * it is refused rather than written over.
 */
async function updateVersion(
  tx: Tx,
  version: { id: string; state: ReviewVersion["state"]; rev: number; currentStage: number },
  set: Partial<typeof versions.$inferInsert>,
  at: Date,
  whenMissed: string,
) {
  const [saved] = await tx
    .update(versions)
    .set({ ...set, rev: sql`${versions.rev} + 1`, updatedAt: at })
    .where(
      and(
        eq(versions.id, version.id),
        eq(versions.state, version.state),
        eq(versions.rev, version.rev),
        eq(versions.currentStage, version.currentStage),
      ),
    )
    .returning({ id: versions.id });
  if (!saved) refuse(whenMissed);
}

function draftRow(draft: DraftFields, ids: { id: string; templateId: string }) {
  return {
    id: ids.id,
    templateId: ids.templateId,
    number: draft.number,
    state: draft.state,
    basedOnVersionId: draft.basedOnVersionId,
    body: draft.body,
    emailSubject: draft.emailSubject,
    emailPreheader: draft.emailPreheader,
    channels: draft.channels,
    variables: draft.variables,
    sampleSets: draft.sampleSets,
    contractChanges: draft.contractChanges,
    currentStage: draft.currentStage,
    rev: draft.rev,
    createdBy: draft.createdBy,
    writers: draft.writers,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

/** "2027-03-01" → that day's midnight UTC (the transitions compare whole UTC days). */
function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function effectContext(viewer: Viewer, found: { teamId: string; templateId: string }, versionId: string, at: Date) {
  return { at, actorId: viewer.userId, teamId: found.teamId, templateId: found.templateId, versionId };
}

// ── Submit for review ─────────────────────────────────────────

const SubmitInput = TemplateRef.extend({ note: z.string().nullish(), rev: z.number().int().nonnegative() });

/**
 * "Submit v2": the template's open draft becomes its next version, In review, with the optional note
 * to reviewers. The first stage's approvers are notified. The draft, the highest number and the
 * variables of the newest version that still renders (`contractBaseline`: the Active one, or after a
 * revoke the newest Superseded one before its sunset) are read in the transaction that writes, so the
 * number and the contract changes can't go stale; the rev and state in the update make it a
 * compare-and-set, and the rev bump makes an autosave still in flight fail rather than land on a
 * frozen version.
 *
 * `rev` is the draft's rev from the submit summary the author saw (`getSubmitSummary`). A draft that
 * has changed since, by a save from this page or any other, is refused (`REFUSALS.summaryStale`), so
 * submit freezes only what the dialog showed.
 *
 * Stays on the page (the workspace re-renders in place). A refusal (an undefined chip, no email subject,
 * already in review, a stale summary) writes nothing and comes back as the sentence to show. The client
 * flushes the pending autosave first.
 */
export async function submitVersion(input: {
  templateId: string;
  note?: string | null;
  rev: number;
}): Promise<ActionResult<{ number: number }>> {
  const viewer = await getViewer();
  const parsed = SubmitInput.safeParse(input);
  const found = parsed.success ? await findTemplate(parsed.data.templateId) : undefined;
  const refused = check(viewer, "version.submit", { teamId: found?.teamId ?? null });
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noTemplate };
  if ((parsed.data.note?.trim().length ?? 0) > NOTE_MAX) return { ok: false, reason: REASONS.noteTooLong };

  const at = await now();
  const result = await transact<{ number: number }>(async (tx) => {
    const list = await tx
      .select({ id: versions.id, number: versions.number, state: versions.state, sunsetAt: versions.sunsetAt })
      .from(versions)
      .where(eq(versions.templateId, found.id));

    const open = list.find((v) => v.state === "draft");
    if (!open) refuse(list.some((v) => v.state === "in_review") ? "This version is already in review." : REASONS.noDraft);
    const draft = await tx.query.versions.findFirst({ where: eq(versions.id, open.id) });
    if (!draft) refuse(REASONS.noDraft);

    const baselineId = contractBaseline(list, at)?.id;
    const baseline = baselineId
      ? await tx
          .select({ variables: versions.variables })
          .from(versions)
          .where(eq(versions.id, baselineId))
          .then((rows) => rows[0]?.variables ?? null)
      : null;

    const outcome = submit({
      draft,
      seenRev: parsed.data.rev,
      highestNumber: list.reduce((max, v) => Math.max(max, v.number ?? 0), 0),
      baseline,
      now: at,
      submittedBy: viewer.userId,
      submitterName: viewer.name,
      templateId: found.id,
      templateName: await templateName(tx, found.id),
      note: parsed.data.note ?? null,
      chain: await loadChain(tx, found.contentTypeId),
    });
    if (!outcome.ok) refuse(outcome.reason);
    const { changes, effects } = outcome;

    await updateVersion(
      tx,
      draft,
      {
        state: changes.state,
        number: changes.number,
        submittedBy: changes.submittedBy,
        submittedAt: changes.submittedAt,
        writers: changes.writers,
        submitNote: changes.submitNote,
        currentStage: changes.currentStage,
        contractChanges: changes.contractChanges,
      },
      at,
      REASONS.draftChanged,
    );
    // Submitting the next version answers the change request that sent the last one back (Sri, Oct 5):
    // open whole-version threads resolve as the submitter's, recording the version that answered them.
    // Block comments stay as they are; the author resolves those one by one.
    const answered = await tx
      .select({ id: commentThreads.id, originVersionId: commentThreads.originVersionId })
      .from(commentThreads)
      .where(
        and(
          eq(commentThreads.templateId, found.id),
          eq(commentThreads.blockId, DOCUMENT_THREAD),
          eq(commentThreads.status, "open"),
        ),
      );
    if (answered.length > 0) {
      await tx
        .update(commentThreads)
        .set({ status: "resolved", resolvedBy: viewer.userId, resolvedAt: at })
        .where(inArray(commentThreads.id, answered.map((t) => t.id)));
    }
    const answeredEffects: LifecycleEffect[] = answered.map((t) => ({
      kind: "audit",
      action: "thread.resolved",
      versionId: t.originVersionId,
      details: { threadId: t.id, blockId: DOCUMENT_THREAD, auto: true, resolvedWith: changes.number },
    }));

    await writeEffects(
      tx,
      [...effects, ...answeredEffects],
      effectContext(viewer, { teamId: found.teamId, templateId: found.id }, draft.id, at),
    );
    return { ok: true, number: changes.number };
  });

  if (result.ok) refreshAfter();
  return result;
}

// ── Request changes ───────────────────────────────────────────

const RequestChangesInput = VersionRef.extend({ reason: z.string() });

/**
 * In review → Changes requested, with the reason. In one transaction: the decision (an approvals row),
 * the version's state, the author's new draft (a copy of the version with the same block ids, so every
 * thread lands in its margin), and the reason as a thread about the whole version (`DOCUMENT_THREAD`)
 * whose first comment is a `change_request`. The author is notified.
 */
export async function requestChanges(input: {
  templateId: string;
  versionNumber: number;
  reason: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = RequestChangesInput.safeParse(input);
  const found = parsed.success ? await findVersion(parsed.data.templateId, parsed.data.versionNumber) : undefined;
  const refused = check(viewer, "version.decide", await decideResource(found));
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noVersion };
  if (parsed.data.reason.trim().length > REASON_MAX) return { ok: false, reason: REASONS.reasonTooLong };

  const at = await now();
  const result = await transact(async (tx) => {
    const version = await loadVersion(tx, found, parsed.data.versionNumber);
    const chain = await loadChain(tx, found.contentTypeId);
    assertStage(viewer, chain, version, found.teamId);

    const outcome = requestChangesTransition({
      version,
      chain,
      actorId: viewer.userId,
      actorName: viewer.name,
      reason: parsed.data.reason,
      now: at,
      templateName: await templateName(tx, found.templateId),
    });
    if (!outcome.ok) refuse(outcome.reason);

    await updateVersion(tx, version, { state: outcome.changes.state }, at, REFUSALS.notInReview);
    await tx.insert(approvals).values({ id: newId("ap"), ...outcome.approval });

    // A template has at most one open draft. There is none while a version is in review, but if one
    // exists the author keeps working in it rather than the request failing. It takes on the returned
    // version's writers, so none of them can decide what it becomes (maker-checker). Content isn't
    // touched, so `rev` stays and an autosave in flight still lands.
    const openDraft = await tx.query.versions.findFirst({
      columns: { id: true, writers: true },
      where: and(eq(versions.templateId, found.templateId), eq(versions.state, "draft")),
    });
    if (!openDraft) {
      await tx.insert(versions).values(draftRow(outcome.newDraft, { id: newId("v"), templateId: found.templateId }));
    } else {
      const writers = outcome.newDraft.writers.reduce((all, userId) => withWriter(all, userId), openDraft.writers);
      await tx
        .update(versions)
        .set({ writers })
        .where(and(eq(versions.id, openDraft.id), eq(versions.state, "draft")));
    }

    const threadId = newId("th");
    await tx.insert(commentThreads).values({
      id: threadId,
      templateId: found.templateId,
      originVersionId: version.id,
      blockId: outcome.reasonComment.blockId,
      quote: null,
      status: "open",
      createdAt: at,
    });
    await tx.insert(comments).values({
      id: newId("cm"),
      threadId,
      authorId: viewer.userId,
      body: outcome.reasonComment.body,
      kind: outcome.reasonComment.kind,
      createdAt: at,
    });

    await writeEffects(tx, outcome.effects, effectContext(viewer, found, version.id, at));
    return { ok: true };
  });

  if (result.ok) refreshAfter();
  return result;
}

// ── Approve ───────────────────────────────────────────────────

const ApproveInput = VersionRef.extend({
  sunsetPrevious: z.string().nullish(),
  sampleSetsSeen: z.array(z.string().max(64)).max(50),
});

/**
 * Approves the stage the version waits on (the content type's chain, from approval_stages). At an
 * earlier stage the version moves on to the next; at the last it goes live: the previous Active
 * version, if there is one, becomes Superseded first (one Active per template), optionally with a
 * sunset date, and the version becomes Active. With none (a first version, or the correction after the
 * Active version was revoked) nothing is superseded and a sunset date is ignored. Consumers that render
 * the template are sent a notice.
 */
export async function approveVersion(input: {
  templateId: string;
  versionNumber: number;
  sunsetPrevious?: string | null;
  sampleSetsSeen: string[];
}): Promise<ActionResult<{ wentLive: boolean; number: number }>> {
  const viewer = await getViewer();
  const parsed = ApproveInput.safeParse(input);
  const found = parsed.success ? await findVersion(parsed.data.templateId, parsed.data.versionNumber) : undefined;
  const refused = check(viewer, "version.decide", await decideResource(found));
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noVersion };

  const sunsetPrevious = parsed.data.sunsetPrevious ? parseDay(parsed.data.sunsetPrevious) : null;
  if (parsed.data.sunsetPrevious && !sunsetPrevious) return { ok: false, reason: REASONS.badDate };

  const at = await now();
  const result = await transact<{ wentLive: boolean; number: number }>(async (tx) => {
    const version = await loadVersion(tx, found, parsed.data.versionNumber);
    const chain = await loadChain(tx, found.contentTypeId);
    assertStage(viewer, chain, version, found.teamId);
    const active = await activeVersion(tx, found.templateId);

    const outcome = approve({
      version,
      chain,
      actorId: viewer.userId,
      actorName: viewer.name,
      now: at,
      active: active && active.id !== version.id && active.number !== null ? { id: active.id, number: active.number } : null,
      sunsetPrevious,
      sampleSetsSeen: parsed.data.sampleSetsSeen,
      templateName: await templateName(tx, found.templateId),
      approvedBy: (await loadApprovedBy(tx, [version.id])).get(version.id) ?? [],
    });
    if (!outcome.ok) refuse(outcome.reason);

    // The previous Active steps down before this one steps up (the one-Active index).
    if (outcome.previous) {
      const [superseded] = await tx
        .update(versions)
        .set({ ...outcome.previous.changes, rev: sql`${versions.rev} + 1`, updatedAt: at })
        .where(and(eq(versions.id, outcome.previous.id), eq(versions.state, "active")))
        .returning({ id: versions.id });
      if (!superseded) refuse(REASONS.activeChanged);
    }

    const { changes } = outcome;
    await updateVersion(
      tx,
      version,
      {
        state: changes.state,
        currentStage: changes.currentStage,
        ...(changes.activatedAt ? { activatedAt: changes.activatedAt } : {}),
      },
      at,
      REFUSALS.notInReview,
    );
    await tx.insert(approvals).values({ id: newId("ap"), ...outcome.approval });
    await writeEffects(tx, outcome.effects, effectContext(viewer, found, version.id, at));
    return { ok: true, wentLive: outcome.wentLive, number: version.number! };
  });

  if (result.ok) refreshAfter();
  return result;
}

// ── Sunset ────────────────────────────────────────────────────

const SunsetInput = VersionRef.extend({ sunsetAt: z.string() });

/**
 * Sets, or moves, the date a Superseded version stops rendering (YYYY-MM-DD, after today on the demo
 * clock). Consumers still rendering the template get a notice with the date and the contract changes
 * the Active version brought. Setting the date it already has writes nothing (a double click). Once
 * the sunset has passed, the transition refuses any date: the version is read again in the transaction,
 * so a sunset that passed while the dialog was open is refused too.
 */
export async function setSunset(input: {
  templateId: string;
  versionNumber: number;
  sunsetAt: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = SunsetInput.safeParse(input);
  const found = parsed.success ? await findVersion(parsed.data.templateId, parsed.data.versionNumber) : undefined;
  const refused = check(viewer, "version.setSunset", { teamId: found?.teamId ?? null });
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noVersion };
  const sunsetAt = parseDay(parsed.data.sunsetAt);
  if (!sunsetAt) return { ok: false, reason: REASONS.badDate };

  const at = await now();
  let wrote = false;
  const result = await transact(async (tx) => {
    const version = await loadVersion(tx, found, parsed.data.versionNumber);
    const unchanged = version.sunsetAt?.getTime() === sunsetAt.getTime();
    if (version.state === "superseded" && unchanged && !sunsetPassed(version, at)) return { ok: true };
    const active = await activeVersion(tx, found.templateId);

    const outcome = setSunsetTransition({
      version,
      actorId: viewer.userId,
      now: at,
      sunsetAt,
      activeNumber: active?.number ?? null,
      templateName: await templateName(tx, found.templateId),
      contractChanges: active?.contractChanges ?? null,
    });
    if (!outcome.ok) refuse(outcome.reason);

    await updateVersion(tx, version, outcome.changes, at, REFUSALS.sunsetNotSuperseded);
    await writeEffects(tx, outcome.effects, effectContext(viewer, found, version.id, at));
    wrote = true;
    return { ok: true };
  });

  if (result.ok && wrote) refreshAfter();
  return result;
}

// ── Revoke (two people) ───────────────────────────────────────

const StartRevokeInput = VersionRef.extend({ reason: z.string() });

/** One approver starts a revoke with a reason. Nothing stops rendering until another approver confirms. */
export async function startRevoke(input: {
  templateId: string;
  versionNumber: number;
  reason: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = StartRevokeInput.safeParse(input);
  const found = parsed.success ? await findVersion(parsed.data.templateId, parsed.data.versionNumber) : undefined;
  const refused = check(viewer, "version.revoke.start", { teamId: found?.teamId ?? null });
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noVersion };
  if (parsed.data.reason.trim().length > REASON_MAX) return { ok: false, reason: REASONS.reasonTooLong };

  return revokeStep(viewer, found, parsed.data.versionNumber, (version, at, name) =>
    startRevokeTransition({
      version,
      actorId: viewer.userId,
      actorName: viewer.name,
      reason: parsed.data.reason,
      now: at,
      templateName: name,
    }),
  );
}

/** A different approver confirms the revoke: the version is Revoked and its renders fail at once. */
export async function confirmRevoke(input: { templateId: string; versionNumber: number }): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = VersionRef.safeParse(input);
  const found = parsed.success ? await findVersion(parsed.data.templateId, parsed.data.versionNumber) : undefined;
  const refused = check(viewer, "version.revoke.confirm", {
    teamId: found?.teamId ?? null,
    revokeStartedBy: found?.revoke && !found.revoke.confirmedAt ? found.revoke.startedBy : null,
  });
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noVersion };

  return revokeStep(viewer, found, parsed.data.versionNumber, async (version, at, name, tx) => {
    const active = await activeVersion(tx, found.templateId);
    return confirmRevokeTransition({
      version,
      actorId: viewer.userId,
      actorName: viewer.name,
      now: at,
      activeNumber: active?.number ?? null,
      templateName: name,
    });
  });
}

/**
 * Withdraws a pending revoke. Any approver who may start one may cancel one: the starter (a mistake)
 * or another approver declining to confirm. Cancelling returns to the safe state (the version keeps
 * rendering), so the two-person rule that guards confirming doesn't apply.
 */
export async function cancelRevoke(input: { templateId: string; versionNumber: number }): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = VersionRef.safeParse(input);
  const found = parsed.success ? await findVersion(parsed.data.templateId, parsed.data.versionNumber) : undefined;
  const refused = check(viewer, "version.revoke.start", { teamId: found?.teamId ?? null });
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noVersion };

  return revokeStep(viewer, found, parsed.data.versionNumber, (version, at) =>
    cancelRevokeTransition({ version, actorId: viewer.userId, now: at }),
  );
}

type RevokeOutcome =
  | { ok: true; changes: Partial<Pick<typeof versions.$inferInsert, "state" | "revoke">>; effects: LifecycleEffect[] }
  | { ok: false; reason: string };

/** The three revoke steps share their transaction: read, transition, compare-and-set, effects. */
async function revokeStep(
  viewer: Viewer,
  found: FoundVersion,
  number: number,
  transition: (version: ReviewVersion, at: Date, templateName: string, tx: Tx) => RevokeOutcome | Promise<RevokeOutcome>,
): Promise<ActionResult> {
  const at = await now();
  const result = await transact(async (tx) => {
    const version = await loadVersion(tx, found, number);
    const outcome = await transition(version, at, await templateName(tx, found.templateId), tx);
    if (!outcome.ok) refuse(outcome.reason);
    await updateVersion(tx, version, outcome.changes, at, REFUSALS.noRevokePending);
    await writeEffects(tx, outcome.effects, effectContext(viewer, found, version.id, at));
    return { ok: true };
  });

  if (result.ok) refreshAfter();
  return result;
}
