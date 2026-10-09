import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, ApiNoticeList, ApiTemplateSearch } from "@/domain/golive-types";
import { consumerNotices, settings } from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { GET as searchGET } from "@/app/api/v1/templates/route";
import { GET } from "./route";

// GET /api/v1/consumers/{consumerId}/notices end to end against a temporary seeded database. The
// notices' shape is covered in src/server/queries/consumer-api.test.ts and src/domain/golive; this
// file covers the HTTP contract and every error row api-v1.ts lists for it.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-notices-route-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));

let libsql: Client;
let ids: Record<string, string>;

beforeAll(async () => {
  const client = await import("@/server/db/client");
  libsql = client.libsql;
  await migrate(client.db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(client.db, { base: env.now })).templates;
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

const CORAL = { "X-Consumer-Id": "coral" };

function get(consumerId: string, query = "", headers: Record<string, string> = CORAL) {
  const request = new NextRequest(`http://localhost/api/v1/consumers/${consumerId}/notices${query}`, { headers });
  return GET(request, { params: Promise.resolve({ consumerId }) });
}

async function expectError(res: Response, status: number, code: string, message: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Correlation-Id")).toBeTruthy();
  expect((await res.json()) as ApiErrorBody).toEqual({ error: { code, message } });
}

const list = async (consumerId: string, query = "") => (await (await get(consumerId, query)).json()) as ApiNoticeList;

/** Every page from `after` (a nextCursor, or none for the start), following nextCursor until hasMore is false. */
async function pages(query: string, after?: string): Promise<ApiNoticeList[]> {
  const out: ApiNoticeList[] = [];
  // A loop this long is a paging bug: fail rather than hang.
  while (out.length < 100) {
    const page = await list("coral", `?${query}${after ? `&after=${after}` : ""}`);
    out.push(page);
    if (!page.hasMore) return out;
    after = page.nextCursor;
  }
  throw new Error("notices didn't end within 100 pages");
}

describe("GET /api/v1/consumers/[consumerId]/notices: 200", () => {
  it("the consumer's notices, oldest first in the order written, with a cursor and the API headers", async () => {
    const res = await get("coral", "", { ...CORAL, "X-Correlation-Id": "notices-1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Correlation-Id")).toBe("notices-1");
    const body = (await res.json()) as ApiNoticeList;
    expect(body).toEqual({ consumerId: "coral", asOf: env.now.toISOString(), notices: expect.any(Array), hasMore: false, nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/) });
    const { db } = await import("@/server/db/client");
    const rows = await db.select().from(consumerNotices).where(eq(consumerNotices.consumerId, "coral")).orderBy(asc(consumerNotices.seq));
    expect(body.notices.map((n) => n.id)).toEqual(rows.map((r) => r.id));
    expect(rows.length).toBeGreaterThan(2);
  });

  it("limit pages: following nextCursor reads every notice once, in order; hasMore is false on the last page", async () => {
    const all = (await list("coral", "?limit=200")).notices.map((n) => n.id);
    const byOne = await pages("limit=1");
    expect(byOne).toHaveLength(all.length);
    expect(byOne.flatMap((p) => p.notices.map((n) => n.id))).toEqual(all);
    expect(byOne.slice(0, -1).every((p) => p.hasMore)).toBe(true);
    expect(byOne.at(-1)!.hasMore).toBe(false);
    const byTwo = await pages("limit=2");
    expect(byTwo.flatMap((p) => p.notices.map((n) => n.id))).toEqual(all);

    // The last cursor is the end: polling with it returns nothing new, and the same cursor again.
    const end = byOne.at(-1)!.nextCursor;
    const empty = await list("coral", `?after=${end}`);
    expect(empty).toMatchObject({ notices: [], hasMore: false, nextCursor: end });
  });

  it("templateId filters, and its cursor pages that filter", async () => {
    const holiday = ids["holiday-points"]!;
    const one = await pages(`templateId=${holiday}&limit=1`);
    const notices = one.flatMap((p) => p.notices);
    expect(notices.length).toBeGreaterThan(1);
    expect(notices.every((n) => n.template.id === holiday)).toBe(true);
    expect(notices.map((n) => n.id)).toEqual((await list("coral", `?templateId=${holiday}`)).notices.map((n) => n.id));
  });
});

describe("GET /api/v1/consumers/[consumerId]/notices: errors", () => {
  it("400 consumer_required", async () => {
    await expectError(await get("coral", "", {}), 400, "consumer_required", "X-Consumer-Id is required.");
  });

  it("403 unknown_consumer", async () => {
    await expectError(await get("coral", "", { "X-Consumer-Id": "acme" }), 403, "unknown_consumer", 'Consumer "acme" isn\'t registered.');
  });

  it("404 consumer_not_found: the path names an unregistered consumer", async () => {
    await expectError(await get("acme"), 404, "consumer_not_found", "Consumer acme doesn't exist.");
  });

  it("403 consumer_mismatch: X-Consumer-Id is another consumer", async () => {
    await expectError(await get("deposits-online"), 403, "consumer_mismatch", "X-Consumer-Id doesn't match consumer deposits-online.");
  });

  it("400 bad_request for limit", async () => {
    await expectError(await get("coral", "?limit=201"), 400, "bad_request", "limit must be a number from 1 to 200.");
    await expectError(await get("coral", "?limit=0"), 400, "bad_request", "limit must be a number from 1 to 200.");
  });

  it("400 bad_request for an after that isn't a cursor of this list", async () => {
    const message = "after must be the nextCursor of an earlier page of this list.";
    const holiday = ids["holiday-points"]!;
    const filtered = (await list("coral", `?templateId=${holiday}&limit=1`)).nextCursor;
    const deposits = ((await (await get("deposits-online", "", { "X-Consumer-Id": "deposits-online" })).json()) as ApiNoticeList).nextCursor;
    const search = (await (await searchGET(new NextRequest("http://localhost/api/v1/templates?limit=1", { headers: CORAL }))).json()) as ApiTemplateSearch;
    for (const after of [
      "yesterday", // not a cursor at all
      encodeURIComponent("2026-10-05T12:00:00Z"), // the old `since`
      "e30", // base64url of {}
      deposits, // another consumer's
      filtered, // another filter's (this call has no templateId)
      search.nextCursor, // the search list's
    ]) {
      await expectError(await get("coral", `?after=${after}`), 400, "bad_request", message);
    }
    // And the other way round: an unfiltered cursor on the filtered list.
    const unfiltered = (await list("coral", "?limit=1")).nextCursor;
    await expectError(await get("coral", `?templateId=${holiday}&after=${unfiltered}`), 400, "bad_request", message);
  });

  it("400 bad_request for a cursor from before a reset: the numbers started again, so it would skip notices", async () => {
    const before = (await list("coral", "?limit=1")).nextCursor;
    // A reset reseeds, which writes a new seeded_at.
    const { db } = await import("@/server/db/client");
    const [seeded] = await db.select().from(settings).where(eq(settings.key, "seeded_at"));
    await db.update(settings).set({ value: "2026-10-05T08:00:00.000Z" }).where(eq(settings.key, "seeded_at"));
    try {
      await expectError(await get("coral", `?after=${before}`), 400, "bad_request", "after is from before the notices were reset. Start again without after.");
      const fresh = await list("coral", "?limit=1");
      expect((await list("coral", `?after=${fresh.nextCursor}`)).notices.length).toBeGreaterThan(0);
    } finally {
      await db.update(settings).set({ value: seeded!.value }).where(eq(settings.key, "seeded_at"));
    }
  });
});
