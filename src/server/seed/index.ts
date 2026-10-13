import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "@/server/db/client";
import * as ucomp from "@/server/db/schema/ucomp";
import * as sim from "@/server/db/schema/sim";
import { seedActivity } from "./activity";
import { createContext, type Sink } from "./context";
import { seedHistory } from "./history";
import { seedPeople } from "./people";
import { seedPlatform } from "./platform";
import { seedSimulator } from "./sim";
import { seedTeams } from "./teams";
import { seedCardStatementsTemplates } from "./templates/card-statements";
import { seedCoralTemplates } from "./templates/coral";
import { seedCoralAlerts } from "./templates/coral-alerts";
import { seedDepositsTemplates } from "./templates/deposits";

/** Bump when the shape of the seed changes in a way other code may care about. */
export const SEED_VERSION = "4";

export interface SeedResult {
  /** Template ids by seed key, e.g. result.templates["cash-back"]. */
  templates: Record<string, string>;
  /** Rows written, by table name. */
  counts: Record<string, number>;
}

/** One table's rows, built in memory, and how to write them. */
export interface SeedTable {
  table: SQLiteTable;
  rows: readonly object[];
  insert(db: Db): Promise<void>;
}

function seedTable<T extends SQLiteTable>(
  table: T,
  rows: T["$inferInsert"][],
  chunk = 400,
): SeedTable {
  return {
    table,
    rows,
    async insert(db) {
      for (let i = 0; i < rows.length; i += chunk) {
        await db.insert(table).values(rows.slice(i, i + chunk));
      }
    },
  };
}

/** `seq` 1, 2, 3, … oldest first (then by id), as if each notice had been written live at its time. */
function numberNotices(rows: Sink["consumerNotices"]) {
  return [...rows]
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((row, i) => ({ ...row, seq: i + 1 }));
}

/** The tables in foreign-key order: parents before children. */
function tablesOf(s: Sink): SeedTable[] {
  return [
    seedTable(ucomp.users, s.users),
    seedTable(ucomp.teams, s.teams),
    seedTable(ucomp.memberships, s.memberships),
    seedTable(ucomp.membershipRoles, s.membershipRoles),
    seedTable(ucomp.contentTypes, s.contentTypes),
    seedTable(ucomp.approvalStages, s.approvalStages),
    seedTable(ucomp.consumers, s.consumers),
    seedTable(ucomp.templates, s.templates),
    seedTable(ucomp.versions, s.versions, 25),
    seedTable(ucomp.approvals, s.approvals),
    seedTable(ucomp.commentThreads, s.commentThreads),
    seedTable(ucomp.comments, s.comments),
    seedTable(ucomp.consumerNotices, numberNotices(s.consumerNotices)),
    seedTable(ucomp.auditEvents, s.auditEvents),
    seedTable(ucomp.notifications, s.notifications),
    seedTable(ucomp.accessRequests, s.accessRequests),
    seedTable(ucomp.recertifications, s.recertifications),
    seedTable(ucomp.recertItems, s.recertItems),
    seedTable(ucomp.renderLog, s.renderLog),
    seedTable(sim.simOffers, s.simOffers),
    seedTable(sim.simCustomers, s.simCustomers),
    seedTable(sim.simLinks, s.simLinks),
    seedTable(sim.simNoticeReads, s.simNoticeReads),
    seedTable(ucomp.settings, s.settings),
  ];
}

/**
 * Builds every row of the seed in memory, deterministically, with timestamps relative to `base` (the real
 * current time at reset; clock offset 0). Structure is deterministic: same ids, names and states every time.
 * Nothing touches a database; `seedDatabase` writes the tables and `buildFixture` exports them.
 */
export function buildSeed(base: Date): {
  tables: SeedTable[];
  templates: Record<string, string>;
  counts: Record<string, number>;
} {
  const ctx = createContext(base.getTime());

  seedPeople(ctx);
  seedTeams(ctx);
  seedPlatform(ctx);
  seedCoralTemplates(ctx);
  seedDepositsTemplates(ctx);
  seedCardStatementsTemplates(ctx);
  seedCoralAlerts(ctx);
  seedHistory(ctx);
  seedActivity(ctx);
  seedSimulator(ctx);

  ctx.sink.settings.push(
    { key: "clock_offset_days", value: 0 },
    { key: "seed_version", value: SEED_VERSION },
    // The notice cursor's epoch: a reset writes a new one, so cursors from before it are refused.
    { key: "seeded_at", value: base.toISOString() },
    // The last consumer_notices.seq handed out (numberNotices gives 1…n); takeNoticeSeqs carries on from it.
    { key: "consumer_notice_seq", value: ctx.sink.consumerNotices.length },
  );

  return {
    tables: tablesOf(ctx.sink),
    templates: Object.fromEntries(
      [...ctx.templates].map(([key, t]) => [key, t.id]),
    ),
    counts: Object.fromEntries(
      Object.entries(ctx.sink).map(([k, rows]) => [k, rows.length]),
    ),
  };
}

/** Fills an empty, migrated database. Every timestamp is relative to `base`. */
export async function seedDatabase(
  db: Db,
  opts: { base: Date },
): Promise<SeedResult> {
  const { tables, templates, counts } = buildSeed(opts.base);
  for (const t of tables) await t.insert(db);
  return { templates, counts };
}
