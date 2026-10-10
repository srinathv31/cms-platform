import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { threadBeganBy } from "@/domain/comments";
import { DOCUMENT_THREAD, type CommentView, type ThreadView } from "@/domain/review-types";
import { asNumbered, nextRound, versionLabel, type RoundRef } from "@/domain/rounds";
import { db } from "@/server/db/client";
import { commentThreads, comments, versions } from "@/server/db/schema/ucomp";
import { pickLatest } from "./library";
import { anchorIdsOf, getPeople, iso, isoOrUndefined, personOf, requireTemplate } from "./review-shared";

// Review threads. A thread belongs to the template and anchors to a stable block id (or a channel field's
// id, "push.title": an alert's threads are on its fields), so a draft made from a version (same block ids)
// shows the version's threads in its margin with no copying. A frozen round shows the threads that began
// by it (`threadBeganBy` in domain/comments.ts).

export interface LoadThreadsOptions {
  /**
   * The round being shown is frozen (it has been submitted): leave out the threads that began after it,
   * by number and then round. Without it, every thread on the template (the editor's margin).
   */
  through?: RoundRef | null;
}

/**
 * The template's threads, seen against one version's anchors (`anchorIdsOf`: its channels' fields, then
 * its body's blocks).
 * Order: the document thread (a change request's reason) first, then threads in the order their
 * anchors appear, then orphaned threads (their block isn't in this version any more), oldest first.
 */
export async function loadThreads(
  templateId: string,
  anchors: readonly string[],
  { through = null }: LoadThreadsOptions = {},
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
      originRound: versions.round,
      originState: versions.state,
    })
    .from(commentThreads)
    .innerJoin(versions, eq(versions.id, commentThreads.originVersionId))
    .where(eq(commentThreads.templateId, templateId));

  const originOf = (t: (typeof allRows)[number]) =>
    t.originVersionNumber === null
      ? null
      : asNumbered({ number: t.originVersionNumber, round: t.originRound, state: t.originState });

  let threadRows = allRows;
  if (through !== null && allRows.length > 0) {
    // A thread begun in the open draft counts as the round the draft will be.
    const rows = await db
      .select({ number: versions.number, round: versions.round, state: versions.state })
      .from(versions)
      .where(eq(versions.templateId, templateId));
    const next = nextRound(rows);
    threadRows = allRows.filter((t) => threadBeganBy(originOf(t), through, next));
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

  const position = new Map(anchors.map((id, index) => [id, index] as const));
  const rank = (blockId: string) => (blockId === DOCUMENT_THREAD ? -1 : (position.get(blockId) ?? Infinity));

  return threadRows
    .map((t) => {
      const resolved = t.status === "resolved";
      const origin = originOf(t);
      const view: ThreadView = {
        id: t.id,
        blockId: t.blockId,
        quote: t.quote,
        status: t.status,
        originVersionNumber: t.originVersionNumber,
        originRound: origin?.round ?? null,
        originLabel: origin ? versionLabel(origin, { history: true }) : null,
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
 * draft, else the latest round) when no version is named. 404 when the version isn't the template's.
 * A submitted round is a record: it shows the threads that began by then, not the later ones.
 */
export const getThreads = cache(
  async (spaceSlug: string, templateId: string, versionId?: string): Promise<ThreadView[]> => {
    const { template } = await requireTemplate(spaceSlug, templateId);
    const list = await db
      .select({ id: versions.id, number: versions.number, round: versions.round, state: versions.state })
      .from(versions)
      .where(versionId ? and(eq(versions.templateId, template.id), eq(versions.id, versionId)) : eq(versions.templateId, template.id));
    const shown = versionId ? list[0] : pickLatest(list);
    if (!shown) notFound();
    const anchors = await db
      .select({ body: versions.body, channels: versions.channels })
      .from(versions)
      .where(eq(versions.id, shown.id))
      .then((rows) => (rows[0] ? anchorIdsOf(rows[0]) : []));
    return loadThreads(template.id, anchors, { through: shown.number === null ? null : asNumbered(shown) });
  },
);
