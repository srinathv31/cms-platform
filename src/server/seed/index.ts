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
import { seedDepositsTemplates } from "./templates/deposits";

/** Bump when the shape of the seed changes in a way other code may care about. */
export const SEED_VERSION = "1";

export interface SeedResult {
  /** Template ids by seed key, e.g. result.templates["cash-back"]. */
  templates: Record<string, string>;
  /** Rows written, by table name. */
  counts: Record<string, number>;
}

async function insertRows<T extends SQLiteTable>(
  db: Db,
  table: T,
  rows: T["$inferInsert"][],
  chunk = 400,
) {
  for (let i = 0; i < rows.length; i += chunk) {
    await db.insert(table).values(rows.slice(i, i + chunk));
  }
}

// Insert order follows the foreign keys: parents before children.
async function insertAll(db: Db, s: Sink) {
  await insertRows(db, ucomp.users, s.users);
  await insertRows(db, ucomp.teams, s.teams);
  await insertRows(db, ucomp.memberships, s.memberships);
  await insertRows(db, ucomp.membershipRoles, s.membershipRoles);
  await insertRows(db, ucomp.contentTypes, s.contentTypes);
  await insertRows(db, ucomp.approvalStages, s.approvalStages);
  await insertRows(db, ucomp.consumers, s.consumers);
  await insertRows(db, ucomp.templates, s.templates);
  await insertRows(db, ucomp.versions, s.versions, 25);
  await insertRows(db, ucomp.approvals, s.approvals);
  await insertRows(db, ucomp.commentThreads, s.commentThreads);
  await insertRows(db, ucomp.comments, s.comments);
  await insertRows(db, ucomp.consumerNotices, s.consumerNotices);
  await insertRows(db, ucomp.auditEvents, s.auditEvents);
  await insertRows(db, ucomp.notifications, s.notifications);
  await insertRows(db, ucomp.accessRequests, s.accessRequests);
  await insertRows(db, ucomp.recertifications, s.recertifications);
  await insertRows(db, ucomp.recertItems, s.recertItems);
  await insertRows(db, ucomp.renderLog, s.renderLog);
  await insertRows(db, sim.simOffers, s.simOffers);
  await insertRows(db, sim.simCustomers, s.simCustomers);
  await insertRows(db, sim.simLinks, s.simLinks);
  await insertRows(db, ucomp.settings, s.settings);
}

/**
 * Fills an empty, migrated database. Every timestamp is relative to `base` (the real current time
 * at reset; clock offset 0). Structure is deterministic: same ids, names and states every time.
 */
export async function seedDatabase(db: Db, opts: { base: Date }): Promise<SeedResult> {
  const ctx = createContext(opts.base.getTime());

  seedPeople(ctx);
  seedTeams(ctx);
  seedPlatform(ctx);
  seedCoralTemplates(ctx);
  seedDepositsTemplates(ctx);
  seedCardStatementsTemplates(ctx);
  seedHistory(ctx);
  seedActivity(ctx);
  seedSimulator(ctx);

  ctx.sink.settings.push(
    { key: "clock_offset_days", value: 0 },
    { key: "seed_version", value: SEED_VERSION },
    { key: "seeded_at", value: opts.base.toISOString() },
  );

  await insertAll(db, ctx.sink);

  return {
    templates: Object.fromEntries([...ctx.templates].map(([key, t]) => [key, t.id])),
    counts: Object.fromEntries(Object.entries(ctx.sink).map(([k, rows]) => [k, rows.length])),
  };
}
