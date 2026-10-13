// Review threads as facts: what `CommentService.threads` answers, and what the review screen and the workspace
// document carry for their margins. People are named by id (with the `Person`s beside them) and a thread's origin
// is the round it began on; the BFF words the labels ("on v3 · Round 1") and lays the threads out.

import type { Person } from "@/domain/review-types";
import type { NumberedRound } from "@/domain/rounds";

/** One comment of a thread. */
export interface CommentFacts {
  id: string;
  /** User id. */
  authorId: string;
  body: string;
  kind: "comment" | "change_request";
  /** ISO. */
  createdAt: string;
}

/**
 * A thread, seen against one version's anchors (`anchorIdsOf`: the fields of its channels, then its body's
 * blocks). It belongs to the template, so a draft made from a version (same block ids) shows the version's
 * threads with no copying.
 */
export interface ThreadFacts {
  id: string;
  /** The block, channel field ("push.title") or `DOCUMENT_THREAD` it anchors to. */
  blockId: string;
  quote: string | null;
  status: "open" | "resolved";
  /** The round it began on, as that row is now; null when it began in the open draft. */
  origin: NumberedRound | null;
  /** Oldest first. */
  comments: CommentFacts[];
  /** User id; null while open. */
  resolvedBy: string | null;
  /** ISO; null while open. */
  resolvedAt: string | null;
  /** Its anchor isn't in the version it is seen against (deleted since). */
  orphaned: boolean;
}

/** A template's threads, seen against one of its versions. */
export interface TemplateThreads {
  template: { id: string; teamId: string };
  /** The version they are seen against: the one asked for, or else the workspace's (its open draft, else its latest round). */
  versionId: string;
  /**
   * In reading order: the document threads (a change request's reason) first, then by where their anchors
   * appear, then the orphaned ones; oldest first within each. A submitted round is a record: it leaves out the
   * threads that began after it (`threadBeganBy`).
   */
  threads: ThreadFacts[];
  /** Everyone the threads name. */
  people: Person[];
}
