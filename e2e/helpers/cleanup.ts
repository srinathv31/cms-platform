import { rm } from "node:fs/promises";
import path from "node:path";
import type { Client, InValue } from "@libsql/client";

// Removing a template a spec created, and everything it owns (children first), by its id: rows in the
// database and the upload folders under data/uploads (one per upload id; never a wildcard).

/** The file has no busy timeout, and the app writes to it: a statement waits its turn. */
async function busy<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const text = String((error as { code?: unknown; message?: unknown })?.code ?? "") + String((error as Error)?.message ?? "");
      if (attempt >= 8 || !/SQLITE_BUSY|database is locked/i.test(text)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    }
  }
}

export async function rowsOf(db: Client, sql: string, args: InValue[] = []) {
  const result = await busy(() => db.execute({ sql, args }));
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column) => [column, row[column] as InValue])));
}

/** Deletes one template (by id) with its versions, uploads (rows and folders), comments, audit events and notifications. */
export async function removeTemplate(db: Client, id: string) {
  const uploads = await rowsOf(db, "SELECT id FROM uploads WHERE template_id = ?", [id]);
  const own = "(SELECT id FROM versions WHERE template_id = ?)";
  const threads = "(SELECT id FROM comment_threads WHERE template_id = ?)";
  const statements: [string, InValue[]][] = [
    [`DELETE FROM comments WHERE thread_id IN ${threads}`, [id]],
    ["DELETE FROM comment_threads WHERE template_id = ?", [id]],
    [`DELETE FROM approvals WHERE version_id IN ${own}`, [id]],
    ["DELETE FROM audit_events WHERE template_id = ?", [id]],
    ["DELETE FROM notifications WHERE href LIKE ?", [`%/${id}%`]],
    ["DELETE FROM consumer_notices WHERE template_id = ?", [id]],
    ["DELETE FROM render_log WHERE template_id = ?", [id]],
    // versions.import_upload_id points at the upload, so the versions go first.
    ["DELETE FROM versions WHERE template_id = ?", [id]],
    ["DELETE FROM uploads WHERE template_id = ?", [id]],
    ["DELETE FROM templates WHERE id = ?", [id]],
  ];
  for (const [sql, args] of statements) await busy(() => db.execute({ sql, args }));
  for (const upload of uploads) {
    const folder = String(upload.id);
    if (/^[\w-]{8,}$/.test(folder)) await rm(path.join(process.cwd(), "data", "uploads", folder), { recursive: true, force: true });
  }
}
