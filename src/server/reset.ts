import "server-only";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { resetRefusal } from "@/domain/demo";
import type { ActionResult } from "@/domain/review-types";
import { DATABASE_URL, db, libsql } from "./db/client";
import { settings } from "./db/schema/ucomp";
import { CLOCK_OFFSET_KEY } from "./clock";
import { defaultUploadsRoot } from "./services/local/uploads";
import { SEED_VERSION, seedDatabase } from "./seed";

// Relative to the project root, which is the working directory for `next dev`, `next start`
// and the scripts alike.
const MIGRATIONS_FOLDER = "./src/server/db/migrations";

async function tableNames(): Promise<string[]> {
  const res = await libsql.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return res.rows.map((r) => String(r.name));
}

/** Drops every table, including drizzle's migrations table. Children go before parents. */
async function dropAllTables() {
  const names = await tableNames();
  const references = new Map<string, Set<string>>();
  for (const name of names) {
    const fks = await libsql.execute(`PRAGMA foreign_key_list("${name}")`);
    references.set(
      name,
      new Set(fks.rows.map((r) => String(r.table)).filter((t) => t !== name)),
    );
  }

  const remaining = new Set(names);
  while (remaining.size > 0) {
    const free = [...remaining].filter(
      (name) =>
        ![...remaining].some(
          (other) => other !== name && references.get(other)?.has(name),
        ),
    );
    // A cycle would leave nothing free; drop whatever is left rather than loop forever.
    for (const name of free.length > 0 ? free : [...remaining]) {
      await libsql.execute(`DROP TABLE IF EXISTS "${name}"`);
      remaining.delete(name);
    }
  }
}

async function countRows(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of (await tableNames()).sort()) {
    if (name.startsWith("__drizzle")) continue;
    const res = await libsql.execute(`SELECT count(*) AS n FROM "${name}"`);
    counts[name] = Number(res.rows[0]?.n ?? 0);
  }
  return counts;
}

async function emptyUploads() {
  const dir = defaultUploadsRoot();
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir)) {
    // A few retries, as in `removeUpload`: on Windows a virus scanner can still hold a file it was just handed.
    await rm(join(dir, entry), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}

/**
 * Restores the demo to its seeded state: drops every table, re-runs the migrations, seeds with the
 * current time as the base, resets the demo clock and empties the uploads folder.
 * Callable from a server action and from `npm run db:reset`.
 *
 * It refuses, before touching anything, a database that isn't a local SQLite file (`file:…`): it drops
 * every table, so a remote `libsql://` database is never its to reset. That holds with or without the
 * demo flag; the action checks the flag, this checks the database.
 */
export async function resetDemo(): Promise<
  ActionResult<{ counts: Record<string, number> }>
> {
  const refused = resetRefusal(DATABASE_URL);
  if (refused) return refused;

  await dropAllTables();
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  await seedDatabase(db, { base: new Date() });

  // The seed already writes these; stating them here keeps the reset contract in one place.
  for (const [key, value] of [
    [CLOCK_OFFSET_KEY, 0],
    ["seed_version", SEED_VERSION],
  ] as const) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  await emptyUploads();
  return { ok: true, counts: await countRows() };
}
