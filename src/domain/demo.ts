// The rules of the demo tools: the data reset, the clock advance and the persona switcher. They are not part of
// the product, so they run only when the server was started with the demo flag (`DEMO_MODE`,
// src/server/config.ts), and a reset only ever drops a database that is a local file (decision 0051).
//
// The table is whole and in one place, with its codes and sentences, so `src/domain/refusals.test.ts` can check
// that no code is used twice.

import { refusal, refuse, type Refused } from "./refusals";

/** Why a demo tool refuses: a code to branch on, and the sentence shown where the person tried. */
export const DEMO_REFUSALS = {
  /** The server wasn't started with the demo flag. */
  off: refusal("demo_mode_off", "The demo tools are turned off."),
  /** A reset drops every table, so it runs only on a SQLite file on this machine. */
  notLocalFile: refusal(
    "reset_needs_local_file",
    "The demo reset only runs on a local database file.",
  ),
} as const;

/** The reset, the clock advance and the persona switcher run only in demo mode. */
export function demoToolsRefusal(demoMode: boolean): Refused | null {
  return demoMode ? null : refuse(DEMO_REFUSALS.off);
}

/**
 * Whether a database URL names a local SQLite file (`file:./data/ucomp.db`). A remote `libsql://` or
 * `https://` database, and an in-memory one, are not.
 */
export function isLocalDatabaseFile(databaseUrl: string): boolean {
  return /^file:/i.test(databaseUrl.trim());
}

/** The reset drops every table of the database it is pointed at: it refuses any that isn't a local file. */
export function resetRefusal(databaseUrl: string): Refused | null {
  return isLocalDatabaseFile(databaseUrl)
    ? null
    : refuse(DEMO_REFUSALS.notLocalFile);
}
