import type { Channel, SeedVersion, Variable } from "../../api/helpers";
import { insert, select, selectOne, update, type InValue } from "./db";
import {
  fromRow,
  newId,
  toColumns,
  type TemplateRecord,
  type VersionRecord,
} from "./records";

// Templates and their versions: what each one holds, which states they are in, and a way to change a version for
// the length of a test.

export async function templateById(
  templateId: string,
): Promise<TemplateRecord | undefined> {
  const row = await selectOne("SELECT * FROM templates WHERE id = ?", [
    templateId,
  ]);
  return row ? fromRow<TemplateRecord>("templates", row) : undefined;
}

export interface VersionFilter {
  id?: string;
  templateId?: string;
  /** The version's own name (the name is a version field). */
  name?: string;
  state?: string;
  number?: number;
  round?: number;
  /** The team's slug, as it is in its URLs. */
  teamSlug?: string;
}

/** Every version that fits, oldest number first (an open draft, which has no number, comes first). */
export async function findVersions(
  filter: VersionFilter = {},
): Promise<VersionRecord[]> {
  const where: string[] = [];
  const args: InValue[] = [];
  const add = (condition: string, value: InValue | undefined) => {
    if (value === undefined) return;
    where.push(condition);
    args.push(value);
  };
  add("v.id = ?", filter.id);
  add("v.template_id = ?", filter.templateId);
  add("v.name = ?", filter.name);
  add("v.state = ?", filter.state);
  add("v.number = ?", filter.number);
  add("v.round = ?", filter.round);
  add("tm.slug = ?", filter.teamSlug);
  const rows = await select(
    `SELECT v.* FROM versions v
     JOIN templates t ON t.id = v.template_id
     JOIN teams tm ON tm.id = t.team_id
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY v.template_id, v.number, v.round, v.created_at`,
    args,
  );
  return rows.map((row) => fromRow<VersionRecord>("versions", row));
}

/** The first version that fits, or undefined. */
export async function findVersion(
  filter: VersionFilter,
): Promise<VersionRecord | undefined> {
  return (await findVersions(filter))[0];
}

export const versionById = (id: string) => findVersion({ id });

/** Every version of a template (and every round of each), oldest number first; an open draft comes first. */
export const versionsOf = (templateId: string) => findVersions({ templateId });

/**
 * A number's version: the round that was released, else the latest round (rounds sent back before a later one are
 * a record only).
 */
export async function versionNumbered(
  templateId: string,
  number: number,
): Promise<VersionRecord | undefined> {
  const rounds = await findVersions({ templateId, number });
  const released = rounds.find((v) =>
    ["active", "superseded", "revoked"].includes(v.state),
  );
  return released ?? rounds[rounds.length - 1];
}

/** The template's open draft, if it has one. */
export const openDraftOf = (templateId: string) =>
  findVersion({ templateId, state: "draft" });

/** The version a number-less draft save from another browser tab would have moved on: its `rev` goes up by one. */
export async function bumpDraftRev(templateId: string): Promise<void> {
  const draft = await openDraftOf(templateId);
  if (!draft) throw new Error(`Template ${templateId} has no open draft.`);
  await update("versions", "id", draft.id, { rev: draft.rev + 1 });
}

/**
 * Adds a version that is a copy of `source` with `changes` on top (an id of its own unless `changes` has one). For
 * the states the seed has no row for: a v3 in review, a Superseded v1, a round sent back. The template it belongs
 * to owns the new row, so removing the template removes it.
 */
export async function addVersionLike(
  source: VersionRecord,
  changes: Partial<VersionRecord>,
): Promise<VersionRecord> {
  const record: VersionRecord = {
    ...source,
    id: newId("v"),
    ...changes,
  };
  await insert("versions", toColumns("versions", { ...record }));
  return record;
}

/**
 * Every version of the seed, every round of it, with what the render rules look at. Nothing is hardcoded by id.
 */
export async function allVersions(): Promise<SeedVersion[]> {
  const rows = await select(`
    SELECT v.id, v.template_id, v.name AS template_name, t.team_id, v.number, v.round, v.state, v.channels, v.variables,
           v.sunset_at, v.revoke,
           (SELECT a.number FROM versions a WHERE a.template_id = v.template_id AND a.state = 'active') AS active_number,
           (SELECT h.id FROM versions h WHERE h.template_id = v.template_id AND h.number = v.number
            ORDER BY h.state IN ('active', 'superseded', 'revoked') DESC, h.round DESC LIMIT 1) AS head_id
    FROM versions v JOIN templates t ON t.id = v.template_id
    ORDER BY v.template_id, v.number, v.round`);
  return rows.map((r) => {
    const revoke = r.revoke
      ? (JSON.parse(String(r.revoke)) as { confirmedAt?: string })
      : null;
    return {
      id: String(r.id),
      templateId: String(r.template_id),
      templateName: String(r.template_name),
      teamId: String(r.team_id),
      number: r.number === null ? null : Number(r.number),
      round: r.round === null ? null : Number(r.round),
      head: r.number !== null && r.head_id === r.id,
      state: String(r.state),
      channels: JSON.parse(String(r.channels)) as Channel[],
      variables: JSON.parse(String(r.variables)) as Variable[],
      sunsetAt: r.sunset_at === null ? null : Number(r.sunset_at),
      revokedAt: revoke?.confirmedAt ?? null,
      activeNumber: r.active_number === null ? null : Number(r.active_number),
    };
  });
}

/**
 * Changes fields of one version for the length of `fn`, then puts back exactly what was there, even when `fn`
 * throws. For the rules the seed has no row for (a sunset that has passed, a version with Email on).
 */
export async function withVersion<T>(
  versionId: string,
  patch: Partial<VersionRecord>,
  fn: () => Promise<T>,
): Promise<T> {
  const columns = toColumns("versions", { ...patch });
  const names = Object.keys(columns);
  const before = await selectOne(
    `SELECT ${names.join(", ")} FROM versions WHERE id = ?`,
    [versionId],
  );
  if (!before) throw new Error(`Version ${versionId} doesn't exist.`);
  try {
    await update("versions", "id", versionId, columns);
    return await fn();
  } finally {
    await update("versions", "id", versionId, before);
  }
}
