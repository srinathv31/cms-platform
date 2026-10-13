import { currentStageOf, stageApproverIds } from "@/domain/approval-chain";
import {
  addComment as addCommentTransition,
  anchorIdsOf,
  canActOnThread,
  canComment,
  reopenThread as reopenTransition,
  reply as replyTransition,
  resolveThread as resolveTransition,
  type CommentTemplate,
  type CommentThread,
  type CommentVersion,
  type ThreadStatusResult,
} from "@/domain/comments";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { compareRounds, nextRound } from "@/domain/rounds";
import type { Viewer } from "@/domain/types";
import { newId } from "@/server/ids";
import type { CommentService } from "../comments";
import { notMoved } from "../not-moved";
import { answerFor, permit, refuse } from "../refuse";
import type { Changed, RequestContext } from "../types";
import { chainOf } from "./chain";
import { writeFakeEffects } from "./effects";
import type { FakeDeps } from "./index";
import type { FakeState, TemplateRow, VersionRow } from "./state";
import { templateById } from "./version-rows";

// Review comments in memory: the same steps as the local implementation (services/local/comments.ts) in the same
// order, the same domain rules, and the writes into the fake's state. The clock is read before the command, which
// then runs synchronously (`FakeStore.command`); a refusal undoes what it wrote.

/** The users the stage a version in review waits on names (its own stages, with the rule they have now). */
function namedOnStage(
  state: FakeState,
  contentTypeId: string,
  version: Pick<VersionRow, "stages" | "currentStage">,
): string[] {
  return stageApproverIds(
    currentStageOf(version, chainOf(state, contentTypeId)),
  );
}

/** What a template is, and what on it takes comments right now (`loadTemplate`). */
function loadTemplate(
  state: FakeState,
  template: TemplateRow,
  name: string,
): CommentTemplate {
  const list = state.versions
    .filter((v) => v.templateId === template.id)
    .sort((a, b) => compareRounds(b, a));
  const review = list.find(
    (v) => v.state === "in_review" && v.number !== null && v.round !== null,
  );
  return {
    id: template.id,
    teamId: template.teamId,
    name,
    hasDraft: list.some((v) => v.state === "draft"),
    inReview: review
      ? {
          number: review.number!,
          round: review.round!,
          stageApproverIds: namedOnStage(state, template.contentTypeId, review),
        }
      : null,
    next: nextRound(list),
  };
}

/** The version a new thread goes on, with its template and what a thread on it can anchor to (`loadVersion`). */
function loadVersion(state: FakeState, templateId: string, versionId: string) {
  const row = state.versions.find(
    (v) => v.id === versionId && v.templateId === templateId,
  );
  const template = row ? templateById(state, row.templateId) : undefined;
  if (!row || !template) return undefined;
  const version: CommentVersion = {
    id: row.id,
    number: row.number,
    round: row.round,
    state: row.state,
    createdBy: row.createdBy,
    submittedBy: row.submittedBy,
    stageApproverIds:
      row.state === "in_review"
        ? namedOnStage(state, template.contentTypeId, row)
        : [],
  };
  return {
    // The version's own name: its notification names the version commented on.
    template: { id: template.id, name: row.name, teamId: template.teamId },
    version,
    blockIds: anchorIdsOf(row),
  };
}

/** A thread, the version it began on, and its template (`loadThread`). */
function loadThread(
  state: FakeState,
  threadId: string,
): { template: CommentTemplate; thread: CommentThread } | undefined {
  const row = state.commentThreads.find((t) => t.id === threadId);
  const origin = row
    ? state.versions.find((v) => v.id === row.originVersionId)
    : undefined;
  const template = row ? templateById(state, row.templateId) : undefined;
  if (!row || !origin || !template) return undefined;
  return {
    // A reply's notification names the version the thread began on, by that version's name.
    template: loadTemplate(state, template, origin.name),
    thread: {
      id: row.id,
      blockId: row.blockId,
      status: row.status,
      origin: {
        id: origin.id,
        number: origin.number,
        round: origin.round,
        state: origin.state,
        createdBy: origin.createdBy,
        submittedBy: origin.submittedBy,
      },
    },
  };
}

function effectContext(
  viewer: Viewer,
  template: { id: string; teamId: string },
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

/** The thread the input names, and the rule asked of it; an unknown thread is refused like a forbidden one. */
function authorizeThread(state: FakeState, viewer: Viewer, threadId: string) {
  const found = loadThread(state, threadId);
  if (!found) refuse(REASONS.generic);
  permit(canActOnThread(viewer, found));
}

export function fakeComments({
  store,
  clock,
  hooks,
}: FakeDeps): CommentService {
  /** Runs one command against the store at the clock's instant; a refusal is its answer. */
  async function run<T extends object>(
    command: (
      tx: Parameters<Parameters<typeof store.command>[0]>[0],
      now: Date,
    ) => ActionResult<T>,
  ): Promise<ActionResult<T>> {
    const now = await clock();
    try {
      return store.command((tx) => command(tx, now));
    } catch (error) {
      return answerFor(error);
    }
  }

  const setStatus = (
    ctx: RequestContext,
    { threadId }: { threadId: string },
    transition: typeof resolveTransition | typeof reopenTransition,
  ) =>
    run((tx, now): ActionResult<Changed> => {
      const { state } = tx;
      authorizeThread(state, ctx.viewer, threadId);
      const facts = loadThread(state, threadId);
      if (!facts) refuse(REQUEST_REFUSALS.threadGone);
      const outcome: ThreadStatusResult = transition({
        viewer: ctx.viewer,
        ...facts,
        now,
      });
      if (!outcome.ok) refuse(outcome);
      if (!outcome.changes) return { ok: true, changed: false };

      const row = state.commentThreads.find((t) => t.id === threadId)!;
      if (
        hooks.beforeCompareAndSet?.({
          table: "comment_threads",
          id: threadId,
        }) === "competing_write"
      )
        tx.update("commentThreads", row, outcome.changes);
      // Another writer got there first: the thread is as asked, and nothing more is written.
      if (row.status !== facts.thread.status)
        return { ok: true, changed: false };
      tx.update("commentThreads", row, outcome.changes);
      writeFakeEffects(
        tx,
        outcome.effects,
        effectContext(ctx.viewer, facts.template, facts.thread.origin.id, now),
      );
      return { ok: true, changed: true };
    });

  return {
    add: (ctx, input) =>
      run((tx, now) => {
        const { state } = tx;
        const found = loadVersion(state, input.templateId, input.versionId);
        if (!found) refuse(REASONS.generic);
        permit(
          canComment(ctx.viewer, {
            teamId: found.template.teamId,
            version: found.version,
          }),
        );
        const outcome = addCommentTransition({
          viewer: ctx.viewer,
          ...found,
          blockId: input.blockId,
          quote: input.quote,
          body: input.body,
          threadId: newId("th"),
          commentId: newId("cm"),
          now,
        });
        if (!outcome.ok) refuse(outcome);

        tx.insert("commentThreads", outcome.thread);
        tx.insert("comments", outcome.comment);
        writeFakeEffects(
          tx,
          outcome.effects,
          effectContext(ctx.viewer, found.template, found.version.id, now),
        );
        return { ok: true, threadId: outcome.thread.id };
      }),

    reply: (ctx, input) =>
      run((tx, now) => {
        const { state } = tx;
        authorizeThread(state, ctx.viewer, input.threadId);
        const facts = loadThread(state, input.threadId);
        if (!facts) refuse(REQUEST_REFUSALS.threadGone);
        const participants = [
          ...new Set(
            state.comments
              .filter((c) => c.threadId === facts.thread.id)
              .map((c) => c.authorId),
          ),
        ];
        const outcome = replyTransition({
          viewer: ctx.viewer,
          ...facts,
          participants,
          body: input.body,
          commentId: newId("cm"),
          now,
        });
        if (!outcome.ok) refuse(outcome);

        tx.insert("comments", outcome.comment);
        writeFakeEffects(
          tx,
          outcome.effects,
          effectContext(
            ctx.viewer,
            facts.template,
            facts.thread.origin.id,
            now,
          ),
        );
        return { ok: true };
      }),

    resolve: (ctx, input) => setStatus(ctx, input, resolveTransition),
    reopen: (ctx, input) => setStatus(ctx, input, reopenTransition),

    threads: notMoved("comments.threads"),
  };
}
