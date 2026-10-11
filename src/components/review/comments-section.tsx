"use client";

import { ThreadList } from "@/components/comments";
import type { Person, ReviewScreenData } from "@/domain/review-types";
import { BlockCommentMenu } from "./block-comment-menu";
import { SectionLabel } from "./rail-sections";
import type { ReviewCommentsState } from "./use-review-comments";
import type { ReviewView } from "./view-tabs";

/**
 * The rail's Comments section: the open count, the menu that comments on a block from the keyboard (on the
 * Document view only), and the thread list with the comment box. The state is `useReviewComments`'.
 */
export function CommentsSection({
  comments,
  data,
  view,
  viewer,
  nowIso,
}: {
  comments: ReviewCommentsState;
  data: ReviewScreenData;
  view: ReviewView;
  /** Who is looking. */
  viewer: Person;
  nowIso: string;
}) {
  const { template, version } = data;
  const canComment = data.can.comment.ok;

  return (
    <section aria-labelledby="review-comments" className="mt-8">
      <SectionLabel
        id="review-comments"
        right={
          <div className="flex items-center gap-3">
            {comments.openThreads > 0 ? <span className="text-[12px] text-text-subtle">{comments.openThreads} open</span> : null}
            {canComment && view === "document" ? (
              <BlockCommentMenu
                family={template.family}
                body={version.body}
                channels={version.channels}
                variables={version.variables}
                onPick={comments.pickBlock}
                triggerRef={comments.menuButton}
              />
            ) : null}
          </div>
        }
      >
        Comments
      </SectionLabel>
      <ThreadList
        className="mt-3"
        threads={comments.threads}
        activeThreadId={comments.activeThreadId}
        onActivate={comments.activate}
        canComment={canComment}
        composer={comments.composer}
        onComposerClose={comments.onComposerClose}
        templateId={template.id}
        versionId={version.id}
        viewer={viewer}
        now={nowIso}
        blockText={comments.blockText}
        blockPosition={comments.blockPosition}
        onMutate={comments.mutate}
      />
    </section>
  );
}
