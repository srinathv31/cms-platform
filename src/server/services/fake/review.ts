import { isCalendarDay } from "@/domain/dates";
import { decideResource, stageRefusal } from "@/domain/lifecycle/decide-check";
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
import type { DraftFields } from "@/domain/lifecycle/types";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS, type Refused } from "@/domain/refusals";
import {
  DOCUMENT_THREAD,
  type ActionResult,
  type LifecycleEffect,
} from "@/domain/review-types";
import type { Action, RevokeRecord, Viewer } from "@/domain/types";
import { newId } from "@/server/ids";
import { notMoved } from "../not-moved";
import { answerFor, check, refuse } from "../refuse";
import { refusal } from "../results";
import type { ReviewService, VersionRef } from "../review";
import type { Changed, RequestContext } from "../types";
import { chainOf, decisionsOf, messageRulesOf } from "./chain";
import { writeFakeEffects } from "./effects";
import type { FakeDeps } from "./index";
import { businessZone } from "./settings";
import type { FakeState, TemplateRow, VersionRow } from "./state";
import type { FakeTx } from "./store";
import {
  activeVersion,
  compareAndSetVersion,
  findRound,
  templateById,
} from "./version-rows";

// The review lifecycle in memory: the same steps as the local implementation (services/local/review.ts) in the
// same order, the same domain rules, and the writes into the fake's state. The clock is read before the
// command, which then runs synchronously (`FakeStore.command`); a refusal undoes what it wrote.

export function fakeReview(deps: FakeDeps): ReviewService {
  const { store, clock, hooks } = deps;

  /** Runs one command: the clock, then the steps synchronously, a refusal undoing what they wrote. */
  async function command<T extends object>(
    run: (tx: FakeTx, now: Date) => ActionResult<T>,
  ): Promise<ActionResult<T>> {
    const now = await clock();
    try {
      return store.command((tx) => run(tx, now));
    } catch (error) {
      return answerFor(error);
    }
  }

  /** The version a command names, found as the local implementation's `findVersion` finds it, and its template. */
  function found(
    state: FakeState,
    input: VersionRef & { round?: number },
  ): { template: TemplateRow; version: VersionRow } | undefined {
    const template = templateById(state, input.templateId);
    const version = template
      ? findRound(state, template.id, input.versionNumber, input.round)
      : undefined;
    return template && version ? { template, version } : undefined;
  }

  /** The three revoke steps: the head, its permission, then the transition, compare-and-set, effects. */
  const revokeCommand = <I extends VersionRef>(
    ctx: RequestContext,
    input: I,
    steps: {
      action: Action;
      revokeStartedBy?: (revoke: RevokeRecord | null) => string | null;
      check?: (input: I) => void;
      transition: (
        version: VersionRow,
        c: { viewer: Viewer; template: TemplateRow; now: Date },
      ) => RevokeOutcome;
    },
  ) =>
    command((tx, now): ActionResult => {
      const named = found(tx.state, input);
      check(ctx.viewer, steps.action, {
        teamId: named?.template.teamId ?? null,
        ...(named &&
          steps.revokeStartedBy && {
            revokeStartedBy: steps.revokeStartedBy(named.version.revoke),
          }),
      });
      if (!named) refuse(REQUEST_REFUSALS.versionGone);
      steps.check?.(input);
      const { template, version } = named;
      const read = { ...version };
      const outcome = steps.transition(version, {
        viewer: ctx.viewer,
        template,
        now,
      });
      if (!outcome.ok) refuse(outcome);
      compareAndSetVersion(tx, version, read, outcome.changes, now, hooks);
      writeFakeEffects(
        tx,
        outcome.effects,
        effectContext(ctx.viewer, template, version.id, now),
      );
      return { ok: true };
    });

  /** The decide commands' permission and stage checks, on the round the input names. */
  function decidable(
    state: FakeState,
    viewer: Viewer,
    input: VersionRef & { round: number },
  ) {
    const named = found(state, input);
    const chain = named ? chainOf(state, named.template.contentTypeId) : [];
    check(
      viewer,
      "version.decide",
      named
        ? decideResource(named.template.teamId, named.version, chain)
        : { teamId: null },
    );
    if (!named) refuse(REQUEST_REFUSALS.versionGone);
    return { ...named, chain };
  }

  return {
    setSunset: (ctx, input) =>
      command((tx, now): ActionResult<Changed> => {
        const { state } = tx;
        const named = found(state, input);
        check(ctx.viewer, "version.setSunset", {
          teamId: named?.template.teamId ?? null,
        });
        if (!named) refuse(REQUEST_REFUSALS.versionGone);
        if (!isCalendarDay(input.sunsetDay))
          refuse(REQUEST_REFUSALS.invalidDate);
        const { template, version } = named;

        const read = { ...version };
        const zone = businessZone(state);
        if (sunsetUnchanged(version, input.sunsetDay, zone, now))
          return { ok: true, changed: false };
        const active = activeVersion(state, template.id);

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

        compareAndSetVersion(tx, version, read, outcome.changes, now, hooks);
        writeFakeEffects(
          tx,
          outcome.effects,
          effectContext(ctx.viewer, template, version.id, now),
        );
        return { ok: true, changed: true };
      }),

    submit: (ctx, input) =>
      command((tx, now) => {
        const { state } = tx;
        const template = templateById(state, input.templateId);
        check(ctx.viewer, "version.submit", {
          teamId: template?.teamId ?? null,
        });
        if (!template) refuse(REQUEST_REFUSALS.templateGone);
        const long = noteRefusal(input.note);
        if (long) refuse(long);

        const list = state.versions.filter((v) => v.templateId === template.id);
        const open = draftToSubmit(list);
        if (!open.ok) refuse(open);
        const draft = open.draft;
        const read = { ...draft };
        const baseline = contractBaseline(list, now)?.variables ?? null;

        const outcome = submit({
          draft,
          seenRev: input.rev,
          versions: list,
          baseline,
          now,
          submittedBy: ctx.viewer.userId,
          submitterName: ctx.viewer.name,
          templateId: template.id,
          templateName: draft.name,
          note: input.note ?? null,
          chain: chainOf(state, template.contentTypeId),
          messageRules: messageRulesOf(state, template.contentTypeId),
        });
        if (!outcome.ok) refuse(outcome);
        const { changes, effects } = outcome;
        compareAndSetVersion(tx, draft, read, changes, now, hooks);

        const threads = state.commentThreads.filter(
          (t) =>
            t.templateId === template.id &&
            t.blockId === DOCUMENT_THREAD &&
            t.status === "open",
        );
        const answered = answerChangeRequests(threads, {
          number: changes.number,
          round: changes.round,
          by: ctx.viewer.userId,
          at: now,
        });
        for (const thread of threads)
          tx.update("commentThreads", thread, answered.resolve);

        writeFakeEffects(
          tx,
          [...effects, ...answered.effects],
          effectContext(ctx.viewer, template, draft.id, now),
        );
        return { ok: true, number: changes.number, round: changes.round };
      }),

    requestChanges: (ctx, input) =>
      command((tx, now): ActionResult => {
        const { state } = tx;
        const { template, version, chain } = decidable(
          state,
          ctx.viewer,
          input,
        );
        const long = reasonRefusal(input.reason);
        if (long) refuse(long);
        const read = { ...version };
        const onStage = stageRefusal(
          ctx.viewer,
          chain,
          version,
          template.teamId,
        );
        if (onStage) refuse(onStage);

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

        compareAndSetVersion(tx, version, read, outcome.changes, now, hooks);
        tx.insert("approvals", { id: newId("ap"), ...outcome.approval });

        // The author keeps working in a draft that is already open; it takes on the round's writers.
        const openDraft = state.versions.find(
          (v) => v.templateId === template.id && v.state === "draft",
        );
        if (!openDraft)
          tx.insert("versions", draftRow(outcome.newDraft, template.id));
        else
          tx.update("versions", openDraft, {
            writers: withWriters(openDraft.writers, outcome.newDraft.writers),
          });

        const threadId = newId("th");
        tx.insert("commentThreads", {
          id: threadId,
          templateId: template.id,
          originVersionId: version.id,
          blockId: outcome.reasonComment.blockId,
          quote: null,
          status: "open",
          resolvedBy: null,
          resolvedAt: null,
          createdAt: now,
        });
        tx.insert("comments", {
          id: newId("cm"),
          threadId,
          authorId: ctx.viewer.userId,
          body: outcome.reasonComment.body,
          kind: outcome.reasonComment.kind,
          createdAt: now,
        });

        writeFakeEffects(
          tx,
          outcome.effects,
          effectContext(ctx.viewer, template, version.id, now),
        );
        return { ok: true };
      }),

    approve: (ctx, input) =>
      command((tx, now) => {
        const { state } = tx;
        const { template, version, chain } = decidable(
          state,
          ctx.viewer,
          input,
        );
        if (input.sunsetPrevious && !isCalendarDay(input.sunsetPrevious))
          refuse(REQUEST_REFUSALS.invalidDate);
        const read = { ...version };
        const onStage = stageRefusal(
          ctx.viewer,
          chain,
          version,
          template.teamId,
        );
        if (onStage) refuse(onStage);
        const active = activeVersion(state, template.id);
        const activeRead = active && { ...active };

        const outcome = approve({
          version,
          chain,
          actorId: ctx.viewer.userId,
          actorName: ctx.viewer.name,
          now,
          active: replacedActive(active, version),
          sunsetPrevious: input.sunsetPrevious || null,
          zone: businessZone(state),
          sampleSetsSeen: input.sampleSetsSeen,
          outputsViewed: input.outputsViewed,
          templateName: version.name,
          decisions: decisionsOf(state, version.id),
        });
        if (!outcome.ok) refuse(outcome);

        // The previous Active steps down first, with a compare-and-set of its own.
        if (outcome.previous && active && activeRead)
          compareAndSetVersion(
            tx,
            active,
            activeRead,
            outcome.previous.changes,
            now,
            hooks,
          );
        const { changes } = outcome;
        compareAndSetVersion(
          tx,
          version,
          read,
          {
            state: changes.state,
            currentStage: changes.currentStage,
            ...(changes.activatedAt
              ? { activatedAt: changes.activatedAt }
              : {}),
          },
          now,
          hooks,
        );
        tx.insert("approvals", { id: newId("ap"), ...outcome.approval });
        writeFakeEffects(
          tx,
          outcome.effects,
          effectContext(ctx.viewer, template, version.id, now),
        );
        return {
          ok: true,
          wentLive: outcome.wentLive,
          number: version.number!,
          round: version.round!,
        };
      }),

    startRevoke: (ctx, input) =>
      revokeCommand(ctx, input, {
        action: "version.revoke.start",
        check: (input) => {
          const long = reasonRefusal(input.reason);
          if (long) refuse(long);
        },
        transition: (version, { viewer, now }) =>
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
        revokeStartedBy: (revoke) =>
          revoke && !revoke.confirmedAt ? revoke.startedBy : null,
        transition: (version, { viewer, template, now }) =>
          confirmRevoke({
            version,
            actorId: viewer.userId,
            actorName: viewer.name,
            now,
            activeNumber:
              activeVersion(store.state, template.id)?.number ?? null,
            templateName: version.name,
          }),
      }),

    cancelRevoke: (ctx, input) =>
      revokeCommand(ctx, input, {
        action: "version.revoke.start",
        transition: (version, { viewer, now }) =>
          cancelRevoke({ version, actorId: viewer.userId, now }),
      }),

    async submitSummary(ctx, { templateId }) {
      const { state } = store;
      const template = templateById(state, templateId);
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const allowed = can(ctx.viewer, "version.submit", {
        teamId: template.teamId,
      });
      if (!allowed.ok) return refusal(403, allowed);
      const now = await clock();
      const facts = submitFacts(
        state.versions.filter((v) => v.templateId === template.id),
        now,
      );
      if (!facts.ok) return refusal(409, facts);
      const { ok, ...summary } = facts;
      return {
        ok,
        asOf: now.toISOString(),
        templateId: template.id,
        ...summary,
      };
    },

    queue: notMoved("review.queue"),
    badgeCount: notMoved("review.badgeCount"),
    screen: notMoved("review.screen"),
  };
}

type RevokeOutcome =
  | {
      ok: true;
      changes: Partial<Pick<VersionRow, "state" | "revoke">>;
      effects: LifecycleEffect[];
    }
  | Refused;

/** Who acted, on which template and version, and when (`effectContext` in services/local/version-rows.ts). */
function effectContext(
  viewer: Viewer,
  template: TemplateRow,
  versionId: string,
  at: Date,
) {
  return {
    at,
    actorId: viewer.userId,
    teamId: template.teamId,
    templateId: template.id,
    versionId,
  };
}

/** A new draft's row, as the database fills it: the columns a draft doesn't set are null. */
function draftRow(draft: DraftFields, templateId: string): VersionRow {
  return {
    id: newId("v"),
    templateId,
    ...draft,
    smsFooter: null,
    stages: null,
    submittedBy: null,
    submittedAt: null,
    submitNote: null,
    activatedAt: null,
    supersededAt: null,
    sunsetAt: null,
    sunsetSetBy: null,
    revoke: null,
    importUploadId: null,
  };
}
