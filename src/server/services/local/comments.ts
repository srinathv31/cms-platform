import "server-only";
import { and, eq } from "drizzle-orm";
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
import type { ActionResult, VersionStage } from "@/domain/review-types";
import { compareRounds, nextRound } from "@/domain/rounds";
import type { Viewer } from "@/domain/types";
import { db, type Db } from "@/server/db/client";
import {
  commentThreads,
  comments,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import type { CommentService } from "../comments";
import type { Changed } from "../types";
import { loadChain } from "./chain";
import { permit, refuse, runCommand, type LocalDeps } from "./command";
import { writeEffects } from "./effects";

// Review comments on this app's own database (src/server/services/comments.ts says what each command promises).
// The rules are src/domain/comments.ts: which versions take comments, who may act on which thread, the text's
// limits, and who is told. Each command runs on the command kit (./command.ts):
//   1. `authorize`: read the facts outside a transaction and ask the rule (`permit`), so a refused caller gets
//      its reason at once (an unknown id is refused like a forbidden one);
//   2. ONE transaction that reads the facts again, asks the domain transition, and writes the rows and its effects
//      (audit, notifications). A refusal rolls it back, so a refused command writes nothing. Resolve and reopen
//      also compare-and-set the status.

/** `db` outside the transaction, `tx` inside it. */
type Reader = Pick<Db, "select">;

/**
 * What a thread's or a version's template is, and what on it takes comments right now. `name` is the name of the
 * version the comment is about (the name is versioned): its notifications call it that.
 */
async function loadTemplate(
  reader: Reader,
  templateId: string,
  name: string,
): Promise<CommentTemplate | undefined> {
  const template = await reader
    .select({
      id: templates.id,
      teamId: templates.teamId,
      contentTypeId: templates.contentTypeId,
    })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!template) return undefined;
  const list = (
    await reader
      .select({
        number: versions.number,
        round: versions.round,
        state: versions.state,
        stages: versions.stages,
        currentStage: versions.currentStage,
      })
      .from(versions)
      .where(eq(versions.templateId, templateId))
  ).sort((a, b) => compareRounds(b, a));
  const review = list.find(
    (v) => v.state === "in_review" && v.number !== null && v.round !== null,
  );
  return {
    ...template,
    name,
    hasDraft: list.some((v) => v.state === "draft"),
    inReview: review
      ? {
          number: review.number!,
          round: review.round!,
          stageApproverIds: await namedOnStage(
            reader,
            template.contentTypeId,
            review,
          ),
        }
      : null,
    next: nextRound(list),
  };
}

/** The users the stage a version in review waits on names: one of its own stages, with the rule it has now. */
async function namedOnStage(
  reader: Reader,
  contentTypeId: string,
  version: { stages: VersionStage[] | null; currentStage: number },
): Promise<string[]> {
  return stageApproverIds(
    currentStageOf(version, await loadChain(reader, contentTypeId)),
  );
}

/** The version a new thread goes on, with its template and what a thread on it can anchor to (its fields and blocks). */
async function loadVersion(
  reader: Reader,
  templateId: string,
  versionId: string,
) {
  const row = await reader
    .select({
      id: versions.id,
      number: versions.number,
      round: versions.round,
      state: versions.state,
      createdBy: versions.createdBy,
      submittedBy: versions.submittedBy,
      stages: versions.stages,
      currentStage: versions.currentStage,
      body: versions.body,
      channels: versions.channels,
      templateId: templates.id,
      // The version's own name: its notification names the version commented on.
      templateName: versions.name,
      teamId: templates.teamId,
      contentTypeId: templates.contentTypeId,
    })
    .from(versions)
    .innerJoin(templates, eq(templates.id, versions.templateId))
    .where(and(eq(versions.id, versionId), eq(versions.templateId, templateId)))
    .limit(1)
    .then((rows) => rows[0]);
  if (!row) return undefined;
  const version: CommentVersion = {
    id: row.id,
    number: row.number,
    round: row.round,
    state: row.state,
    createdBy: row.createdBy,
    submittedBy: row.submittedBy,
    stageApproverIds:
      row.state === "in_review"
        ? await namedOnStage(reader, row.contentTypeId, row)
        : [],
  };
  return {
    template: {
      id: row.templateId,
      name: row.templateName,
      teamId: row.teamId,
    },
    version,
    blockIds: anchorIdsOf(row),
  };
}

/** A thread, the version it began on, and its template. */
async function loadThread(
  reader: Reader,
  threadId: string,
): Promise<{ template: CommentTemplate; thread: CommentThread } | undefined> {
  const row = await reader
    .select({
      id: commentThreads.id,
      blockId: commentThreads.blockId,
      status: commentThreads.status,
      templateId: commentThreads.templateId,
      originId: versions.id,
      originNumber: versions.number,
      originRound: versions.round,
      originState: versions.state,
      originCreatedBy: versions.createdBy,
      originSubmittedBy: versions.submittedBy,
      originName: versions.name,
    })
    .from(commentThreads)
    .innerJoin(versions, eq(versions.id, commentThreads.originVersionId))
    .where(eq(commentThreads.id, threadId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!row) return undefined;
  // A reply's notification names the version the thread began on, by that version's name.
  const template = await loadTemplate(reader, row.templateId, row.originName);
  if (!template) return undefined;
  return {
    template,
    thread: {
      id: row.id,
      blockId: row.blockId,
      status: row.status,
      origin: {
        id: row.originId,
        number: row.originNumber,
        round: row.originRound,
        state: row.originState,
        createdBy: row.originCreatedBy,
        submittedBy: row.originSubmittedBy,
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
async function authorizeThread({
  ctx,
  input,
}: {
  ctx: { viewer: Viewer };
  input: { threadId: string };
}) {
  const found = await loadThread(db, input.threadId);
  if (!found) refuse(REASONS.generic);
  permit(canActOnThread(ctx.viewer, found));
}

export function localComments(
  deps: LocalDeps,
): Omit<CommentService, "threads"> {
  /** Resolve and reopen: the same steps, with the transition that differs. */
  const setStatus = (
    ctx: Parameters<CommentService["resolve"]>[0],
    input: { threadId: string },
    transition: typeof resolveTransition | typeof reopenTransition,
  ) =>
    runCommand(deps, ctx, input, {
      authorize: authorizeThread,
      transaction: async (
        tx,
        { ctx, input, now },
      ): Promise<ActionResult<Changed>> => {
        const facts = await loadThread(tx, input.threadId);
        if (!facts) refuse(REQUEST_REFUSALS.threadGone);
        const outcome: ThreadStatusResult = transition({
          viewer: ctx.viewer,
          ...facts,
          now,
        });
        if (!outcome.ok) refuse(outcome);
        if (!outcome.changes) return { ok: true, changed: false };

        if (
          deps.hooks.beforeCompareAndSet?.({
            table: "comment_threads",
            id: facts.thread.id,
          }) === "competing_write"
        )
          await tx
            .update(commentThreads)
            .set(outcome.changes)
            .where(eq(commentThreads.id, facts.thread.id));
        const [row] = await tx
          .update(commentThreads)
          .set(outcome.changes)
          .where(
            and(
              eq(commentThreads.id, facts.thread.id),
              eq(commentThreads.status, facts.thread.status),
            ),
          )
          .returning({ id: commentThreads.id });
        // Another writer got there first: the thread is as asked, and nothing more is written.
        if (!row) return { ok: true, changed: false };
        await writeEffects(
          tx,
          outcome.effects,
          effectContext(
            ctx.viewer,
            facts.template,
            facts.thread.origin.id,
            now,
          ),
        );
        return { ok: true, changed: true };
      },
    });

  return {
    add: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const found = await loadVersion(
            db,
            input.templateId,
            input.versionId,
          );
          if (!found) refuse(REASONS.generic);
          permit(
            canComment(ctx.viewer, {
              teamId: found.template.teamId,
              version: found.version,
            }),
          );
        },
        transaction: async (
          tx,
          { ctx, input, now },
        ): Promise<ActionResult<{ threadId: string }>> => {
          const facts = await loadVersion(
            tx,
            input.templateId,
            input.versionId,
          );
          if (!facts) refuse(REQUEST_REFUSALS.versionGone);
          const outcome = addCommentTransition({
            viewer: ctx.viewer,
            ...facts,
            blockId: input.blockId,
            quote: input.quote,
            body: input.body,
            threadId: newId("th"),
            commentId: newId("cm"),
            now,
          });
          if (!outcome.ok) refuse(outcome);

          await tx.insert(commentThreads).values(outcome.thread);
          await tx.insert(comments).values(outcome.comment);
          await writeEffects(
            tx,
            outcome.effects,
            effectContext(ctx.viewer, facts.template, facts.version.id, now),
          );
          return { ok: true, threadId: outcome.thread.id };
        },
      }),

    reply: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: authorizeThread,
        transaction: async (tx, { ctx, input, now }) => {
          const facts = await loadThread(tx, input.threadId);
          if (!facts) refuse(REQUEST_REFUSALS.threadGone);
          const participants = await tx
            .selectDistinct({ authorId: comments.authorId })
            .from(comments)
            .where(eq(comments.threadId, facts.thread.id));
          const outcome = replyTransition({
            viewer: ctx.viewer,
            ...facts,
            participants: participants.map((p) => p.authorId),
            body: input.body,
            commentId: newId("cm"),
            now,
          });
          if (!outcome.ok) refuse(outcome);

          await tx.insert(comments).values(outcome.comment);
          await writeEffects(
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
        },
      }),

    resolve: (ctx, input) => setStatus(ctx, input, resolveTransition),
    reopen: (ctx, input) => setStatus(ctx, input, reopenTransition),
  };
}
