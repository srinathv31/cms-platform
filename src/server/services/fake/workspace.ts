import { anchorIdsOf, canComment } from "@/domain/comments";
import type { ImportKind } from "@/domain/import-report";
import { contractBaseline } from "@/domain/lifecycle/baselines";
import { smsFooterOf } from "@/domain/lifecycle/submit";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { latestVersion } from "@/domain/rounds";
import { contentTypeFamily } from "@/domain/types";
import { refusal } from "../results";
import type { TemplateService } from "../templates";
import type { ImportOriginalFacts } from "../workspace";
import { peopleOf } from "./people";
import type { FakeState } from "./state";
import { fakeThreadsOf } from "./threads";
import { templateById } from "./version-rows";
import type { FakeDeps } from "./index";

// The workspace's document in memory: the twin of `workspaceDocument` in services/local/workspace.ts, with the same
// domain rules (`latestVersion`, `contractBaseline`, `smsFooterOf`, the permission and comment checks). It is the
// read the contract suite observes a draft through (what New template, Import, Edit, a change request and an
// autosave stored); the workspace header stays local.

export function fakeWorkspace({
  store,
  clock,
}: FakeDeps): Pick<TemplateService, "workspaceDocument"> {
  return {
    async workspaceDocument(ctx, { templateId }) {
      const asOf = await clock();
      const { state } = store;
      const template = templateById(state, templateId);
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const team = state.teams.find((t) => t.id === template.teamId);
      const contentType = state.contentTypes.find(
        (c) => c.id === template.contentTypeId,
      );
      const rows = state.versions.filter((v) => v.templateId === template.id);
      const shown = latestVersion(rows);
      if (!shown || !team || !contentType)
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const threads = fakeThreadsOf(state, template.id, anchorIdsOf(shown), {
        through: null,
      });
      const importOriginal = importOriginalOf(state, template.id);

      return {
        ok: true,
        asOf: asOf.toISOString(),
        template: {
          id: template.id,
          teamId: template.teamId,
          teamName: team.name,
          family: contentTypeFamily(contentType.allowedChannels),
          allowedChannels: contentType.allowedChannels,
        },
        version: {
          id: shown.id,
          number: shown.state === "draft" ? null : shown.number,
          round: shown.state === "draft" ? null : shown.round,
          state: shown.state,
          rev: shown.rev,
          body: structuredClone(shown.body),
          variables: structuredClone(shown.variables),
          channels: [...shown.channels],
          channelFields: structuredClone(shown.channelFields),
          sampleSets: structuredClone(shown.sampleSets),
        },
        baseline:
          shown.state === "draft"
            ? (structuredClone(contractBaseline(rows, asOf)?.variables) ?? null)
            : null,
        messageRules: {
          smsFooter: smsFooterOf(shown, contentType.smsFooter),
          smsMaxParts: contentType.smsMaxParts,
        },
        senders: { appName: team.appName, smsSender: team.smsSender },
        threads,
        can: {
          edit: can(ctx.viewer, "draft.edit", { teamId: template.teamId }),
          comment: canComment(ctx.viewer, {
            teamId: template.teamId,
            version: { state: shown.state, stageApproverIds: [] },
          }),
        },
        importOriginal,
        people: peopleOf(state, [
          ...threads.flatMap((t) => [
            ...t.comments.map((c) => c.authorId),
            t.resolvedBy,
          ]),
          importOriginal?.uploadedBy,
          ctx.viewer.userId,
        ]),
      };
    },
  };
}

/** The upload paths the fake writes (as the local store does): "<uploadId>/original.<kind>". */
const ORIGINAL_PATH = /\/original\.(docx|pdf|txt)$/;

/** The file the template was imported from (the newest, should there ever be more); null when it wasn't imported. */
function importOriginalOf(
  state: FakeState,
  templateId: string,
): ImportOriginalFacts | null {
  const row = state.uploads
    .filter((u) => u.templateId === templateId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const kind = row ? (ORIGINAL_PATH.exec(row.path)?.[1] as ImportKind) : null;
  return row && kind
    ? {
        uploadId: row.id,
        filename: row.filename,
        kind,
        size: row.size,
        uploadedAt: row.createdAt.toISOString(),
        uploadedBy: row.createdBy,
      }
    : null;
}
