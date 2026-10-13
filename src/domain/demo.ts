// The rules of the demo tools: the data reset, the clock advance and the persona switcher. They are not part of
// the product, so they run only when the server was started with the demo flag (`DEMO_MODE`,
// src/server/config.ts), and a reset only ever drops a database that is a local file (decision 0051).
//
// The table is whole and in one place, with its codes and sentences, so `src/domain/refusals.test.ts` can check
// that no code is used twice.

import { defaultSpace } from "./permissions";
import {
  REQUEST_REFUSALS,
  refusal,
  refuse,
  type Refusal,
  type Refused,
} from "./refusals";
import { spaceNamed, type SpaceFacts, type SpaceTeam } from "./spaces";
import type { Viewer } from "./types";

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

/** The most days one clock advance moves (ten years). */
export const DEMO_ADVANCE_MAX_DAYS = 3650;

/** Why the clock can't be moved by `days`, or null: whole days, 1 to `DEMO_ADVANCE_MAX_DAYS`. */
export function advanceDaysRefusal(days: number): Refusal | null {
  return Number.isInteger(days) && days >= 1 && days <= DEMO_ADVANCE_MAX_DAYS
    ? null
    : REQUEST_REFUSALS.invalidInput("Enter 1 to 3,650 days.");
}

/** Where a persona lands after the switch. */
export interface PersonaLandingFacts {
  /** The space `slug` names, when the persona may enter it; null when they may not, or there is no slug. */
  space: SpaceFacts | null;
  /** The slug of their first space (`defaultSpace`), where they go instead; null with no space yet. */
  homeSlug: string | null;
}

/**
 * Where `viewer`, just switched to, lands from a URL whose first segment is `slug` (null: not a space's URL):
 * they stay in that space if they may enter it (`spaceNamed`, with `team` the team that has the slug), and
 * otherwise go to their first space.
 */
export function personaLanding(
  viewer: Viewer,
  slug: string | null,
  team: SpaceTeam | undefined,
): PersonaLandingFacts {
  return {
    space: slug === null ? null : spaceNamed(viewer, slug, team),
    homeSlug: defaultSpace(viewer),
  };
}
