import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq, isNotNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ApiTemplateDetail } from "@/domain/golive-types";
import type { VariableType } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { getTemplateDetail, listNotices, requireConsumer, searchActiveTemplates, templateIdFromQuery } from "./consumer-api";

// The consumer API's reads against a temporary database filled by the real seed:
//   - Balance Transfer v1 Superseded (sunset in 21 days), v2 Active (adds optional offer_end_date);
//   - Cash Back v1 Superseded, v2 Active, v3 In review (adds required annual_fee);
//   - Holiday Points v1 Revoked, v2 Active; Annual Fee Waiver has nothing released;
//   - Coral's notices: seeded payloads (new_version, sunset_scheduled, revoked).

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-consumer-api-");
  env.dir = temp.dir;
  return temp;
});

const { consumerNotices, templates, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

let db: Db;
let libsql: Client;
let ids: Record<string, string>;

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

const id = (key: string) => ids[key]!;

async function detail(key: string, opts: { version?: number; since?: number } = {}, at = BASE): Promise<ApiTemplateDetail> {
  const result = await getTemplateDetail(ids[key] ?? key, opts, at);
  if (!result.ok) throw new Error(`${key}: ${result.error.message}`);
  return result.detail;
}

async function detailError(key: string, opts: { version?: number; since?: number } = {}) {
  const result = await getTemplateDetail(ids[key] ?? key, opts, BASE);
  if (result.ok) throw new Error(`${key} answered 200`);
  return result.error;
}

// ── Consumers ────────────────────────────────────────────────────────────────

describe("requireConsumer", () => {
  it("a registered consumer, trimmed", async () => {
    expect(await requireConsumer(" coral ")).toEqual({ ok: true, consumer: { id: "coral", name: "Coral" } });
    expect(await requireConsumer("deposits-online")).toMatchObject({ ok: true, consumer: { id: "deposits-online" } });
  });

  it("none is consumer_required; an unknown one is unknown_consumer", async () => {
    for (const header of [null, "", "   "]) {
      expect(await requireConsumer(header)).toEqual({ ok: false, error: { code: "consumer_required", message: "X-Consumer-Id is required." } });
    }
    expect(await requireConsumer("acme")).toEqual({ ok: false, error: { code: "unknown_consumer", message: 'Consumer "acme" isn\'t registered.' } });
  });
});

// ── Search ───────────────────────────────────────────────────────────────────

describe("searchActiveTemplates", () => {
  it("an empty query lists every template with an Active version, by name", async () => {
    const results = await searchActiveTemplates("", 50);
    const active = await db
      .select({ id: templates.id, name: templates.name })
      .from(versions)
      .innerJoin(templates, eq(templates.id, versions.templateId))
      .where(eq(versions.state, "active"));
    expect(results.map((r) => r.id).sort()).toEqual(active.map((a) => a.id).sort());
    expect(results.map((r) => r.name)).toEqual([...results.map((r) => r.name)].sort((a, b) => a.localeCompare(b)));
    expect(results.map((r) => r.id)).not.toContain(id("annual-fee-waiver"));
  });

  it("summarizes the Active version", async () => {
    const [balance] = await searchActiveTemplates(id("balance-transfer"), 20);
    expect(balance).toEqual({
      id: id("balance-transfer"),
      name: "Balance Transfer Intro — Terms",
      team: { id: "coral-offers", name: "Coral Offers" },
      contentType: { key: "disclosure", name: "Disclosure" },
      activeVersion: 2,
      activatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      channels: ["pdf", "web"],
      variableCount: 5,
      requiredCount: 4,
    });
  });

  it("finds an id in any case, with or without UC-", async () => {
    const full = id("cash-back");
    const code = full.slice(3);
    for (const q of [full, full.toLowerCase(), code, code.toLowerCase(), ` ${full} `]) {
      expect((await searchActiveTemplates(q, 20)).map((r) => r.id), q).toEqual([full]);
    }
    expect(templateIdFromQuery("uc-4f7k2q")).toBe("UC-4F7K2Q");
    expect(templateIdFromQuery("4f7k2q")).toBe("UC-4F7K2Q");
    expect(templateIdFromQuery("balance")).toBeNull();
  });

  it("an id with nothing Active isn't found", async () => {
    expect(await searchActiveTemplates(id("annual-fee-waiver"), 20)).toEqual([]);
  });

  it("matches every word of the name, any case", async () => {
    expect((await searchActiveTemplates("TERMS balance", 20)).map((r) => r.id)).toEqual([id("balance-transfer")]);
    expect(await searchActiveTemplates("balance savings", 20)).toEqual([]);
  });

  it("names that start with the query come first, then the rest by name; limit cuts the list", async () => {
    const names = (await searchActiveTemplates("rate", 20)).map((r) => r.name);
    expect(names[0]).toBe("Rate Change Notice");
    expect(names.slice(1)).toEqual([...names.slice(1)].sort((a, b) => a.localeCompare(b)));
    expect(names).toEqual(expect.arrayContaining(["High-Yield Savings — Rate Disclosure", "Statement Insert — Rate Change"]));
    expect(await searchActiveTemplates("rate", 1)).toHaveLength(1);
  });
});

// ── One template ─────────────────────────────────────────────────────────────

describe("getTemplateDetail", () => {
  it("defaults to the Active version's contract; lists released versions newest first", async () => {
    const d = await detail("balance-transfer");
    expect(d).toMatchObject({
      id: id("balance-transfer"),
      name: "Balance Transfer Intro — Terms",
      team: { id: "coral-offers", name: "Coral Offers" },
      contentType: { key: "disclosure", name: "Disclosure" },
      asOf: BASE.toISOString(),
      activeVersion: 2,
    });
    expect(d.versions.map((v) => [v.number, v.state, v.renders, v.sunsetPassed])).toEqual([
      [2, "active", true, false],
      [1, "superseded", true, false],
    ]);
    expect(d.versions[1]!.sunsetAt).not.toBeNull();
    expect(d.versions[1]!.supersededAt).not.toBeNull();
    expect(d.contract).toMatchObject({ version: 2, state: "active", channels: ["pdf", "web"] });
    expect(d.contract!.variables.map((v) => v.key)).toEqual(["first_name", "last_name", "purchase_apr", "home_state", "offer_end_date"]);
    expect(d.contract!.jsonSchema.required).toEqual(["first_name", "last_name", "purchase_apr", "home_state"]);
    expect(d.changes).toBeUndefined();
  });

  it("a Superseded version's contract can be read by number", async () => {
    const d = await detail("balance-transfer", { version: 1 });
    expect(d.contract).toMatchObject({ version: 1, state: "superseded" });
    expect(d.contract!.jsonSchema.$id).toBe(`https://stencil.example/schemas/${id("balance-transfer")}/v1/values.json`);
    expect(d.activeVersion).toBe(2);
  });

  it("since adds the contract changes up to the version (or the Active one)", async () => {
    const d = await detail("balance-transfer", { since: 1 });
    expect(d.changes).toEqual({
      since: 1,
      to: 2,
      breaking: false,
      items: [{ kind: "added", key: "offer_end_date", breaking: false, text: "v2 adds optional `offer_end_date` (Date)." }],
      newRequired: [],
    });
    expect((await detail("holiday-points", { since: 1, version: 2 })).changes!.items.map((i) => i.kind)).toEqual(["label_changed"]);
  });

  it("past its sunset a Superseded version no longer renders", async () => {
    const d = await detail("balance-transfer", {}, new Date(BASE.getTime() + 22 * DAY));
    expect(d.versions[1]).toMatchObject({ number: 1, sunsetPassed: true, renders: false });
  });

  it("a Revoked version is listed with its date, and its contract can still be read", async () => {
    const d = await detail("holiday-points", { version: 1 });
    expect(d.versions.find((v) => v.number === 1)).toMatchObject({ state: "revoked", renders: false, revokedAt: expect.any(String) });
    expect(d.contract).toMatchObject({ version: 1, state: "revoked" });
  });

  it("versions in review never show", async () => {
    expect((await detail("cash-back")).versions.map((v) => v.number)).toEqual([2, 1]);
  });

  it("with nothing Active: activeVersion and contract are null (unless a version is named)", async () => {
    const where = and(eq(versions.templateId, id("rate-change-notice")), eq(versions.number, 1));
    await db.update(versions).set({ state: "revoked", revoke: { reason: "Test", startedBy: "jordan", startedAt: BASE.toISOString(), confirmedBy: "alex", confirmedAt: BASE.toISOString() } }).where(where);
    try {
      const d = await detail("rate-change-notice", { since: 1 });
      expect(d).toMatchObject({ activeVersion: null, contract: null });
      expect(d.changes).toBeUndefined();
      expect((await detail("rate-change-notice", { version: 1 })).contract).toMatchObject({ version: 1, state: "revoked" });
    } finally {
      await db.update(versions).set({ state: "active", revoke: null }).where(where);
    }
  });

  it("errors: unknown or unreleased template, unknown version, unreleased version, since not lower", async () => {
    expect(await detailError("UC-ZZZZZZ")).toEqual({ code: "template_not_found", message: "Template UC-ZZZZZZ doesn't exist." });
    expect(await detailError("annual-fee-waiver")).toEqual({ code: "template_not_found", message: `Template ${id("annual-fee-waiver")} doesn't exist.` });
    expect(await detailError("balance-transfer", { version: 9 })).toEqual({ code: "version_not_found", message: `Template ${id("balance-transfer")} has no version 9.` });
    expect(await detailError("cash-back", { version: 3 })).toEqual({
      code: "version_not_released",
      message: "Version 3 is in review. Version 2 is active.",
      details: { version: 3, activeVersion: 2 },
    });
    const order = { code: "bad_request", message: "since must be lower than version." };
    expect(await detailError("balance-transfer", { since: 2 })).toEqual(order);
    expect(await detailError("balance-transfer", { version: 1, since: 2 })).toEqual(order);
    expect(await detailError("balance-transfer", { version: 1, since: 1 })).toEqual(order);
  });
});

// ── The contract's JSON Schema, on every seeded version ──────────────────────

const JUNK: Record<VariableType, unknown> = {
  text: { not: "text" },
  currency: "twelve dollars",
  percent: "abc",
  date: "someday",
  number: "many",
  us_state: "Narnia",
};

describe("Channel rules", () => {
  it("a channel the content type no longer allows isn't advertised anywhere (the render route refuses it)", async () => {
    const [disclosure] = await db.select().from(schema.contentTypes).where(eq(schema.contentTypes.key, "disclosure"));
    const before = disclosure!.allowedChannels;
    await db.update(schema.contentTypes).set({ allowedChannels: ["pdf", "email"] }).where(eq(schema.contentTypes.id, disclosure!.id));
    try {
      const [balance] = await searchActiveTemplates(id("balance-transfer"), 20);
      expect(balance!.channels).toEqual(["pdf"]);
      const d = await detail("balance-transfer");
      expect(d.contract!.channels).toEqual(["pdf"]);
      expect(d.versions.every((v) => !v.channels.includes("web"))).toBe(true);
      expect((await detail("balance-transfer", { version: 1 })).contract!.channels).not.toContain("web");
    } finally {
      await db.update(schema.contentTypes).set({ allowedChannels: before }).where(eq(schema.contentTypes.id, disclosure!.id));
    }
    expect((await detail("balance-transfer")).contract!.channels).toEqual(["pdf", "web"]);
  });
});

describe("JSON Schema against the seed", () => {
  it("every released version's samples validate against its schema; JUNK in any variable doesn't", async () => {
    const released = (await db.select().from(versions).where(isNotNull(versions.number))).filter((v) =>
      ["active", "superseded", "revoked"].includes(v.state),
    );
    expect(released.length).toBeGreaterThanOrEqual(10);
    for (const v of released) {
      const d = await detail(v.templateId, { version: v.number! });
      const validator = z.fromJSONSchema(d.contract!.jsonSchema as never);
      const samples = Object.fromEntries(v.variables.map((x) => [x.key, x.sample]));
      expect(validator.safeParse(samples).success, `${v.templateId} v${v.number} samples`).toBe(true);
      // The example the contract lists is the sample.
      expect(d.contract!.variables.map((x) => x.example)).toEqual(v.variables.map((x) => x.sample));
      for (const variable of v.variables) {
        const junk = { ...samples, [variable.key]: JUNK[variable.type] };
        expect(validator.safeParse(junk).success, `${v.templateId} v${v.number} ${variable.key}`).toBe(false);
      }
    }
  });
});

// ── Notices ──────────────────────────────────────────────────────────────────

describe("listNotices", () => {
  it("Coral's notices, newest first, normalized from the seeded payloads", async () => {
    const notices = await listNotices("coral", { limit: 200 });
    const rows = await db.select().from(consumerNotices).where(eq(consumerNotices.consumerId, "coral"));
    expect(notices).toHaveLength(rows.length);
    const times = notices.map((n) => n.createdAt);
    expect(times).toEqual([...times].sort().reverse());

    const sunset = notices.find((n) => n.kind === "sunset_scheduled" && n.template.id === id("balance-transfer"))!;
    expect(sunset).toMatchObject({ versionNumber: 1, activeVersion: 2, reason: null });
    expect(sunset.message).toMatch(/^Balance Transfer Intro — Terms v1 stops rendering on \w+ \d+, \d{4}\. Move to v2\.$/);

    const fresh = notices.find((n) => n.kind === "new_version" && n.template.id === id("balance-transfer"))!;
    expect(fresh).toMatchObject({ versionNumber: 2, activeVersion: 2, message: "Balance Transfer Intro — Terms v2 is available. It adds the optional variable offer_end_date." });
  });

  it("a seeded revoke gets the version that was Active then", async () => {
    const [revoked] = await listNotices("coral", { templateId: id("holiday-points"), limit: 1 });
    expect(revoked).toMatchObject({ kind: "revoked", versionNumber: 1, activeVersion: 2, reason: "Wrong bonus amount", message: "Holiday Points Promo — Terms v1 was revoked: Wrong bonus amount." });
  });

  it("filters by template, by time and by count; other consumers' notices never show", async () => {
    const forBalance = await listNotices("coral", { templateId: id("balance-transfer"), limit: 50 });
    expect(forBalance.map((n) => n.kind).sort()).toEqual(["new_version", "sunset_scheduled"]);
    expect(await listNotices("coral", { limit: 2 })).toHaveLength(2);

    const all = await listNotices("coral", { limit: 50 });
    const cut = new Date(all[1]!.createdAt);
    expect((await listNotices("coral", { since: cut, limit: 50 })).map((n) => n.id)).toEqual([all[0]!.id]);

    const deposits = await listNotices("deposits-online", { limit: 50 });
    expect(deposits.length).toBeGreaterThan(0);
    expect(deposits.every((n) => !all.some((c) => c.id === n.id))).toBe(true);
  });

  it("a live-shaped row reads the same way", async () => {
    const at = new Date(BASE.getTime() + 60_000);
    await db.insert(consumerNotices).values({
      id: "cn_live_test",
      consumerId: "coral",
      templateId: id("cash-back"),
      versionId: "v_test",
      kind: "new_version",
      payload: {
        templateName: "Cash Back Welcome Bonus — Terms",
        versionNumber: 3,
        activeVersion: 3,
        contractChanges: [{ kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true }],
        contractLines: ["v3 adds required `annual_fee` (Currency)."],
      },
      createdAt: at,
    });
    try {
      const [latest] = await listNotices("coral", { limit: 1 });
      expect(latest).toEqual({
        id: "cn_live_test",
        kind: "new_version",
        createdAt: at.toISOString(),
        template: { id: id("cash-back"), name: "Cash Back Welcome Bonus — Terms" },
        versionNumber: 3,
        activeVersion: 3,
        sunsetAt: null,
        reason: null,
        changes: [{ kind: "added", key: "annual_fee", breaking: true, text: "v3 adds required `annual_fee` (Currency)." }],
        message: "Cash Back Welcome Bonus — Terms v3 is available. It adds the required variable annual_fee.",
      });
    } finally {
      await db.delete(consumerNotices).where(eq(consumerNotices.id, "cn_live_test"));
    }
  });
});
