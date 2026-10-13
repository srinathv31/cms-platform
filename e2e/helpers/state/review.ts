import { insert, select, type InValue } from "./db";
import {
  fromRow,
  newId,
  toColumns,
  type ApprovalRecord,
  type CommentRecord,
  type CommentThreadRecord,
} from "./records";

// The review trail on a version: who decided it at each stage, and the comment threads on its blocks.

/** The decisions on one version, oldest first. */
export async function approvalsOf(
  versionId: string,
): Promise<ApprovalRecord[]> {
  return (
    await select(
      "SELECT * FROM approvals WHERE version_id = ? ORDER BY decided_at, stage_position, id",
      [versionId],
    )
  ).map((row) => fromRow<ApprovalRecord>("approvals", row));
}

/** Every decision on any version of a template, oldest first, each with the number and round it decided. */
export async function decisionsOnTemplate(
  templateId: string,
): Promise<(ApprovalRecord & { number: number; round: number })[]> {
  return (
    await select(
      `SELECT a.*, v.number, v.round FROM approvals a JOIN versions v ON v.id = a.version_id
       WHERE v.template_id = ? ORDER BY a.decided_at, a.id`,
      [templateId],
    )
  ).map((row) =>
    fromRow<ApprovalRecord & { number: number; round: number }>(
      "approvals",
      row,
    ),
  );
}

export interface ThreadFilter {
  id?: string;
  blockId?: string;
  status?: "open" | "resolved";
}

/** A template's comment threads, oldest first. */
export async function commentThreads(
  templateId: string,
  filter: ThreadFilter = {},
): Promise<CommentThreadRecord[]> {
  const where = ["template_id = ?"];
  const args: InValue[] = [templateId];
  if (filter.id !== undefined) {
    where.push("id = ?");
    args.push(filter.id);
  }
  if (filter.blockId !== undefined) {
    where.push("block_id = ?");
    args.push(filter.blockId);
  }
  if (filter.status !== undefined) {
    where.push("status = ?");
    args.push(filter.status);
  }
  return (
    await select(
      `SELECT * FROM comment_threads WHERE ${where.join(" AND ")} ORDER BY created_at, id`,
      args,
    )
  ).map((row) => fromRow<CommentThreadRecord>("comment_threads", row));
}

/** One thread by id, wherever it is. */
export async function commentThread(
  threadId: string,
): Promise<CommentThreadRecord | undefined> {
  const rows = await select("SELECT * FROM comment_threads WHERE id = ?", [
    threadId,
  ]);
  return rows[0]
    ? fromRow<CommentThreadRecord>("comment_threads", rows[0])
    : undefined;
}

/** The comments in a thread, oldest first. */
export async function commentsIn(threadId: string): Promise<CommentRecord[]> {
  return (
    await select(
      "SELECT * FROM comments WHERE thread_id = ? ORDER BY created_at, id",
      [threadId],
    )
  ).map((row) => fromRow<CommentRecord>("comments", row));
}

/**
 * Leaves a thread with one comment on a block of a version, as a review would have (the person commented a day
 * ago). The template owns the rows: watch or remove the template to take them out again.
 */
export async function addCommentThread(thread: {
  templateId: string;
  versionId: string;
  blockId: string;
  quote: string | null;
  authorId: string;
  comment: string;
  id?: string;
}): Promise<{ threadId: string; commentId: string }> {
  const at = Date.now() - 86_400_000;
  const threadId = thread.id ?? newId("th");
  const commentId = newId("cm");
  await insert(
    "comment_threads",
    toColumns("comment_threads", {
      id: threadId,
      templateId: thread.templateId,
      originVersionId: thread.versionId,
      blockId: thread.blockId,
      quote: thread.quote,
      status: "open",
      createdAt: at,
    }),
  );
  await insert(
    "comments",
    toColumns("comments", {
      id: commentId,
      threadId,
      authorId: thread.authorId,
      body: thread.comment,
      kind: "comment",
      createdAt: at,
    }),
  );
  return { threadId, commentId };
}
