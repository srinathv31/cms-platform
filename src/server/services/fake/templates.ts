import type { ImportReport } from "@/domain/import-report";
import {
  createTemplateFrom,
  editLatest,
  newTemplateContentType,
  newTemplateRefusal,
  planDraftStart,
} from "@/domain/lifecycle/drafts";
import type { ActionResult } from "@/domain/review-types";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { newId } from "@/server/ids";
import { notInFake } from "./not-in-fake";
import { answerFor, check, refuse } from "../refuse";
import { refusal } from "../results";
import { TemplateIdTaken, withNewTemplateId } from "../template-id";
import type { ImportedOriginal, TemplateService } from "../templates";
import type { Changed } from "../types";
import { fakeDraftRow } from "./draft-row";
import { writeFakeEffects } from "./effects";
import type { FakeDeps } from "./index";
import type { FakeState, UploadRow } from "./state";
import type { FakeTx } from "./store";
import { templateById } from "./version-rows";

// Templates as a whole in memory: the same steps as the local implementation (services/local/templates.ts) in
// the same order, the same domain rules, and the writes into the fake's state. An import's files (the original,
// its Compare HTML and its report) are kept in the fake's memory beside the uploads row, per fake.

/** An imported file as the fake keeps it: what the local implementation writes under ./data/uploads. */
interface StoredUpload {
  bytes: Uint8Array;
  report: ImportReport;
  compareHtml: string | null;
}

export function fakeTemplates(
  deps: FakeDeps,
): Omit<TemplateService, "library" | "palette" | "workspaceDocument"> {
  const { store, clock, hooks, ids } = deps;
  const files = new Map<string, StoredUpload>();

  /** Who may create in the team: the permission, then that the team exists. Throws the refusal. */
  function authorizeCreate(state: FakeState, viewer: Viewer, teamId: string) {
    const team = state.teams.find((t) => t.id === teamId);
    check(viewer, "template.create", { teamId: team?.id ?? null });
    if (!team) refuse(REQUEST_REFUSALS.teamGone);
  }

  /** Inserts the template, its first draft and the effects; the id taken is `TemplateIdTaken`. */
  function insertNewTemplate(
    tx: FakeTx,
    rows: Parameters<typeof createTemplateFrom>[0] & {
      templateId: string;
      teamId: string;
      contentTypeId: string;
      importUploadId?: string;
    },
  ) {
    const created = createTemplateFrom(rows);
    const { template, draft } = created.changes;
    if (templateById(tx.state, rows.templateId))
      throw new TemplateIdTaken(rows.templateId);
    const versionId = newId("v");
    tx.insert("templates", {
      id: rows.templateId,
      teamId: rows.teamId,
      contentTypeId: rows.contentTypeId,
      createdBy: template.createdBy,
      createdAt: template.createdAt,
      starterKey: template.starterKey,
    });
    tx.insert(
      "versions",
      fakeDraftRow(draft, {
        id: versionId,
        templateId: rows.templateId,
        importUploadId: rows.importUploadId,
      }),
    );
    writeFakeEffects(tx, created.effects, {
      at: rows.now,
      actorId: rows.createdBy,
      teamId: rows.teamId,
      templateId: rows.templateId,
      versionId,
    });
  }

  /** The upload an import left, and who made it, as the Original tab reads it. */
  function importedOriginal(
    state: FakeState,
    row: UploadRow,
  ): ImportedOriginal | null {
    const file = files.get(row.id);
    const user = state.users.find((u) => u.id === row.createdBy);
    if (!file || !user) return null;
    return {
      uploadId: row.id,
      filename: row.filename,
      kind: file.report.kind,
      size: row.size,
      uploadedAt: row.createdAt.toISOString(),
      uploadedBy: {
        id: user.id,
        name: user.name,
        initials: user.initials,
        hue: user.avatarHue,
      },
    };
  }

  /** An upload the viewer may see: it belongs to a template in a space they can see. */
  function visibleUpload(state: FakeState, viewer: Viewer, uploadId: string) {
    const row = state.uploads.find((u) => u.id === uploadId);
    const template = row?.templateId
      ? templateById(state, row.templateId)
      : undefined;
    return row &&
      template &&
      can(viewer, "template.view", { teamId: template.teamId }).ok
      ? row
      : undefined;
  }

  /** New template and Import: the permission, then the content type and the channels, then `write`. */
  async function makeTemplate<R extends object>(
    ctx: Parameters<TemplateService["create"]>[0],
    input: Parameters<TemplateService["create"]>[1],
    write: (tx: FakeTx, c: { templateId: string; now: Date }) => R,
  ): Promise<ActionResult<R & { templateId: string }>> {
    return withNewTemplateId(ids, async (templateId) => {
      const now = await clock();
      try {
        return store.command((tx): ActionResult<R & { templateId: string }> => {
          const { state } = tx;
          authorizeCreate(state, ctx.viewer, input.teamId);
          const contentType = state.contentTypes.find(
            (c) => c.id === input.contentTypeId,
          );
          const refused = newTemplateRefusal(contentType, input.draft.channels);
          if (refused) refuse(refused);
          return { ok: true, templateId, ...write(tx, { templateId, now }) };
        });
      } catch (error) {
        return answerFor(error);
      }
    });
  }

  return {
    async newTemplateType(ctx, { teamId, family }) {
      const { state } = store;
      const team = state.teams.find((t) => t.id === teamId);
      const allowed = can(ctx.viewer, "template.create", {
        teamId: team?.id ?? null,
      });
      if (!allowed.ok) return refusal(403, allowed);
      if (!team) return refusal(404, REQUEST_REFUSALS.teamGone);
      const chosen = newTemplateContentType(family, state.contentTypes);
      if (!chosen.ok) return refusal(409, chosen);
      const { contentType } = chosen;
      return {
        ok: true,
        asOf: (await clock()).toISOString(),
        contentTypeId: contentType.id,
        requiredSections: contentType.requiredSections,
        allowedChannels: contentType.allowedChannels,
      };
    },

    create: (ctx, input) =>
      makeTemplate(ctx, input, (tx, { templateId, now }) => {
        insertNewTemplate(tx, {
          draft: input.draft,
          createdBy: ctx.viewer.userId,
          now,
          templateId,
          teamId: input.teamId,
          contentTypeId: input.contentTypeId,
        });
        return {};
      }),

    async createPermission(ctx, { teamId }) {
      try {
        authorizeCreate(store.state, ctx.viewer, teamId);
        return { ok: true };
      } catch (error) {
        return answerFor(error);
      }
    },

    async createImported(ctx, input) {
      const { original, report, compareHtml } = input;
      const uploadId = newId("up");
      const answer = await makeTemplate(
        ctx,
        input,
        (tx, { templateId, now }) => {
          insertNewTemplate(tx, {
            draft: input.draft,
            createdBy: ctx.viewer.userId,
            now,
            imported: { kind: report.kind, filename: original.filename },
            templateId,
            teamId: input.teamId,
            contentTypeId: input.contentTypeId,
            importUploadId: uploadId,
          });
          tx.insert("uploads", {
            id: uploadId,
            templateId,
            filename: original.filename,
            mime: original.mime,
            size: original.bytes.byteLength,
            path: `${uploadId}/original.${report.kind}`,
            createdBy: ctx.viewer.userId,
            createdAt: now,
          });
          return { uploadId };
        },
      );
      // The files are kept only with the template: nothing was written for a refusal.
      if (answer.ok)
        files.set(uploadId, {
          bytes: original.bytes,
          report,
          compareHtml,
        });
      return answer;
    },

    async startDraft(ctx, input) {
      const now = await clock();
      try {
        return store.command(
          (
            tx,
          ): ActionResult<Changed & { draftId: string; teamSlug: string }> => {
            const { state } = tx;
            const template = templateById(state, input.templateId);
            check(ctx.viewer, "draft.edit", {
              teamId: template?.teamId ?? null,
            });
            if (!template) refuse(REQUEST_REFUSALS.templateGone);
            const teamSlug = state.teams.find(
              (t) => t.id === template.teamId,
            )!.slug;
            const opened = (draftId: string) => ({
              ok: true as const,
              changed: false,
              draftId,
              teamSlug,
            });
            const openDraft = () =>
              state.versions.find(
                (v) => v.templateId === template.id && v.state === "draft",
              );

            const plan = planDraftStart(
              state.versions.filter((v) => v.templateId === template.id),
            );
            if (plan.kind === "open") return opened(plan.versionId);
            if (plan.kind === "blocked") refuse(plan);

            const latest = state.versions.find(
              (v) =>
                v.id === plan.from &&
                (v.state === "active" || v.state === "revoked"),
            );
            if (!latest) refuse(REQUEST_REFUSALS.latestChanged);
            const { changes, effects } = editLatest({
              from: latest,
              createdBy: ctx.viewer.userId,
              now,
            });
            const draftId = newId("v");

            // Two people pressing Edit at once: one draft per template, so the other opens it.
            if (
              hooks.beforeCompareAndSet?.({
                table: "drafts",
                id: template.id,
              }) === "competing_write"
            )
              tx.insert(
                "versions",
                fakeDraftRow(changes.draft, {
                  id: newId("v"),
                  templateId: template.id,
                }),
              );
            const competing = openDraft();
            if (competing) return opened(competing.id);

            tx.insert(
              "versions",
              fakeDraftRow(changes.draft, {
                id: draftId,
                templateId: template.id,
              }),
            );
            writeFakeEffects(tx, effects, {
              at: now,
              actorId: ctx.viewer.userId,
              teamId: template.teamId,
              templateId: template.id,
              versionId: draftId,
            });
            return { ok: true, changed: true, draftId, teamSlug };
          },
        );
      } catch (error) {
        return answerFor(error);
      }
    },

    async importOriginal(ctx, { uploadId }) {
      const { state } = store;
      const upload = visibleUpload(state, ctx.viewer, uploadId);
      const file = upload ? files.get(upload.id) : undefined;
      if (!upload || !file)
        return refusal(404, REQUEST_REFUSALS.uploadUnavailable);
      return {
        ok: true,
        filename: upload.filename,
        mime: upload.mime,
        bytes: file.bytes,
      };
    },

    async importOriginalView(ctx, { uploadId }) {
      const { state } = store;
      const upload = visibleUpload(state, ctx.viewer, uploadId);
      const original = upload ? importedOriginal(state, upload) : null;
      const file = upload ? files.get(upload.id) : undefined;
      if (!original || !file)
        return refusal(404, REQUEST_REFUSALS.uploadUnavailable);
      if (original.kind === "docx" && file.compareHtml === null)
        return refusal(404, REQUEST_REFUSALS.uploadUnavailable);
      return {
        ok: true,
        original,
        report: file.report,
        compareHtml: original.kind === "docx" ? file.compareHtml : null,
      };
    },

    workspaceHeader: notInFake("templates.workspaceHeader"),
    integration: notInFake("templates.integration"),
    copilotPrompt: notInFake("templates.copilotPrompt"),
  };
}
