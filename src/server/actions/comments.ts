"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/domain/review-types";
import { services } from "@/server/services";
import type { Changed } from "@/server/services/types";
import { serverAction } from "./kit";

// Review comments: start a thread on a block or a channel field (or on the whole version), reply, resolve, reopen,
// on the server action kit (kit.ts), behind the comment service (src/server/services/comments.ts). The rules are
// the domain's (src/domain/comments.ts) and the backend applies them: which versions take comments, who may act on
// which thread, the text's limits, and who is told. The BFF parses the input and refreshes the pages that show
// threads once the backend has written.
//
// A "use server" file may export only async functions: the helpers below stay private.

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
    call: (ctx, comment) => services().comments.add(ctx, comment),
    after: refreshThreads,
  });
}

// ── Threads: reply, resolve, reopen ───────────────────────────

const ThreadInput = z.object({ threadId: z.string().min(1).max(64) });
const ReplyInput = ThreadInput.extend({ body: z.string() });

/**
 * Adds a reply to a thread (open or resolved; a reply doesn't reopen it). Everyone who has written in the
 * thread, and the author of the version it started on, is notified (never the one replying).
 */
export async function reply(input: {
  threadId: string;
  body: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: ReplyInput,
    call: (ctx, comment) => services().comments.reply(ctx, comment),
    after: refreshThreads,
  });
}

/**
 * Resolves an open thread. Compare-and-set on the status: a second click (or a second person) finds it
 * resolved already and writes nothing; that still answers ok, since the thread is what was asked.
 */
export async function resolveThread(input: {
  threadId: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: ThreadInput,
    call: (ctx, { threadId }) => services().comments.resolve(ctx, { threadId }),
    after: refreshIfChanged,
  }).then(withoutChanged);
}

/** Reopens a resolved thread (compare-and-set, as `resolveThread`). */
export async function reopenThread(input: {
  threadId: string;
}): Promise<ActionResult> {
  return serverAction(input, {
    input: ThreadInput,
    call: (ctx, { threadId }) => services().comments.reopen(ctx, { threadId }),
    after: refreshIfChanged,
  }).then(withoutChanged);
}

/** The pages refresh only when the backend wrote: a second click finds nothing to change. */
function refreshIfChanged({ changed }: Changed) {
  if (changed) refreshThreads();
}

/** The action answers `{ ok: true }`: whether the service wrote is the kit's business (`after`), not the page's. */
function withoutChanged(result: ActionResult<Changed>): ActionResult {
  return result.ok ? { ok: true } : result;
}
