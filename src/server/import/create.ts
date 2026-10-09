import "server-only";
import { eq } from "drizzle-orm";
import { finishImport, refusalForUnreadableKind } from "@/domain/import";
import { IMPORT_LIMITS, IMPORT_MIME, IMPORT_REFUSALS, type ImportRefusalCode, type ImportResponse } from "@/domain/import-types";
import { createDraft } from "@/domain/lifecycle";
import { REASONS, can } from "@/domain/permissions";
import type { Viewer } from "@/domain/types";
import { defaultSampleSets } from "@/editor/model/sample-sets";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { teams, uploads } from "@/server/db/schema/ucomp";
import { prepareBody } from "@/server/documents/prepare";
import { newId } from "@/server/ids";
import { conformToContentType, disclosureContentType, freshTemplateId, insertNewTemplate } from "@/server/templates/create";
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

const refuse = (code: ImportRefusalCode): ImportResponse => ({ ok: false, code, reason: IMPORT_REFUSALS[code] });

/** The HTTP status for an import's answer: 200 · 400 refused · 403 · 413 size · 415 type. */
export function importStatus(response: ImportResponse): number {
  if (response.ok) return 200;
  if (response.code === "permission") return 403;
  if (response.code === "size") return 413;
  if (response.code === "type" || response.code === "legacyDoc" || response.code === "notPdf" || response.code === "notWord") return 415;
  return 400;
}

/**
 * The permission half of an import, on its own so the route can ask it before reading the body. The
 * team is looked up only to check the permission on it; an unknown team fails the same way.
 */
export async function importPermission(
  viewer: Viewer,
  teamSlug: string,
): Promise<{ ok: true; team: typeof teams.$inferSelect } | (ImportResponse & { ok: false })> {
  const team = teamSlug ? await db.query.teams.findFirst({ where: eq(teams.slug, teamSlug) }) : undefined;
  const allowed = can(viewer, "template.create", { teamId: team?.id ?? null });
  if (!allowed.ok || !team) return { ok: false, code: "permission", reason: allowed.ok ? REASONS.generic.reason : allowed.reason };
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
  if (!file) return refuse("unreadable");
  if (file.bytes.byteLength === 0) return refuse("empty");
  if (file.bytes.byteLength > IMPORT_LIMITS.maxBytes) return refuse("size");

  const kind = sniffKind(file.bytes, file.name);
  if (!kind) return refuse(refusalForUnreadableKind(file.name));

  const converted = await convertFile(kind, file.bytes);
  if (!converted.ok) return refuse(converted.code);

  const contentType = await disclosureContentType();
  const finished = finishImport({
    file: converted.file,
    filename: file.name,
    size: file.bytes.byteLength,
    requiredSections: contentType.requiredSections,
  });
  // A document the check refuses is never stored (it couldn't be rendered): nothing is written.
  const body = prepareBody(finished.body);
  if (!body.ok) return { ok: false, code: "content", reason: `${IMPORT_REFUSALS.content} ${body.message}` };

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
        sampleSets: defaultSampleSets(finished.variables, at.toISOString().slice(0, 10)),
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
      ? { ...effect, details: { name: finished.name, source: `import:${kind}`, filename: finished.report.filename } }
      : effect,
  );

  const root = options.uploadsRoot ?? defaultUploadsRoot();
  try {
    const path = await writeUpload(
      { uploadId, kind, bytes: file.bytes, compareHtml: converted.file.compareHtml, report: finished.report },
      root,
    );
    await db.transaction(async (tx) => {
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

  return { ok: true, templateId, href: `/${team.slug}/templates/${templateId}` };
}
