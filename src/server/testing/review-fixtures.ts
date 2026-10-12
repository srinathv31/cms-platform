import { and, eq, inArray } from "drizzle-orm";
import { createDraft } from "@/domain/lifecycle/drafts";
import type { TeamRole, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import {
  tempDatabase as tempDatabaseOn,
  freshDatabasePerTest as freshDatabasePerTestOn,
} from "@/lib/fresh-database";
import { newId, newTemplateId } from "@/server/ids";
import { seedDatabase } from "@/server/seed";
import { buildStarter } from "@/server/starters";

// Test support for the server layer (actions, queries, sweeps). Not a test file itself.
//
// A test file stubs `@/server/db/client` with `tempDatabase()` (inside its `vi.mock` factory) and calls
// `seededDatabasePerTest()` once at its top level. The database is migrated and seeded once per file, and
// every test then runs on its own copy of that file: no test sees another's writes, tests run in any
// order, and one test runs alone (`@/lib/fresh-database` is the mechanism). Personas are built from the
// database the way `server/viewer.ts` does.

/** A fresh libSQL file in the temp folder, shaped like `@/server/db/client`'s exports. */
export function tempDatabase(prefix: string) {
  return tempDatabaseOn(prefix, schema);
}

/**
 * Gives every test its own database, built once per file, for the `@/server/db/client` mock. The database
 * is migrated, then `build` fills it (`build` gets the build database itself, which only it should use;
 * tests read through the `db` the mocked client exports). Pass `{ migrate: false }` when `build` migrates
 * by itself.
 */
export function freshDatabasePerTest(
  build?: (db: Db) => Promise<void>,
  opts: { migrate?: boolean } = {},
): void {
  freshDatabasePerTestOn<Db>({
    client: () => import("@/server/db/client"),
    build,
    migrate: opts.migrate,
  });
}

/**
 * For a test that hands `db` to the code under test (`writeEffects`, `runRender`, `applyDraftPatch`) instead
 * of mocking `@/server/db/client`: the real seed built on `base`, one copy per test. Returns the live `db`
 * and `libsql` (they follow the test's copy) and the seed's template ids by key.
 */
export function standaloneDatabasePerTest(opts: { base: Date }) {
  const temp = tempDatabase("ucomp-test-");
  const ids: Record<string, string> = {};
  freshDatabasePerTestOn<Db>({
    client: async () => temp,
    build: async (db) => {
      Object.assign(
        ids,
        (await seedDatabase(db, { base: opts.base })).templates,
      );
    },
  });
  return { db: temp.db as Db, libsql: temp.libsql, ids };
}

/**
 * `freshDatabasePerTest()` with the real seed built on `base`. Returns the seed's template ids by key
 * (`ids["balance-transfer"]`); the object is filled in before the first test runs.
 */
export function seededDatabasePerTest(opts: {
  base: Date;
}): Record<string, string> {
  const templates: Record<string, string> = {};
  freshDatabasePerTest(async (db) => {
    Object.assign(
      templates,
      (await seedDatabase(db, { base: opts.base })).templates,
    );
  });
  return templates;
}

/** The persona as `getViewer()` would build it from the database. */
export async function loadPersona(db: Db, userId: string): Promise<Viewer> {
  const { users, memberships, membershipRoles, teams } = schema;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error(`No user ${userId}`);
  const rows = await db
    .select({
      membershipId: memberships.id,
      status: memberships.status,
      teamId: teams.id,
      teamSlug: teams.slug,
      teamName: teams.name,
    })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(memberships.userId, userId));
  const roles = rows.length
    ? await db
        .select()
        .from(membershipRoles)
        .where(
          inArray(
            membershipRoles.membershipId,
            rows.map((r) => r.membershipId),
          ),
        )
    : [];
  return {
    userId: user.id,
    name: user.name,
    initials: user.initials,
    title: user.title,
    platformRole: user.platformRole ?? null,
    memberships: rows.map((r) => ({
      teamId: r.teamId,
      teamSlug: r.teamSlug,
      teamName: r.teamName,
      status: r.status,
      roles: roles
        .filter((x) => x.membershipId === r.membershipId)
        .map((x) => x.role as TeamRole),
    })),
  };
}

/** A new template with its first draft from the "Card offer terms" starter, as `createTemplate` writes it. */
export async function createTemplateWithDraft(
  db: Db,
  opts: { teamId: string; createdBy: string; at: Date; name?: string },
): Promise<{ templateId: string; draftId: string }> {
  const templateId = newTemplateId();
  const starter = buildStarter(
    { family: "document", starterKey: "card_offer_terms" },
    { scope: templateId, now: opts.at },
  );
  const { changes } = createDraft({
    starter,
    createdBy: opts.createdBy,
    now: opts.at,
  });
  const draftId = newId("v");
  await db.insert(schema.templates).values({
    id: templateId,
    teamId: opts.teamId,
    contentTypeId: "ct_disclosure",
    createdBy: opts.createdBy,
    createdAt: opts.at,
    starterKey: changes.template.starterKey,
  });
  await db.insert(schema.versions).values({
    id: draftId,
    templateId,
    ...changes.draft,
    name: opts.name ?? changes.draft.name,
  });
  return { templateId, draftId };
}

/**
 * The template's open draft's `rev`, the one its submit summary carries (0 when there is no draft):
 * what a test passes to `submitVersion` to submit the draft as it stands.
 */
export async function draftRev(db: Db, templateId: string): Promise<number> {
  const draft = await db.query.versions.findFirst({
    columns: { rev: true },
    where: and(
      eq(schema.versions.templateId, templateId),
      eq(schema.versions.state, "draft"),
    ),
  });
  return draft?.rev ?? 0;
}
