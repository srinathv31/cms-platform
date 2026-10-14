import { anchorIdsOf, inReadingOrder, threadBeganBy } from "@/domain/comments";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import {
  asNumbered,
  latestVersion,
  nextRound,
  type NumberedRound,
} from "@/domain/rounds";
import type { CommentService } from "../comments";
import { refusal } from "../results";
import type { ThreadFacts } from "../threads";
import { peopleOf } from "./people";
import type { FakeState } from "./state";
import { templateById } from "./version-rows";
import type { FakeDeps } from "./index";

// Review threads in memory: the twin of services/local/threads.ts, over the fake's threads and comments, with the
// same domain rules (`threadBeganBy`, `inReadingOrder`). The contract suite observes the comment commands through
// it.

export function fakeThreads({
  store,
}: FakeDeps): Pick<CommentService, "threads"> {
  return {
    async threads(ctx, { templateId, versionId }) {
      const { state } = store;
      const template = templateById(state, templateId);
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const rows = state.versions.filter((v) => v.templateId === template.id);
      const shown = versionId
        ? rows.find((v) => v.id === versionId)
        : latestVersion(rows);
      if (!shown) return refusal(404, REQUEST_REFUSALS.versionUnavailable);
      const threads = fakeThreadsOf(state, template.id, anchorIdsOf(shown), {
        through: shown.number === null ? null : asNumbered(shown),
      });
      return {
        ok: true,
        template: { id: template.id, teamId: template.teamId },
        versionId: shown.id,
        threads,
        people: peopleOf(
          state,
          threads.flatMap((t) => [
            ...t.comments.map((c) => c.authorId),
            t.resolvedBy,
          ]),
        ),
      };
    },
  };
}

/** The twin of `loadThreads`: the template's threads against `anchors`, through a frozen round when given. */
export function fakeThreadsOf(
  state: FakeState,
  templateId: string,
  anchors: readonly string[],
  { through }: { through: NumberedRound | null },
): ThreadFacts[] {
  const rows = state.versions.filter((v) => v.templateId === templateId);
  const originOf = (versionId: string): NumberedRound | null => {
    const origin = rows.find((v) => v.id === versionId);
    return origin && origin.number !== null ? asNumbered(origin) : null;
  };
  // A thread begun in the open draft counts as the round the draft will be.
  const next = nextRound(rows);
  const shown = state.commentThreads.filter(
    (t) =>
      t.templateId === templateId &&
      (through === null ||
        threadBeganBy(originOf(t.originVersionId), through, next)),
  );
  return inReadingOrder(shown, anchors).map((t): ThreadFacts => {
    const resolved = t.status === "resolved";
    return {
      id: t.id,
      blockId: t.blockId,
      quote: t.quote,
      status: t.status,
      origin: originOf(t.originVersionId),
      comments: state.comments
        .filter((c) => c.threadId === t.id)
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        .map((c) => ({
          id: c.id,
          authorId: c.authorId,
          body: c.body,
          kind: c.kind,
          createdAt: c.createdAt.toISOString(),
        })),
      resolvedBy: resolved ? t.resolvedBy : null,
      resolvedAt: resolved ? (t.resolvedAt?.toISOString() ?? null) : null,
      orphaned: t.orphaned,
    };
  });
}
