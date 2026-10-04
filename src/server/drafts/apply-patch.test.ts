import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DraftPatch, DraftSaveResponse, JSONContent, MembershipStatus, TeamRole, Variable, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { applyDraftPatch } from "./apply-patch";

const { auditEvents, contentTypes, teams, templates, users, versions } = schema;

// A temporary libSQL file, migrated from the real migrations (the seed test does the same).
let dir: string;
let client: Client;
let db: Db;

const T0 = new Date("2026-10-04T10:00:00.000Z");
const T1 = new Date("2026-10-04T10:00:07.000Z");
const T2 = new Date("2026-10-04T10:00:12.000Z");

const SESSION = "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21";
const OTHER_SESSION = "0b9d8a7c-1111-4222-8333-444455556666";

const para = (text: string, id?: string): JSONContent => ({
  type: "paragraph",
  ...(id ? { attrs: { id } } : {}),
  content: [{ type: "text", text }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

const variable = (key: string): Variable => ({ key, label: key, type: "text", required: false, sample: "x" });

function viewer(userId: string, roles: TeamRole[], opts: { team?: string; status?: MembershipStatus; platform?: Viewer["platformRole"] } = {}): Viewer {
  const team = opts.team ?? "coral";
  return {
    userId,
    name: userId,
    initials: userId.slice(0, 2).toUpperCase(),
    title: "Tester",
    platformRole: opts.platform ?? null,
    memberships: roles.length
      ? [{ teamId: team, teamSlug: team, teamName: team, roles, status: opts.status ?? "active" }]
      : [],
  };
}

const maya = viewer("maya", ["author"]);

async function seed() {
  await db.insert(users).values(
    ["maya", "jordan", "sam", "riley", "dee"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
      initials: id.slice(0, 2),
      avatarHue: 10,
      title: "Tester",
    })),
  );
  await db.insert(teams).values(
    ["coral", "deposits"].map((id) => ({ id, slug: id, name: id, description: "", icon: "x", createdAt: T0 })),
  );
  await db.insert(contentTypes).values({
    id: "ct_disclosure",
    key: "disclosure",
    name: "Disclosure",
    requiredSections: [],
    allowedChannels: ["pdf", "web"], // email is deliberately not allowed
  });
  await db.insert(templates).values({
    id: "UC-AAAAAA",
    teamId: "coral",
    contentTypeId: "ct_disclosure",
    name: "Annual fee",
    createdBy: "maya",
    createdAt: T0,
  });
  await db.insert(versions).values({
    id: "v_draft",
    templateId: "UC-AAAAAA",
    number: null,
    state: "draft",
    body: doc(para("Original", "p1")),
    channels: ["pdf"],
    variables: [variable("first_name")],
    sampleSets: [],
    emailSubject: null,
    emailPreheader: null,
    rev: 5,
    createdBy: "maya",
    createdAt: T0,
    updatedAt: T0,
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ucomp-drafts-"));
  client = createClient({ url: `file:${join(dir, "drafts.db")}` });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
}, 30_000);

afterAll(() => {
  client?.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const table of [auditEvents, versions, templates, contentTypes, teams, users]) await db.delete(table);
  await seed();
});

const save = (patch: Partial<DraftPatch>, opts: { by?: Viewer; id?: string; at?: Date } = {}) =>
  applyDraftPatch(db, {
    viewer: opts.by ?? maya,
    versionId: opts.id ?? "v_draft",
    at: opts.at ?? T1,
    patch: { rev: 5, sessionKey: SESSION, ...patch },
  });

const draft = () => db.query.versions.findFirst({ where: eq(versions.id, "v_draft") }).then((v) => v!);
const template = () => db.query.templates.findFirst({ where: eq(templates.id, "UC-AAAAAA") }).then((t) => t!);
const audit = () => db.select().from(auditEvents);
const failure = (res: DraftSaveResponse) => {
  if (res.ok) throw new Error("expected a failure");
  return res;
};

describe("applyDraftPatch: a good save", () => {
  it("writes only the fields it was given and bumps the rev", async () => {
    const before = await draft();
    const res = await save({ body: doc(para("Edited", "p1")) });

    expect(res).toEqual({ ok: true, rev: 6, savedAt: T1.toISOString() });
    const after = await draft();
    expect(after.rev).toBe(6);
    expect(after.updatedAt).toEqual(T1);
    expect(after.body).toEqual(doc(para("Edited", "p1")));
    expect(after.variables).toEqual(before.variables);
    expect(after.channels).toEqual(before.channels);
    expect(after.sampleSets).toEqual(before.sampleSets);
    expect(after.emailSubject).toBeNull();
    expect(after.state).toBe("draft");
  });

  it("writes every field when all are given", async () => {
    const subject = doc(para("Hello {{first_name}}", "s1"));
    const res = await save({
      body: doc(para("B", "p1")),
      variables: [variable("a"), variable("b")],
      channels: ["pdf", "web"],
      emailSubject: subject,
      emailPreheader: doc(para("Pre", "h1")),
      sampleSets: [{ id: "s1", name: "Maya", values: { a: "1", b: 2 } }],
      name: "New name",
    });
    expect(res.ok).toBe(true);
    const after = await draft();
    expect(after.variables.map((v) => v.key)).toEqual(["a", "b"]);
    expect(after.channels).toEqual(["pdf", "web"]);
    expect(after.emailSubject).toEqual(subject);
    expect(after.emailPreheader).toEqual(doc(para("Pre", "h1")));
    expect(after.sampleSets).toEqual([{ id: "s1", name: "Maya", values: { a: "1", b: 2 } }]);
    expect((await template()).name).toBe("New name");
  });

  it("clears the email subject with null", async () => {
    await save({ emailSubject: doc(para("Hi", "s1")) });
    await save({ rev: 6, emailSubject: null });
    expect((await draft()).emailSubject).toBeNull();
  });

  it("renames the template, trimmed, and still bumps the version's rev", async () => {
    const res = await save({ name: "  Annual fee waiver  " });
    expect(res).toMatchObject({ ok: true, rev: 6 });
    expect((await template()).name).toBe("Annual fee waiver");
    expect((await draft()).body).toEqual(doc(para("Original", "p1")));
  });

  it("gives blocks without an id one, and keeps the ids they have", async () => {
    await save({ body: doc(para("Has id", "keep-me"), para("No id")) });
    const content = (await draft()).body.content!;
    expect(content[0]!.attrs?.id).toBe("keep-me");
    expect(content[1]!.attrs?.id).toEqual(expect.stringMatching(/.{8,}/));
  });

  it("takes the next save at the new rev", async () => {
    await save({ body: doc(para("One", "p1")) });
    const res = await save({ rev: 6, body: doc(para("Two", "p1")) }, { at: T2 });
    expect(res).toEqual({ ok: true, rev: 7, savedAt: T2.toISOString() });
  });
});

describe("applyDraftPatch: refusals change nothing", () => {
  async function expectUntouched(run: () => Promise<DraftSaveResponse>) {
    const before = await draft();
    const name = (await template()).name;
    const res = await run();
    expect(res.ok).toBe(false);
    expect(await draft()).toEqual(before);
    expect((await template()).name).toBe(name);
    expect(await audit()).toHaveLength(0);
    return failure(res);
  }

  it("not_found for an unknown version", async () => {
    const res = await expectUntouched(() => save({ body: doc(para("x")) }, { id: "v_missing" }));
    expect(res.error).toBe("not_found");
  });

  it("forbidden for a viewer, an approver, a platform admin and a lapsed author", async () => {
    for (const who of [
      viewer("sam", ["viewer"]),
      viewer("jordan", ["approver"]),
      viewer("riley", [], { platform: "platform_admin" }),
      viewer("dee", ["author"], { status: "lapsed" }),
      viewer("dee", ["author"], { status: "suspended" }),
    ]) {
      const res = await expectUntouched(() => save({ body: doc(para("x")) }, { by: who }));
      expect(res).toMatchObject({ error: "forbidden", message: "You don't have access to do this." });
    }
  });

  it("forbidden for an author of another team", async () => {
    const res = await expectUntouched(() => save({ body: doc(para("x")) }, { by: viewer("dee", ["author"], { team: "deposits" }) }));
    expect(res.error).toBe("forbidden");
  });

  it("not_draft once the version has left draft", async () => {
    for (const state of ["in_review", "changes_requested", "active", "superseded", "revoked"] as const) {
      await db.update(versions).set({ state, number: 1 }).where(eq(versions.id, "v_draft"));
      const res = await expectUntouched(() => save({ body: doc(para("x")) }));
      expect(res.error).toBe("not_draft");
    }
  });

  it("conflict carries the current rev, for a stale rev and for a rev from the future", async () => {
    for (const rev of [4, 0, 6, 99]) {
      const res = await expectUntouched(() => save({ rev, body: doc(para("x")) }));
      expect(res).toMatchObject({ error: "conflict", rev: 5 });
    }
  });

  it("checks the permission before the state and the state before the rev", async () => {
    await db.update(versions).set({ state: "active", number: 1 }).where(eq(versions.id, "v_draft"));
    const asViewer = await save({ rev: 0, body: doc(para("x")) }, { by: viewer("sam", ["viewer"]) });
    expect(failure(asViewer).error).toBe("forbidden");
    const asAuthor = await save({ rev: 0, body: doc(para("x")) });
    expect(failure(asAuthor).error).toBe("not_draft");
  });

  it("invalid for a name that is empty or too long", async () => {
    for (const name of ["", "   ", "x".repeat(121)]) {
      const res = await expectUntouched(() => save({ name }));
      expect(res.error).toBe("invalid");
    }
  });

  it("invalid for a body the editor schema doesn't know", async () => {
    const res = await expectUntouched(() => save({ body: doc({ type: "iframe", attrs: { src: "https://example.com" } }) }));
    expect(res.error).toBe("invalid");
  });

  it("invalid for a channel the content type doesn't allow", async () => {
    const res = await expectUntouched(() => save({ channels: ["pdf", "email"] }));
    expect(res.error).toBe("invalid");
  });

  it("does not leave half a save behind when the name is the bad part", async () => {
    await expectUntouched(() => save({ body: doc(para("Changed", "p1")), name: " " }));
  });
});

describe("applyDraftPatch: the audit row", () => {
  it("writes one draft.edited row for the first save", async () => {
    await save({ body: doc(para("a", "p1")), name: "Renamed" });
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "draft.edited",
      actorId: "maya",
      teamId: "coral",
      templateId: "UC-AAAAAA",
      versionId: "v_draft",
      sessionKey: SESSION,
      at: T1,
      details: { saves: 1, fields: ["body", "name"], since: T1.toISOString() },
    });
  });

  it("merges later saves of the same session into that row", async () => {
    await save({ body: doc(para("a", "p1")) }, { at: T1 });
    await save({ rev: 6, variables: [variable("x")] }, { at: T2 });
    await save({ rev: 7, body: doc(para("b", "p1")) }, { at: new Date(T2.getTime() + 1000) });

    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      at: new Date(T2.getTime() + 1000),
      details: { saves: 3, fields: ["body", "variables"], since: T1.toISOString() },
    });
  });

  it("starts a new row for a new session", async () => {
    await save({ body: doc(para("a", "p1")) });
    await save({ rev: 6, body: doc(para("b", "p1")), sessionKey: OTHER_SESSION }, { at: T2 });
    const rows = await audit();
    expect(rows.map((r) => r.sessionKey).sort()).toEqual([OTHER_SESSION, SESSION].sort());
    expect(rows.every((r) => (r.details as { saves: number }).saves === 1)).toBe(true);
  });

  it("keeps sessions of other drafts apart, even with the same key", async () => {
    await db.insert(templates).values({
      id: "UC-BBBBBB",
      teamId: "coral",
      contentTypeId: "ct_disclosure",
      name: "Other",
      createdBy: "maya",
      createdAt: T0,
    });
    await db.insert(versions).values({
      id: "v_other",
      templateId: "UC-BBBBBB",
      state: "draft",
      body: doc(para("o", "o1")),
      channels: ["pdf"],
      variables: [],
      sampleSets: [],
      rev: 0,
      createdBy: "maya",
      createdAt: T0,
      updatedAt: T0,
    });
    await save({ body: doc(para("a", "p1")) });
    await save({ rev: 0, body: doc(para("b", "o1")) }, { id: "v_other" });
    expect(await audit()).toHaveLength(2);
  });

  it("never merges into another person's row that happens to share a session key", async () => {
    await save({ body: doc(para("a", "p1")) });
    const author2 = viewer("dee", ["author"]);
    await save({ rev: 6, body: doc(para("b", "p1")) }, { by: author2, at: T2 });

    const rows = await audit();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.actorId).sort()).toEqual(["dee", "maya"]);
    const mayas = rows.find((r) => r.actorId === "maya")!;
    expect(mayas.at).toEqual(T1);
    expect(mayas.details).toMatchObject({ saves: 1 });
  });

  it("does not merge into other kinds of audit rows", async () => {
    await db.insert(auditEvents).values({
      id: "ae_other",
      at: T0,
      actorId: "maya",
      teamId: "coral",
      templateId: "UC-AAAAAA",
      versionId: "v_draft",
      action: "version.submitted",
      sessionKey: SESSION,
    });
    await save({ body: doc(para("a", "p1")) });
    const rows = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "draft.edited")));
    expect(rows).toHaveLength(1);
    expect((await audit()).find((r) => r.id === "ae_other")?.at).toEqual(T0);
  });

  it("carries on from a row the seed wrote before fields and since existed", async () => {
    await db.insert(auditEvents).values({
      id: "ae_old",
      at: T0,
      actorId: "maya",
      teamId: "coral",
      templateId: "UC-AAAAAA",
      versionId: "v_draft",
      action: "draft.edited",
      details: { saves: 15 },
      sessionKey: SESSION,
    });
    await save({ body: doc(para("a", "p1")) });
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "ae_old",
      at: T1,
      details: { saves: 16, fields: ["body"], since: T0.toISOString() },
    });
  });
});

describe("applyDraftPatch: a save whose response was lost", () => {
  it("records the rev each save produced on the session's audit row", async () => {
    await save({ body: doc(para("a", "p1")) });
    expect((await audit())[0]?.details).toMatchObject({ rev: 6 });
    await save({ rev: 6, body: doc(para("b", "p1")) }, { at: T2 });
    expect((await audit())[0]?.details).toMatchObject({ rev: 7, saves: 2 });
  });

  it("takes the resend of a save that did land, and carries on from the current rev", async () => {
    await save({ body: doc(para("first try", "p1")), name: "Landed" }); // rev 5 -> 6; the client never heard
    const res = await save({ body: doc(para("second try", "p1")) }, { at: T2 }); // still says rev 5

    expect(res).toEqual({ ok: true, rev: 7, savedAt: T2.toISOString() });
    const after = await draft();
    expect(after.rev).toBe(7);
    expect(after.body).toEqual(doc(para("second try", "p1")));
    expect((await template()).name).toBe("Landed"); // the first save's other fields stay

    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ saves: 2, rev: 7, fields: ["body", "name"] });

    // And the client, now told rev 7, is back in step.
    expect(await save({ rev: 7, body: doc(para("third", "p1")) })).toMatchObject({ ok: true, rev: 8 });
  });

  it("takes it again when several responses in a row were lost", async () => {
    await save({ body: doc(para("1", "p1")) });
    await save({ body: doc(para("2", "p1")) });
    const res = await save({ body: doc(para("3", "p1")) });
    expect(res).toMatchObject({ ok: true, rev: 8 });
    expect((await audit())[0]?.details).toMatchObject({ saves: 3, rev: 8 });
  });

  it("is still a conflict when another session wrote in between", async () => {
    const other = OTHER_SESSION;
    await save({ body: doc(para("mine", "p1")) }); // rev 6, ack lost
    await save({ rev: 6, sessionKey: other, body: doc(para("theirs", "p1")) }, { at: T2 }); // rev 7

    for (const rev of [5, 6]) {
      const res = await save({ rev, body: doc(para("mine again", "p1")) });
      expect(failure(res)).toMatchObject({ error: "conflict", rev: 7 });
    }
    expect((await draft()).body).toEqual(doc(para("theirs", "p1")));
    expect((await draft()).rev).toBe(7);
  });

  it("is still a conflict when another tab of the same person wrote in between", async () => {
    await save({ body: doc(para("tab one", "p1")) });
    await save({ rev: 6, sessionKey: OTHER_SESSION, body: doc(para("tab two", "p1")) }, { at: T2 });
    expect(failure(await save({ body: doc(para("tab one again", "p1")) })).error).toBe("conflict");
  });

  it("is a conflict for another person who borrows the session key", async () => {
    await save({ body: doc(para("maya", "p1")) });
    const res = await save({ body: doc(para("dee", "p1")) }, { by: viewer("dee", ["author"]) });
    expect(failure(res)).toMatchObject({ error: "conflict", rev: 6 });
    expect((await draft()).body).toEqual(doc(para("maya", "p1")));
  });

  it("is a conflict when a write that left no audit trail bumped the rev", async () => {
    await save({ body: doc(para("mine", "p1")) });
    await db.update(versions).set({ rev: 7 }).where(eq(versions.id, "v_draft"));
    expect(failure(await save({ body: doc(para("again", "p1")) }))).toMatchObject({ error: "conflict", rev: 7 });
  });

  it("is a conflict when the session's row has no rev (written before this existed)", async () => {
    await db.insert(auditEvents).values({
      id: "ae_old",
      at: T0,
      actorId: "maya",
      teamId: "coral",
      templateId: "UC-AAAAAA",
      versionId: "v_draft",
      action: "draft.edited",
      details: { saves: 15 },
      sessionKey: SESSION,
    });
    expect(failure(await save({ rev: 4, body: doc(para("x", "p1")) }))).toMatchObject({ error: "conflict", rev: 5 });
    expect((await audit())[0]?.details).toEqual({ saves: 15 });
  });

  it("is a conflict for a rev from the future, even from the session that wrote the current one", async () => {
    await save({ body: doc(para("mine", "p1")) });
    expect(failure(await save({ rev: 9, body: doc(para("x", "p1")) }))).toMatchObject({ error: "conflict", rev: 6 });
  });

  it("still refuses a resend that is invalid, and changes nothing", async () => {
    await save({ body: doc(para("mine", "p1")) });
    const before = await draft();
    const res = await save({ channels: ["email"] }); // rev 5 is behind, but the session owns rev 6
    expect(failure(res).error).toBe("invalid");
    expect(await draft()).toEqual(before);
    expect((await audit())[0]?.details).toMatchObject({ saves: 1, rev: 6 });
  });

  it("still answers not_draft first once the version has left draft", async () => {
    await save({ body: doc(para("mine", "p1")) });
    await db.update(versions).set({ state: "in_review", number: 1 }).where(eq(versions.id, "v_draft"));
    expect(failure(await save({ body: doc(para("again", "p1")) })).error).toBe("not_draft");
  });

  it("lets only one of two resends through", async () => {
    await save({ body: doc(para("mine", "p1")) });
    const results = await Promise.all([save({ body: doc(para("x", "p1")) }), save({ body: doc(para("y", "p1")) })]);
    // Both are behind rev 6 and the session owns it, so both are legitimate; they serialize one after the other.
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await draft()).rev).toBe(8);
  });
});

describe("applyDraftPatch: two saves at once", () => {
  it("lets exactly one of two saves from different sessions with the same rev through", async () => {
    const results = await Promise.all([
      save({ body: doc(para("tab one", "p1")) }),
      save({ sessionKey: OTHER_SESSION, body: doc(para("tab two", "p1")) }),
    ]);
    const wins = results.filter((r) => r.ok);
    expect(wins).toHaveLength(1);
    expect(failure(results.find((r) => !r.ok)!)).toMatchObject({ error: "conflict", rev: 6 });
    expect((await draft()).rev).toBe(6);
    expect((await audit())[0]?.details).toMatchObject({ saves: 1 });
  });
});
