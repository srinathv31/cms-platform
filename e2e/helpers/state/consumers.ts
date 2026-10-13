import { columnNames, execute, marks, select, type InValue } from "./db";
import {
  fromRow,
  type ConsumerNoticeRecord,
  type RenderLogRecord,
} from "./records";

// Stencil's side of its consumers: who is registered, the notices waiting for them, and the log of every render
// they asked for.

/** The ids of the registered consumers. */
export async function consumerIds(): Promise<string[]> {
  return (await select("SELECT id FROM consumers ORDER BY id")).map((row) =>
    String(row.id),
  );
}

export interface NoticeFilter {
  templateId?: string;
  consumerId?: string;
  kind?: string;
}

/** Notices that fit, in the order they were written to the outbox (`seq`). */
export async function consumerNotices(
  filter: NoticeFilter = {},
): Promise<ConsumerNoticeRecord[]> {
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter.templateId !== undefined) {
    where.push("template_id = ?");
    args.push(filter.templateId);
  }
  if (filter.consumerId !== undefined) {
    where.push("consumer_id = ?");
    args.push(filter.consumerId);
  }
  if (filter.kind !== undefined) {
    where.push("kind = ?");
    args.push(filter.kind);
  }
  return (
    await select(
      `SELECT * FROM consumer_notices ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq`,
      args,
    )
  ).map((row) => fromRow<ConsumerNoticeRecord>("consumer_notices", row));
}

/** Each notice's place in the outbox, in the order given; ids no longer stored are left out. */
export async function noticeSeqs(ids: readonly string[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await select(
    `SELECT id, seq FROM consumer_notices WHERE id IN (${marks(ids.length)})`,
    [...ids],
  );
  const byId = new Map(rows.map((row) => [String(row.id), Number(row.seq)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export interface RenderLogFilter {
  templateId?: string;
  correlationId?: string;
  isPreview?: boolean;
}

/** Renders the API logged that fit, oldest first. */
export async function renderLog(
  filter: RenderLogFilter = {},
): Promise<RenderLogRecord[]> {
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter.templateId !== undefined) {
    where.push("template_id = ?");
    args.push(filter.templateId);
  }
  if (filter.correlationId !== undefined) {
    where.push("correlation_id = ?");
    args.push(filter.correlationId);
  }
  if (filter.isPreview !== undefined) {
    where.push("is_preview = ?");
    args.push(filter.isPreview ? 1 : 0);
  }
  return (
    await select(
      `SELECT * FROM render_log ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at, id`,
      args,
    )
  ).map((row) => fromRow<RenderLogRecord>("render_log", row));
}

/** Every log row of one correlation id, oldest first. */
export const renderLogFor = (correlationId: string) =>
  renderLog({ correlationId });

/** The fields a log row has (camelCase), whatever order they are stored in. */
export async function renderLogFields(): Promise<string[]> {
  const columns = await columnNames("render_log");
  return Object.keys(
    fromRow<Record<string, unknown>>(
      "render_log",
      Object.fromEntries(columns.map((column) => [column, null])),
    ),
  );
}

/** How many log rows hold `text` in any field, matched as plain text. */
export async function renderLogRowsContaining(text: string): Promise<number> {
  const columns = await columnNames("render_log");
  const asText = columns
    .map((column) => `coalesce(cast("${column}" as text), '')`)
    .join(" || ' ' || ");
  const [row] = await select(
    `SELECT count(*) AS n FROM render_log WHERE instr(${asText}, ?) > 0`,
    [text],
  );
  return Number(row.n);
}

/**
 * Remembers which notices of this kind exist. The returned function removes the ones written since, with any mark
 * Coral made of having read them.
 */
export async function rememberConsumerNotices(
  kind: string,
): Promise<() => Promise<void>> {
  const before = new Set((await consumerNotices({ kind })).map((n) => n.id));
  return async () => {
    for (const notice of await consumerNotices({ kind })) {
      if (before.has(notice.id)) continue;
      await execute("DELETE FROM sim_notice_reads WHERE notice_id = ?", [
        notice.id,
      ]);
      await execute("DELETE FROM consumer_notices WHERE id = ?", [notice.id]);
    }
  };
}
