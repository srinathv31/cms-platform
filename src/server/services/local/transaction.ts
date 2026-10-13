import "server-only";
import type { Db } from "@/server/db/client";

// The local backend's write transaction. Every write transaction in the app runs here: the commands
// (`runCommand` in ./command.ts) and, until they move behind the seam, the legacy server actions
// (`actions/kit.ts`), autosave (`drafts/apply-patch.ts`), import (`import/create.ts`) and the sweeps. The
// effects a transition asks for are written inside it (./effects.ts, ./access-effects.ts), so a transition and
// its side records land together or not at all.

/** The transaction handle drizzle passes to `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * One write transaction (`BEGIN IMMEDIATE`), run once. Two writes at once never collide: the database client
 * makes the second wait its turn, at most 5 s (src/lib/serialized-writes.ts, the only place the app waits, which
 * also says what a lock held by another process does: it freezes the event loop and fails queued writes one by
 * one). Past the wait it fails with SQLITE_BUSY, and the failure is the answer: a retry here would wait again
 * for every attempt. The transaction reads what it checks, so whichever write goes second sees the first one's,
 * and its compare-and-set refuses if the row moved.
 */
export function inTransaction<T>(
  db: Db,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(run);
}
