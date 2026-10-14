import { execute, insert, select, selectOne, update } from "./db";
import {
  fromRow,
  toColumns,
  type ApprovalStageRecord,
  type ContentTypeRecord,
} from "./records";

// Platform configuration: the settings table (the demo clock and the business time zone live there), a content
// type's approval chain and its allowed channels.

const UPSERT_SETTING =
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

/**
 * A team's id, by the slug its URLs name it by. The two are never the same (decision 0053): the database, the audit
 * trail and the notifications hold the id, the URL the slug.
 */
export async function teamIdOf(slug: string): Promise<string> {
  const row = await selectOne("SELECT id FROM teams WHERE slug = ?", [slug]);
  if (!row) throw new Error(`No team has the slug ${slug}.`);
  return String(row.id);
}

/** A setting's value, or undefined when it isn't set. */
export async function setting<T = unknown>(
  key: string,
): Promise<T | undefined> {
  const row = await selectOne("SELECT value FROM settings WHERE key = ?", [
    key,
  ]);
  return row ? fromRow<{ value: T }>("settings", row).value : undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await execute(UPSERT_SETTING, [key, JSON.stringify(value)]);
}

export async function deleteSetting(key: string): Promise<void> {
  await execute("DELETE FROM settings WHERE key = ?", [key]);
}

/** Remembers a setting as it is now. The returned function puts it back, or removes it if it wasn't set. */
export async function rememberSetting(
  key: string,
): Promise<() => Promise<void>> {
  const before = await selectOne("SELECT value FROM settings WHERE key = ?", [
    key,
  ]);
  return async () => {
    if (before) await execute(UPSERT_SETTING, [key, before.value]);
    else await deleteSetting(key);
  };
}

/** A content type's approval chain, first stage first. */
export async function approvalChain(
  contentTypeId: string,
): Promise<ApprovalStageRecord[]> {
  return (
    await select(
      "SELECT * FROM approval_stages WHERE content_type_id = ? ORDER BY position",
      [contentTypeId],
    )
  ).map((row) => fromRow<ApprovalStageRecord>("approval_stages", row));
}

/**
 * Adds a stage to a chain, as the chain editor would have saved it. For a spec that re-seeds afterwards
 * (`resetDemoData`): nothing here is undone.
 */
export async function addApprovalStage(
  stage: ApprovalStageRecord,
): Promise<void> {
  await insert("approval_stages", toColumns("approval_stages", { ...stage }));
}

/** Moves a stage to a position in its chain. For a spec that re-seeds afterwards (`resetDemoData`). */
export async function moveApprovalStage(
  stageId: string,
  position: number,
): Promise<void> {
  await update("approval_stages", "id", stageId, { position });
}

/** A content type by its key ("disclosure"), or undefined. */
export async function contentType(
  key: string,
): Promise<ContentTypeRecord | undefined> {
  const row = await selectOne("SELECT * FROM content_types WHERE key = ?", [
    key,
  ]);
  return row ? fromRow<ContentTypeRecord>("content_types", row) : undefined;
}

/** The channels a content type allows its versions to use. */
export async function setAllowedChannels(
  key: string,
  channels: readonly string[],
): Promise<void> {
  await update("content_types", "key", key, {
    allowed_channels: JSON.stringify(channels),
  });
}

/** Remembers a content type's allowed channels. The returned function puts them back. */
export async function rememberAllowedChannels(
  key: string,
): Promise<() => Promise<void>> {
  const before = await contentType(key);
  if (!before) throw new Error(`There is no "${key}" content type.`);
  return () => setAllowedChannels(key, before.allowedChannels);
}

/** Changes a content type's allowed channels for the length of `fn`, then puts them back, even when `fn` throws. */
export async function withAllowedChannels<T>(
  key: string,
  channels: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const restore = await rememberAllowedChannels(key);
  try {
    await setAllowedChannels(key, channels);
    return await fn();
  } finally {
    await restore();
  }
}
