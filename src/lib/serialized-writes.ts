import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createClient,
  type Client,
  type Config,
  type InStatement,
  type Transaction,
  type TransactionMode,
} from "@libsql/client";
import { filePathOfUrl } from "@/lib/file-url";

// One writer at a time per process, for a local SQLite file.
//
// Why: libSQL's local driver leaves a statement that failed with SQLITE_BUSY un-finalized on its pooled
// connection. The next transaction that borrows that connection cannot COMMIT ("SQL statements in
// progress"), and the connection then keeps its lock on the file until the garbage collector happens
// to finalize the statement: every other write, here and in any other process, fails with
// SQLITE_BUSY meanwhile. So a single busy collision (two writes at once in this server: an autosave
// and an Edit, a render's log row and a review) could poison the file for seconds, and retrying
// (`inTransaction`) only borrowed the same poisoned connection again. That is how "Edit" on an Active
// template sometimes did nothing.
//
// The cure is to never collide inside the process: every write here (a write transaction, a batch,
// any statement that isn't a plain read) waits its turn on one lock, shared through globalThis by
// UCOMP's client and the simulator's, which open the same file. Plain reads don't wait. Other
// processes (the e2e helpers, a second server on the same file) are covered by the client's busy
// `timeout`, which makes SQLite itself wait for their lock instead of failing at once.
//
// This is the only place the app waits for the database, and nothing above it retries: a write that
// can't get the file fails with SQLITE_BUSY (`inTransaction`, src/server/effects.ts, runs once). Don't
// add a busy retry above this; each attempt would wait again.
//
// The worst case:
//   - In this process a write waits at most WRITE_TURN_WAIT_MS (5 s) for its turn. When no other
//     process opens the file that is the whole bound, and a turn is held only across microtasks.
//   - While ANOTHER process holds the file's lock, libSQL's busy wait is synchronous: it blocks the
//     event loop for up to BUSY_TIMEOUT_MS (5 s) per statement. No timer fires and the server answers
//     nothing, reads included. When one write gives up, the next queued write starts its own 5 s wait
//     at once, so writes fail one after another, about 5 s apart, until the lock clears. A COMMIT can
//     wait on another process's readers the same way.
// So don't write to the file from another process (`npm run db:reset`, an e2e helper) beside a live
// server and expect the server to stay responsive.
//
// Every URL gets this wrapper, a remote one too, on purpose: invariants the code relies on (a
// transaction reads what the writer before it committed, `takeNoticeSeqs`, last-admin and the other
// read-check-write rules; quality review H-2) hold only because writes here take turns. A remote
// libSQL database (Turso) is not a supported deployment: the Java API replaces this layer.

/**
 * The clients' busy `timeout`: how long SQLite waits for another process's lock on the local file
 * (the e2e helpers, a second server on the same file) before failing with SQLITE_BUSY. The wait blocks
 * the event loop (see above).
 */
export const BUSY_TIMEOUT_MS = 5_000;

/** How long a write waits for its turn in this process before failing as SQLITE_BUSY. Nothing retries it. */
export const WRITE_TURN_WAIT_MS = 5_000;

interface WriteLock {
  /** Settles when the last queued writer has released. */
  tail: Promise<void>;
}

const LOCK_KEY = Symbol.for("ucomp.sqlite.writeLock");

function sharedLock(): WriteLock {
  const holder = globalThis as unknown as Record<symbol, WriteLock | undefined>;
  return (holder[LOCK_KEY] ??= { tail: Promise.resolve() });
}

function busyError(waitMs: number): Error {
  return Object.assign(
    new Error(
      `SQLITE_BUSY: waited ${waitMs}ms for this process's other write to finish`,
    ),
    {
      code: "SQLITE_BUSY",
    },
  );
}

/** Waits for the turn and returns its release (idempotent). Gives up after `waitMs`, as SQLITE_BUSY. */
async function takeTurn(lock: WriteLock, waitMs: number): Promise<() => void> {
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = lock.tail;
  // Whoever queues next waits for this turn, and so for everything queued before it too.
  lock.tail = before.then(() => mine);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), waitMs);
  });
  const outcome = await Promise.race([
    before.then(() => "turn" as const),
    gaveUp,
  ]);
  clearTimeout(timer);
  if (outcome === "timeout") {
    // Leave the queue: the next writer still waits for `before`, then for nothing.
    release();
    throw busyError(waitMs);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

const READ_ONLY = /^\s*select\b/i;

function sqlOf(stmt: InStatement | [string, unknown?] | string): string {
  if (typeof stmt === "string") return stmt;
  if (Array.isArray(stmt)) return stmt[0];
  return stmt.sql;
}

/** Calls through to the target with `this` bound to it: libSQL's classes keep their state in #private fields. */
function bound<T extends object>(target: T, prop: string | symbol): unknown {
  const value = Reflect.get(target, prop, target) as unknown;
  return typeof value === "function"
    ? (value as (...args: unknown[]) => unknown).bind(target)
    : value;
}

/** The transaction, releasing the turn once it settles (commit, rollback or close). */
function releasingTransaction(
  tx: Transaction,
  release: () => void,
): Transaction {
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === "commit" || prop === "rollback") {
        return async () => {
          try {
            return await target[prop]();
          } finally {
            release();
          }
        };
      }
      if (prop === "close") {
        return () => {
          try {
            target.close();
          } finally {
            release();
          }
        };
      }
      return bound(target, prop);
    },
  });
}

/**
 * The client, with every write taking its turn on the process-wide lock. Reads pass straight through,
 * so a page can render while a transaction is open.
 */
export function serializeWrites(
  client: Client,
  options: { waitMs?: number } = {},
): Client {
  const waitMs = options.waitMs ?? WRITE_TURN_WAIT_MS;
  const lock = sharedLock();

  async function inTurn<T>(run: () => Promise<T>): Promise<T> {
    const release = await takeTurn(lock, waitMs);
    try {
      return await run();
    } finally {
      release();
    }
  }

  return new Proxy(client, {
    get(target, prop) {
      switch (prop) {
        case "execute":
          return (stmt: InStatement | string, args?: never) =>
            READ_ONLY.test(sqlOf(stmt))
              ? target.execute(stmt as never, args)
              : inTurn(() => target.execute(stmt as never, args));
        case "batch":
          return (
            stmts: Parameters<Client["batch"]>[0],
            mode?: TransactionMode,
          ) =>
            mode === "read"
              ? target.batch(stmts, mode)
              : inTurn(() => target.batch(stmts, mode));
        case "migrate":
          return (stmts: Parameters<Client["migrate"]>[0]) =>
            inTurn(() => target.migrate(stmts));
        case "executeMultiple":
          return (sql: string) => inTurn(() => target.executeMultiple(sql));
        case "transaction":
          return async (mode?: TransactionMode) => {
            if (mode === "read") return target.transaction(mode);
            const release = await takeTurn(lock, waitMs);
            try {
              return releasingTransaction(
                await target.transaction(mode),
                release,
              );
            } catch (error) {
              release();
              throw error;
            }
          };
        default:
          return bound(target, prop);
      }
    },
  });
}

/** A client for the app's database: writes take turns here, and SQLite waits out other processes' locks. */
export function createAppClient(
  config: Pick<Config, "url" | "authToken">,
): Client {
  // A fresh clone has no ./data (it's gitignored), and SQLite can't create the file in a missing folder.
  const file = filePathOfUrl(config.url);
  if (file !== null) mkdirSync(dirname(file), { recursive: true });
  return serializeWrites(createClient({ ...config, timeout: BUSY_TIMEOUT_MS }));
}
