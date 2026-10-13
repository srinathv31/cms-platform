// Review comments: threads anchored to a block (or a channel field, or the whole version), their replies,
// and resolving and reopening them (`src/domain/comments.ts` decides who may).
//
// `threads` runs behind the seam (local and fake; its facts are in ./threads.ts). The commands are typed for
// step 2b: they still run in src/server/actions/comments.ts.

import type { TemplateThreads } from "./threads";
import type { ActionResult, ReadResult, RequestContext } from "./types";

export interface CommentService {
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

  reply(
    ctx: RequestContext,
    input: { threadId: string; body: string },
  ): Promise<ActionResult>;

  resolve(
    ctx: RequestContext,
    input: { threadId: string },
  ): Promise<ActionResult>;

  reopen(
    ctx: RequestContext,
    input: { threadId: string },
  ): Promise<ActionResult>;

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
