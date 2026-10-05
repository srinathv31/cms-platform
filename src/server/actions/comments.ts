"use server";

import { refresh, revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PermissionError, assertCan } from "@/domain/permissions";
import {
  DOCUMENT_THREAD,
  type ActionResult,
  type LifecycleEffect,
  type NotificationLink,
} from "@/domain/review-types";
import type { PermissionResource, VersionState, Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { commentThreads, comments, templates, versions } from "@/server/db/schema/ucomp";
import { inTransaction, writeEffects } from "@/server/effects";
import { newId } from "@/server/ids";
import { blockIdsOf, loadChain, stageApproverIds, waitingStage } from "@/server/queries/review-shared";
import { getViewer } from "@/server/viewer";

// Review comments: start a thread on a block (or on the whole version), reply, resolve, reopen.
// Authors and approvers on the template's team comment (`review.comment`), and the same people
// resolve and reopen; so does whoever the stage a version waits on names, on any team (Phase 6). Every action checks the permission first, writes in one transaction with its
// audit row and notifications, and refreshes the page it came from.
//
// A "use server" file may export only async functions: the helpers below stay private.

const COMMENT_MAX = 4000;
const QUOTE_MAX = 500;

const REASONS = {
  empty: "Write a comment first.",
  tooLong: `Keep a comment under ${COMMENT_MAX.toLocaleString("en-US")} characters.`,
  noVersion: "This version no longer exists.",
  noThread: "This comment thread no longer exists.",
  noBlock: "That block isn't in this version any more.",
} as const;

// ── Helpers ───────────────────────────────────────────────────

/** `assertCan`, with the refusal returned as the action's answer instead of thrown. */
function check(viewer: Viewer, resource: PermissionResource): { ok: false; reason: string } | null {
  try {
    assertCan(viewer, "review.comment", resource);
    return null;
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, reason: error.reason };
    throw error;
  }
}

/**
 * The users the stage a version waits on names: they comment on it on any team (Phase 6). With no
 * version given, the template's version in review (a thread may have started on an earlier one).
 */
async function namedOnStage(
  templateId: string,
  version?: { state: VersionState; currentStage: number; contentTypeId: string },
): Promise<string[]> {
  const waiting =
    version ??
    (await db
      .select({ state: versions.state, currentStage: versions.currentStage, contentTypeId: templates.contentTypeId })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .where(and(eq(versions.templateId, templateId), eq(versions.state, "in_review")))
      .limit(1)
      .then((rows) => rows[0]));
  if (!waiting || waiting.state !== "in_review") return [];
  return stageApproverIds(waitingStage(await loadChain(db, waiting.contentTypeId), waiting.currentStage));
}

/** A comment's text: trimmed, not empty, not huge. */
function commentBody(body: string): { ok: true; body: string } | { ok: false; reason: string } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: REASONS.empty };
  if (trimmed.length > COMMENT_MAX) return { ok: false, reason: REASONS.tooLong };
  return { ok: true, body: trimmed };
}

/**
 * Where a comment notification leads: the review screen while the version is in review, else the
 * template. A numbered version also names itself, so a stage reviewer outside the team (who can't
 * open the template's workspace) gets its review screen in their own space.
 */
function commentLink(templateId: string, version: { number: number | null; state: VersionState }): NotificationLink {
  if (version.number === null) return { to: "template", templateId };
  return version.state === "in_review"
    ? { to: "review", templateId, versionNumber: version.number }
    : { to: "template", templateId, reviewVersion: version.number };
}

function versionLabel(templateName: string, version: { number: number | null }): string {
  return version.number === null ? `the draft of ${templateName}` : `${templateName} v${version.number}`;
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
 * Starts a thread on one block of a version (or on the whole version: `DOCUMENT_THREAD`), with its
 * first comment. The thread belongs to the template, so drafts made from this version show it too.
 * On a frozen version the block must be in its body; a draft's newest blocks may not be saved yet,
 * so a draft takes any block id (a thread whose block never lands reads as orphaned).
 * The version's author is notified.
 */
export async function addComment(input: {
  templateId: string;
  versionId: string;
  blockId: string;
  quote?: string | null;
  body: string;
}): Promise<ActionResult<{ threadId: string }>> {
  const viewer = await getViewer();

  // The version is read only to learn its team for the permission check (as in templates.ts).
  const parsed = AddCommentInput.safeParse(input);
  const found = parsed.success
    ? await db
        .select({
          templateId: templates.id,
          templateName: templates.name,
          teamId: templates.teamId,
          versionId: versions.id,
          number: versions.number,
          state: versions.state,
          body: versions.body,
          submittedBy: versions.submittedBy,
          createdBy: versions.createdBy,
          currentStage: versions.currentStage,
          contentTypeId: templates.contentTypeId,
        })
        .from(versions)
        .innerJoin(templates, eq(templates.id, versions.templateId))
        .where(and(eq(versions.id, parsed.data.versionId), eq(versions.templateId, parsed.data.templateId)))
        .limit(1)
        .then((rows) => rows[0])
    : undefined;
  const refused = check(viewer, {
    teamId: found?.teamId ?? null,
    stageApproverIds: found ? await namedOnStage(found.templateId, found) : [],
  });
  if (refused) return refused;
  if (!parsed.success || !found) return { ok: false, reason: REASONS.noVersion };

  const text = commentBody(parsed.data.body);
  if (!text.ok) return text;
  const { blockId } = parsed.data;
  if (blockId !== DOCUMENT_THREAD && found.state !== "draft" && !blockIdsOf(found.body).includes(blockId)) {
    return { ok: false, reason: REASONS.noBlock };
  }
  const quote = parsed.data.quote?.trim().slice(0, QUOTE_MAX) || null;

  const at = await now();
  const threadId = newId("th");
  const effects: LifecycleEffect[] = [
    {
      kind: "audit",
      action: "comment.added",
      details: { threadId, blockId, number: found.number, ...(quote ? { quote } : {}) },
    },
    {
      kind: "notification",
      notification: "comment_added",
      to: { kind: "user", userId: found.submittedBy ?? found.createdBy },
      title: `${viewer.name} commented on ${versionLabel(found.templateName, found)}.`,
      body: text.body,
      link: commentLink(found.templateId, found),
    },
  ];

  await inTransaction(db, async (tx) => {
    await tx.insert(commentThreads).values({
      id: threadId,
      templateId: found.templateId,
      originVersionId: found.versionId,
      blockId,
      quote,
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      createdAt: at,
    });
    await tx.insert(comments).values({
      id: newId("cm"),
      threadId,
      authorId: viewer.userId,
      body: text.body,
      kind: "comment",
      createdAt: at,
    });
    await writeEffects(tx, effects, {
      at,
      actorId: viewer.userId,
      teamId: found.teamId,
      templateId: found.templateId,
      versionId: found.versionId,
    });
  });

  refreshThreads();
  return { ok: true, threadId };
}

// ── Threads: reply, resolve, reopen ───────────────────────────

const ThreadInput = z.object({ threadId: z.string().min(1).max(64) });
const ReplyInput = ThreadInput.extend({ body: z.string() });

/** The thread with its template and origin version (who to tell, which team it's on). */
async function findThread(threadId: string) {
  return db
    .select({
      id: commentThreads.id,
      blockId: commentThreads.blockId,
      status: commentThreads.status,
      templateId: templates.id,
      templateName: templates.name,
      teamId: templates.teamId,
      versionId: versions.id,
      number: versions.number,
      state: versions.state,
      submittedBy: versions.submittedBy,
      createdBy: versions.createdBy,
    })
    .from(commentThreads)
    .innerJoin(templates, eq(templates.id, commentThreads.templateId))
    .innerJoin(versions, eq(versions.id, commentThreads.originVersionId))
    .where(eq(commentThreads.id, threadId))
    .limit(1)
    .then((rows) => rows[0]);
}

type FoundThread = NonNullable<Awaited<ReturnType<typeof findThread>>>;

function threadContext(thread: FoundThread, viewer: Viewer, at: Date) {
  return {
    at,
    actorId: viewer.userId,
    teamId: thread.teamId,
    templateId: thread.templateId,
    versionId: thread.versionId,
  };
}

/**
 * Adds a reply to a thread (open or resolved; a reply doesn't reopen it). Everyone who has written in
 * the thread, and the author of the version it started on, is notified (never the one replying).
 */
export async function reply(input: { threadId: string; body: string }): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = ReplyInput.safeParse(input);
  const thread = parsed.success ? await findThread(parsed.data.threadId) : undefined;
  const refused = check(viewer, {
    teamId: thread?.teamId ?? null,
    stageApproverIds: thread ? await namedOnStage(thread.templateId) : [],
  });
  if (refused) return refused;
  if (!parsed.success || !thread) return { ok: false, reason: REASONS.noThread };

  const text = commentBody(parsed.data.body);
  if (!text.ok) return text;
  const at = await now();

  await inTransaction(db, async (tx) => {
    const participants = await tx
      .selectDistinct({ authorId: comments.authorId })
      .from(comments)
      .where(eq(comments.threadId, thread.id));
    const recipients = new Set([thread.submittedBy ?? thread.createdBy, ...participants.map((p) => p.authorId)]);

    await tx.insert(comments).values({
      id: newId("cm"),
      threadId: thread.id,
      authorId: viewer.userId,
      body: text.body,
      kind: "comment",
      createdAt: at,
    });
    const effects: LifecycleEffect[] = [
      {
        kind: "audit",
        action: "comment.added",
        details: { threadId: thread.id, blockId: thread.blockId, number: thread.number, reply: true },
      },
      ...[...recipients].sort().map(
        (userId): LifecycleEffect => ({
          kind: "notification",
          notification: "comment_added",
          to: { kind: "user", userId },
          title: `${viewer.name} replied on ${versionLabel(thread.templateName, thread)}.`,
          body: text.body,
          link: commentLink(thread.templateId, thread),
        }),
      ),
    ];
    await writeEffects(tx, effects, threadContext(thread, viewer, at));
  });

  refreshThreads();
  return { ok: true };
}

/**
 * Resolves an open thread. Compare-and-set on the status: a second click (or a second person) finds it
 * resolved already and writes nothing; that still answers ok, since the thread is what was asked.
 */
export async function resolveThread(input: { threadId: string }): Promise<ActionResult> {
  return setStatus(input, "resolved");
}

/** Reopens a resolved thread (compare-and-set, as `resolveThread`). */
export async function reopenThread(input: { threadId: string }): Promise<ActionResult> {
  return setStatus(input, "open");
}

async function setStatus(input: { threadId: string }, to: "open" | "resolved"): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = ThreadInput.safeParse(input);
  const thread = parsed.success ? await findThread(parsed.data.threadId) : undefined;
  const refused = check(viewer, {
    teamId: thread?.teamId ?? null,
    stageApproverIds: thread ? await namedOnStage(thread.templateId) : [],
  });
  if (refused) return refused;
  if (!parsed.success || !thread) return { ok: false, reason: REASONS.noThread };

  const at = await now();
  const from = to === "resolved" ? "open" : "resolved";

  const changed = await inTransaction(db, async (tx) => {
    const [row] = await tx
      .update(commentThreads)
      .set(to === "resolved" ? { status: to, resolvedBy: viewer.userId, resolvedAt: at } : { status: to, resolvedBy: null, resolvedAt: null })
      .where(and(eq(commentThreads.id, thread.id), eq(commentThreads.status, from)))
      .returning({ id: commentThreads.id });
    if (!row) return false;
    await writeEffects(
      tx,
      [
        {
          kind: "audit",
          action: to === "resolved" ? "thread.resolved" : "thread.reopened",
          details: { threadId: thread.id, blockId: thread.blockId, number: thread.number },
        },
      ],
      threadContext(thread, viewer, at),
    );
    return true;
  });

  if (changed) refreshThreads();
  return { ok: true };
}
