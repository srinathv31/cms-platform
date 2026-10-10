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
import { accessRefusal, applyDraftPatch } from "./apply-patch";

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
    createdBy: "maya",
    createdAt: T0,
  });
  await db.insert(versions).values({
    id: "v_draft",
    templateId: "UC-AAAAAA",
    number: null,
    state: "draft",
    name: "Annual fee",
    body: doc(para("Original", "p1")),
    channels: ["pdf"],
    variables: [variable("first_name")],
    sampleSets: [],
    channelFields: {},
    rev: 5,
    createdBy: "maya",
    writers: ["maya"],
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
    expect(after.channelFields).toEqual({});
    expect(after.state).toBe("draft");
  });

  it("writes every field when all are given", async () => {
    const subject = doc(para("Hello {{first_name}}", "s1"));
    const res = await save({
      body: doc(para("B", "p1")),
      variables: [variable("a"), variable("b")],
      channels: ["pdf", "web"],
      "email.subject": subject,
      "email.preheader": doc(para("Pre", "h1")),
      sampleSets: [{ id: "s1", name: "Maya", values: { a: "1", b: 2 } }],
      name: "New name",
    });
    expect(res.ok).toBe(true);
    const after = await draft();
    expect(after.variables.map((v) => v.key)).toEqual(["a", "b"]);
    expect(after.channels).toEqual(["pdf", "web"]);
    expect(after.channelFields).toEqual({ email: { subject, preheader: doc(para("Pre", "h1")) } });
    expect(after.sampleSets).toEqual([{ id: "s1", name: "Maya", values: { a: "1", b: 2 } }]);
    expect((await draft()).name).toBe("New name");
  });

  it("clears the email subject with null, and keeps the fields a save doesn't name", async () => {
    await save({ "email.subject": doc(para("Hi", "s1")), "email.preheader": doc(para("Pre", "h1")) });
    await save({ rev: 6, "email.subject": null });
    expect((await draft()).channelFields).toEqual({ email: { preheader: doc(para("Pre", "h1")) } });
    await save({ rev: 7, "email.preheader": null });
    expect((await draft()).channelFields).toEqual({});
  });

  it("records each channel field it changed, by id, in the session's audit row", async () => {
    await save({ "email.subject": doc(para("Hi", "s1")) });
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.action, "draft.edited"));
    expect((row!.details as { fields: string[] }).fields).toEqual(["email.subject"]);
  });

  it("renames the draft, trimmed, and still bumps the version's rev", async () => {
    const res = await save({ name: "  Annual fee waiver  " });
    expect(res).toMatchObject({ ok: true, rev: 6 });
    expect((await draft()).name).toBe("Annual fee waiver");
    expect((await draft()).body).toEqual(doc(para("Original", "p1")));
  });

  it("renames only the draft: the Active version keeps the name it went live with", async () => {
    await db.insert(versions).values({
      id: "v_active",
      templateId: "UC-AAAAAA",
      number: 1,
      state: "active",
      name: "Annual fee",
      body: doc(para("Live", "p1")),
      channels: ["pdf"],
      variables: [],
      sampleSets: [],
      createdBy: "maya",
      createdAt: T0,
      updatedAt: T0,
    });
    expect(await save({ name: "Annual fee waiver" })).toMatchObject({ ok: true });
    const active = await db.query.versions.findFirst({ where: eq(versions.id, "v_active") });
    expect(active).toMatchObject({ name: "Annual fee", rev: 0, updatedAt: T0 });
    expect((await draft()).name).toBe("Annual fee waiver");
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

describe("applyDraftPatch: the body is stored normalized (docs/render-spec.md §3)", () => {
  const t = (text: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "text", text, ...(marks ? { marks } : {}) });
  const node = (type: string, attrs: Record<string, unknown> | null, ...content: JSONContent[]): JSONContent => ({
    type,
    ...(attrs ? { attrs } : {}),
    ...(content.length ? { content } : {}),
  });

  it("tabs, heading levels, invisible characters, cell attributes, TipTap's list type, links and ragged rows", async () => {
    const res = await save({
      body: doc(
        node("heading", { id: "h", level: 5 }, t("Fees\t20\u00AD27\u200E"), { type: "hardBreak" }),
        node("paragraph", { id: "p" }, t("Terms", [{ type: "link", attrs: { href: " HTTPS://Coral.Example/café " } }]), t(" or "), t("here", [{ type: "link", attrs: { href: "javascript:x" } }])),
        node("orderedList", { id: "l", start: 2, type: "a" }, node("listItem", { id: "i" }, node("paragraph", { id: "q" }, t("x")))),
        node(
          "table",
          { id: "t" },
          node("tableRow", null, node("tableCell", { align: "center", colwidth: [90] }, node("paragraph", { id: "a" }, t("a"))), node("tableCell", null, node("paragraph", { id: "b" }, t("b")))),
          node("tableRow", null, node("tableCell", null, node("paragraph", { id: "c" }, t("c")))),
        ),
      ),
    });
    expect(res.ok).toBe(true);
    const [heading, paragraph, list, table] = (await draft()).body.content!;
    // A hard break at the end stays: the editor shows the line after it.
    expect(heading).toEqual(node("heading", { id: "h", level: 3, requiredKey: null }, t("Fees 2027"), { type: "hardBreak" }));
    // (Giving ids round-trips through the schema: adjacent plain runs merge, the link's defaults are written.)
    expect(paragraph.content?.map((run) => [run.text, run.marks?.map((m) => m.attrs?.href)])).toEqual([
      ["Terms", ["https://Coral.Example/caf%C3%A9"]],
      [" or here", undefined],
    ]);
    expect(list.attrs).toEqual({ id: "l", start: 2, markerFormat: null, markerDelimiter: null });
    expect(table.content![0].content![0].attrs).toEqual({ colspan: 1, rowspan: 1 });
    expect(table.content![1].content).toHaveLength(2);
  });

  it("content a cell can't hold stays in the cell as paragraphs", async () => {
    const res = await save({
      body: doc(node("table", { id: "t" }, node("tableRow", null, node("tableCell", null, node("heading", { level: 2 }, t("Fee")), node("callout", null, node("paragraph", null, t("Note"))))))),
    });
    expect(res.ok).toBe(true);
    const cell = (await draft()).body.content![0].content![0].content![0];
    expect(cell.content!.map((b) => [b.type, b.content?.[0]?.text])).toEqual([
      ["paragraph", "Fee"],
      ["paragraph", "Note"],
    ]);
  });

  it("the email fields: one line, no marks", async () => {
    const res = await save({ "email.subject": doc(node("paragraph", null, t("Your\tAPR", [{ type: "bold" }]), { type: "hardBreak" }, t("changes"))) });
    expect(res.ok).toBe(true);
    expect((await draft()).channelFields.email?.subject).toEqual(doc(node("paragraph", null, t("Your APR"), t(" "), t("changes"))));
  });
});

describe("applyDraftPatch: a document the check refuses is not saved, and says why", () => {
  const item = (text: string, ...more: JSONContent[]): JSONContent => ({ type: "listItem", content: [para(text), ...more] });
  const deep = (levels: number): JSONContent => {
    let list: JSONContent = { type: "bulletList", content: [item("deepest")] };
    for (let level = 1; level < levels; level++) list = { type: "bulletList", content: [item(`level ${level}`, list)] };
    return list;
  };
  const row = (n: number, attrs?: Record<string, unknown>): JSONContent => ({
    type: "tableRow",
    content: Array.from({ length: n }, () => ({ type: "tableCell", ...(attrs ? { attrs } : {}), content: [para("x")] })),
  });

  it.each<[string, JSONContent, string]>([
    ["a list start of 10000", doc({ type: "orderedList", attrs: { start: 10000 }, content: [item("x")] }), "A numbered list can start at 0 to 9999."],
    ["an unknown numbering style", doc({ type: "orderedList", attrs: { markerFormat: "greek" }, content: [item("x")] }), "This list's numbering style isn't one Stencil knows."],
    ["lists ten deep", doc(deep(10)), "Lists can nest at most 9 levels deep."],
    ["a colspan of 0", doc({ type: "table", content: [row(2, { colspan: 0 })] }), "This table's cells don't line up into rows and columns."],
    ["a heading of level 9", doc({ type: "heading", attrs: { level: 9 }, content: [{ type: "text", text: "x" }] }), "Headings can only be levels 1 to 3."],
    ["an unknown node", doc({ type: "iframe", attrs: { src: "https://example.com" } }), "This document has content Stencil doesn't support."],
  ])("refuses %s", async (_, body, message) => {
    const before = await draft();
    const res = failure(await save({ body }));
    expect(res).toEqual({ ok: false, error: "invalid", message });
    expect(await draft()).toEqual(before);
  });

  it("refuses an email subject that isn't one line", async () => {
    const res = failure(await save({ "email.subject": doc(para("a"), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "b" }] }) }));
    expect(res.message).toBe("The email subject and preheader can hold only one line of text and variables.");
  });
});

describe("applyDraftPatch: refusals change nothing", () => {
  async function expectUntouched(run: () => Promise<DraftSaveResponse>) {
    const before = await draft();
    const name = (await draft()).name;
    const res = await run();
    expect(res.ok).toBe(false);
    expect(await draft()).toEqual(before);
    expect((await draft()).name).toBe(name);
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

  it("invalid for no channels at all, which the parse refuses too: the draft keeps its own", async () => {
    const res = await expectUntouched(() => save({ channels: [] }));
    expect(res).toMatchObject({ error: "invalid", message: "Turn on at least one channel." });
  });

  it("does not leave half a save behind when the name is the bad part", async () => {
    await expectUntouched(() => save({ body: doc(para("Changed", "p1")), name: " " }));
  });
});

describe("accessRefusal: who may save, before the body is read", () => {
  it("is null for an author of the draft's team, whatever the draft's state", async () => {
    expect(await accessRefusal(db, maya, "v_draft")).toBeNull();
    await db.update(versions).set({ state: "active", number: 1 }).where(eq(versions.id, "v_draft"));
    expect(await accessRefusal(db, maya, "v_draft")).toBeNull(); // not_draft is the save's to answer
  });

  it("answers not_found and forbidden exactly as the save does", async () => {
    const cases: [Viewer, string][] = [
      [maya, "v_missing"],
      [viewer("sam", ["viewer"]), "v_draft"],
      [viewer("jordan", ["approver"]), "v_draft"],
      [viewer("dee", ["author"], { status: "lapsed" }), "v_draft"],
      [viewer("dee", ["author"], { team: "deposits" }), "v_draft"],
      [viewer("dee", ["author"], { team: "deposits" }), "v_missing"],
    ];
    for (const [who, id] of cases) {
      const refused = await accessRefusal(db, who, id);
      expect(refused, `${who.userId} ${id}`).toEqual(await save({ body: doc(para("x")) }, { by: who, id }));
      expect(refused?.error).toBe(id === "v_missing" ? "not_found" : "forbidden");
    }
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
      createdBy: "maya",
      createdAt: T0,
    });
    await db.insert(versions).values({
      id: "v_other",
      templateId: "UC-BBBBBB",
      state: "draft",
      name: "Other",
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

// Maker-checker: whoever saves an edit to a draft wrote it, so they can't approve it later.
describe("applyDraftPatch: the writers", () => {
  const dee = viewer("dee", ["author", "approver"]);

  it("adds each person whose save lands, once, in the order they first wrote", async () => {
    await save({ body: doc(para("Maya's", "p1")) });
    expect((await draft()).writers).toEqual(["maya"]);
    await save({ rev: 6, sessionKey: OTHER_SESSION, body: doc(para("Dee's", "p1")) }, { by: dee, at: T2 });
    expect((await draft()).writers).toEqual(["maya", "dee"]);
    await save({ rev: 7, body: doc(para("Maya's again", "p1")) }, { at: T2 });
    expect((await draft()).writers).toEqual(["maya", "dee"]);
  });

  it("counts a save of any field, a rename included", async () => {
    await save({ name: "Renamed" }, { by: dee });
    expect((await draft()).writers).toEqual(["maya", "dee"]);
  });

  it("leaves them alone when the save is refused", async () => {
    expect(failure(await save({ rev: 4, body: doc(para("x")) }, { by: dee })).error).toBe("conflict");
    expect(failure(await save({ body: doc(para("x")) }, { by: viewer("jordan", ["approver"]) })).error).toBe("forbidden");
    expect((await draft()).writers).toEqual(["maya"]);
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
    expect((await draft()).name).toBe("Landed"); // the first save's other fields stay

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
