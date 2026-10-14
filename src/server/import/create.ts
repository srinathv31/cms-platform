import "server-only";
import { finishImport, refusalForUnreadableKind } from "@/domain/import";
import {
  IMPORT_LIMITS,
  IMPORT_MIME,
  IMPORT_REFUSALS,
  type ImportRefusalName,
  type ImportResponse,
} from "@/domain/import-types";
import { REFUSALS as LIFECYCLE_REFUSALS } from "@/domain/lifecycle/refusals";
import {
  REQUEST_REFUSALS,
  refuse,
  type Refused,
  type RefusalCode,
} from "@/domain/refusals";
import { defaultSampleSets } from "@/editor/model/sample-sets";
import type { RequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import {
  conformToContentType,
  draftContentOf,
  prepareDraftContent,
} from "@/server/templates/create";
import { convertFile } from "./convert";
import { sniffKind } from "./sniff";

// Import a file: a .docx, .pdf or .txt becomes a new template whose first draft holds
// its text, with `{{placeholders}}` as Text chips and the content type's required sections in place.
// The order is the contract's (src/domain/import-types.ts): permission first, then size, kind,
// conversion, then the document check (the body is stored as src/server/documents/prepare.ts makes
// it, as an autosave would store it); then the backend stores the template, the draft, the original and the
// report (`templates.createImported`) in one write, or none of them.
//
// The BFF does everything that builds a document here (decision 0065, H3): it sniffs and converts the file,
// asks the backend which content type documents are made on (`templates.newTemplateType`, whose `asOf` dates
// the sample sets: the BFF reads no clock), fits the draft to it and prepares it. The backend only stores.

export interface ImportFile {
  /** The client's file name: display text only, never a path. */
  name: string;
  bytes: Uint8Array;
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
  // A team that isn't there, or that the viewer may not enter, reads as not there (decision 0052).
  [REQUEST_REFUSALS.spaceUnavailable.code]: 404,
};
const IMPORT_CODES: ReadonlySet<string> = new Set(
  Object.values(IMPORT_REFUSALS).map((entry) => entry.code),
);

/**
 * The HTTP status for an import's answer: 200 · 400 the file is refused · 401 nobody is signed in · 404 the team
 * isn't there or isn't the viewer's to enter · 403 the viewer may not create here (any other refusal) · 409 no
 * content type makes documents · 413 too large · 415 not a
 * kind we take.
 */
export function importStatus(response: ImportResponse): number {
  if (response.ok) return 200;
  return (
    IMPORT_STATUS[response.code] ??
    (IMPORT_CODES.has(response.code) ? 400 : 403)
  );
}

/** A refusal as the import answers it: its code and sentence, and nothing of the read's status. */
const refused = ({ code, reason }: { code: RefusalCode; reason: string }) =>
  refuse({ code, reason });

/**
 * The permission half of an import, on its own so the route can ask it before reading the body. The URL's team
 * is resolved to its id once (`identity.space`), then the backend says whether the viewer may create on it. A
 * team that isn't there and one the viewer may not enter read the same (404 `space_unavailable`); All teams, which
 * is no team to create in, and a team the viewer may enter but not create on are 403.
 */
export async function importPermission(
  ctx: RequestContext,
  teamSlug: string,
): Promise<{ ok: true; teamId: string; teamSlug: string } | Refused> {
  const space = await services().identity.space(ctx, { slug: teamSlug });
  if (!space.ok) return refused(space);
  const { teamId } = space.space;
  if (teamId === null) return refuse(REQUEST_REFUSALS.teamGone);
  const allowed = await services().templates.createPermission(ctx, { teamId });
  return allowed.ok ? { ok: true, teamId, teamSlug } : refused(allowed);
}

export async function importTemplate(
  ctx: RequestContext,
  input: { teamSlug: string; file: ImportFile | null },
): Promise<ImportResponse> {
  const permitted = await importPermission(ctx, input.teamSlug);
  if (!permitted.ok) return permitted;
  const { teamId, teamSlug } = permitted;

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
  const type = await services().templates.newTemplateType(ctx, {
    teamId,
    family: "document",
  });
  if (!type.ok) return refused(type);
  const finished = finishImport({
    file: converted.file,
    filename: file.name,
    size: file.bytes.byteLength,
    requiredSections: type.requiredSections,
  });
  const starter = conformToContentType(
    {
      key: "import",
      name: finished.name,
      body: finished.body,
      variables: finished.variables,
      // The sample sets are dated from the backend's instant, as a new template's are.
      sampleSets: defaultSampleSets(finished.variables, type.asOf.slice(0, 10)),
    },
    type,
    // finishImport fitted the required sections already; the channels still follow the content type.
    { sectionsFitted: true },
  );
  // A document the check refuses is never stored (it couldn't be rendered): nothing is written.
  const prepared = prepareDraftContent(
    draftContentOf(starter, { imported: true }),
  );
  if (!prepared.ok) return refuse(IMPORT_REFUSALS.content(prepared.message));

  const created = await services().templates.createImported(ctx, {
    teamId,
    contentTypeId: type.contentTypeId,
    draft: prepared.draft,
    original: {
      filename: finished.report.filename,
      mime: IMPORT_MIME[kind],
      bytes: file.bytes,
    },
    report: finished.report,
    compareHtml: converted.file.compareHtml ?? null,
  });
  if (!created.ok) return refused(created);

  return {
    ok: true,
    templateId: created.templateId,
    href: `/${teamSlug}/templates/${created.templateId}`,
  };
}
