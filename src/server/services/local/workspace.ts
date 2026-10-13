import "server-only";
import { desc, eq } from "drizzle-orm";
import { sunsetDay } from "@/domain/business-zone";
import { anchorIdsOf, canComment } from "@/domain/comments";
import { contractBaseline } from "@/domain/lifecycle/baselines";
import { smsFooterOf } from "@/domain/lifecycle/submit";
import { sunsetPassed } from "@/domain/lifecycle/sunset";
import { workspaceActions } from "@/domain/lifecycle/version-actions";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import {
  asNumbered,
  latestVersion,
  nextRound,
  type RoundRef,
} from "@/domain/rounds";
import { contentTypeFamily } from "@/domain/types";
import { db } from "@/server/db/client";
import {
  contentTypes,
  teams,
  templates,
  uploads,
  versions,
} from "@/server/db/schema/ucomp";
import { kindOfPath } from "@/server/import/store";
import { refusal } from "../results";
import type { TemplateService } from "../templates";
import type { ImportOriginalFacts } from "../workspace";
import { readBusinessZone } from "./business-zone";
import type { LocalDeps } from "./command";
import { loadPeople } from "./people";
import { loadThreads, peopleIn } from "./threads";
import { visibleTemplate } from "./visible-template";

// A template's workspace on this app's own database (src/server/services/templates.ts says what the two reads
// promise): the version it shows (the open draft, else the latest round: `latestVersion`), what the viewer may do
// there (`workspaceActions`), and the document the Content tab edits or shows, with its margin's threads.

type WorkspaceReads = Pick<
  TemplateService,
  "workspaceHeader" | "workspaceDocument"
>;

export function localWorkspace(deps: LocalDeps): WorkspaceReads {
  return {
    async workspaceHeader(ctx, { templateId }) {
      const template = await visibleTemplate(ctx.viewer, templateId);
      if (!template) return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const asOf = await deps.clock();
      const [rows, zone] = await Promise.all([
        db
          .select({
            id: versions.id,
            number: versions.number,
            round: versions.round,
            state: versions.state,
            name: versions.name,
            sunsetAt: versions.sunsetAt,
            basedOnVersionId: versions.basedOnVersionId,
            rev: versions.rev,
          })
          .from(versions)
          .where(eq(versions.templateId, template.id)),
        readBusinessZone(db),
      ]);

      const shown = latestVersion(rows);
      const numbered = (row: (typeof rows)[number] | undefined) =>
        row && row.number !== null ? asNumbered(row) : null;
      const draft = shown?.state === "draft" ? shown : undefined;
      const active = rows.find((v) => v.state === "active");
      return {
        ok: true,
        asOf: asOf.toISOString(),
        template: {
          id: template.id,
          teamId: template.teamId,
          teamSlug: template.teamSlug,
          teamName: template.teamName,
          contentTypeId: template.contentTypeId,
        },
        shown: shown
          ? {
              id: shown.id,
              number: shown.number,
              round: shown.round,
              state: shown.state,
              name: shown.name,
              sunsetDay: shown.sunsetAt
                ? sunsetDay(shown.sunsetAt, zone)
                : null,
              sunsetPassed: sunsetPassed(shown, asOf),
              rev: shown.rev,
            }
          : null,
        // A draft is numbered as its submit will number it: the next version, or the next round of the one sent back.
        numbered:
          !shown || draft ? nextRound(rows) : roundOf(asNumbered(shown)),
        basedOn: draft?.basedOnVersionId
          ? numbered(rows.find((v) => v.id === draft.basedOnVersionId))
          : null,
        active:
          active && active.number !== null
            ? { number: active.number, name: active.name }
            : null,
        inReview: numbered(
          rows.find((v) => v.state === "in_review" && v.number !== null),
        ),
        can: workspaceActions(ctx.viewer, template.teamId, rows),
      };
    },

    async workspaceDocument(ctx, { templateId }) {
      const template = await visibleTemplate(ctx.viewer, templateId);
      if (!template) return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const asOf = await deps.clock();
      const [rows, [setup], importOriginal] = await Promise.all([
        db
          .select({
            id: versions.id,
            number: versions.number,
            round: versions.round,
            state: versions.state,
            sunsetAt: versions.sunsetAt,
            rev: versions.rev,
            body: versions.body,
            variables: versions.variables,
            channels: versions.channels,
            channelFields: versions.channelFields,
            smsFooter: versions.smsFooter,
            sampleSets: versions.sampleSets,
          })
          .from(versions)
          .where(eq(versions.templateId, template.id)),
        db
          .select({
            allowedChannels: contentTypes.allowedChannels,
            smsFooter: contentTypes.smsFooter,
            smsMaxParts: contentTypes.smsMaxParts,
            appName: teams.appName,
            smsSender: teams.smsSender,
          })
          .from(templates)
          .innerJoin(contentTypes, eq(contentTypes.id, templates.contentTypeId))
          .innerJoin(teams, eq(teams.id, templates.teamId))
          .where(eq(templates.id, template.id))
          .limit(1),
        loadImportOriginal(template.id),
      ]);
      const shown = latestVersion(rows);
      if (!shown || !setup)
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      const threads = await loadThreads(template.id, anchorIdsOf(shown));

      return {
        ok: true,
        asOf: asOf.toISOString(),
        template: {
          id: template.id,
          teamId: template.teamId,
          teamName: template.teamName,
          family: contentTypeFamily(setup.allowedChannels),
          allowedChannels: setup.allowedChannels,
        },
        version: {
          id: shown.id,
          number: shown.state === "draft" ? null : shown.number,
          round: shown.state === "draft" ? null : shown.round,
          state: shown.state,
          rev: shown.rev,
          body: shown.body,
          variables: shown.variables,
          channels: shown.channels,
          channelFields: shown.channelFields,
          sampleSets: shown.sampleSets,
        },
        baseline:
          shown.state === "draft"
            ? (contractBaseline(rows, asOf)?.variables ?? null)
            : null,
        messageRules: {
          smsFooter: smsFooterOf(shown, setup.smsFooter),
          smsMaxParts: setup.smsMaxParts,
        },
        senders: { appName: setup.appName, smsSender: setup.smsSender },
        threads,
        can: {
          edit: can(ctx.viewer, "draft.edit", { teamId: template.teamId }),
          // The workspace is the team's: whoever a review stage names comments from the review screen.
          comment: canComment(ctx.viewer, {
            teamId: template.teamId,
            version: { state: shown.state, stageApproverIds: [] },
          }),
        },
        importOriginal,
        people: await loadPeople([
          ...peopleIn(threads),
          importOriginal?.uploadedBy,
          ctx.viewer.userId,
        ]),
      };
    },
  };
}

/** A round's number and round, without its state. */
function roundOf({ number, round }: RoundRef): RoundRef {
  return { number, round };
}

/** The file the template was imported from (the newest, should there ever be more); null when it wasn't imported. */
async function loadImportOriginal(
  templateId: string,
): Promise<ImportOriginalFacts | null> {
  const [row] = await db
    .select({
      uploadId: uploads.id,
      filename: uploads.filename,
      path: uploads.path,
      size: uploads.size,
      createdAt: uploads.createdAt,
      createdBy: uploads.createdBy,
    })
    .from(uploads)
    .where(eq(uploads.templateId, templateId))
    .orderBy(desc(uploads.createdAt))
    .limit(1);
  const kind = row ? kindOfPath(row.path) : null;
  return row && kind
    ? {
        uploadId: row.uploadId,
        filename: row.filename,
        kind,
        size: row.size,
        uploadedAt: row.createdAt.toISOString(),
        uploadedBy: row.createdBy,
      }
    : null;
}
