"use server";

import { refresh, revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { currentStageOf } from "@/domain/approval-chain";
import {
  addComment as addCommentTransition,
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
import type { Viewer } from "@/domain/types";
import { db, type Db } from "@/server/db/client";
import { commentThreads, comments, templates, versions } from "@/server/db/schema/ucomp";
import { writeEffects } from "@/server/effects";
import { newId } from "@/server/ids";
import { anchorIdsOf, loadChain, stageApproverIds } from "@/server/queries/review-shared";
import { permit, refuse, serverAction } from "./kit";

// Review comments: start a thread on a block or a channel field (or on the whole version), reply, resolve, reopen. The rules
// are domain/comments.ts: which versions take comments (a draft, a version in review), who may act on
// which thread, the text's limits, and who is notified. Every action runs the server action kit (kit.ts):
//   1. `authorize`: read the facts outside a transaction and ask the rule (`permit`), so a refused caller
//      gets its reason at once (an unknown id is refused like a forbidden one);
//   2. ONE transaction that reads the facts again, asks the domain transition, and writes the rows and
//      its effects (audit, notifications). A refusal rolls it back, so a refused transaction writes
//      nothing. Writes in this process take turns (src/lib/serialized-writes.ts), so what the
//      transaction read still holds when it writes; resolve and reopen also compare-and-set the status;
//   3. `refresh()`, so the page the person is on re-renders in place.
//
// A "use server" file may export only async functions: the helpers below stay private.

// ── Facts ─────────────────────────────────────────────────────

/** `db` outside the transaction, `tx` inside it. */
type Reader = Pick<Db, "select">;

/**
 * What a thread's or a version's template is, and what on it takes comments right now. `name` is the
 * name of the version the comment is about (the name is versioned): its notifications call it that.
 */
async function loadTemplate(reader: Reader, templateId: string, name: string): Promise<CommentTemplate | undefined> {
  const template = await reader
    .select({ id: templates.id, teamId: templates.teamId, contentTypeId: templates.contentTypeId })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!template) return undefined;
  const list = await reader
    .select({ number: versions.number, state: versions.state, stages: versions.stages, currentStage: versions.currentStage })
    .from(versions)
    .where(eq(versions.templateId, templateId))
    .orderBy(desc(versions.number));
  const review = list.find((v) => v.state === "in_review" && v.number !== null);
  return {
    ...template,
    name,
    hasDraft: list.some((v) => v.state === "draft"),
    inReview: review
      ? { number: review.number!, stageApproverIds: await namedOnStage(reader, template.contentTypeId, review) }
      : null,
    highestNumber: list.reduce((max, v) => Math.max(max, v.number ?? 0), 0),
  };
}

/** The users the stage a version in review waits on names: one of its own stages, with the rule it has now. */
async function namedOnStage(
  reader: Reader,
  contentTypeId: string,
  version: { stages: VersionStage[] | null; currentStage: number },
): Promise<string[]> {
  return stageApproverIds(currentStageOf(version, await loadChain(reader, contentTypeId)));
}

/** The version a new thread goes on, with its template and what a thread on it can anchor to (its fields and blocks). */
async function loadVersion(reader: Reader, templateId: string, versionId: string) {
  const row = await reader
    .select({
      id: versions.id,
      number: versions.number,
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
    state: row.state,
    createdBy: row.createdBy,
    submittedBy: row.submittedBy,
    stageApproverIds: row.state === "in_review" ? await namedOnStage(reader, row.contentTypeId, row) : [],
  };
  return {
    template: { id: row.templateId, name: row.templateName, teamId: row.teamId },
    version,
    blockIds: anchorIdsOf(row),
  };
}

/** A thread, the version it began on, and its template. */
async function loadThread(reader: Reader, threadId: string): Promise<{ template: CommentTemplate; thread: CommentThread } | undefined> {
  const row = await reader
    .select({
      id: commentThreads.id,
      blockId: commentThreads.blockId,
      status: commentThreads.status,
      templateId: commentThreads.templateId,
      originId: versions.id,
      originNumber: versions.number,
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
        state: row.originState,
        createdBy: row.originCreatedBy,
        submittedBy: row.originSubmittedBy,
      },
    },
  };
}

function effectContext(viewer: Viewer, template: { id: string; teamId: string }, versionId: string, at: Date) {
  return { at, actorId: viewer.userId, teamId: template.teamId, templateId: template.id, versionId };
}

/** The pages that show threads: the template workspace (margin) and the review screens. */
function refreshThreads() {
  revalidatePath("/[team]/templates/[templateId]", "layout");
  revalidatePath("/[team]/review", "layout");
  refresh();
}

// ── Add a thread ──────────────────────────────────────────────

const AddCommentInput = z.object({
  templateId: z.string().min(1).max(32),
  versionId: z.string().min(1).max(64),
  blockId: z.string().min(1).max(128),
  quote: z.string().nullish(),
  body: z.string(),
});

/**
 * Starts a thread on one block of a draft or a version in review (or on the whole version:
 * `DOCUMENT_THREAD`), with its first comment. The thread belongs to the template, so drafts made from
 * this version show it too. The version's author is notified.
 */
export async function addComment(input: {
  templateId: string;
  versionId: string;
  blockId: string;
  quote?: string | null;
  body: string;
}): Promise<ActionResult<{ threadId: string }>> {
  return serverAction(input, {
    input: AddCommentInput,
    authorize: async ({ viewer, input }) => {
      const found = await loadVersion(db, input.templateId, input.versionId);
      if (!found) refuse(REASONS.generic);
      permit(canComment(viewer, { teamId: found.template.teamId, version: found.version }));
    },
    transaction: async (tx, { viewer, input, now: at }) => {
      const facts = await loadVersion(tx, input.templateId, input.versionId);
      if (!facts) refuse(REQUEST_REFUSALS.versionGone);
      const outcome = addCommentTransition({
        viewer,
        ...facts,
        blockId: input.blockId,
        quote: input.quote,
        body: input.body,
        threadId: newId("th"),
        commentId: newId("cm"),
        now: at,
      });
      if (!outcome.ok) refuse(outcome);

      await tx.insert(commentThreads).values(outcome.thread);
      await tx.insert(comments).values(outcome.comment);
      await writeEffects(tx, outcome.effects, effectContext(viewer, facts.template, facts.version.id, at));
      return { ok: true, threadId: outcome.thread.id };
    },
    after: refreshThreads,
  });
}

// ── Threads: reply, resolve, reopen ───────────────────────────

const ThreadInput = z.object({ threadId: z.string().min(1).max(64) });
const ReplyInput = ThreadInput.extend({ body: z.string() });

/** The thread the input names, and the rule asked of it; an unknown thread is refused like a forbidden one. */
async function authorizeThread({ viewer, input }: { viewer: Viewer; input: { threadId: string } }) {
  const found = await loadThread(db, input.threadId);
  if (!found) refuse(REASONS.generic);
  permit(canActOnThread(viewer, found));
}

/**
 * Adds a reply to a thread (open or resolved; a reply doesn't reopen it). Everyone who has written in the
 * thread, and the author of the version it started on, is notified (never the one replying).
 */
export async function reply(input: { threadId: string; body: string }): Promise<ActionResult> {
  return serverAction(input, {
    input: ReplyInput,
    authorize: authorizeThread,
    transaction: async (tx, { viewer, input, now: at }) => {
      const facts = await loadThread(tx, input.threadId);
      if (!facts) refuse(REQUEST_REFUSALS.threadGone);
      const participants = await tx
        .selectDistinct({ authorId: comments.authorId })
        .from(comments)
        .where(eq(comments.threadId, facts.thread.id));
      const outcome = replyTransition({
        viewer,
        ...facts,
        participants: participants.map((p) => p.authorId),
        body: input.body,
        commentId: newId("cm"),
        now: at,
      });
      if (!outcome.ok) refuse(outcome);

      await tx.insert(comments).values(outcome.comment);
      await writeEffects(tx, outcome.effects, effectContext(viewer, facts.template, facts.thread.origin.id, at));
      return { ok: true };
    },
    after: refreshThreads,
  });
}

/**
 * Resolves an open thread. Compare-and-set on the status: a second click (or a second person) finds it
 * resolved already and writes nothing; that still answers ok, since the thread is what was asked.
 */
export async function resolveThread(input: { threadId: string }): Promise<ActionResult> {
  return setStatus(input, resolveTransition);
}

/** Reopens a resolved thread (compare-and-set, as `resolveThread`). */
export async function reopenThread(input: { threadId: string }): Promise<ActionResult> {
  return setStatus(input, reopenTransition);
}

async function setStatus(
  input: { threadId: string },
  transition: typeof resolveTransition | typeof reopenTransition,
): Promise<ActionResult> {
  let wrote = false;
  return serverAction(input, {
    input: ThreadInput,
    authorize: authorizeThread,
    transaction: async (tx, { viewer, input, now: at }) => {
      const facts = await loadThread(tx, input.threadId);
      if (!facts) refuse(REQUEST_REFUSALS.threadGone);
      const outcome: ThreadStatusResult = transition({ viewer, ...facts, now: at });
      if (!outcome.ok) refuse(outcome);
      if (!outcome.changes) return { ok: true };

      const [row] = await tx
        .update(commentThreads)
        .set(outcome.changes)
        .where(and(eq(commentThreads.id, facts.thread.id), eq(commentThreads.status, facts.thread.status)))
        .returning({ id: commentThreads.id });
      if (!row) return { ok: true };
      await writeEffects(tx, outcome.effects, effectContext(viewer, facts.template, facts.thread.origin.id, at));
      wrote = true;
      return { ok: true };
    },
    after: () => {
      if (wrote) refreshThreads();
    },
  });
}
