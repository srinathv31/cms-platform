// Review comments: threads anchored to a block (or a channel field, or the whole version), their replies,
// and resolving and reopening them (`src/domain/comments.ts` decides who may).
//
// Typed for step 2b: they still run in src/server/actions/comments.ts and src/server/queries/threads.ts.

import type {
  ActionResult,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";

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

  /** The template's threads, or one version's. */
  threads(
    ctx: RequestContext,
    input: { templateId: string; versionId?: string },
  ): Promise<ReadResult<Unsettled<"P4a: the threads' facts">>>;
}
