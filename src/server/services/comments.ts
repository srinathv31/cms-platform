// Review comments: threads anchored to a block (or a channel field, or the whole version), their replies,
// and resolving and reopening them (`src/domain/comments.ts` decides who may).
//
// The four commands and `threads` run behind the seam, local and fake; the threads' facts are in ./threads.ts.

import type { TemplateThreads } from "./threads";
import type {
  ActionResult,
  Changed,
  ReadResult,
  RequestContext,
} from "./types";

export interface CommentService {
  /**
   * Starts a thread on one block of a draft or a version in review (or on a channel field, or the whole version:
   * `DOCUMENT_THREAD`), with its first comment, both dated by the backend's clock. The thread belongs to the
   * template, so drafts made from this version show it too; the version's author is told, unless they wrote it.
   * Refuses, in order: the permission (`generic`; a version that isn't the template's is refused the same),
   * `comments_closed` (only a draft and a version in review take comments), `comment_empty`, `comment_too_long`,
   * `block_gone` (a version in review takes only the anchors it has).
   */
  add(
    ctx: RequestContext,
    input: {
      templateId: string;
      versionId: string;
      blockId: string;
      quote?: string | null;
      body: string;
    },
  ): Promise<ActionResult<{ threadId: string }>>;

  /**
   * One more comment in a thread, open or resolved (a reply doesn't reopen it). Everyone who has written in the
   * thread, and the author of the version it began on, is told, never the one replying. Refuses, in order: the
   * permission (`generic`; an unknown thread is refused the same), `comments_closed` (no version of the template
   * takes comments where the thread shows), `comment_empty`, `comment_too_long`.
   */
  reply(
    ctx: RequestContext,
    input: { threadId: string; body: string },
  ): Promise<ActionResult>;

  /**
   * Resolves an open thread. A compare-and-set on its status: a second click, or a second person, finds it resolved
   * and writes nothing (`changed` is false), which is still ok. Refuses as `reply` does, without the text rules.
   */
  resolve(
    ctx: RequestContext,
    input: { threadId: string },
  ): Promise<ActionResult<Changed>>;

  /** Reopens a resolved thread; compare-and-set, refusals and `changed` as `resolve`. */
  reopen(
    ctx: RequestContext,
    input: { threadId: string },
  ): Promise<ActionResult<Changed>>;

  /**
   * The template's threads seen against one of its versions (`versionId`), or without one against what the
   * workspace shows (the open draft, else the latest round). A submitted round is a record: it shows only the
   * threads that began by it. Refuses 404 `template_unavailable` when the template doesn't exist or the viewer
   * may not see its team, then 404 `version_unavailable` when `versionId` isn't one of its versions.
   */
  threads(
    ctx: RequestContext,
    input: { templateId: string; versionId?: string },
  ): Promise<ReadResult<TemplateThreads>>;
}
