import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, ApiNoticeList } from "@/domain/golive-types";
import { seedDatabase } from "@/server/seed";
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

describe("GET /api/v1/consumers/[consumerId]/notices: 200", () => {
  it("the consumer's notices, newest first, with the API headers", async () => {
    const res = await get("coral", "", { ...CORAL, "X-Correlation-Id": "notices-1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Correlation-Id")).toBe("notices-1");
    const body = (await res.json()) as ApiNoticeList;
    expect(body.consumerId).toBe("coral");
    expect(body.asOf).toBe(env.now.toISOString());
    expect(body.notices.length).toBeGreaterThan(0);
    const times = body.notices.map((n) => n.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("templateId, since and limit filter", async () => {
    const all = ((await (await get("coral")).json()) as ApiNoticeList).notices;
    const one = ((await (await get("coral", `?templateId=${ids["holiday-points"]}`)).json()) as ApiNoticeList).notices;
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((n) => n.template.id === ids["holiday-points"])).toBe(true);
    const limited = ((await (await get("coral", "?limit=1")).json()) as ApiNoticeList).notices;
    expect(limited.map((n) => n.id)).toEqual([all[0]!.id]);
    const since = encodeURIComponent(all[1]!.createdAt);
    const newer = ((await (await get("coral", `?since=${since}`)).json()) as ApiNoticeList).notices;
    expect(newer.map((n) => n.id)).toEqual([all[0]!.id]);
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

  it("400 bad_request for since and limit", async () => {
    await expectError(await get("coral", "?since=yesterday"), 400, "bad_request", "since must be a date and time, like 2026-10-05T12:00:00Z.");
    await expectError(await get("coral", "?limit=201"), 400, "bad_request", "limit must be a number from 1 to 200.");
    await expectError(await get("coral", "?limit=0"), 400, "bad_request", "limit must be a number from 1 to 200.");
  });
});
