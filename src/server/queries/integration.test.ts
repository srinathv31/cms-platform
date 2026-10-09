import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RESPONSE_FORMATS } from "@/domain/golive/samples";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getIntegrationPanel, loadIntegrationPanel } from "./integration";

// The integration panel's data and its viewer-checked loader (the GET route's read) against a temporary database
// filled by the real seed. Balance Transfer: v2 Active (pdf, web), v1 Superseded with a sunset.

const env = vi.hoisted(() => ({ dir: "", host: "localhost:3001", proto: null as string | null }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-integration-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: env.host, ...(env.proto ? { "x-forwarded-proto": env.proto } : {}) })),
}));

const { renderLog, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const ORIGIN = "http://localhost:3001";

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
  for (const id of ["maya", "sam", "morgan", "riley"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

const id = (key: string) => ids[key]!;

describe("getIntegrationPanel", () => {
  it("the Active version: id, channels, contract rows, schema, endpoint", async () => {
    const panel = (await getIntegrationPanel(id("balance-transfer"), `${ORIGIN}/`))!;
    expect(panel.template).toEqual({ id: id("balance-transfer"), name: "Balance Transfer Intro — Terms", teamSlug: "coral-offers", teamName: "Coral Offers" });
    expect(panel.active).toMatchObject({ number: 2, channels: ["pdf", "web"] });
    expect(panel.contract[2]).toEqual({ key: "purchase_apr", label: "Purchase APR", type: "percent", typeLabel: "Percent", required: true, example: "21.99" });
    expect(panel.contract.map((r) => r.key)).toEqual(["first_name", "last_name", "purchase_apr", "home_state", "offer_end_date"]);
    expect(panel.jsonSchema.$id).toBe(`https://stencil.example/schemas/${id("balance-transfer")}/v2/values.json`);
    expect(panel.jsonSchemaText).toBe(JSON.stringify(panel.jsonSchema, null, 2));
    const path = `/api/v1/templates/${id("balance-transfer")}/render`;
    expect(panel.endpoint).toEqual({ method: "POST", path, url: `${ORIGIN}${path}` });
    expect(panel.responses).toEqual(RESPONSE_FORMATS);
    expect(panel.errors.map((e) => e.status)).toEqual(expect.arrayContaining([404, 410, 422]));
  });

  it("one sample per enabled channel, PDF first, naming the consumer that renders it", async () => {
    const panel = (await getIntegrationPanel(id("balance-transfer"), ORIGIN))!;
    expect(panel.samples.map((s) => s.channel)).toEqual(["pdf", "web"]);
    expect(panel.samples[0]!.curl).toContain(`curl -X POST '${ORIGIN}/api/v1/templates/${id("balance-transfer")}/render'`);
    expect(panel.samples[0]!.curl).toContain("-H 'X-Consumer-Id: coral'");
    expect(panel.samples[0]!.curl).toContain("--output");
    expect(panel.samples[1]!.fetch).toContain('"channel": "web"');

    const deposits = (await getIntegrationPanel(id("high-yield-savings"), ORIGIN))!;
    expect(deposits.samples[0]!.curl).toContain("-H 'X-Consumer-Id: deposits-online'");
  });

  it("with no renders yet, the samples name the first registered consumer", async () => {
    const templateId = id("rate-change-notice");
    const saved = await db.select().from(renderLog).where(eq(renderLog.templateId, templateId));
    await db.delete(renderLog).where(eq(renderLog.templateId, templateId));
    try {
      const panel = (await getIntegrationPanel(templateId, ORIGIN))!;
      expect(panel.samples[0]!.curl).toContain("X-Consumer-Id: coral");
    } finally {
      for (let i = 0; i < saved.length; i += 400) await db.insert(renderLog).values(saved.slice(i, i + 400));
    }
  });

  it("'since' lists the older released versions, newest first, with the diff to the Active one", async () => {
    const panel = (await getIntegrationPanel(id("balance-transfer"), ORIGIN))!;
    expect(panel.since).toEqual([
      {
        number: 1,
        state: "superseded",
        // Its sunset's day in the business time zone (Eastern until changed).
        sunsetDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        diff: { breaking: false, items: [{ kind: "added", key: "offer_end_date", breaking: false, text: "v2 adds optional `offer_end_date` (Date)." }] },
      },
    ]);
    const holiday = (await getIntegrationPanel(id("holiday-points"), ORIGIN))!;
    expect(holiday.since.map((s) => [s.number, s.state])).toEqual([[1, "revoked"]]);
    expect((await getIntegrationPanel(id("rate-change-notice"), ORIGIN))!.since).toEqual([]);
  });

  it("versions in review don't count: Cash Back's panel is v2's", async () => {
    const panel = (await getIntegrationPanel(id("cash-back"), ORIGIN))!;
    expect(panel.active.number).toBe(2);
    expect(panel.contract.map((r) => r.key)).not.toContain("annual_fee");
  });

  it("a channel Channel rules turned off has no sample and isn't listed", async () => {
    const { contentTypes } = schema;
    const [disclosure] = await db.select().from(contentTypes).where(eq(contentTypes.key, "disclosure"));
    const before = disclosure!.allowedChannels;
    await db.update(contentTypes).set({ allowedChannels: ["pdf", "email"] }).where(eq(contentTypes.id, disclosure!.id));
    try {
      const panel = (await getIntegrationPanel(id("balance-transfer"), ORIGIN))!;
      expect(panel.active.channels).toEqual(["pdf"]);
      expect(panel.samples.map((s) => s.channel)).toEqual(["pdf"]);
    } finally {
      await db.update(contentTypes).set({ allowedChannels: before }).where(eq(contentTypes.id, disclosure!.id));
    }
  });

  it("null with no Active version or no template", async () => {
    expect(await getIntegrationPanel(id("annual-fee-waiver"), ORIGIN)).toBeNull();
    expect(await getIntegrationPanel("UC-ZZZZZZ", ORIGIN)).toBeNull();
  });
});

describe("loadIntegrationPanel", () => {
  beforeEach(() => {
    env.host = "localhost:3001";
    env.proto = null;
  });

  const as = (userId: string) => people[userId]!;

  it("an author and a viewer on the team can load it; the origin comes from the request", async () => {
    const result = await loadIntegrationPanel(as("maya"), { templateId: id("balance-transfer") });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.panel.endpoint.url).toBe(`http://localhost:3001/api/v1/templates/${id("balance-transfer")}/render`);

    expect((await loadIntegrationPanel(as("sam"), { templateId: id("balance-transfer") })).ok).toBe(true);
  });

  it("behind a proxy: the forwarded protocol; a public host defaults to https", async () => {
    env.host = "ucomp.example";
    const https = await loadIntegrationPanel(as("maya"), { templateId: id("balance-transfer") });
    expect(https.ok && https.panel.endpoint.url.startsWith("https://ucomp.example/")).toBe(true);
    env.proto = "http";
    const http = await loadIntegrationPanel(as("maya"), { templateId: id("balance-transfer") });
    expect(http.ok && http.panel.endpoint.url.startsWith("http://ucomp.example/")).toBe(true);
  });

  it("someone without the team is refused with the permission's reason", async () => {
    const result = await loadIntegrationPanel(as("morgan"), { templateId: id("balance-transfer") });
    expect(result).toMatchObject({ ok: false, status: 403 });
    if (!result.ok) expect(result.reason).toMatch(/\S/);
  });

  it("no template, or nothing Active yet", async () => {
    expect(await loadIntegrationPanel(as("riley"), { templateId: "UC-ZZZZZZ" })).toEqual({ ok: false, status: 404, reason: "This template no longer exists." });
    expect(await loadIntegrationPanel(as("riley"), { templateId: "" })).toEqual({ ok: false, status: 400, reason: "This template no longer exists." });
    expect(await loadIntegrationPanel(as("maya"), { templateId: id("annual-fee-waiver") })).toEqual({
      ok: false,
      status: 409,
      reason: "This template has no Active version yet.",
    });
  });

  it("a revoked-only template has no panel", async () => {
    const where = and(eq(versions.templateId, id("rate-change-notice")), eq(versions.number, 1));
    await db.update(versions).set({ state: "revoked" }).where(where);
    try {
      expect(await loadIntegrationPanel(as("maya"), { templateId: id("rate-change-notice") })).toEqual({
        ok: false,
        status: 409,
        reason: "This template has no Active version yet.",
      });
    } finally {
      await db.update(versions).set({ state: "active" }).where(where);
    }
  });
});
