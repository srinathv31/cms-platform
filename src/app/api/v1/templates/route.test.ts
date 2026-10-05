import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, ApiTemplateSearch } from "@/domain/golive-types";
import { seedDatabase } from "@/server/seed";
import { GET } from "./route";

// GET /api/v1/templates end to end: HTTP in, the real query against a temporary seeded database, HTTP
// out. Only the database handle and the demo clock are swapped. Search semantics are covered in
// src/server/queries/consumer-api.test.ts; this file covers the HTTP contract and every error row.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-search-route-");
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

function get(query: string, headers: Record<string, string> = CORAL) {
  return GET(new NextRequest(`http://localhost/api/v1/templates${query}`, { headers }));
}

async function expectError(res: Response, status: number, code: string, message: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Correlation-Id")).toBeTruthy();
  expect(res.headers.get("Date")).toBe(env.now.toUTCString());
  const body = (await res.json()) as ApiErrorBody;
  expect(body).toEqual({ error: { code, message } });
}

describe("GET /api/v1/templates", () => {
  it("200: the query (trimmed), the demo clock and the results, with the API headers", async () => {
    const res = await get("?q=%20Balance%20&limit=5", { ...CORAL, "X-Correlation-Id": "search-1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Correlation-Id")).toBe("search-1");
    // The HTTP Date is the demo clock's (consumers stamp what they receive with it).
    expect(res.headers.get("Date")).toBe(env.now.toUTCString());
    const body = (await res.json()) as ApiTemplateSearch;
    expect(body.query).toBe("Balance");
    expect(body.asOf).toBe(env.now.toISOString());
    expect(body.results.map((r) => r.id)).toEqual([ids["balance-transfer"]]);
  });

  it("no q lists every Active template (default limit 20)", async () => {
    const body = (await (await get("")).json()) as ApiTemplateSearch;
    expect(body.query).toBe("");
    expect(body.results.length).toBeGreaterThanOrEqual(8);
    expect(body.results.length).toBeLessThanOrEqual(20);
  });

  it("limit cuts the list", async () => {
    const body = (await (await get("?limit=2")).json()) as ApiTemplateSearch;
    expect(body.results).toHaveLength(2);
  });

  it("400 consumer_required without X-Consumer-Id", async () => {
    await expectError(await get("", {}), 400, "consumer_required", "X-Consumer-Id is required.");
  });

  it("403 unknown_consumer for an unregistered consumer", async () => {
    await expectError(await get("", { "X-Consumer-Id": "acme" }), 403, "unknown_consumer", 'Consumer "acme" isn\'t registered.');
  });

  it.each(["0", "51", "ten", "1.5"])("400 bad_request for limit=%s", async (limit) => {
    await expectError(await get(`?limit=${limit}`), 400, "bad_request", "limit must be a number from 1 to 50.");
  });
});
