import { rm } from "node:fs/promises";
import path from "node:path";
import { E2E_UPLOADS_DIR } from "../../storage";
import {
  execute,
  insert,
  marks,
  select,
  selectOne,
  update,
  type Row,
} from "./db";
import {
  fromRow,
  toColumns,
  type TemplateRecord,
  type UploadRecord,
} from "./records";
import { templateById } from "./versions";

// Putting a template back, or taking it away, with everything that points at it: the rows Stencil wrote about it
// (versions, approvals, threads and comments, audit events, notifications, consumer notices, render log, uploads)
// and, when it goes, Coral's deliveries and link for it and the upload folders on disk.

interface Owned {
  table: string;
  /** Which rows of the table belong to the template: a condition with one `?`, filled by `arg`. */
  where: string;
  arg: (templateId: string) => string;
}

/** What a template owns, children before parents: the order rows can be deleted in. */
const OWNED: readonly Owned[] = [
  {
    table: "comments",
    where:
      "thread_id IN (SELECT id FROM comment_threads WHERE template_id = ?)",
    arg: (id) => id,
  },
  { table: "comment_threads", where: "template_id = ?", arg: (id) => id },
  {
    table: "approvals",
    where: "version_id IN (SELECT id FROM versions WHERE template_id = ?)",
    arg: (id) => id,
  },
  { table: "audit_events", where: "template_id = ?", arg: (id) => id },
  {
    table: "notifications",
    where: "json_extract(link, '$.templateId') = ?",
    arg: (id) => id,
  },
  { table: "consumer_notices", where: "template_id = ?", arg: (id) => id },
  { table: "render_log", where: "template_id = ?", arg: (id) => id },
  { table: "versions", where: "template_id = ?", arg: (id) => id },
  // After the versions: `versions.import_upload_id` names the upload.
  { table: "uploads", where: "template_id = ?", arg: (id) => id },
];

const CHUNK = 200;

async function idsOwned(owned: Owned, templateId: string): Promise<string[]> {
  return (
    await select(`SELECT id FROM ${owned.table} WHERE ${owned.where}`, [
      owned.arg(templateId),
    ])
  ).map((row) => String(row.id));
}

/** Deletes the rows the template owns, except the ids in `keep` (by table). Children first. */
async function deleteOwned(
  templateId: string,
  keep: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
) {
  for (const owned of OWNED) {
    const kept = keep.get(owned.table);
    const doomed = (await idsOwned(owned, templateId)).filter(
      (id) => !kept?.has(id),
    );
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const chunk = doomed.slice(i, i + CHUNK);
      // Coral's read marks point at the notices.
      if (owned.table === "consumer_notices")
        await execute(
          `DELETE FROM sim_notice_reads WHERE notice_id IN (${marks(chunk.length)})`,
          chunk,
        );
      await execute(
        `DELETE FROM ${owned.table} WHERE id IN (${marks(chunk.length)})`,
        chunk,
      );
    }
    if (owned.table === "uploads") await removeUploadFolders(doomed);
  }
}

/** One folder per upload id under e2e's uploads directory; never a wildcard. */
async function removeUploadFolders(uploadIds: readonly string[]) {
  for (const id of uploadIds)
    if (/^[\w-]{8,}$/.test(id))
      // A few retries, as in `removeUpload` (src/server/services/local/uploads.ts): on Windows a virus scanner can still
      // hold a file it was just handed.
      await rm(path.join(E2E_UPLOADS_DIR, id), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
}

/** Removes a template and everything that points at it: its rows, Coral's deliveries and link for it, its upload folders. */
export async function removeTemplate(templateId: string): Promise<void> {
  await execute("DELETE FROM sim_deliveries WHERE template_id = ?", [
    templateId,
  ]);
  await execute("DELETE FROM sim_links WHERE template_id = ?", [templateId]);
  await deleteOwned(templateId);
  await execute("DELETE FROM templates WHERE id = ?", [templateId]);
}

/**
 * Remembers a template as it is now: its versions as they are, and which rows exist for it. The returned function
 * puts it back: what was written since (a new draft, comments, audit events, notifications, notices, render log
 * rows, uploads) is removed, and each version goes back to the row it was.
 */
export async function rememberTemplate(
  templateId: string,
): Promise<() => Promise<void>> {
  const keep = new Map<string, Set<string>>();
  for (const owned of OWNED)
    keep.set(owned.table, new Set(await idsOwned(owned, templateId)));
  const versions: Row[] = await select(
    "SELECT * FROM versions WHERE template_id = ?",
    [templateId],
  );
  return async () => {
    await deleteOwned(templateId, keep);
    for (const { id, ...columns } of versions) {
      const stored = await selectOne("SELECT id FROM versions WHERE id = ?", [
        id,
      ]);
      if (stored) await update("versions", "id", id, columns);
      else await insert("versions", { id, ...columns });
    }
  };
}

/** Adds a template that is a copy of another's row, with `changes` on top. The copy has no versions yet. */
export async function addTemplateLike(
  sourceTemplateId: string,
  changes: Partial<TemplateRecord> & { id: string },
): Promise<TemplateRecord> {
  const source = await templateById(sourceTemplateId);
  if (!source) throw new Error(`Template ${sourceTemplateId} doesn't exist.`);
  const record: TemplateRecord = { ...source, ...changes };
  await insert("templates", toColumns("templates", { ...record }));
  return record;
}

/** The files uploaded to a template (an import's original, for one), oldest first. */
export async function uploadsOf(templateId: string): Promise<UploadRecord[]> {
  return (
    await select(
      "SELECT * FROM uploads WHERE template_id = ? ORDER BY created_at, id",
      [templateId],
    )
  ).map((row) => fromRow<UploadRecord>("uploads", row));
}
