import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PALETTE_QUERY_MAX } from "@/domain/palette";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { GET } from "./route";

// The ⌘K palette's search, end to end: HTTP in, the real query against a temporary database filled by
// the real seed, HTTP out. Only the database handle, the clock and the persona (`getViewer`) are swapped.
//
// Seed facts used: Coral Offers has Annual Fee Waiver (Changes requested), Balance Transfer Intro
// (Active), Cash Back Welcome Bonus (In review), Holiday Points Promo and Rate Change Notice; Deposits has
// Everyday Checking, High-Yield Savings and Overdraft Protection; Card Statements has three Statement
// Inserts. Maya (Author, Coral Offers) last acted on Cash Back, then Annual Fee Waiver, then Rate Change
// Notice. Sam is a Viewer on Coral Offers, Eli an Author on Deposits only, Morgan has no team, Taylor is
// the Auditor (every team, through All teams).

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-palette-search-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

const CORAL = [
  "Annual Fee Waiver — Terms",
  "Balance Transfer Intro — Terms",
  "Cash Back Welcome Bonus — Terms",
  "Holiday Points Promo — Terms",
  "Rate Change Notice",
];
const DEPOSITS = ["Everyday Checking — Fee Schedule", "High-Yield Savings — Rate Disclosure", "Overdraft Protection — Terms"];
const INVALID = { ok: false, code: "invalid_search", reason: "This search can't be run." };
const NOT_YOURS = { ok: false, code: "space_unavailable", reason: "This team isn't available to you." };

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: env.now })).templates;
  for (const id of ["maya", "sam", "eli", "morgan", "taylor"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

beforeEach(() => as("maya"));

function as(userId: string) {
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
}

type Row = { id: string; name: string; teamSlug: string; status: string };
type Body = { ok: boolean; code?: string; reason?: string; viewerId?: string; space?: string; query?: string; canCreate?: boolean; current?: boolean; recent?: Row[]; templates?: Row[] };

/** GET /api/palette/{space}{query}: the status and the body, checking the headers every answer has. */
async function search(space: string, query = "") {
  const res = await GET(new NextRequest(`http://localhost/api/palette/${encodeURIComponent(space)}${query}`), {
    params: Promise.resolve({ space }),
  });
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  return { status: res.status, body: (await res.json()) as Body };
}

const names = (rows: Row[] | undefined) => (rows ?? []).map((r) => r.name);

describe("GET /api/palette/[space]", () => {
  it("at rest: the viewer's recent templates, then the rest of the space's by name, and what they may do", async () => {
    const { status, body } = await search("coral-offers");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, viewerId: "maya", space: "coral-offers", query: "", canCreate: true, current: false });
    expect(names(body.recent)).toEqual(["Cash Back Welcome Bonus — Terms", "Annual Fee Waiver — Terms", "Rate Change Notice"]);
    expect(names(body.templates)).toEqual(["Balance Transfer Intro — Terms", "Holiday Points Promo — Terms"]);
    expect(body.recent![0]).toEqual({ id: ids["cash-back"], name: "Cash Back Welcome Bonus — Terms", teamSlug: "coral-offers", teamName: "Coral Offers", status: "in_review" });
  });

  it("searches by q: every word, in the name, the team, the id or the status, without Recent", async () => {
    expect(names((await search("coral-offers", "?q=balance")).body.templates)).toEqual(["Balance Transfer Intro — Terms"]);
    expect(names((await search("coral-offers", "?q=In%20review")).body.templates)).toEqual(["Cash Back Welcome Bonus — Terms"]);
    expect(names((await search("coral-offers", `?q=${ids["holiday-points"]!.toLowerCase()}`)).body.templates)).toEqual(["Holiday Points Promo — Terms"]);
    const terms = await search("coral-offers", "?q=++Terms++Coral");
    expect(terms.body).toMatchObject({ query: "terms coral", recent: [] });
    // Recently touched ones first among equal matches.
    expect(names(terms.body.templates)).toEqual([
      "Cash Back Welcome Bonus — Terms",
      "Annual Fee Waiver — Terms",
      "Balance Transfer Intro — Terms",
      "Holiday Points Promo — Terms",
    ]);
    expect((await search("coral-offers", "?q=zzz")).body.templates).toEqual([]);
  });

  it("lists only the space's templates, and only to people who can see it", async () => {
    as("sam");
    const sam = await search("coral-offers");
    expect(sam.body).toMatchObject({ ok: true, viewerId: "sam", canCreate: false, recent: [] });
    expect(names(sam.body.templates)).toEqual(CORAL);

    as("eli");
    const eli = await search("deposits", "?q=balance");
    expect(eli.body).toMatchObject({ ok: true, viewerId: "eli", templates: [] });
    const atRest = (await search("deposits")).body;
    expect([...names(atRest.recent), ...names(atRest.templates)].sort()).toEqual(DEPOSITS);
    expect(await search("coral-offers")).toEqual({ status: 404, body: NOT_YOURS });
    expect(await search("all")).toEqual({ status: 404, body: NOT_YOURS });

    as("morgan");
    expect(await search("coral-offers")).toEqual({ status: 404, body: NOT_YOURS });
  });

  it("the cross-team space searches every team, for the people who have it", async () => {
    as("taylor");
    const statements = await search("all", "?q=statement+insert");
    expect(statements.body).toMatchObject({ ok: true, viewerId: "taylor", canCreate: false });
    expect(statements.body.templates!.map((t) => t.teamSlug)).toEqual(["card-statements", "card-statements", "card-statements"]);
    expect((await search("all")).body.templates).toHaveLength(8); // a first page of the eleven
    expect(names((await search("all", "?q=overdraft")).body.templates)).toEqual(["Overdraft Protection — Terms"]);
  });

  it("says whether the template being viewed is the viewer's to see here, and leaves it out of Recent", async () => {
    const onCashBack = await search("coral-offers", `?template=${ids["cash-back"]}`);
    expect(onCashBack.body).toMatchObject({ current: true });
    expect(names(onCashBack.body.recent)).toEqual(["Annual Fee Waiver — Terms", "Rate Change Notice"]);
    expect(names(onCashBack.body.templates)).toContain("Cash Back Welcome Bonus — Terms");

    expect((await search("coral-offers", "?template=UC-ZZZZZZ")).body).toMatchObject({ ok: true, current: false });
    as("eli");
    expect((await search("deposits", `?template=${ids["cash-back"]}`)).body).toMatchObject({ ok: true, current: false });
  });

  it("400 for a search that doesn't parse: too long, or an empty or overlong template", async () => {
    expect(await search("coral-offers", `?q=${"a".repeat(PALETTE_QUERY_MAX + 1)}`)).toEqual({ status: 400, body: INVALID });
    expect(await search("coral-offers", "?template=")).toEqual({ status: 400, body: INVALID });
    expect(await search("coral-offers", `?template=${"U".repeat(65)}`)).toEqual({ status: 400, body: INVALID });
    expect((await search("coral-offers", `?q=${"a".repeat(PALETTE_QUERY_MAX)}`)).status).toBe(200);
  });
});
