import { execute, select, type InValue } from "./db";
import {
  fromRow,
  type AuditEventRecord,
  type NotificationRecord,
} from "./records";

// What Stencil wrote down as things happened: the audit log, people's notifications, and (for the privacy
// checks) all of it as one piece of text.

export interface AuditFilter {
  templateId?: string;
  versionId?: string;
  /** One action, or any of several. */
  action?: string | readonly string[];
  /** Everything except this action. */
  notAction?: string;
}

/** Audit events that fit, in the order they were written (oldest first). */
export async function auditEvents(
  filter: AuditFilter = {},
): Promise<AuditEventRecord[]> {
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter.templateId !== undefined) {
    where.push("template_id = ?");
    args.push(filter.templateId);
  }
  if (filter.versionId !== undefined) {
    where.push("version_id = ?");
    args.push(filter.versionId);
  }
  if (typeof filter.action === "string") {
    where.push("action = ?");
    args.push(filter.action);
  } else if (filter.action !== undefined) {
    where.push(`action IN (${filter.action.map(() => "?").join(", ")})`);
    args.push(...filter.action);
  }
  if (filter.notAction !== undefined) {
    where.push("action <> ?");
    args.push(filter.notAction);
  }
  return (
    await select(
      `SELECT * FROM audit_events ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at, rowid`,
      args,
    )
  ).map((row) => fromRow<AuditEventRecord>("audit_events", row));
}

/** The notifications that link to a template, oldest first. */
export async function notificationsAbout(
  templateId: string,
): Promise<NotificationRecord[]> {
  return (
    await select(
      "SELECT * FROM notifications WHERE href LIKE ? ORDER BY created_at, rowid",
      [`%/${templateId}%`],
    )
  ).map((row) => fromRow<NotificationRecord>("notifications", row));
}

/**
 * Everything Stencil stored about a template's renders, audit events, notifications and consumer notices, as one
 * piece of text, for the checks that no variable value or customer detail is anywhere in it.
 */
export async function storedTextAbout(templateId: string): Promise<string> {
  const [renders, events, notifications, notices] = await Promise.all([
    select("SELECT * FROM render_log WHERE template_id = ?", [templateId]),
    select("SELECT * FROM audit_events WHERE template_id = ?", [templateId]),
    select("SELECT * FROM notifications WHERE href LIKE ?", [
      `%/${templateId}%`,
    ]),
    select("SELECT * FROM consumer_notices WHERE template_id = ?", [
      templateId,
    ]),
  ]);
  return JSON.stringify([...renders, ...events, ...notifications, ...notices]);
}

/**
 * Remembers which audit events with this action exist. The returned function removes the ones written since. For
 * the events a spec makes the app write (a sweep's, a settings change's) and that must not stay in the log.
 */
export async function rememberAuditEvents(
  action: string,
): Promise<() => Promise<void>> {
  const before = new Set((await auditEvents({ action })).map((e) => e.id));
  return async () => {
    for (const event of await auditEvents({ action }))
      if (!before.has(event.id))
        await execute("DELETE FROM audit_events WHERE id = ?", [event.id]);
  };
}
