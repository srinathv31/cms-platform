import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  createTemplateFrom,
  editLatest,
  newTemplateContentType,
  newTemplateRefusal,
  planDraftStart,
  type NewTemplateChanges,
} from "@/domain/lifecycle/drafts";
import type {
  DraftContent,
  LifecycleResult,
  VersionSnapshot,
} from "@/domain/lifecycle/types";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import {
  contentTypes,
  teams,
  templates,
  uploads,
  users,
  versions,
} from "@/server/db/schema/ucomp";
import { db } from "@/server/db/client";
import { newId } from "@/server/ids";
import { notMoved } from "../not-moved";
import { answerFor } from "../refuse";
import { refusal } from "../results";
import { TemplateIdTaken, withNewTemplateId } from "../template-id";
import type { ImportedOriginal, TemplateService } from "../templates";
import type { Changed } from "../types";
import { check, refuse, runCommand, type LocalDeps } from "./command";
import { draftRow } from "./draft-row";
import { writeEffects } from "./effects";
import type { Tx } from "./transaction";
import {
  defaultUploadsRoot,
  kindOfPath,
  readCompareHtml,
  readOriginal,
  readReport,
  removeUpload,
  writeUpload,
} from "./uploads";

// Templates as a whole on this app's own database (src/server/services/templates.ts says what each method
// promises): making one (New template, Import), Edit, and an imported file's original. The BFF built the draft
// (src/server/starters, src/server/import) and prepared its documents; this stores it, after checking the team,
// the content type and the channels, dated by the backend's clock.

/** Who may create in the team: the permission, then that the team exists. Throws the refusal. */
async function authorizeCreate(viewer: Viewer, teamId: string) {
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  // An unknown team has no id to check, so it is refused the same way as a team the viewer can't write to.
  check(viewer, "template.create", { teamId: team?.id ?? null });
  if (!team) refuse(REQUEST_REFUSALS.teamGone);
  return team;
}

interface NewTemplateRows {
  templateId: string;
  teamId: string;
  contentTypeId: string;
  versionId: string;
  created: LifecycleResult<NewTemplateChanges>;
  at: Date;
  actorId: string;
  /** The upload an imported draft came from (`versions.import_upload_id`). */
  importUploadId?: string | null;
}

/**
 * Inserts the template, its first draft and the effects (the audit row) in the caller's transaction. The insert
 * finds the id taken (the primary key) as `TemplateIdTaken`, which rolls the whole write back for the retry
 * (decision 0060).
 */
async function insertNewTemplate(tx: Tx, rows: NewTemplateRows) {
  const { template, draft } = rows.created.changes;
  const [inserted] = await tx
    .insert(templates)
    .values({
      id: rows.templateId,
      teamId: rows.teamId,
      contentTypeId: rows.contentTypeId,
      createdBy: template.createdBy,
      createdAt: template.createdAt,
      starterKey: template.starterKey,
    })
    .onConflictDoNothing()
    .returning({ id: templates.id });
  if (!inserted) throw new TemplateIdTaken(rows.templateId);
  await tx.insert(versions).values({
    ...draftRow(draft, { id: rows.versionId, templateId: rows.templateId }),
    ...(rows.importUploadId ? { importUploadId: rows.importUploadId } : {}),
  });
  await writeEffects(tx, rows.created.effects, {
    at: rows.at,
    actorId: rows.actorId,
    teamId: rows.teamId,
    templateId: rows.templateId,
    versionId: rows.versionId,
  });
}

/** The content type a new template is made on, read in the transaction that inserts it. */
async function loadContentType(tx: Tx, contentTypeId: string) {
  const [row] = await tx
    .select({ allowedChannels: contentTypes.allowedChannels })
    .from(contentTypes)
    .where(eq(contentTypes.id, contentTypeId))
    .limit(1);
  return row;
}

type NewTemplateInput = {
  teamId: string;
  contentTypeId: string;
  draft: DraftContent;
};

/** An upload row with the person who made it, in the order newest first. */
const uploadColumns = {
  uploadId: uploads.id,
  templateId: uploads.templateId,
  filename: uploads.filename,
  mime: uploads.mime,
  path: uploads.path,
  size: uploads.size,
  createdAt: uploads.createdAt,
  uploaderId: users.id,
  uploaderName: users.name,
  uploaderInitials: users.initials,
  uploaderHue: users.avatarHue,
};

type UploadRow = {
  uploadId: string;
  filename: string;
  path: string;
  size: number;
  createdAt: Date;
  uploaderId: string;
  uploaderName: string;
  uploaderInitials: string;
  uploaderHue: number;
};

function importedOriginal(row: UploadRow): ImportedOriginal | null {
  const kind = kindOfPath(row.path);
  return kind
    ? {
        uploadId: row.uploadId,
        filename: row.filename,
        kind,
        size: row.size,
        uploadedAt: row.createdAt.toISOString(),
        uploadedBy: {
          id: row.uploaderId,
          name: row.uploaderName,
          initials: row.uploaderInitials,
          hue: row.uploaderHue,
        },
      }
    : null;
}

/** An upload the viewer may see: it belongs to a template in a space they can see. */
async function visibleUpload(viewer: Viewer, uploadId: string) {
  const row = await db
    .select({ ...uploadColumns, teamId: templates.teamId })
    .from(uploads)
    .innerJoin(users, eq(users.id, uploads.createdBy))
    .innerJoin(templates, eq(templates.id, uploads.templateId))
    .where(eq(uploads.id, uploadId))
    .limit(1)
    .then((rows) => rows[0]);
  return row && can(viewer, "template.view", { teamId: row.teamId }).ok
    ? row
    : undefined;
}

export function localTemplates(deps: LocalDeps): TemplateService {
  const uploadsRoot = () => deps.uploadsRoot ?? defaultUploadsRoot();

  /** New template and Import: the permission, then (in the transaction) the content type and the channels. */
  const makeTemplate = <T extends NewTemplateInput, R extends object>(
    ctx: Parameters<TemplateService["create"]>[0],
    input: T,
    write: (
      tx: Tx,
      c: { templateId: string; now: Date; viewer: Viewer },
    ) => Promise<R>,
  ) =>
    withNewTemplateId(deps.ids, (templateId) =>
      runCommand(deps, ctx, input, {
        authorize: ({ ctx, input }) =>
          authorizeCreate(ctx.viewer, input.teamId),
        transaction: async (
          tx,
          { ctx, input, now },
        ): Promise<ActionResult<R & { templateId: string }>> => {
          const contentType = await loadContentType(tx, input.contentTypeId);
          const refused = newTemplateRefusal(contentType, input.draft.channels);
          if (refused) refuse(refused);
          const written = await write(tx, {
            templateId,
            now,
            viewer: ctx.viewer,
          });
          return { ok: true, templateId, ...written };
        },
      }),
    );

  return {
    async newTemplateType(ctx, { teamId, family }) {
      const team = await db.query.teams.findFirst({
        where: eq(teams.id, teamId),
      });
      const allowed = can(ctx.viewer, "template.create", {
        teamId: team?.id ?? null,
      });
      if (!allowed.ok) return refusal(403, allowed);
      if (!team) return refusal(404, REQUEST_REFUSALS.teamGone);
      const chosen = newTemplateContentType(
        family,
        await db.select().from(contentTypes),
      );
      if (!chosen.ok) return refusal(409, chosen);
      const { contentType } = chosen;
      return {
        ok: true,
        asOf: (await deps.clock()).toISOString(),
        contentTypeId: contentType.id,
        requiredSections: contentType.requiredSections,
        allowedChannels: contentType.allowedChannels,
      };
    },

    create: (ctx, input) =>
      makeTemplate(ctx, input, async (tx, { templateId, now, viewer }) => {
        await insertNewTemplate(tx, {
          templateId,
          teamId: input.teamId,
          contentTypeId: input.contentTypeId,
          versionId: newId("v"),
          created: createTemplateFrom({
            draft: input.draft,
            createdBy: viewer.userId,
            now,
          }),
          at: now,
          actorId: viewer.userId,
        });
        return {};
      }),

    async createPermission(ctx, { teamId }) {
      try {
        await authorizeCreate(ctx.viewer, teamId);
        return { ok: true };
      } catch (error) {
        return answerFor(error);
      }
    },

    async createImported(ctx, input) {
      const uploadId = newId("up");
      const root = uploadsRoot();
      const { original, report, compareHtml } = input;
      try {
        const answer = await makeTemplate(
          ctx,
          input,
          async (tx, { templateId, now, viewer }) => {
            // The files go down first, then ONE transaction inserts the template, the draft (with
            // `import_upload_id`), the uploads row and the audit event. Whatever fails after this removes them.
            const path = await writeUpload(
              {
                uploadId,
                kind: report.kind,
                bytes: original.bytes,
                compareHtml: compareHtml ?? undefined,
                report,
              },
              root,
            );
            await insertNewTemplate(tx, {
              templateId,
              teamId: input.teamId,
              contentTypeId: input.contentTypeId,
              versionId: newId("v"),
              created: createTemplateFrom({
                draft: input.draft,
                createdBy: viewer.userId,
                now,
                imported: { kind: report.kind, filename: original.filename },
              }),
              at: now,
              actorId: viewer.userId,
              importUploadId: uploadId,
            });
            await tx.insert(uploads).values({
              id: uploadId,
              templateId,
              filename: original.filename,
              mime: original.mime,
              size: original.bytes.byteLength,
              path,
              createdBy: viewer.userId,
              createdAt: now,
            });
            return { uploadId };
          },
        );
        if (!answer.ok) await removeUpload(uploadId, root).catch(() => {});
        return answer;
      } catch (error) {
        await removeUpload(uploadId, root).catch(() => {});
        throw error;
      }
    },

    startDraft: (ctx, input) =>
      runCommand(deps, ctx, input, {
        // The template is read only to learn its team for the permission check; an unknown one is refused the
        // same as one the viewer can't edit.
        authorize: async ({ ctx, input }) => {
          const found = await db
            .select({
              id: templates.id,
              teamId: templates.teamId,
              teamSlug: teams.slug,
            })
            .from(templates)
            .innerJoin(teams, eq(teams.id, templates.teamId))
            .where(eq(templates.id, input.templateId))
            .limit(1)
            .then((rows) => rows[0]);
          check(ctx.viewer, "draft.edit", { teamId: found?.teamId ?? null });
          if (!found) refuse(REQUEST_REFUSALS.templateGone);
          return found;
        },
        transaction: async (
          tx,
          { ctx, found, now },
        ): Promise<
          ActionResult<Changed & { draftId: string; teamSlug: string }>
        > => {
          const opened = (draftId: string) => ({
            ok: true as const,
            changed: false,
            draftId,
            teamSlug: found.teamSlug,
          });
          const list = await tx
            .select({
              id: versions.id,
              state: versions.state,
              number: versions.number,
              round: versions.round,
            })
            .from(versions)
            .where(eq(versions.templateId, found.id));
          const plan = planDraftStart(list);
          if (plan.kind === "open") return opened(plan.versionId);
          if (plan.kind === "blocked") refuse(plan);

          const latest = await tx.query.versions.findFirst({
            where: and(
              eq(versions.id, plan.from),
              inArray(versions.state, ["active", "revoked"]),
            ),
          });
          if (!latest) refuse(REQUEST_REFUSALS.latestChanged);

          const snapshot: VersionSnapshot = {
            id: latest.id,
            number: latest.number,
            round: latest.round,
            state: latest.state,
            name: latest.name,
            body: latest.body,
            channelFields: latest.channelFields,
            channels: latest.channels,
            variables: latest.variables,
            sampleSets: latest.sampleSets,
          };
          const { changes, effects } = editLatest({
            from: snapshot,
            createdBy: ctx.viewer.userId,
            now,
          });
          const draftId = newId("v");

          // Two people pressing Edit at once: the partial unique index (one open draft per template) lets one
          // draft in. The other inserts nothing and simply opens it.
          if (
            deps.hooks.beforeCompareAndSet?.({
              table: "drafts",
              id: found.id,
            }) === "competing_write"
          )
            await tx
              .insert(versions)
              .values(
                draftRow(changes.draft, {
                  id: newId("v"),
                  templateId: found.id,
                }),
              )
              .onConflictDoNothing();
          const [inserted] = await tx
            .insert(versions)
            .values(
              draftRow(changes.draft, { id: draftId, templateId: found.id }),
            )
            .onConflictDoNothing()
            .returning({ id: versions.id });
          if (!inserted) {
            const [open] = await tx
              .select({ id: versions.id })
              .from(versions)
              .where(
                and(
                  eq(versions.templateId, found.id),
                  eq(versions.state, "draft"),
                ),
              )
              .limit(1);
            return opened(open!.id);
          }
          await writeEffects(tx, effects, {
            at: now,
            actorId: ctx.viewer.userId,
            teamId: found.teamId,
            templateId: found.id,
            versionId: draftId,
          });
          return {
            ok: true,
            changed: true,
            draftId,
            teamSlug: found.teamSlug,
          };
        },
      }),

    async importOriginal(ctx, { uploadId }) {
      const upload = await visibleUpload(ctx.viewer, uploadId);
      const bytes = upload
        ? await readOriginal(upload.path, uploadsRoot())
        : null;
      if (!upload || !bytes)
        return refusal(404, REQUEST_REFUSALS.uploadUnavailable);
      return { ok: true, filename: upload.filename, mime: upload.mime, bytes };
    },

    async importOriginalView(ctx, { uploadId }) {
      const upload = await visibleUpload(ctx.viewer, uploadId);
      const original = upload ? importedOriginal(upload) : null;
      const report = original
        ? await readReport(uploadId, uploadsRoot())
        : null;
      if (!original || !report)
        return refusal(404, REQUEST_REFUSALS.uploadUnavailable);
      // A docx is shown as its Compare HTML; a PDF is drawn from, and a text file read from, the original.
      const compareHtml =
        original.kind === "docx"
          ? await readCompareHtml(uploadId, uploadsRoot())
          : null;
      if (original.kind === "docx" && compareHtml === null)
        return refusal(404, REQUEST_REFUSALS.uploadUnavailable);
      return { ok: true, original, report, compareHtml };
    },

    async importOriginalRef(ctx, { templateId }) {
      const template = await db.query.templates.findFirst({
        where: eq(templates.id, templateId),
      });
      if (
        !template ||
        !can(ctx.viewer, "template.view", { teamId: template.teamId }).ok
      )
        return refusal(404, REQUEST_REFUSALS.templateUnavailable);
      // The newest, should there ever be more than one.
      const row = await db
        .select(uploadColumns)
        .from(uploads)
        .innerJoin(users, eq(users.id, uploads.createdBy))
        .where(eq(uploads.templateId, templateId))
        .orderBy(desc(uploads.createdAt))
        .limit(1)
        .then((rows) => rows[0]);
      return { ok: true, original: row ? importedOriginal(row) : null };
    },

    library: notMoved("templates.library"),
    palette: notMoved("templates.palette"),
    workspaceHeader: notMoved("templates.workspaceHeader"),
    workspaceDocument: notMoved("templates.workspaceDocument"),
    integration: notMoved("templates.integration"),
    copilotPrompt: notMoved("templates.copilotPrompt"),
  };
}
