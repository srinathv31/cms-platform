import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { applyDraftPatch } from "@/server/drafts/apply-patch";
import { getTemplateDetail, listNotices, searchActiveTemplates } from "@/server/queries/consumer-api";
import { findRound } from "@/server/queries/find-round";
import { getIntegrationPanel } from "@/server/queries/integration";
import { getWorkspaceHeader } from "@/server/queries/workspace";
import { getLibraryRows } from "@/server/queries/library";
import { searchPalette } from "@/server/queries/palette";
import { getSubmitSummary } from "@/server/queries/submit-summary";
import { runRender } from "@/server/render/render-template";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { addComment } from "./comments";
import { approveVersion, requestChanges, submitVersion } from "./review";
import { startDraft } from "./templates";

// The name is a version field (docs/decisions/0016-the-name-is-versioned.md). A rename in a draft is the
// draft's alone: customers keep seeing the Active version's name in its web <title>, its PDF title, the
// API and the notices, until the renamed version is approved and goes live. Balance Transfer from the
// real seed: v1 Superseded, v2 Active, both rendered by Coral, so Coral gets its notices.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-versioned-name-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), RedirectType: { replace: "replace", push: "push" } }));

const { consumerNotices, notifications, templates, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const LIVE = "Balance Transfer Intro — Terms";
const RENAMED = "Balance Transfer Intro — Card Terms";

let db: Db;
let libsql: Client;
let templateId: string;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  templateId = (await seedDatabase(db, { base: BASE })).templates["balance-transfer"]!;
  for (const id of ["maya", "jordan"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

let minute = 0;
function as(userId: string) {
  minute += 1;
  env.now = new Date(BASE.getTime() + minute * 60_000);
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
  return env.now;
}

/** The name the ⌘K palette lists a template by, searched for by its id as Maya in Coral Offers. */
async function paletteName(id: string) {
  const result = await searchPalette(people.maya!, { space: "coral-offers", q: id, template: null });
  return result.ok ? result.templates.find((t) => t.id === id)?.name : undefined;
}

/** A version by number: its head, the released row, else its latest round. */
const version = (number: number) => findRound(db, templateId, number).then((v) => v!);
const draft = () =>
  db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.state, "draft")) }).then((v) => v!);

/** What a customer gets: Coral's web render of a version, by its <title>. */
async function webTitle(number: number) {
  const row = await version(number);
  const values = row.sampleSets.find((s) => s.id === "typical")!.values;
  const result = await runRender(
    db,
    { templateId, version: number, channel: "web", values, preview: false, consumerId: "coral", correlationId: `name_${number}_${minute}`, viewer: null },
    env.now,
  );
  if (!result.ok) throw new Error(result.error.message);
  return /<title>([^<]*)<\/title>/.exec(result.body as string)?.[1];
}

/** What the API calls the template, and what the default contract's schema is titled. */
async function apiName() {
  const result = await getTemplateDetail(templateId, {}, env.now);
  if (!result.ok) throw new Error(result.error.message);
  return { name: result.detail.name, schemaTitle: result.detail.contract?.jsonSchema.title };
}
const found = async (q: string) => (await searchActiveTemplates(q, 50)).results.filter((r) => r.id === templateId).map((r) => r.name);

async function rename(name: string) {
  const open = await draft();
  const at = as("maya");
  const result = await applyDraftPatch(db, { viewer: people.maya!, versionId: open.id, at, patch: { rev: open.rev, sessionKey: "sess_rename", name } });
  expect(result).toMatchObject({ ok: true });
}

describe("a rename in a draft goes live only with its version", () => {
  it("Maya opens a draft of v2: it starts with v2's name", async () => {
    as("maya");
    await startDraft({ templateId });
    expect((await draft()).name).toBe(LIVE);
  });

  it("renaming the draft changes nothing a customer sees", async () => {
    await rename(RENAMED);
    expect((await draft()).name).toBe(RENAMED);
    expect((await version(2)).name).toBe(LIVE);

    expect(await webTitle(2)).toBe(LIVE);
    expect(await apiName()).toEqual({ name: LIVE, schemaTitle: `${LIVE} v2: values` });
    expect(await found("balance transfer")).toEqual([LIVE]);
    expect(await found("card terms")).toEqual([]);

    // The SHARE sheet shows what consumers get.
    const panel = await getIntegrationPanel(templateId, "http://localhost:3000");
    expect([panel?.template.name, panel?.jsonSchema.title]).toEqual([LIVE, `${LIVE} v2: values`]);
  });

  it("the workspace header edits the draft's name, and gives the SHARE ring the Active version's", async () => {
    as("maya");
    const header = await getWorkspaceHeader("coral-offers", templateId);
    expect({ name: header.name, activeName: header.activeName, editable: header.editable }).toEqual({ name: RENAMED, activeName: LIVE, editable: true });
  });

  // The header binds autosave on every tab, so a rename on Versions saves too (handoff review I1).
  it("the workspace header names the draft autosave saves to, with its rev, only for someone who can edit it", async () => {
    const open = await draft();
    as("maya");
    expect((await getWorkspaceHeader("coral-offers", templateId)).draft).toEqual({ versionId: open.id, rev: open.rev });
    as("jordan");
    const approver = await getWorkspaceHeader("coral-offers", templateId);
    expect([approver.editable, approver.draft]).toEqual([false, null]);
  });

  it("the CMS's lists show the draft's name", async () => {
    as("maya");
    expect((await getLibraryRows("coral-offers")).find((r) => r.id === templateId)?.name).toBe(RENAMED);
    expect(await paletteName(templateId)).toBe(RENAMED);
  });

  it("the submit summary lists the rename against the Active version", async () => {
    as("maya");
    const result = await getSubmitSummary(people.maya!, { templateId });
    expect(result.ok && { name: result.summary.name, baseline: result.summary.baseline?.name }).toEqual({ name: RENAMED, baseline: LIVE });
  });

  it("submitted, it is reviewed under its new name; customers still see the old one", async () => {
    const at = as("maya");
    expect(await submitVersion({ templateId, rev: (await draft()).rev })).toEqual({ ok: true, number: 3, round: 1 });
    expect((await version(3)).name).toBe(RENAMED);
    const sent = await db.select().from(notifications).where(eq(notifications.createdAt, at));
    expect(sent.map((n) => n.title)).toContain(`Maya Chen submitted ${RENAMED} v3 for review.`);
    expect(await webTitle(2)).toBe(LIVE);
    expect((await apiName()).name).toBe(LIVE);
  });

  it("a comment on it notifies the author under the version's name", async () => {
    const at = as("jordan");
    const v3 = await version(3);
    const result = await addComment({ templateId, versionId: v3.id, blockId: DOCUMENT_THREAD, body: "Is the new name approved by Legal?" });
    expect(result).toMatchObject({ ok: true });
    const sent = await db.select().from(notifications).where(eq(notifications.createdAt, at));
    expect(sent.map((n) => n.title)).toEqual([`Jordan Ellis commented on ${RENAMED} v3.`]);
  });

  it("a change request hands the author a draft with the name it was sent back with", async () => {
    as("jordan");
    expect(await requestChanges({ templateId, versionNumber: 3, round: 1, reason: "Keep the intro period on its own line." })).toEqual({
      ok: true,
    });
    expect((await draft()).name).toBe(RENAMED);
    expect((await apiName()).name).toBe(LIVE);
  });

  it("approved, the new name is live: its renders, the API, search and its notice; the old version keeps its own", async () => {
    as("maya");
    // Sent back, it comes back as round 2 of v3: consumers get v3, never a round.
    expect(await submitVersion({ templateId, rev: (await draft()).rev })).toEqual({ ok: true, number: 3, round: 2 });
    const at = as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 3, round: 2, sunsetPrevious: "2026-12-01", sampleSetsSeen: [] })).toEqual({
      ok: true,
      wentLive: true,
      number: 3,
      round: 2,
    });

    expect(await webTitle(3)).toBe(RENAMED);
    expect(await webTitle(2)).toBe(LIVE); // Superseded, still rendering until its sunset, under the name it went live with
    expect(await apiName()).toEqual({ name: RENAMED, schemaTitle: `${RENAMED} v3: values` });
    expect(await found("card terms")).toEqual([RENAMED]);

    const notices = await db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, at));
    expect(notices.map((n) => [n.kind, n.payload.templateName]).sort()).toEqual([
      ["new_version", RENAMED],
      ["sunset_scheduled", LIVE],
    ]);
    const listed = (await listNotices("coral", { templateId, limit: 200 })).notices.slice(-2);
    expect(listed.map((n) => n.message)).toEqual([
      expect.stringMatching(new RegExp(`^${RENAMED} v3 is available\\.`)),
      expect.stringMatching(new RegExp(`^${LIVE} v2 stops rendering on `)),
    ]);
  });

  it("the API's contract of an older version is titled with that version's name", async () => {
    const result = await getTemplateDetail(templateId, { version: 2 }, env.now);
    expect(result.ok && [result.detail.name, result.detail.contract?.jsonSchema.title]).toEqual([RENAMED, `${LIVE} v2: values`]);
  });
});

describe("a template with no version at all", () => {
  it("is listed by its id, as the Library and the header show it", async () => {
    as("maya");
    const id = "UC-NOVERS";
    await db.insert(templates).values({ id, teamId: "coral-offers", contentTypeId: "ct_disclosure", createdBy: "maya", createdAt: env.now });
    try {
      expect(await paletteName(id)).toBe(id);
      expect((await getLibraryRows("coral-offers")).find((r) => r.id === id)?.name).toBe(id);
    } finally {
      await db.delete(templates).where(eq(templates.id, id));
    }
  });
});
