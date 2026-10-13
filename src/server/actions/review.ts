"use server";

import { refresh, revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isCalendarDay } from "@/domain/dates";
import { approve } from "@/domain/lifecycle/approve";
import {
  cancelRevoke as cancelRevokeTransition,
  confirmRevoke as confirmRevokeTransition,
  startRevoke as startRevokeTransition,
} from "@/domain/lifecycle/revoke";
import { contractBaseline } from "@/domain/lifecycle/baselines";
import { requestChanges as requestChangesTransition } from "@/domain/lifecycle/request-changes";
import { submit } from "@/domain/lifecycle/submit";
import { withWriter } from "@/domain/lifecycle/drafts";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import type { ReviewVersion } from "@/domain/lifecycle/types";
import { REQUEST_REFUSALS, type Refused } from "@/domain/refusals";
import { OUTPUT_KEYS, type OutputKey } from "@/domain/review-outputs";
import {
  DOCUMENT_THREAD,
  type ActionResult,
  type LifecycleEffect,
} from "@/domain/review-types";
import { readBusinessZone } from "@/server/business-zone";
import {
  approvals,
  commentThreads,
  comments,
  versions,
} from "@/server/db/schema/ucomp";
import { writeEffects, type Tx } from "@/server/effects";
import { newId } from "@/server/ids";
import {
  loadChain,
  loadDecisions,
  loadMessageRules,
} from "@/server/queries/review-shared";
import { services } from "@/server/services";
import {
  activeVersion,
  assertStage,
  decideResource,
  effectContext,
  findTemplate,
  findVersion,
  loadVersion,
  updateVersion,
  type FoundVersion,
} from "@/server/services/local/version-rows";
import type { Changed } from "@/server/services/types";
import { draftRow } from "@/server/templates/create";
import { check, refuse, serverAction, type CommitContext } from "./kit";

// The review lifecycle: submit, request changes, approve, sunset, and the two-person revoke. A version is
// named by its number and, to decide it, its round (domain/rounds.ts): approve and request changes act on
// exactly the round the approver was shown; sunset and revoke act on the number's head (`findRound`),
// its released row, and the transition refuses any other state.
//
// `setSunset` runs behind the service interfaces: it parses its input and calls `services().review`, which
// does the rest (src/server/services/local/review.ts). The others still run here on the server action kit
// (kit.ts), with the version helpers the local implementation shares (services/local/version-rows.ts):
//   1. `authorize`: the version (or the template), read only to learn its team and its people, and
//      `check` on that team. An unknown one is refused like a forbidden one, and then as gone;
//   2. ONE transaction that re-reads the version, asks the domain transition (domain/lifecycle/),
//      writes the changes with a compare-and-set on state and rev, and writes the transition's
//      effects (audit, notifications, consumer notices) through server/effects.ts;
//   3. `after`: `refresh()`, so the page the person is on re-renders in place.
// A double click or a slower colleague finds the version already moved on: the second transition
// is refused with the domain's sentence and writes nothing.
//
// A "use server" file may export only async functions: the helpers below stay private.

const NOTE_MAX = 2000;
const REASON_MAX = 2000;

// ── Helpers ───────────────────────────────────────────────────

/** The pages a lifecycle change shows on: the Library rows, the template workspace, the review queue and screens. */
function refreshAfter() {
  revalidatePath("/[team]/library", "page");
  revalidatePath("/[team]/templates/[templateId]", "layout");
  revalidatePath("/[team]/review", "layout");
  refresh();
}

const TemplateRef = z.object({ templateId: z.string().min(1).max(32) });
const VersionRef = TemplateRef.extend({
  versionNumber: z.number().int().positive(),
});
/** A decision names the round it decides: the one on the approver's screen, never whichever is newest. */
const RoundRefInput = VersionRef.extend({ round: z.number().int().positive() });

// ── Submit for review ─────────────────────────────────────────

const SubmitInput = TemplateRef.extend({
  note: z.string().nullish(),
  rev: z.number().int().nonnegative(),
});

/**
 * "Submit v2" (or "Submit v1, round 2" after a send-back): the template's open draft becomes its next
 * round, In review, with the optional note to reviewers: round 1 of the next version after a release, or
 * the next round of the number sent back (`nextRound`). The first stage's approvers are notified. The
 * draft, the template's rows and the variables of the newest version that still renders
 * (`contractBaseline`: the Active one, or after a revoke the newest Superseded one before its sunset) are
 * read in the transaction that writes, so the number, the round and the contract changes can't go stale;
 * the rev and state in the update make it a compare-and-set, and the rev bump makes an autosave still in
 * flight fail rather than land on a frozen version.
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
}): Promise<ActionResult<{ number: number; round: number }>> {
  return serverAction(input, {
    input: SubmitInput,
    authorize: async ({ viewer, input }) => {
      const found = await findTemplate(input.templateId);
      check(viewer, "version.submit", { teamId: found?.teamId ?? null });
      if (!found) refuse(REQUEST_REFUSALS.templateGone);
      if ((input.note?.trim().length ?? 0) > NOTE_MAX)
        refuse(REQUEST_REFUSALS.noteTooLong(NOTE_MAX));
      return found;
    },
    transaction: async (tx, { viewer, input, found, now: at }) => {
      const list = await tx
        .select({
          id: versions.id,
          number: versions.number,
          round: versions.round,
          state: versions.state,
          sunsetAt: versions.sunsetAt,
        })
        .from(versions)
        .where(eq(versions.templateId, found.id));

      const open = list.find((v) => v.state === "draft");
      if (!open)
        refuse(
          list.some((v) => v.state === "in_review")
            ? REFUSALS.alreadyInReview
            : REQUEST_REFUSALS.noDraftToSubmit,
        );
      const draft = await tx.query.versions.findFirst({
        where: eq(versions.id, open.id),
      });
      if (!draft) refuse(REQUEST_REFUSALS.noDraftToSubmit);

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
        seenRev: input.rev,
        versions: list,
        baseline,
        now: at,
        submittedBy: viewer.userId,
        submitterName: viewer.name,
        templateId: found.id,
        templateName: draft.name,
        note: input.note ?? null,
        chain: await loadChain(tx, found.contentTypeId),
        messageRules: await loadMessageRules(tx, found.contentTypeId),
      });
      if (!outcome.ok) refuse(outcome);
      const { changes, effects } = outcome;

      await updateVersion(
        tx,
        draft,
        {
          state: changes.state,
          number: changes.number,
          round: changes.round,
          submittedBy: changes.submittedBy,
          submittedAt: changes.submittedAt,
          writers: changes.writers,
          submitNote: changes.submitNote,
          stages: changes.stages,
          currentStage: changes.currentStage,
          contractChanges: changes.contractChanges,
          smsFooter: changes.smsFooter,
        },
        at,
        REQUEST_REFUSALS.draftChanged,
      );
      // Submitting the next round answers the change request that sent the last one back (Sri, Oct 5):
      // open whole-version threads resolve as the submitter's, recording the round that answered them.
      // Block comments stay as they are; the author resolves those one by one.
      const answered = await tx
        .select({
          id: commentThreads.id,
          originVersionId: commentThreads.originVersionId,
        })
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
          .set({
            status: "resolved",
            resolvedBy: viewer.userId,
            resolvedAt: at,
          })
          .where(
            inArray(
              commentThreads.id,
              answered.map((t) => t.id),
            ),
          );
      }
      const answeredEffects: LifecycleEffect[] = answered.map((t) => ({
        kind: "audit",
        action: "thread.resolved",
        versionId: t.originVersionId,
        details: {
          threadId: t.id,
          blockId: DOCUMENT_THREAD,
          auto: true,
          resolvedWith: changes.number,
          resolvedWithRound: changes.round,
        },
      }));

      await writeEffects(
        tx,
        [...effects, ...answeredEffects],
        effectContext(
          viewer,
          { teamId: found.teamId, templateId: found.id },
          draft.id,
          at,
        ),
      );
      return { ok: true, number: changes.number, round: changes.round };
    },
    after: refreshAfter,
  });
}

// ── Request changes ───────────────────────────────────────────

const RequestChangesInput = RoundRefInput.extend({ reason: z.string() });

/**
 * In review → Changes requested, with the reason, on the round the approver was shown (`round`). In one
 * transaction: the decision (an approvals row), the version's state, the author's new draft (a copy of
 * the version with the same block ids, so every thread lands in its margin; its submit is the next round
 * of the same number), and the reason as a thread about the whole version (`DOCUMENT_THREAD`) whose first
 * comment is a `change_request`. The author is notified.
 */
export async function requestChanges(input: {
  templateId: string;
  versionNumber: number;
  round: number;
  reason: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: RequestChangesInput,
    authorize: async ({ viewer, input }) => {
      const found = await findVersion(
        input.templateId,
        input.versionNumber,
        input.round,
      );
      check(viewer, "version.decide", await decideResource(found));
      if (!found) refuse(REQUEST_REFUSALS.versionGone);
      if (input.reason.trim().length > REASON_MAX)
        refuse(REQUEST_REFUSALS.reasonTooLong(REASON_MAX));
      return found;
    },
    transaction: async (tx, { viewer, input, found, now: at }) => {
      const version = await loadVersion(
        tx,
        found,
        input.versionNumber,
        input.round,
      );
      const chain = await loadChain(tx, found.contentTypeId);
      assertStage(viewer, chain, version, found.teamId);

      const outcome = requestChangesTransition({
        version,
        chain,
        actorId: viewer.userId,
        actorName: viewer.name,
        reason: input.reason,
        now: at,
        templateName: version.name,
      });
      if (!outcome.ok) refuse(outcome);

      await updateVersion(
        tx,
        version,
        { state: outcome.changes.state },
        at,
        REFUSALS.notInReview,
      );
      await tx
        .insert(approvals)
        .values({ id: newId("ap"), ...outcome.approval });

      // A template has at most one open draft. There is none while a version is in review, but if one
      // exists the author keeps working in it rather than the request failing. It takes on the returned
      // version's writers, so none of them can decide what it becomes (maker-checker). Content isn't
      // touched, so `rev` stays and an autosave in flight still lands.
      const openDraft = await tx.query.versions.findFirst({
        columns: { id: true, writers: true },
        where: and(
          eq(versions.templateId, found.templateId),
          eq(versions.state, "draft"),
        ),
      });
      if (!openDraft) {
        await tx.insert(versions).values(
          draftRow(outcome.newDraft, {
            id: newId("v"),
            templateId: found.templateId,
          }),
        );
      } else {
        const writers = outcome.newDraft.writers.reduce(
          (all, userId) => withWriter(all, userId),
          openDraft.writers,
        );
        await tx
          .update(versions)
          .set({ writers })
          .where(
            and(eq(versions.id, openDraft.id), eq(versions.state, "draft")),
          );
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

      await writeEffects(
        tx,
        outcome.effects,
        effectContext(viewer, found, version.id, at),
      );
      return { ok: true };
    },
    after: refreshAfter,
  });
}

// ── Approve ───────────────────────────────────────────────────

const ApproveInput = RoundRefInput.extend({
  sunsetPrevious: z.string().nullish(),
  sampleSetsSeen: z.array(z.string().max(64)).max(50),
  /** The outputs the approver had rendered on screen in Preview: keys only (decision 0037). */
  outputsViewed: z.array(z.enum(OUTPUT_KEYS)).max(OUTPUT_KEYS.length * 2),
});

/**
 * Approves the stage the round on the approver's screen (`round`) waits on: one of the stages it recorded
 * at submit, with the rule that stage has in approval_stages now. A round that was sent back in the
 * meantime is refused as not in review. At an earlier stage the version moves on to the next of its own; at
 * the last it goes live: the previous Active version, if there is one, becomes Superseded first (one
 * Active per template), optionally with a sunset date, and the version becomes Active. With none (a
 * first version, or the correction after the Active version was revoked) nothing is superseded and a
 * sunset date is ignored. Consumers that render the template are sent a notice.
 *
 * The approver must have viewed every output of the round (`outputsViewed`): the transition works out
 * which from the round's own channels and refuses `output_not_viewed` while one is missing, and the
 * approval's audit row records the ones viewed (decision 0037).
 */
export async function approveVersion(input: {
  templateId: string;
  versionNumber: number;
  round: number;
  sunsetPrevious?: string | null;
  sampleSetsSeen: string[];
  outputsViewed: readonly OutputKey[];
}): Promise<
  ActionResult<{ wentLive: boolean; number: number; round: number }>
> {
  return serverAction(input, {
    input: ApproveInput,
    authorize: async ({ viewer, input }) => {
      const found = await findVersion(
        input.templateId,
        input.versionNumber,
        input.round,
      );
      check(viewer, "version.decide", await decideResource(found));
      if (!found) refuse(REQUEST_REFUSALS.versionGone);
      // A calendar day; the transition reads it in the business time zone (00:00 there ends renders).
      if (input.sunsetPrevious && !isCalendarDay(input.sunsetPrevious))
        refuse(REQUEST_REFUSALS.invalidDate);
      return found;
    },
    transaction: async (tx, { viewer, input, found, now: at }) => {
      const version = await loadVersion(
        tx,
        found,
        input.versionNumber,
        input.round,
      );
      const chain = await loadChain(tx, found.contentTypeId);
      assertStage(viewer, chain, version, found.teamId);
      const active = await activeVersion(tx, found.templateId);

      const outcome = approve({
        version,
        chain,
        actorId: viewer.userId,
        actorName: viewer.name,
        now: at,
        active:
          active && active.id !== version.id && active.number !== null
            ? { id: active.id, number: active.number }
            : null,
        sunsetPrevious: input.sunsetPrevious || null,
        zone: await readBusinessZone(tx),
        sampleSetsSeen: input.sampleSetsSeen,
        outputsViewed: input.outputsViewed,
        templateName: version.name,
        decisions:
          (await loadDecisions(tx, [version.id])).get(version.id) ?? [],
      });
      if (!outcome.ok) refuse(outcome);

      // The previous Active steps down before this one steps up (the one-Active index).
      if (outcome.previous) {
        const [superseded] = await tx
          .update(versions)
          .set({
            ...outcome.previous.changes,
            rev: sql`${versions.rev} + 1`,
            updatedAt: at,
          })
          .where(
            and(
              eq(versions.id, outcome.previous.id),
              eq(versions.state, "active"),
            ),
          )
          .returning({ id: versions.id });
        if (!superseded) refuse(REQUEST_REFUSALS.activeChanged);
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
      await tx
        .insert(approvals)
        .values({ id: newId("ap"), ...outcome.approval });
      await writeEffects(
        tx,
        outcome.effects,
        effectContext(viewer, found, version.id, at),
      );
      return {
        ok: true,
        wentLive: outcome.wentLive,
        number: version.number!,
        round: version.round!,
      };
    },
    after: refreshAfter,
  });
}

// ── Sunset ────────────────────────────────────────────────────

const SunsetInput = VersionRef.extend({ sunsetAt: z.string() });

/**
 * "Set sunset" on the Versions tab: the day (YYYY-MM-DD, `sunsetAt`) a Superseded version stops rendering,
 * at 00:00 in the business time zone (decision 0017). The service decides and writes it
 * (`ReviewService.setSunset`, which lists its refusals); the pages refresh only when it wrote something, so a
 * double click with the same day changes nothing on screen either.
 */
export async function setSunset(input: {
  templateId: string;
  versionNumber: number;
  sunsetAt: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: SunsetInput,
    call: (ctx, { templateId, versionNumber, sunsetAt }) =>
      services().review.setSunset(ctx, {
        templateId,
        versionNumber,
        sunsetDay: sunsetAt,
      }),
    after: ({ changed }) => {
      if (changed) refreshAfter();
    },
  }).then(withoutChanged);
}

/** The action answers `{ ok: true }`: whether the service wrote is the kit's business (`after`), not the page's. */
function withoutChanged(result: ActionResult<Changed>): ActionResult {
  return result.ok ? { ok: true } : result;
}

// ── Revoke (two people) ───────────────────────────────────────

const StartRevokeInput = VersionRef.extend({ reason: z.string() });

/** One approver starts a revoke with a reason. Nothing stops rendering until another approver confirms. */
export async function startRevoke(input: {
  templateId: string;
  versionNumber: number;
  reason: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: StartRevokeInput,
    authorize: async ({ viewer, input }) => {
      const found = await findVersion(input.templateId, input.versionNumber);
      check(viewer, "version.revoke.start", { teamId: found?.teamId ?? null });
      if (!found) refuse(REQUEST_REFUSALS.versionGone);
      if (input.reason.trim().length > REASON_MAX)
        refuse(REQUEST_REFUSALS.reasonTooLong(REASON_MAX));
      return found;
    },
    transaction: revokeStep((version, { viewer, input, now: at }) =>
      startRevokeTransition({
        version,
        actorId: viewer.userId,
        actorName: viewer.name,
        reason: input.reason,
        now: at,
        templateName: version.name,
      }),
    ),
    after: refreshAfter,
  });
}

/** A different approver confirms the revoke: the version is Revoked and its renders fail at once. */
export async function confirmRevoke(input: {
  templateId: string;
  versionNumber: number;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: VersionRef,
    authorize: async ({ viewer, input }) => {
      const found = await findVersion(input.templateId, input.versionNumber);
      check(viewer, "version.revoke.confirm", {
        teamId: found?.teamId ?? null,
        revokeStartedBy:
          found?.revoke && !found.revoke.confirmedAt
            ? found.revoke.startedBy
            : null,
      });
      if (!found) refuse(REQUEST_REFUSALS.versionGone);
      return found;
    },
    transaction: revokeStep(async (version, { viewer, found, now: at }, tx) => {
      const active = await activeVersion(tx, found.templateId);
      return confirmRevokeTransition({
        version,
        actorId: viewer.userId,
        actorName: viewer.name,
        now: at,
        activeNumber: active?.number ?? null,
        templateName: version.name,
      });
    }),
    after: refreshAfter,
  });
}

/**
 * Withdraws a pending revoke. Any approver who may start one may cancel one: the starter (a mistake)
 * or another approver declining to confirm. Cancelling returns to the safe state (the version keeps
 * rendering), so the two-person rule that guards confirming doesn't apply.
 */
export async function cancelRevoke(input: {
  templateId: string;
  versionNumber: number;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: VersionRef,
    authorize: async ({ viewer, input }) => {
      const found = await findVersion(input.templateId, input.versionNumber);
      check(viewer, "version.revoke.start", { teamId: found?.teamId ?? null });
      if (!found) refuse(REQUEST_REFUSALS.versionGone);
      return found;
    },
    transaction: revokeStep((version, { viewer, now: at }) =>
      cancelRevokeTransition({ version, actorId: viewer.userId, now: at }),
    ),
    after: refreshAfter,
  });
}

type RevokeOutcome =
  | {
      ok: true;
      changes: Partial<Pick<typeof versions.$inferInsert, "state" | "revoke">>;
      effects: LifecycleEffect[];
    }
  | Refused;

/** The three revoke steps share their transaction: read, transition, compare-and-set, effects. */
function revokeStep<I extends { versionNumber: number }>(
  transition: (
    version: ReviewVersion,
    ctx: CommitContext<I, FoundVersion>,
    tx: Tx,
  ) => RevokeOutcome | Promise<RevokeOutcome>,
) {
  return async (
    tx: Tx,
    ctx: CommitContext<I, FoundVersion>,
  ): Promise<ActionResult> => {
    const version = await loadVersion(tx, ctx.found, ctx.input.versionNumber);
    const outcome = await transition(version, ctx, tx);
    if (!outcome.ok) refuse(outcome);
    await updateVersion(
      tx,
      version,
      outcome.changes,
      ctx.now,
      REFUSALS.noRevokePending,
    );
    await writeEffects(
      tx,
      outcome.effects,
      effectContext(ctx.viewer, ctx.found, version.id, ctx.now),
    );
    return { ok: true };
  };
}
