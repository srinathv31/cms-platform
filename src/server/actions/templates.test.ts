import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { redirect } from "next/navigation";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { JSONContent, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { createAppClient } from "@/lib/serialized-writes";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { createTemplate } from "./create-template";
import { startDraft } from "./templates";

// A new template takes the content type as Platform settings leave it: its required sections and
// its allowed channels. Against a temporary database filled by the real seed; only the database, the
// clock, the persona and Next's request APIs are swapped.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-template-actions-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), RedirectType: { replace: "replace", push: "push" } }));

const { contentTypes, templates, versions } = schema;
const CT = "ct_disclosure";

let db: Db;
let libsql: Client;
let maya: Viewer;

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: env.now });
  maya = await loadPersona(db, "maya");
  vi.mocked(getViewer).mockResolvedValue(maya);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

/** Creates a template and returns its first draft (the id comes from the redirect). */
async function create(starterKey: "card_offer_terms" | "rate_change_notice") {
  vi.mocked(redirect).mockClear();
  await createTemplate({ teamSlug: "coral-offers", starterKey });
  const to = vi.mocked(redirect).mock.calls[0]![0] as string;
  const templateId = to.split("/").pop()!;
  expect(await db.query.templates.findFirst({ where: eq(templates.id, templateId) })).toBeTruthy();
  return (await db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.state, "draft")) }))!;
}

const requiredHeadings = (body: JSONContent) =>
  (body.content ?? [])
    .filter((b) => b.type === "heading" && b.attrs?.requiredKey)
    .map((b) => [b.attrs!.requiredKey, (b.content ?? []).map((n) => n.text).join("")]);

describe("createTemplate shapes the starter to the content type", () => {
  it("as seeded: the three Disclosure sections, in the starter's order", async () => {
    const draft = await create("card_offer_terms");
    expect(requiredHeadings(draft.body)).toEqual([
      ["offer_details", "Offer details"],
      ["rates_and_fees", "Rates and fees"],
      ["legal_notices", "Legal notices"],
    ]);
  });

  it("after a section edit: renamed, removed (an ordinary heading now) and added sections", async () => {
    await db
      .update(contentTypes)
      .set({
        requiredSections: [
          { key: "offer_details", title: "Offer details" },
          { key: "rates_and_fees", title: "Rates, fees and APR" },
          { key: "eligibility", title: "Eligibility" },
        ],
      })
      .where(eq(contentTypes.id, CT));
    const draft = await create("card_offer_terms");
    expect(requiredHeadings(draft.body)).toEqual([
      ["offer_details", "Offer details"],
      ["rates_and_fees", "Rates, fees and APR"],
      ["eligibility", "Eligibility"],
    ]);
    const legal = (draft.body.content ?? []).find(
      (b) => b.type === "heading" && (b.content ?? []).some((n) => n.text === "Legal notices"),
    );
    expect(legal?.attrs?.requiredKey ?? null).toBeNull();
    const added = (draft.body.content ?? []).at(-1)!;
    expect(added.attrs).toMatchObject({ level: 2, requiredKey: "eligibility" });
    expect(added.attrs?.id).toMatch(/^b_/);
  });

  it("leaves out a channel the content type no longer allows", async () => {
    await db.update(contentTypes).set({ allowedChannels: ["pdf", "web"] }).where(eq(contentTypes.id, CT));
    const draft = await create("rate_change_notice");
    expect(draft.channels).toEqual(["pdf", "web"]);
  });
});

// "Edit" on an Active template sometimes did nothing: another write in the server held the file at that
// moment, startDraft's `BEGIN IMMEDIATE` failed with SQLITE_BUSY, and the failure poisoned that pooled
// connection, so every retry failed too (`src/lib/serialized-writes.ts`). The action answered
// 500 and the page stayed on Active. Writes now take turns, so startDraft waits and opens the draft.
describe("startDraft while another write holds the file", () => {
  it("still opens one draft and redirects to the workspace", async () => {
    const [active] = await db
      .select({ templateId: versions.templateId })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .where(and(eq(templates.teamId, "coral-offers"), eq(versions.state, "active")))
      .limit(1);
    expect(active, "the seed has an Active Coral template").toBeTruthy();
    const { templateId } = active!;
    const draftsOf = () =>
      db.select({ id: versions.id }).from(versions).where(and(eq(versions.templateId, templateId), eq(versions.state, "draft")));
    expect(await draftsOf()).toHaveLength(0);

    // A write on the simulator's client (its own pool on the same file, as `src/simulator/db.ts` opens
    // it), holding the file across an await as a real action's transaction does.
    const sim = createAppClient({ url: `file:${join(env.dir, "test.db")}` });
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const other = (async () => {
      const tx = await sim.transaction("write");
      await tx.execute("UPDATE templates SET starter_key = starter_key WHERE id = 'nonexistent'");
      holding();
      await new Promise((resolve) => setTimeout(resolve, 60));
      await tx.commit();
    })();
    await held;

    vi.mocked(redirect).mockClear();
    try {
      await startDraft({ templateId });
    } finally {
      await other;
      sim.close();
    }

    expect(await draftsOf()).toHaveLength(1);
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(`/coral-offers/templates/${templateId}`, "replace");
  });
});

// Maker-checker: whoever starts a draft wrote it. A draft from the Active version starts a fresh set of
// writers, so having written an earlier released version keeps nobody from deciding the next one.
describe("who wrote a new draft", () => {
  it("New template: the person who made it", async () => {
    const draft = await create("card_offer_terms");
    expect(draft.writers).toEqual(["maya"]);
  });

  it("Edit on an Active template: the person who pressed it, not the Active version's writers", async () => {
    const rows = await db
      .select({ templateId: versions.templateId, id: versions.id, state: versions.state })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .where(eq(templates.teamId, "coral-offers"));
    const open = new Set(rows.filter((r) => r.state === "draft" || r.state === "in_review").map((r) => r.templateId));
    const active = rows.find((r) => r.state === "active" && !open.has(r.templateId));
    expect(active, "the seed has an Active Coral template with nothing newer").toBeTruthy();
    await db.update(versions).set({ writers: ["priya", "eli"] }).where(eq(versions.id, active!.id));

    await startDraft({ templateId: active!.templateId });
    const draft = await db.query.versions.findFirst({
      where: and(eq(versions.templateId, active!.templateId), eq(versions.state, "draft")),
    });
    expect(draft).toMatchObject({ basedOnVersionId: active!.id, createdBy: "maya", writers: ["maya"] });
  });
});
