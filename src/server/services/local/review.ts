import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { isCalendarDay } from "@/domain/dates";
import { approve, replacedActive } from "@/domain/lifecycle/approve";
import { contractBaseline } from "@/domain/lifecycle/baselines";
import { withWriters } from "@/domain/lifecycle/drafts";
import { noteRefusal, reasonRefusal } from "@/domain/lifecycle/helpers";
import { requestChanges } from "@/domain/lifecycle/request-changes";
import {
  cancelRevoke,
  confirmRevoke,
  startRevoke,
} from "@/domain/lifecycle/revoke";
import {
  answerChangeRequests,
  draftToSubmit,
  submit,
  submitFacts,
} from "@/domain/lifecycle/submit";
import {
  setSunset as setSunsetTransition,
  sunsetUnchanged,
} from "@/domain/lifecycle/sunset";
import type { ReviewVersion } from "@/domain/lifecycle/types";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS, type Refused } from "@/domain/refusals";
import {
  DOCUMENT_THREAD,
  type ActionResult,
  type LifecycleEffect,
} from "@/domain/review-types";
import type { Action, Viewer } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  approvals,
  commentThreads,
  comments,
  versions,
} from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import { refusal } from "../results";
import type { ReviewService, VersionRef } from "../review";
import type { Changed } from "../types";
import { readBusinessZone } from "./business-zone";
import { loadChain, loadDecisions, loadMessageRules } from "./chain";
import { check, refuse, runCommand, type LocalDeps } from "./command";
import { writeEffects } from "./effects";
import type { Tx } from "./transaction";
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
} from "./version-rows";

// The review lifecycle on this app's own database (src/server/services/review.ts says what each command
// promises, and its refusals in order). Each runs on the command kit (./command.ts): `authorize` reads the
// version (or the template) only to learn its team and its people and checks the permission; the one
// transaction re-reads it, asks the domain (src/domain/lifecycle), writes the changes with a compare-and-set on
// state, rev and stage (`updateVersion`, ./version-rows.ts), and writes the transition's effects through
// ./effects.ts, all dated by the backend's clock.

export function localReview(
  deps: LocalDeps,
): Omit<ReviewService, "queue" | "badgeCount" | "screen"> {
  /** The three revoke steps: the head, its permission, then read, transition, compare-and-set, effects. */
  const revokeCommand = <I extends VersionRef>(
    ctx: Parameters<ReviewService["startRevoke"]>[0],
    input: I,
    steps: {
      action: Action;
      resource?: (found: FoundVersion) => { revokeStartedBy: string | null };
      check?: (input: I) => void;
      transition: (
        version: ReviewVersion,
        c: { viewer: Viewer; input: I; found: FoundVersion; now: Date },
        tx: Tx,
      ) => Promise<RevokeOutcome> | RevokeOutcome;
    },
  ) =>
    runCommand(deps, ctx, input, {
      authorize: async ({ ctx, input }) => {
        const found = await findVersion(input.templateId, input.versionNumber);
        check(ctx.viewer, steps.action, {
          teamId: found?.teamId ?? null,
          ...(found && steps.resource?.(found)),
        });
        if (!found) refuse(REQUEST_REFUSALS.versionGone);
        steps.check?.(input);
        return found;
      },
      transaction: async (tx, { ctx, input, found, now }) => {
        const version = await loadVersion(tx, found, input.versionNumber);
        const outcome = await steps.transition(
          version,
          { viewer: ctx.viewer, input, found, now },
          tx,
        );
        if (!outcome.ok) refuse(outcome);
        await updateVersion(tx, version, outcome.changes, now, deps.hooks);
        await writeEffects(
          tx,
          outcome.effects,
          effectContext(ctx.viewer, found, version.id, now),
        );
        return { ok: true };
      },
    });

  return {
    setSunset: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const found = await findVersion(
            input.templateId,
            input.versionNumber,
          );
          check(ctx.viewer, "version.setSunset", {
            teamId: found?.teamId ?? null,
          });
          if (!found) refuse(REQUEST_REFUSALS.versionGone);
          if (!isCalendarDay(input.sunsetDay))
            refuse(REQUEST_REFUSALS.invalidDate);
          return found;
        },
        transaction: async (
          tx,
          { ctx, input, found, now },
        ): Promise<ActionResult<Changed>> => {
          const version = await loadVersion(tx, found, input.versionNumber);
          const zone = await readBusinessZone(tx);
          if (sunsetUnchanged(version, input.sunsetDay, zone, now))
            return { ok: true, changed: false };
          const active = await activeVersion(tx, found.templateId);

          const outcome = setSunsetTransition({
            version,
            actorId: ctx.viewer.userId,
            now,
            sunsetDay: input.sunsetDay,
            zone,
            activeNumber: active?.number ?? null,
            templateName: version.name,
            contractChanges: active?.contractChanges ?? null,
          });
          if (!outcome.ok) refuse(outcome);

          await updateVersion(tx, version, outcome.changes, now, deps.hooks);
          await writeEffects(
            tx,
            outcome.effects,
            effectContext(ctx.viewer, found, version.id, now),
          );
          return { ok: true, changed: true };
        },
      }),

    submit: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const found = await findTemplate(input.templateId);
          check(ctx.viewer, "version.submit", {
            teamId: found?.teamId ?? null,
          });
          if (!found) refuse(REQUEST_REFUSALS.templateGone);
          const long = noteRefusal(input.note);
          if (long) refuse(long);
          return found;
        },
        transaction: async (tx, { ctx, input, found, now }) => {
          // The template's rows and its draft are read in the transaction that writes, so the number, the round
          // and the contract changes can't go stale.
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
          const open = draftToSubmit(list);
          if (!open.ok) refuse(open);
          const draft = await tx.query.versions.findFirst({
            where: eq(versions.id, open.draft.id),
          });
          if (!draft) refuse(REQUEST_REFUSALS.noDraftToSubmit);
          const baselineId = contractBaseline(list, now)?.id;
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
            now,
            submittedBy: ctx.viewer.userId,
            submitterName: ctx.viewer.name,
            templateId: found.id,
            templateName: draft.name,
            note: input.note ?? null,
            chain: await loadChain(tx, found.contentTypeId),
            messageRules: await loadMessageRules(tx, found.contentTypeId),
          });
          if (!outcome.ok) refuse(outcome);
          const { changes, effects } = outcome;
          // The rev bump makes an autosave still in flight fail rather than land on a frozen version.
          await updateVersion(tx, draft, changes, now, deps.hooks);

          const threads = await tx
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
          const answered = answerChangeRequests(threads, {
            number: changes.number,
            round: changes.round,
            by: ctx.viewer.userId,
            at: now,
          });
          if (threads.length > 0)
            await tx
              .update(commentThreads)
              .set(answered.resolve)
              .where(
                inArray(
                  commentThreads.id,
                  threads.map((t) => t.id),
                ),
              );

          await writeEffects(
            tx,
            [...effects, ...answered.effects],
            effectContext(
              ctx.viewer,
              { teamId: found.teamId, templateId: found.id },
              draft.id,
              now,
            ),
          );
          return { ok: true, number: changes.number, round: changes.round };
        },
      }),

    requestChanges: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const found = await findVersion(
            input.templateId,
            input.versionNumber,
            input.round,
          );
          check(ctx.viewer, "version.decide", await decideResource(found));
          if (!found) refuse(REQUEST_REFUSALS.versionGone);
          const long = reasonRefusal(input.reason);
          if (long) refuse(long);
          return found;
        },
        transaction: async (tx, { ctx, input, found, now }) => {
          const version = await loadVersion(
            tx,
            found,
            input.versionNumber,
            input.round,
          );
          const chain = await loadChain(tx, found.contentTypeId);
          assertStage(ctx.viewer, chain, version, found.teamId);

          const outcome = requestChanges({
            version,
            chain,
            actorId: ctx.viewer.userId,
            actorName: ctx.viewer.name,
            reason: input.reason,
            now,
            templateName: version.name,
          });
          if (!outcome.ok) refuse(outcome);

          await updateVersion(tx, version, outcome.changes, now, deps.hooks);
          await tx
            .insert(approvals)
            .values({ id: newId("ap"), ...outcome.approval });

          // A template has at most one open draft. There is none while a version is in review, but if one
          // exists the author keeps working in it rather than the request failing. It takes on the returned
          // version's writers, so none of them can decide what it becomes (maker-checker). Its content isn't
          // touched, so `rev` stays and an autosave in flight still lands.
          const openDraft = await tx.query.versions.findFirst({
            columns: { id: true, writers: true },
            where: and(
              eq(versions.templateId, found.templateId),
              eq(versions.state, "draft"),
            ),
          });
          if (!openDraft)
            await tx.insert(versions).values({
              id: newId("v"),
              templateId: found.templateId,
              ...outcome.newDraft,
            });
          else
            await tx
              .update(versions)
              .set({
                writers: withWriters(
                  openDraft.writers,
                  outcome.newDraft.writers,
                ),
              })
              .where(
                and(eq(versions.id, openDraft.id), eq(versions.state, "draft")),
              );

          const threadId = newId("th");
          await tx.insert(commentThreads).values({
            id: threadId,
            templateId: found.templateId,
            originVersionId: version.id,
            blockId: outcome.reasonComment.blockId,
            quote: null,
            status: "open",
            createdAt: now,
          });
          await tx.insert(comments).values({
            id: newId("cm"),
            threadId,
            authorId: ctx.viewer.userId,
            body: outcome.reasonComment.body,
            kind: outcome.reasonComment.kind,
            createdAt: now,
          });

          await writeEffects(
            tx,
            outcome.effects,
            effectContext(ctx.viewer, found, version.id, now),
          );
          return { ok: true };
        },
      }),

    approve: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const found = await findVersion(
            input.templateId,
            input.versionNumber,
            input.round,
          );
          check(ctx.viewer, "version.decide", await decideResource(found));
          if (!found) refuse(REQUEST_REFUSALS.versionGone);
          // A calendar day; the transition reads it in the business time zone (00:00 there ends renders).
          if (input.sunsetPrevious && !isCalendarDay(input.sunsetPrevious))
            refuse(REQUEST_REFUSALS.invalidDate);
          return found;
        },
        transaction: async (tx, { ctx, input, found, now }) => {
          const version = await loadVersion(
            tx,
            found,
            input.versionNumber,
            input.round,
          );
          const chain = await loadChain(tx, found.contentTypeId);
          assertStage(ctx.viewer, chain, version, found.teamId);
          const active = await activeVersion(tx, found.templateId);

          const outcome = approve({
            version,
            chain,
            actorId: ctx.viewer.userId,
            actorName: ctx.viewer.name,
            now,
            active: replacedActive(active, version),
            sunsetPrevious: input.sunsetPrevious || null,
            zone: await readBusinessZone(tx),
            sampleSetsSeen: input.sampleSetsSeen,
            outputsViewed: input.outputsViewed,
            templateName: version.name,
            decisions:
              (await loadDecisions(tx, [version.id])).get(version.id) ?? [],
          });
          if (!outcome.ok) refuse(outcome);

          // The previous Active steps down before this one steps up (the one-Active index), with a
          // compare-and-set of its own: a revoke confirmed meanwhile loses this one the write.
          if (outcome.previous && active)
            await updateVersion(
              tx,
              active,
              outcome.previous.changes,
              now,
              deps.hooks,
            );
          const { changes } = outcome;
          await updateVersion(
            tx,
            version,
            {
              state: changes.state,
              currentStage: changes.currentStage,
              ...(changes.activatedAt
                ? { activatedAt: changes.activatedAt }
                : {}),
            },
            now,
            deps.hooks,
          );
          await tx
            .insert(approvals)
            .values({ id: newId("ap"), ...outcome.approval });
          await writeEffects(
            tx,
            outcome.effects,
            effectContext(ctx.viewer, found, version.id, now),
          );
          return {
            ok: true,
            wentLive: outcome.wentLive,
            number: version.number!,
            round: version.round!,
          };
        },
      }),

    startRevoke: (ctx, input) =>
      revokeCommand(ctx, input, {
        action: "version.revoke.start",
        check: (input) => {
          const long = reasonRefusal(input.reason);
          if (long) refuse(long);
        },
        transition: (version, { viewer, input, now }) =>
          startRevoke({
            version,
            actorId: viewer.userId,
            actorName: viewer.name,
            reason: input.reason,
            now,
            templateName: version.name,
          }),
      }),

    confirmRevoke: (ctx, input) =>
      revokeCommand(ctx, input, {
        action: "version.revoke.confirm",
        // The two-person rule: the starter of a pending revoke can't confirm it.
        resource: (found) => ({
          revokeStartedBy:
            found.revoke && !found.revoke.confirmedAt
              ? found.revoke.startedBy
              : null,
        }),
        transition: async (version, { viewer, found, now }, tx) => {
          const active = await activeVersion(tx, found.templateId);
          return confirmRevoke({
            version,
            actorId: viewer.userId,
            actorName: viewer.name,
            now,
            activeNumber: active?.number ?? null,
            templateName: version.name,
          });
        },
      }),

    // Any approver who may start a revoke may cancel one: the starter (a mistake) or another approver
    // declining to confirm. Cancelling returns to the safe state, so the two-person rule doesn't apply.
    cancelRevoke: (ctx, input) =>
      revokeCommand(ctx, input, {
        action: "version.revoke.start",
        transition: (version, { viewer, now }) =>
          cancelRevoke({ version, actorId: viewer.userId, now }),
      }),

    async submitSummary(ctx, { templateId }) {
      const template = await findTemplate(templateId);
      // Not there, and not the viewer's to see, read the same (decision 0052).
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const allowed = can(ctx.viewer, "version.submit", {
        teamId: template.teamId,
      });
      if (!allowed.ok) return refusal(403, allowed);

      const rows = await db
        .select({
          number: versions.number,
          round: versions.round,
          state: versions.state,
          rev: versions.rev,
          sunsetAt: versions.sunsetAt,
          name: versions.name,
          channels: versions.channels,
          variables: versions.variables,
          sampleSets: versions.sampleSets,
        })
        .from(versions)
        .where(eq(versions.templateId, template.id));
      const now = await deps.clock();
      const facts = submitFacts(rows, now);
      if (!facts.ok) return refusal(409, facts);
      const { ok, ...summary } = facts;
      return {
        ok,
        asOf: now.toISOString(),
        templateId: template.id,
        ...summary,
      };
    },
  };
}

type RevokeOutcome =
  | {
      ok: true;
      changes: Partial<Pick<typeof versions.$inferInsert, "state" | "revoke">>;
      effects: LifecycleEffect[];
    }
  | Refused;
