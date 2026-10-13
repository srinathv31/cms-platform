import { createClient, type Client, type InValue } from "@libsql/client";
import { E2E_DATABASE_URL } from "../../storage";

// The only file in e2e that opens the database, and the only one that knows it is SQLite (ESLint enforces it).
// The rest of `helpers/state/` reads and writes through `select`, `execute` and `insert` here and speaks in
// records (`records.ts`); a Java backend replaces these files and nothing else.

export type { InValue };
export type Row = Record<string, InValue>;

/** How long SQLite waits for the server's write lock before a statement fails with SQLITE_BUSY. */
const BUSY_TIMEOUT_MS = 5_000;

const isBusy = (error: unknown) =>
  /SQLITE_BUSY|database is locked/i.test(
    `${(error as { code?: unknown })?.code ?? ""} ${(error as Error)?.message ?? ""}`,
  );

/** Runs a statement again, a few times with a growing pause, while the server holds the file's write lock. */
async function retryBusy<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= 8 || !isBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    }
  }
}

let client: Client | undefined;

/**
 * e2e's own database (`E2E_DATABASE_URL`, the file this worker's server runs on; see e2e/storage.ts), opened on
 * first use and kept for the life of the worker. `db:reset` drops and re-seeds the tables in place, so the
 * connection stays valid across a reset.
 */
function database(): Client {
  client ??= createClient({ url: E2E_DATABASE_URL, timeout: BUSY_TIMEOUT_MS });
  return client;
}

/** The rows a query returns, each as an object of its column names. */
export async function select(
  sql: string,
  args: InValue[] = [],
): Promise<Row[]> {
  const result = await retryBusy(() => database().execute({ sql, args }));
  return result.rows.map((row) =>
    Object.fromEntries(
      result.columns.map((column) => [column, row[column] as InValue]),
    ),
  );
}

/** The first row of a query, or undefined. */
export async function selectOne(
  sql: string,
  args: InValue[] = [],
): Promise<Row | undefined> {
  return (await select(sql, args))[0];
}

/** Runs a statement that returns no rows. */
export async function execute(
  sql: string,
  args: InValue[] = [],
): Promise<void> {
  await retryBusy(() => database().execute({ sql, args }));
}

/** Inserts one row; `columns` are the table's column names. */
export async function insert(
  table: string,
  columns: Record<string, InValue>,
): Promise<void> {
  const names = Object.keys(columns);
  await execute(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    names.map((name) => columns[name]),
  );
}

/** Sets columns on every row of `table` where `keyColumn` is `key`. */
export async function update(
  table: string,
  keyColumn: string,
  key: InValue,
  columns: Record<string, InValue>,
): Promise<void> {
  const names = Object.keys(columns);
  if (names.length === 0) return;
  await execute(
    `UPDATE ${table} SET ${names.map((name) => `${name} = ?`).join(", ")} WHERE ${keyColumn} = ?`,
    [...names.map((name) => columns[name]), key],
  );
}

/** `?, ?, ?` for a list of `count` values. */
export const marks = (count: number) =>
  Array.from({ length: count }, () => "?").join(", ");

/** The names of a table's columns, in table order. */
export async function columnNames(table: string): Promise<string[]> {
  return (await select(`PRAGMA table_info(${table})`)).map((column) =>
    String(column.name),
  );
}
