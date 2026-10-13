import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { anchorIdsOf, inReadingOrder, threadBeganBy } from "@/domain/comments";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import {
  asNumbered,
  latestVersion,
  nextRound,
  type RoundRef,
} from "@/domain/rounds";
import { db } from "@/server/db/client";
import { commentThreads, comments, versions } from "@/server/db/schema/ucomp";
import type { CommentService } from "../comments";
import { refusal } from "../results";
import type { CommentFacts, ThreadFacts } from "../threads";
import { loadPeople } from "./people";
import { visibleTemplate } from "./visible-template";

// Review threads on this app's own database (src/server/services/comments.ts says what `threads` promises). A
// thread belongs to the template and anchors to a stable block id (or a channel field's id, "push.title"), so a
// draft made from a version (same block ids) shows the version's threads with no copying. A frozen round shows
// the threads that began by it (`threadBeganBy`). The review screen and the workspace document load their
// margins with `loadThreads` too.

export function localThreads(): Pick<CommentService, "threads"> {
  return {
    async threads(ctx, { templateId, versionId }) {
      const template = await visibleTemplate(ctx.viewer, templateId);
      if (!template) return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const rows = await db
        .select({
          id: versions.id,
          number: versions.number,
          round: versions.round,
          state: versions.state,
          body: versions.body,
          channels: versions.channels,
        })
        .from(versions)
        .where(eq(versions.templateId, template.id));
      const shown = versionId
        ? rows.find((v) => v.id === versionId)
        : latestVersion(rows);
      if (!shown) return refusal(404, REQUEST_REFUSALS.versionUnavailable);
      const threads = await loadThreads(template.id, anchorIdsOf(shown), {
        through: shown.number === null ? null : asNumbered(shown),
      });
      return {
        ok: true,
        template: { id: template.id, teamId: template.teamId },
        versionId: shown.id,
        threads,
        people: await loadPeople(peopleIn(threads)),
      };
    },
  };
}

/**
 * The template's threads, seen against one version's anchors (`anchorIdsOf`: its channels' fields, then its
 * body's blocks), in reading order (`inReadingOrder`). With `through` (the round shown is frozen: it has been
 * submitted), the threads that began after it are left out (`threadBeganBy`); without it, every thread on the
 * template (the editor's margin).
 */
export async function loadThreads(
  templateId: string,
  anchors: readonly string[],
  { through = null }: { through?: RoundRef | null } = {},
): Promise<ThreadFacts[]> {
  const rows = await db
    .select({
      id: commentThreads.id,
      blockId: commentThreads.blockId,
      quote: commentThreads.quote,
      status: commentThreads.status,
      resolvedBy: commentThreads.resolvedBy,
      resolvedAt: commentThreads.resolvedAt,
      createdAt: commentThreads.createdAt,
      originNumber: versions.number,
      originRound: versions.round,
      originState: versions.state,
    })
    .from(commentThreads)
    .innerJoin(versions, eq(versions.id, commentThreads.originVersionId))
    .where(eq(commentThreads.templateId, templateId));
  const originOf = (t: (typeof rows)[number]) =>
    t.originNumber === null
      ? null
      : asNumbered({
          number: t.originNumber,
          round: t.originRound,
          state: t.originState,
        });

  let shown = rows;
  if (through !== null && rows.length > 0) {
    // A thread begun in the open draft counts as the round the draft will be.
    const next = nextRound(
      await db
        .select({
          number: versions.number,
          round: versions.round,
          state: versions.state,
        })
        .from(versions)
        .where(eq(versions.templateId, templateId)),
    );
    shown = rows.filter((t) => threadBeganBy(originOf(t), through, next));
  }
  if (shown.length === 0) return [];

  const commentRows = await db
    .select()
    .from(comments)
    .where(
      inArray(
        comments.threadId,
        shown.map((t) => t.id),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id));
  const byThread = new Map<string, CommentFacts[]>();
  for (const c of commentRows) {
    const facts: CommentFacts = {
      id: c.id,
      authorId: c.authorId,
      body: c.body,
      kind: c.kind,
      createdAt: c.createdAt.toISOString(),
    };
    byThread.set(c.threadId, [...(byThread.get(c.threadId) ?? []), facts]);
  }

  return inReadingOrder(shown, anchors).map((t): ThreadFacts => {
    const resolved = t.status === "resolved";
    return {
      id: t.id,
      blockId: t.blockId,
      quote: t.quote,
      status: t.status,
      origin: originOf(t),
      comments: byThread.get(t.id) ?? [],
      resolvedBy: resolved ? t.resolvedBy : null,
      resolvedAt: resolved ? (t.resolvedAt?.toISOString() ?? null) : null,
      orphaned: t.orphaned,
    };
  });
}

/** Everyone the threads name: each comment's author and whoever resolved a thread. */
export function peopleIn(threads: readonly ThreadFacts[]): string[] {
  return threads.flatMap((t) => [
    ...t.comments.map((c) => c.authorId),
    ...(t.resolvedBy ? [t.resolvedBy] : []),
  ]);
}
