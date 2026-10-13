import "server-only";
import { eq } from "drizzle-orm";
import { finishImport, refusalForUnreadableKind } from "@/domain/import";
import {
  IMPORT_LIMITS,
  IMPORT_MIME,
  IMPORT_REFUSALS,
  type ImportRefusalName,
  type ImportResponse,
} from "@/domain/import-types";
import { createDraft } from "@/domain/lifecycle/drafts";
import { REFUSALS as LIFECYCLE_REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS, can } from "@/domain/permissions";
import {
  REQUEST_REFUSALS,
  refuse,
  type Refused,
  type RefusalCode,
} from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { defaultSampleSets } from "@/editor/model/sample-sets";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { teams, uploads } from "@/server/db/schema/ucomp";
import { prepareBody } from "@/server/documents/prepare";
import { inTransaction } from "@/server/effects";
import { newId } from "@/server/ids";
import {
  conformToContentType,
  freshTemplateId,
  insertNewTemplate,
  newTemplateType,
} from "@/server/templates/create";
import { convertFile } from "./convert";
import { sniffKind } from "./sniff";
import { defaultUploadsRoot, removeUpload, writeUpload } from "./store";

// Import a file (Phase 7a): a .docx, .pdf or .txt becomes a new template whose first draft holds
// its text, with `{{placeholders}}` as Text chips and the content type's required sections in place.
// The order is the contract's (src/domain/import-types.ts): permission first, then size, kind,
// conversion, then the document check (the body is stored as src/server/documents/prepare.ts makes
// it, as an autosave would store it); the files are written, then ONE transaction inserts the
// template, the draft (with `import_upload_id`), the uploads row and the audit event. If the
// transaction fails, the folder goes.

export interface ImportFile {
  /** The client's file name: display text only, never a path. */
  name: string;
  bytes: Uint8Array;
}

export interface ImportOptions {
  /** Where upload folders go. Default ./data/uploads. */
  uploadsRoot?: string;
}

const refuseFile = (name: ImportRefusalName): ImportResponse =>
  refuse(IMPORT_REFUSALS[name]);

/**
 * The statuses of the refusals that aren't a plain 400 or 403: the file is too large, or not a kind we
 * take, or no content type makes documents (Platform settings, not the file or the person).
 */
const IMPORT_STATUS: Partial<Record<RefusalCode, number>> = {
  [IMPORT_REFUSALS.size.code]: 413,
  [IMPORT_REFUSALS.type.code]: 415,
  [IMPORT_REFUSALS.legacyDoc.code]: 415,
  [IMPORT_REFUSALS.notPdf.code]: 415,
  [IMPORT_REFUSALS.notWord.code]: 415,
  [LIFECYCLE_REFUSALS.noContentType.code]: 409,
  [REQUEST_REFUSALS.signedOut.code]: 401,
};
const IMPORT_CODES: ReadonlySet<string> = new Set(
  Object.values(IMPORT_REFUSALS).map((entry) => entry.code),
);

/**
 * The HTTP status for an import's answer: 200 · 400 the file is refused · 401 nobody is signed in · 403 the
 * viewer may not create here (any other refusal) · 409 no content type makes documents · 413 too large · 415 not a
 * kind we take.
 */
export function importStatus(response: ImportResponse): number {
  if (response.ok) return 200;
  return (
    IMPORT_STATUS[response.code] ??
    (IMPORT_CODES.has(response.code) ? 400 : 403)
  );
}

/**
 * The permission half of an import, on its own so the route can ask it before reading the body. The
 * team is looked up only to check the permission on it; an unknown team fails the same way.
 */
export async function importPermission(
  viewer: Viewer,
  teamSlug: string,
): Promise<{ ok: true; team: typeof teams.$inferSelect } | Refused> {
  const team = teamSlug
    ? await db.query.teams.findFirst({ where: eq(teams.slug, teamSlug) })
    : undefined;
  const allowed = can(viewer, "template.create", { teamId: team?.id ?? null });
  if (!allowed.ok) return allowed;
  if (!team) return refuse(REASONS.generic);
  return { ok: true, team };
}

export async function importTemplate(
  viewer: Viewer,
  input: { teamSlug: string; file: ImportFile | null },
  options: ImportOptions = {},
): Promise<ImportResponse> {
  const permitted = await importPermission(viewer, input.teamSlug);
  if (!permitted.ok) return permitted;
  const { team } = permitted;

  const file = input.file;
  if (!file) return refuseFile("unreadable");
  if (file.bytes.byteLength === 0) return refuseFile("empty");
  if (file.bytes.byteLength > IMPORT_LIMITS.maxBytes) return refuseFile("size");

  const kind = sniffKind(file.bytes, file.name);
  if (!kind) return refuseFile(refusalForUnreadableKind(file.name));

  const converted = await convertFile(kind, file.bytes);
  if (!converted.ok) return refuseFile(converted.code);

  // Import makes documents (`importUnavailable`): a file's text becomes the body. No content type makes
  // them: refused, as New template refuses it.
  const chosen = await newTemplateType("document");
  if (!chosen.ok) return chosen;
  const { contentType } = chosen;
  const finished = finishImport({
    file: converted.file,
    filename: file.name,
    size: file.bytes.byteLength,
    requiredSections: contentType.requiredSections,
  });
  // A document the check refuses is never stored (it couldn't be rendered): nothing is written.
  const body = prepareBody(finished.body);
  if (!body.ok) return refuse(IMPORT_REFUSALS.content(body.message));

  const at = await now();
  const templateId = await freshTemplateId();
  const versionId = newId("v");
  const uploadId = newId("up");
  const created = createDraft({
    // finishImport fitted the required sections already; the channels still follow the content type.
    starter: conformToContentType(
      {
        key: "import",
        name: finished.name,
        body: body.doc,
        variables: finished.variables,
        sampleSets: defaultSampleSets(
          finished.variables,
          at.toISOString().slice(0, 10),
        ),
      },
      contentType,
      { sectionsFitted: true },
    ),
    createdBy: viewer.userId,
    now: at,
  });
  // An import isn't a starter: no starter key, and the audit event names the source file.
  created.changes.template.starterKey = null;
  created.effects = created.effects.map((effect) =>
    effect.kind === "audit" && effect.action === "template.created"
      ? {
          ...effect,
          details: {
            name: finished.name,
            source: `import:${kind}`,
            filename: finished.report.filename,
          },
        }
      : effect,
  );

  const root = options.uploadsRoot ?? defaultUploadsRoot();
  try {
    const path = await writeUpload(
      {
        uploadId,
        kind,
        bytes: file.bytes,
        compareHtml: converted.file.compareHtml,
        report: finished.report,
      },
      root,
    );
    await inTransaction(db, async (tx) => {
      await insertNewTemplate(tx, {
        templateId,
        teamId: team.id,
        contentTypeId: contentType.id,
        versionId,
        created,
        at,
        actorId: viewer.userId,
        importUploadId: uploadId,
      });
      await tx.insert(uploads).values({
        id: uploadId,
        templateId,
        filename: finished.report.filename,
        mime: IMPORT_MIME[kind],
        size: file.bytes.byteLength,
        path,
        createdBy: viewer.userId,
        createdAt: at,
      });
    });
  } catch (error) {
    await removeUpload(uploadId, root).catch(() => undefined);
    throw error;
  }

  return {
    ok: true,
    templateId,
    href: `/${team.slug}/templates/${templateId}`,
  };
}
