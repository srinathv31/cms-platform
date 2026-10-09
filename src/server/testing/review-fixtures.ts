import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createDraft } from "@/domain/lifecycle";
import type { TeamRole, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { createAppClient } from "@/lib/serialized-writes";
import { newId, newTemplateId } from "@/server/ids";
import { buildStarter } from "@/server/starters";

// Test support for the review server layer (actions and queries). Not a test file itself: the test
// files stub `@/server/db/client` with `tempDatabase()` (inside their `vi.mock` factory), migrate and
// seed it, and build personas from it the way `server/viewer.ts` does.

/** A fresh libSQL file in the temp folder, shaped like `@/server/db/client`'s exports. */
export function tempDatabase(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const url = `file:${join(dir, "test.db")}`;
  // As the app opens it (writes take turns, other connections' locks are waited out).
  const libsql = createAppClient({ url });
  return { DATABASE_URL: url, libsql, db: drizzle(libsql, { schema }), dir };
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
        .where(inArray(membershipRoles.membershipId, rows.map((r) => r.membershipId)))
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
      roles: roles.filter((x) => x.membershipId === r.membershipId).map((x) => x.role as TeamRole),
    })),
  };
}

/** A new template with its first draft from the "Card offer terms" starter, as `createTemplate` writes it. */
export async function createTemplateWithDraft(
  db: Db,
  opts: { teamId: string; createdBy: string; at: Date; name?: string },
): Promise<{ templateId: string; draftId: string }> {
  const templateId = newTemplateId();
  const starter = buildStarter("card_offer_terms", { scope: templateId, now: opts.at });
  const { changes } = createDraft({ starter, createdBy: opts.createdBy, now: opts.at });
  const draftId = newId("v");
  await db.insert(schema.templates).values({
    id: templateId,
    teamId: opts.teamId,
    contentTypeId: "ct_disclosure",
    name: opts.name ?? changes.template.name,
    createdBy: opts.createdBy,
    createdAt: opts.at,
    starterKey: changes.template.starterKey,
  });
  await db.insert(schema.versions).values({ id: draftId, templateId, ...changes.draft });
  return { templateId, draftId };
}

/**
 * The template's open draft's `rev`, the one its submit summary carries (0 when there is no draft):
 * what a test passes to `submitVersion` to submit the draft as it stands.
 */
export async function draftRev(db: Db, templateId: string): Promise<number> {
  const draft = await db.query.versions.findFirst({
    columns: { rev: true },
    where: and(eq(schema.versions.templateId, templateId), eq(schema.versions.state, "draft")),
  });
  return draft?.rev ?? 0;
}
