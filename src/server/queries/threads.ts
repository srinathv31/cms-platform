import "server-only";
import type { Person } from "@/domain/review-types";
import { versionLabel } from "@/domain/rounds";
import type { ThreadFacts } from "@/server/services/threads";
import { personOf, type People } from "./people";

// Review threads as the screens show them. A thread belongs to the template and anchors to a stable block id (or
// a channel field's id, "push.title": an alert's threads are on its fields), so a draft made from a version (same
// block ids) shows the version's threads in its margin with no copying. The facts (which threads, in what order,
// which are orphaned) come with the review screen's and the workspace document's (services/threads.ts); this
// words them and names their people.

export interface CommentView {
  id: string;
  author: Person;
  body: string;
  kind: "comment" | "change_request";
  createdAt: string;
}

/**
 * A review thread. Threads belong to the template and anchor to a stable block id, so a draft made
 * from a version (same block ids) carries them into the editor margin automatically.
 */
export interface ThreadView {
  // The editor's ThreadAnchor fields (structurally compatible with `ThreadAnchor` in @/editor/types).
  id: string;
  blockId: string;
  quote: string | null;
  status: "open" | "resolved";
  originVersionNumber: number | null;
  /** The round of the version it began on; null when it began in the open draft. */
  originRound: number | null;
  /** The version it began on, for "on v3 · Round 1" (chrome, with history); null for the open draft. */
  originLabel: string | null;
  comments: CommentView[];
  resolvedBy?: Person;
  resolvedAt?: string;
  /** The block isn't in the version being shown (deleted since). Listed after the anchored ones. */
  orphaned: boolean;
}

/** The threads as a margin lists them, in the order the service answered them. */
export function threadViews(
  threads: readonly ThreadFacts[],
  people: People,
): ThreadView[] {
  return threads.map((t) => {
    const view: ThreadView = {
      id: t.id,
      blockId: t.blockId,
      quote: t.quote,
      status: t.status,
      originVersionNumber: t.origin?.number ?? null,
      originRound: t.origin?.round ?? null,
      originLabel: t.origin ? versionLabel(t.origin, { history: true }) : null,
      comments: t.comments.map((c) => ({
        id: c.id,
        author: personOf(people, c.authorId),
        body: c.body,
        kind: c.kind,
        createdAt: c.createdAt,
      })),
      orphaned: t.orphaned,
    };
    if (t.status === "resolved") {
      if (t.resolvedBy) view.resolvedBy = personOf(people, t.resolvedBy);
      if (t.resolvedAt) view.resolvedAt = t.resolvedAt;
    }
    return view;
  });
}
