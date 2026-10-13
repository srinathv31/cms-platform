import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DraftPatch, JSONContent } from "@/domain/types";
import type { RequestContext } from "@/server/context/request";
import type { Db } from "@/server/db/client";
import { auditEvents, versions } from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { localServices } from "./index";

// The local implementation's own half of autosave, which the contract suite doesn't pin
// (../contract/drafts.ts holds the behaviour every implementation shares): the `draft.edited` audit row an editing
// session keeps, merged in place on every save (the Java API keeps one row per save, decision 0066), and the
// lost-response recovery read from it (`lastSaveOf`). Against the real seed on a database of its own per test.
//
// Seed facts used: Annual Fee Waiver's open draft is Maya's (Coral Offers); Priya is an author there too.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-drafts-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const T1 = new Date(BASE.getTime() + 60_000);
const T2 = new Date(BASE.getTime() + 120_000);
const T3 = new Date(BASE.getTime() + 180_000);
const SESSION = "session-one-0001";
const OTHER = "session-two-0002";

const ids = seededDatabasePerTest({ base: BASE });
let db: Db;
let clock = T1;
const services = localServices({ clock: async () => clock });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

const doc = (text: string): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { id: "p1" },
      content: [{ type: "text", text }],
    },
  ],
});

async function as(userId: string): Promise<RequestContext> {
  return {
    viewer: await loadPersona(db, userId),
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

/** The template's open draft row. */
const draft = () =>
  db.query.versions
    .findFirst({
      where: and(
        eq(versions.templateId, ids["annual-fee-waiver"]!),
        eq(versions.state, "draft"),
      ),
    })
    .then((v) => v!);

/** The draft's `draft.edited` rows for the sessions these tests use. */
const sessionRows = async () =>
  (
    await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.versionId, (await draft()).id),
          eq(auditEvents.action, "draft.edited"),
        ),
      )
  ).filter((r) => r.sessionKey === SESSION || r.sessionKey === OTHER);

async function save(
  patch: Partial<DraftPatch> & Pick<DraftPatch, "rev">,
  opts: { by?: string; at?: Date } = {},
) {
  clock = opts.at ?? T1;
  return services.drafts.save(await as(opts.by ?? "maya"), {
    versionId: (await draft()).id,
    patch: { sessionKey: SESSION, ...patch },
  });
}

describe("drafts.save on the database: the editing session's audit row", () => {
  it("writes one draft.edited row for a session's first save, with the rev it produced", async () => {
    const { id, rev, templateId } = await draft();
    await save({ rev, body: doc("a"), name: "Renamed" });
    expect(await sessionRows()).toEqual([
      expect.objectContaining({
        action: "draft.edited",
        actorId: "maya",
        teamId: "t_coral",
        templateId,
        versionId: id,
        sessionKey: SESSION,
        at: T1,
        details: {
          saves: 1,
          fields: ["body", "name"],
          since: T1.toISOString(),
          rev: rev + 1,
        },
      }),
    ]);
  });

  it("merges the session's later saves into that row: the count, the fields, the latest rev and time", async () => {
    const { rev } = await draft();
    await save({ rev, body: doc("a") }, { at: T1 });
    await save({ rev: rev + 1, variables: [] }, { at: T2 });
    await save({ rev: rev + 2, "email.subject": null }, { at: T3 });
    expect(await sessionRows()).toEqual([
      expect.objectContaining({
        at: T3,
        details: {
          saves: 3,
          fields: ["body", "variables", "email.subject"],
          since: T1.toISOString(),
          rev: rev + 3,
        },
      }),
    ]);
  });

  it("starts a row for each new session, and for each person, even under a key another person used", async () => {
    const { rev } = await draft();
    await save({ rev, body: doc("a") });
    await save({ rev: rev + 1, sessionKey: OTHER, body: doc("b") }, { at: T2 });
    await save({ rev: rev + 2, body: doc("c") }, { by: "priya", at: T3 });
    const rows = await sessionRows();
    expect(
      rows.map((r) => [
        r.actorId,
        r.sessionKey,
        (r.details as { saves: number }).saves,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["maya", SESSION, 1],
        ["maya", OTHER, 1],
        ["priya", SESSION, 1],
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it("never merges into another kind of row that carries the session's key", async () => {
    const { id, rev, templateId } = await draft();
    await db.insert(auditEvents).values({
      id: "ae_other_kind",
      at: BASE,
      actorId: "maya",
      teamId: "t_coral",
      templateId,
      versionId: id,
      action: "version.submitted",
      sessionKey: SESSION,
    });
    await save({ rev, body: doc("a") });
    expect(await sessionRows()).toHaveLength(1);
    expect(
      await db.query.auditEvents.findFirst({
        where: eq(auditEvents.id, "ae_other_kind"),
      }),
    ).toMatchObject({ at: BASE, details: null });
  });

  it("carries on from a row written before the fields, the first save and the rev were recorded", async () => {
    const { id, rev, templateId } = await draft();
    await db.insert(auditEvents).values({
      id: "ae_legacy",
      at: BASE,
      actorId: "maya",
      teamId: "t_coral",
      templateId,
      versionId: id,
      action: "draft.edited",
      details: { saves: 15 },
      sessionKey: SESSION,
    });
    await save({ rev, body: doc("a") });
    expect(await sessionRows()).toEqual([
      expect.objectContaining({
        id: "ae_legacy",
        at: T1,
        details: {
          saves: 16,
          fields: ["body"],
          since: BASE.toISOString(),
          rev: rev + 1,
        },
      }),
    ]);
  });

  it("writes no row for a refused save", async () => {
    const { rev } = await draft();
    expect(await save({ rev: rev - 1, body: doc("a") })).toMatchObject({
      ok: false,
      code: "draft_changed",
    });
    expect(await sessionRows()).toEqual([]);
  });
});

describe("drafts.save on the database: the lost response, read from the session's row (lastSaveOf)", () => {
  it("is a conflict when the session's row recorded no rev", async () => {
    const { id, rev, templateId } = await draft();
    await db.insert(auditEvents).values({
      id: "ae_legacy",
      at: BASE,
      actorId: "maya",
      teamId: "t_coral",
      templateId,
      versionId: id,
      action: "draft.edited",
      details: { saves: 15 },
      sessionKey: SESSION,
    });
    expect(await save({ rev: rev - 1, body: doc("a") })).toMatchObject({
      ok: false,
      code: "draft_changed",
      rev,
    });
    expect((await sessionRows()).map((r) => r.details)).toEqual([
      { saves: 15 },
    ]);
  });

  it("is a conflict when a write that left no audit row bumped the rev after the session's save", async () => {
    const { id, rev } = await draft();
    await save({ rev, body: doc("Mine") });
    await db
      .update(versions)
      .set({ rev: rev + 2 })
      .where(eq(versions.id, id));
    expect(await save({ rev, body: doc("Again") }, { at: T2 })).toMatchObject({
      ok: false,
      code: "draft_changed",
      rev: rev + 2,
    });
  });
});
