import { constants, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createAppClient } from "@/lib/serialized-writes";

// Test support: a database per test. Not app code, and only test files import it.
//
// A test file stubs the module that exports its database handle (`@/server/db/client`, or the
// simulator's `@/simulator/db`) with `tempDatabase()` inside its `vi.mock` factory, then calls
// `freshDatabasePerTest()` once at its top level. The database is migrated and filled once per file; every
// test then runs on a copy of that file, so no test sees another's writes, tests run in any order, and
// one test runs alone. `src/server/testing/review-fixtures.ts` wraps both for UCOMP's schema and seed.

const MIGRATIONS = "./src/server/db/migrations";

function open<S extends Record<string, unknown>>(path: string, schema: S) {
  // As the app opens it (writes take turns, other connections' locks are waited out).
  const libsql = createAppClient({ url: `file:${path}` });
  return { libsql, db: drizzle(libsql, { schema }) };
}

/**
 * A stand-in that reads through to `target()` each time, so it follows the target as it changes.
 * What a test sets on it (`vi.spyOn(db, "transaction")`) lives on the stand-in until `forget()`.
 */
function following<T extends object>(target: () => T) {
  const own = {} as T;
  const proxy = new Proxy(own, {
    get(_, key) {
      if (Object.hasOwn(own, key)) return Reflect.get(own, key);
      const current = target();
      const value = Reflect.get(current, key, current) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(current)
        : value;
    },
    has: (_, key) => Reflect.has(own, key) || Reflect.has(target(), key),
  });
  const forget = () => {
    for (const key of Reflect.ownKeys(own)) Reflect.deleteProperty(own, key);
  };
  return { proxy, forget };
}

/** The files behind a `tempDatabase()`, driven by `freshDatabasePerTest()`. */
interface DatabaseFiles<D> {
  /** The built database: written only until `freeze()`, then copied for each test. */
  readonly db: D;
  /** Checkpoints and closes the template, and points the handles at a first copy of it. */
  freeze(): Promise<void>;
  /** Points the handles at a new copy of the template, closing and deleting the copy it replaces. */
  next(): Promise<void>;
  /** Closes the current handles and removes the temp folder. */
  close(): Promise<void>;
}

/**
 * A fresh libSQL file in the temp folder, opened on `schema` the way the app opens its database. Its
 * `db` and `libsql` follow whichever copy `freshDatabasePerTest()` last switched to, so a test may keep them
 * in a variable; spread them into what the `vi.mock` factory returns.
 */
export function tempDatabase<S extends Record<string, unknown>>(
  prefix: string,
  schema: S,
) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const template = join(dir, "test.db");
  const first = open(template, schema);
  let current = first;
  let currentPath = template;
  let copies = 0;

  const libsql = following(() => current.libsql);
  const db = following(() => current.db);

  const files: DatabaseFiles<typeof first.db> = {
    db: first.db,
    async freeze() {
      await first.libsql.execute("PRAGMA wal_checkpoint(TRUNCATE)");
      first.libsql.close();
      await files.next();
    },
    async next() {
      const previous = current;
      const previousPath = currentPath;
      currentPath = join(dir, `test-${(copies += 1)}.db`);
      // A clone where the filesystem has them (APFS), a plain copy elsewhere.
      copyFileSync(template, currentPath, constants.COPYFILE_FICLONE);
      current = open(currentPath, schema);
      libsql.forget();
      db.forget();
      if (previousPath !== template) {
        previous.libsql.close();
        rmSync(previousPath, { force: true });
      }
    },
    async close() {
      current.libsql.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };

  return {
    /** The file the handles follow now. */
    get DATABASE_URL() {
      return `file:${currentPath}`;
    },
    libsql: libsql.proxy as Client,
    db: db.proxy as typeof first.db,
    dir,
    /** For `freshDatabasePerTest()`. */
    __files: files,
  };
}

/**
 * Gives every test its own database, built once per file. Call it at the top level of a test file, before
 * any hook that reads the database. `client` imports the mocked module whose factory returned
 * `tempDatabase()` (`() => import("@/server/db/client")`). The database is migrated, then `build` fills it;
 * `build` gets the build database itself, which only it should use (tests read through the `db` the mocked
 * module exports). Each test, and each hook that runs before it, starts from a copy of that. Pass
 * `migrate: false` when `build` migrates by itself. The file's temp folder is removed after the last test.
 */
export function freshDatabasePerTest<D>(opts: {
  client: () => Promise<unknown>;
  build?: (db: D) => Promise<void>;
  migrate?: boolean;
}): void {
  let files: DatabaseFiles<D> | undefined;

  beforeAll(async () => {
    const mocked = (await opts.client()) as { __files?: DatabaseFiles<D> };
    if (!mocked.__files)
      throw new Error(
        "freshDatabasePerTest() needs the database module mocked with tempDatabase()",
      );
    files = mocked.__files;
    if (opts.migrate !== false)
      await migrate(files.db as Parameters<typeof migrate>[0], {
        migrationsFolder: MIGRATIONS,
      });
    await opts.build?.(files.db);
    await files.freeze();
  }, 60_000);

  beforeEach(async () => {
    await files?.next();
  });

  afterAll(async () => {
    await files?.close();
  });
}
