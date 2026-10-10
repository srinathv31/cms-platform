import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client, InValue } from "@libsql/client";
import { asc, eq, getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDraft } from "@/domain/lifecycle";
import type { Viewer } from "@/domain/types";
import { submitVersion } from "@/server/actions/review";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { createContext } from "@/server/seed/context";
import { seedPeople } from "@/server/seed/people";
import { seedPlatform } from "@/server/seed/platform";
import { seedTeams } from "@/server/seed/teams";
import { buildStarter } from "@/server/starters";
import { draftRev, loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";

// Migration 0008 (review rounds) on a database as it stood before it: migrated through 0007, with
// versions numbered the old way, where every submission took the next number and a send-back kept its
// number as a record. Then 0008 runs the way `npm run db:migrate` runs it, and the app submits on top.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-rounds-migration-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const MIGRATIONS = "./src/server/db/migrations";
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(BASE.getTime() - n * DAY);

let db: Db;
let libsql: Client;
let before: string;
let maya: Viewer;

/** The migrations folder as it stood before 0008: the SQL files through 0007, and a journal that ends there. */
function migrationsThrough0007(): string {
  const folder = mkdtempSync(join(tmpdir(), "ucomp-migrations-0007-"));
  mkdirSync(join(folder, "meta"));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  journal.entries = journal.entries.filter((e) => e.idx <= 7);
  expect(journal.entries.at(-1)?.tag).toBe("0007_sunset_business_zone");
  for (const { tag } of journal.entries) copyFileSync(join(MIGRATIONS, `${tag}.sql`), join(folder, `${tag}.sql`));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  return folder;
}

/** A row in the 0007 shape (no `round`), written as SQL: Drizzle's schema already has the column. */
async function insertOld(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  const value = (v: unknown): InValue =>
    v instanceof Date ? v.getTime() : v !== null && typeof v === "object" ? JSON.stringify(v) : (v as InValue);
  await libsql.execute({
    sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    args: columns.map((c) => value(row[c])),
  });
}

/**
 * Rows as the seed builds them, written in the shape the database has now (0007): a column a later
 * migration adds (a team's app name, a content type's SMS footer) is left out, as it was then.
 */
async function insertAsBuilt<T extends SQLiteTable>(table: T, rows: readonly T["$inferInsert"][]) {
  const name = getTableName(table);
  const existing = new Set((await libsql.execute(`PRAGMA table_info(${name})`)).rows.map((r) => String(r.name)));
  const columns = Object.entries(getTableColumns(table));
  for (const row of rows) {
    const values: Record<string, unknown> = {};
    for (const [key, column] of columns) {
      const value = (row as Record<string, unknown>)[key];
      if (value === undefined || !existing.has(column.name)) continue;
      values[column.name] = value === null ? null : column.mapToDriverValue(value);
    }
    await insertOld(name, values);
  }
}

/**
 * A template and its versions as the old numbering left them: `numbered` in order, each submitted by
 * Maya, then an open draft started from the last of them.
 */
async function oldTemplate(id: string, numbered: { number: number; state: "active" | "superseded" | "changes_requested" }[]) {
  const created = daysAgo(40);
  await insertAsBuilt(schema.templates, [{ id, teamId: "coral-offers", contentTypeId: "ct_disclosure", createdBy: "maya", createdAt: created }]);
  const starter = buildStarter({ family: "document", starterKey: "card_offer_terms" }, { scope: id, now: created });
  const { draft } = createDraft({ starter, createdBy: "maya", now: created }).changes;
  const content = {
    name: draft.name,
    body: draft.body,
    channels: draft.channels,
    variables: draft.variables,
    sample_sets: draft.sampleSets,
    created_by: "maya",
    writers: ["maya"],
  };
  let previous: string | null = null;
  for (const [i, v] of numbered.entries()) {
    const versionId = `v_${id}_${v.number}`;
    const at = daysAgo(30 - i * 5);
    await insertOld("versions", {
      id: versionId,
      template_id: id,
      number: v.number,
      state: v.state,
      based_on_version_id: previous,
      ...content,
      contract_changes: i === 0 ? null : [],
      stages: [{ id: "stage_disclosure_0", name: "Team approver" }],
      rev: 40,
      created_at: at,
      updated_at: at,
      submitted_by: "maya",
      submitted_at: at,
      activated_at: v.state === "changes_requested" ? null : at,
      superseded_at: v.state === "superseded" ? daysAgo(30 - (i + 1) * 5) : null,
    });
    previous = versionId;
  }
  await insertOld("versions", {
    id: `v_${id}_draft`,
    template_id: id,
    number: null,
    state: "draft",
    based_on_version_id: previous,
    ...content,
    rev: 12,
    created_at: daysAgo(2),
    updated_at: daysAgo(1),
  });
}

const { versions } = schema;
const rowsOf = (templateId: string) =>
  db
    .select({ id: versions.id, number: versions.number, round: versions.round, state: versions.state })
    .from(versions)
    .where(eq(versions.templateId, templateId))
    .orderBy(asc(versions.createdAt));

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  before = migrationsThrough0007();
  await migrate(db, { migrationsFolder: before });

  // The people, teams and chain, from the seed (none of these tables changed in 0008; later migrations add
  // columns to teams and content types, which these rows go in without).
  const ctx = createContext(BASE.getTime());
  seedPeople(ctx);
  seedTeams(ctx);
  seedPlatform(ctx);
  const { sink } = ctx;
  await insertAsBuilt(schema.users, sink.users);
  await insertAsBuilt(schema.teams, sink.teams);
  await insertAsBuilt(schema.memberships, sink.memberships);
  await insertAsBuilt(schema.membershipRoles, sink.membershipRoles);
  await insertAsBuilt(schema.contentTypes, sink.contentTypes);
  await insertAsBuilt(schema.approvalStages, sink.approvalStages);

  // Sent back the old way: v1 Active, then v2 sent back (it kept its number), and a draft from it.
  await oldTemplate("UC-SENTBK", [
    { number: 1, state: "active" },
    { number: 2, state: "changes_requested" },
  ]);
  // Released twice: v1 Superseded, v2 Active, and a draft from v2.
  await oldTemplate("UC-SH1PED", [
    { number: 1, state: "superseded" },
    { number: 2, state: "active" },
  ]);

  await migrate(db, { migrationsFolder: MIGRATIONS });
  maya = await loadPersona(db, "maya");
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
  if (before) rmSync(before, { recursive: true, force: true });
});

describe("migration 0008: review rounds", () => {
  it("makes every numbered row round 1, keeps its number, and leaves the draft without either", async () => {
    expect((await rowsOf("UC-SENTBK")).map((v) => [v.number, v.round, v.state])).toEqual([
      [1, 1, "active"],
      [2, 1, "changes_requested"],
      [null, null, "draft"],
    ]);
    expect((await rowsOf("UC-SH1PED")).map((v) => [v.number, v.round, v.state])).toEqual([
      [1, 1, "superseded"],
      [2, 1, "active"],
      [null, null, "draft"],
    ]);
  });

  it("replaces the one-row-per-number index with one row per round and one released row per number", async () => {
    const indexes = (await libsql.execute("PRAGMA index_list(versions)")).rows.map((r) => String(r.name));
    expect(indexes).toEqual(expect.arrayContaining(["versions_template_number_round", "versions_one_released"]));
    expect(indexes).not.toContain("versions_template_number");
  });

  it("refuses a second released row for a number, and a second row for a round", async () => {
    const row = {
      template_id: "UC-SH1PED",
      name: "x",
      body: { type: "doc" },
      channels: [],
      variables: [],
      sample_sets: [],
      created_by: "maya",
      created_at: BASE,
      updated_at: BASE,
    };
    // v2 is Active: a later round of it can't be released too.
    await expect(insertOld("versions", { ...row, id: "v_second_released", number: 2, round: 2, state: "superseded" })).rejects.toThrow(
      /UNIQUE constraint failed: versions\.template_id, versions\.number(?!, versions\.round)/,
    );
    await expect(insertOld("versions", { ...row, id: "v_same_round", number: 1, round: 1, state: "changes_requested" })).rejects.toThrow(
      /UNIQUE constraint failed: versions\.template_id, versions\.number, versions\.round/,
    );
    // A sent-back round beside the released row is what rounds are for.
    await insertOld("versions", { ...row, id: "v_sent_back_round", number: 2, round: 2, state: "changes_requested" });
    await libsql.execute("DELETE FROM versions WHERE id = 'v_sent_back_round'");
  });

  it("runs the later migrations over the same rows: no channel fields yet, and a document's versions without an SMS footer", async () => {
    const { rows } = await libsql.execute("SELECT channel_fields, sms_footer FROM versions WHERE template_id = 'UC-SH1PED' ORDER BY created_at");
    expect(rows.map((r) => [r.channel_fields, r.sms_footer])).toEqual([
      ["{}", null],
      ["{}", null],
      ["{}", null],
    ]);
  });

  it("continues the number an old send-back left above every released one, and numbers the next release after the last", async () => {
    vi.mocked(getViewer).mockResolvedValue(maya);
    // Before rounds this submission would have been v3: now it is v2's next round.
    expect(await submitVersion({ templateId: "UC-SENTBK", rev: await draftRev(db, "UC-SENTBK") })).toEqual({ ok: true, number: 2, round: 2 });
    expect(await submitVersion({ templateId: "UC-SH1PED", rev: await draftRev(db, "UC-SH1PED") })).toEqual({ ok: true, number: 3, round: 1 });
    expect((await rowsOf("UC-SENTBK")).map((v) => [v.number, v.round, v.state])).toEqual([
      [1, 1, "active"],
      [2, 1, "changes_requested"],
      [2, 2, "in_review"],
    ]);
  });
});
