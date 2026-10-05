import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, ApiTemplateDetail } from "@/domain/golive-types";
import { seedDatabase } from "@/server/seed";
import { GET } from "./route";

// GET /api/v1/templates/{templateId} end to end against a temporary seeded database. The detail's
// semantics are covered in src/server/queries/consumer-api.test.ts; this file covers the HTTP
// contract and every error row api-v1.ts lists for it.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-detail-route-");
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

function get(template: string, query = "", headers: Record<string, string> = CORAL) {
  const templateId = ids[template] ?? template;
  const request = new NextRequest(`http://localhost/api/v1/templates/${templateId}${query}`, { headers });
  return GET(request, { params: Promise.resolve({ templateId }) });
}

async function expectError(res: Response, status: number, code: string, message: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Correlation-Id")).toBeTruthy();
  const body = (await res.json()) as ApiErrorBody;
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(message);
  return body.error;
}

describe("GET /api/v1/templates/[templateId]: 200", () => {
  it("the Active contract, with the API headers", async () => {
    const res = await get("balance-transfer", "", { ...CORAL, "X-Correlation-Id": "detail-1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Correlation-Id")).toBe("detail-1");
    const body = (await res.json()) as ApiTemplateDetail;
    expect(body).toMatchObject({ id: ids["balance-transfer"], activeVersion: 2, asOf: env.now.toISOString(), contract: { version: 2 } });
    expect(body.changes).toBeUndefined();
  });

  it("version and since", async () => {
    const body = (await (await get("balance-transfer", "?version=2&since=1")).json()) as ApiTemplateDetail;
    expect(body.contract!.version).toBe(2);
    expect(body.changes).toMatchObject({ since: 1, to: 2, breaking: false, newRequired: [] });
    const old = (await (await get("balance-transfer", "?version=1")).json()) as ApiTemplateDetail;
    expect(old.contract).toMatchObject({ version: 1, state: "superseded" });
  });
});

describe("GET /api/v1/templates/[templateId]: errors", () => {
  it("400 consumer_required", async () => {
    await expectError(await get("balance-transfer", "", {}), 400, "consumer_required", "X-Consumer-Id is required.");
  });

  it("403 unknown_consumer", async () => {
    await expectError(await get("balance-transfer", "", { "X-Consumer-Id": "acme" }), 403, "unknown_consumer", 'Consumer "acme" isn\'t registered.');
  });

  it.each([["?version=0"], ["?version=two"], ["?version=1.5"]])("400 bad_request for %s", async (query) => {
    await expectError(await get("balance-transfer", query), 400, "bad_request", "version must be a version number.");
  });

  it("400 bad_request for a since that isn't a version number", async () => {
    await expectError(await get("balance-transfer", "?since=v1"), 400, "bad_request", "since must be a version number.");
  });

  it("400 bad_request when since isn't lower than the version", async () => {
    await expectError(await get("balance-transfer", "?version=1&since=2"), 400, "bad_request", "since must be lower than version.");
    await expectError(await get("balance-transfer", "?since=2"), 400, "bad_request", "since must be lower than version.");
  });

  it("404 template_not_found: no such template", async () => {
    await expectError(await get("UC-ZZZZZZ"), 404, "template_not_found", "Template UC-ZZZZZZ doesn't exist.");
  });

  it("404 template_not_found: nothing released yet", async () => {
    await expectError(await get("annual-fee-waiver"), 404, "template_not_found", `Template ${ids["annual-fee-waiver"]} doesn't exist.`);
  });

  it("404 version_not_found", async () => {
    await expectError(await get("balance-transfer", "?version=9"), 404, "version_not_found", `Template ${ids["balance-transfer"]} has no version 9.`);
  });

  it("409 version_not_released", async () => {
    const error = await expectError(await get("cash-back", "?version=3"), 409, "version_not_released", "Version 3 is in review. Version 2 is active.");
    expect(error.details).toEqual({ version: 3, activeVersion: 2 });
  });
});
