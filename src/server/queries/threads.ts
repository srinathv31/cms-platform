import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { DOCUMENT_THREAD, type CommentView, type ThreadView } from "@/domain/review-types";
import type { JSONContent } from "@/domain/types";
import { db } from "@/server/db/client";
import { commentThreads, comments, versions } from "@/server/db/schema/ucomp";
import { pickLatest } from "./library";
import { blockIdsOf, getPeople, iso, isoOrUndefined, personOf, requireTemplate } from "./review-shared";

// Review threads. A thread belongs to the template and anchors to a stable block id, so a draft made
// from a version (same block ids) shows the version's threads in its margin with no copying.

/**
 * Whether a thread belongs on a frozen version's screen: it began no later than that version. A thread
 * that began in the open draft (no number yet) counts as the next number, the one the draft will take.
 * (A thread begun in v4's review is not part of v2's record.)
 */
export function threadBeganBy(originNumber: number | null, throughVersion: number, nextNumber: number): boolean {
  return (originNumber ?? nextNumber) <= throughVersion;
}

export interface LoadThreadsOptions {
  /**
   * The version being shown is frozen (it has been submitted): leave out the threads that began after it.
   * Without it, every thread on the template (the editor's margin).
   */
  throughVersion?: number | null;
}

/**
 * The template's threads, seen against one version's body.
 * Order: the document thread (a change request's reason) first, then threads in the order their
 * blocks appear, then orphaned threads (their block isn't in this body any more), oldest first.
 */
export async function loadThreads(
  templateId: string,
  body: JSONContent | null,
  { throughVersion = null }: LoadThreadsOptions = {},
): Promise<ThreadView[]> {
  const allRows = await db
    .select({
      id: commentThreads.id,
      blockId: commentThreads.blockId,
      quote: commentThreads.quote,
      status: commentThreads.status,
      resolvedBy: commentThreads.resolvedBy,
      resolvedAt: commentThreads.resolvedAt,
      createdAt: commentThreads.createdAt,
      originVersionNumber: versions.number,
    })
    .from(commentThreads)
    .innerJoin(versions, eq(versions.id, commentThreads.originVersionId))
    .where(eq(commentThreads.templateId, templateId));

  let threadRows = allRows;
  if (throughVersion !== null && allRows.length > 0) {
    const [{ newest }] = await db.select({ newest: max(versions.number) }).from(versions).where(eq(versions.templateId, templateId));
    const nextNumber = (newest ?? 0) + 1;
    threadRows = allRows.filter((t) => threadBeganBy(t.originVersionNumber, throughVersion, nextNumber));
  }
  if (threadRows.length === 0) return [];

  const [commentRows, people] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(inArray(comments.threadId, threadRows.map((t) => t.id)))
      .orderBy(asc(comments.createdAt), asc(comments.id)),
    getPeople(),
  ]);

  const byThread = new Map<string, CommentView[]>();
  for (const c of commentRows) {
    const view: CommentView = {
      id: c.id,
      author: personOf(people, c.authorId),
      body: c.body,
      kind: c.kind,
      createdAt: iso(c.createdAt),
    };
    const list = byThread.get(c.threadId);
    if (list) list.push(view);
    else byThread.set(c.threadId, [view]);
  }

  const position = new Map(blockIdsOf(body).map((id, index) => [id, index] as const));
  const rank = (blockId: string) => (blockId === DOCUMENT_THREAD ? -1 : (position.get(blockId) ?? Infinity));

  return threadRows
    .map((t) => {
      const resolved = t.status === "resolved";
      const view: ThreadView = {
        id: t.id,
        blockId: t.blockId,
        quote: t.quote,
        status: t.status,
        originVersionNumber: t.originVersionNumber,
        comments: byThread.get(t.id) ?? [],
        orphaned: rank(t.blockId) === Infinity,
      };
      if (resolved && t.resolvedBy) view.resolvedBy = personOf(people, t.resolvedBy);
      if (resolved) view.resolvedAt = isoOrUndefined(t.resolvedAt);
      return { view, rank: rank(t.blockId), createdAt: t.createdAt.getTime() };
    })
    .sort((a, b) => a.rank - b.rank || a.createdAt - b.createdAt || a.view.id.localeCompare(b.view.id))
    .map((t) => t.view);
}

/**
 * The template's threads for one of its versions (by id), or for what the workspace shows (the open
 * draft, else the latest version) when no version is named. 404 when the version isn't the template's.
 * A submitted version is a record: it shows the threads that began by then, not the later ones.
 */
export const getThreads = cache(
  async (spaceSlug: string, templateId: string, versionId?: string): Promise<ThreadView[]> => {
    const { template } = await requireTemplate(spaceSlug, templateId);
    const list = await db
      .select({ id: versions.id, number: versions.number, state: versions.state })
      .from(versions)
      .where(versionId ? and(eq(versions.templateId, template.id), eq(versions.id, versionId)) : eq(versions.templateId, template.id));
    const shown = versionId ? list[0] : pickLatest(list);
    if (!shown) notFound();
    const body = await db
      .select({ body: versions.body })
      .from(versions)
      .where(eq(versions.id, shown.id))
      .then((rows) => rows[0]?.body ?? null);
    return loadThreads(template.id, body, { throughVersion: shown.number });
  },
);
