import type { Client } from "@libsql/client";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiNoticeList, ApiTemplateDetail, ApiTemplateSearch } from "@/contracts/api-v1";
import { JUNK, allVersions, expectError, openDb, pick, type SeedVersion, type VariableType } from "./helpers";

// The consumer API gate (phase 5): the three GET routes a consumer (Coral) reads, called the way a
// consumer would, with the seeded database read to know what to expect. Contract: src/contracts/api-v1.ts.
//
//   1. GET /api/v1/templates                       search: Active templates only, by id or by words
//   2. GET /api/v1/templates/{id}                  released versions, a contract, its JSON Schema, changes
//   3. GET /api/v1/consumers/{consumerId}/notices  the outbox, normalized from either payload shape
//
// Read-only: nothing is written. Nothing is hardcoded by id: templates are found by state. Other agents
// may add templates or notices while this runs, so lists are checked for what the seed guarantees.

let db: Client;

test.beforeAll(() => {
  db = openDb();
});

test.afterAll(() => {
  db.close();
});

const CORAL = { "X-Consumer-Id": "coral" };
const RELEASED = ["active", "superseded", "revoked"];

const versions = () => allVersions(db);

async function get(request: APIRequestContext, path: string, headers: Record<string, string> = CORAL) {
  return request.get(path, { headers });
}

/** Every variable with its sample, as the version stores it. */
async function samplesOf(versionId: string): Promise<{ key: string; type: VariableType; sample: string }[]> {
  const { rows } = await db.execute({ sql: "SELECT variables FROM versions WHERE id = ?", args: [versionId] });
  return JSON.parse(String(rows[0]!.variables)) as { key: string; type: VariableType; sample: string }[];
}

/** Templates whose versions are all unreleased (draft, in review, changes requested). */
const unreleased = (all: SeedVersion[]) => {
  const byTemplate = Map.groupBy(all, (v) => v.templateId);
  return [...byTemplate.entries()].filter(([, vs]) => vs.every((v) => !RELEASED.includes(v.state))).map(([id]) => id);
};

/** An Active version with a Superseded predecessor (Balance Transfer in the seed). */
async function activeWithSuperseded(): Promise<{ active: SeedVersion; old: SeedVersion }> {
  const all = await versions();
  const active = pick(all, "Active version with a Superseded one before it", (v) =>
    v.state === "active" && all.some((o) => o.templateId === v.templateId && o.state === "superseded"),
  );
  const old = all.find((o) => o.templateId === active.templateId && o.state === "superseded")!;
  return { active, old };
}

// ── 1. Search ────────────────────────────────────────────────────────────────

test.describe("GET /api/v1/templates", () => {
  test("lists Active templates only, with the no-store and correlation headers", async ({ request }) => {
    const correlationId = `e2e-consumer-${randomUUID().slice(0, 8)}`;
    const res = await get(request, "/api/v1/templates?limit=50", { ...CORAL, "X-Correlation-Id": correlationId });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/json");
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["x-correlation-id"]).toBe(correlationId);
    const body = (await res.json()) as ApiTemplateSearch;
    expect(body.query).toBe("");
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);

    const all = await versions();
    const activeIds = new Set(all.filter((v) => v.state === "active").map((v) => v.templateId));
    expect(body.results.length).toBeGreaterThan(0);
    for (const result of body.results) {
      expect(activeIds.has(result.id), `${result.id} has an Active version`).toBe(true);
      const active = all.find((v) => v.templateId === result.id && v.state === "active")!;
      expect(result.activeVersion).toBe(active.number);
      expect(result.variableCount).toBe(active.variables.length);
      expect(result.requiredCount).toBe(active.variables.filter((v) => v.required).length);
    }
    for (const id of unreleased(all)) expect(body.results.map((r) => r.id)).not.toContain(id);
  });

  test("finds a template by id in any case, with or without UC-", async ({ request }) => {
    const { active } = await activeWithSuperseded();
    const code = active.templateId.slice(3);
    for (const q of [active.templateId, active.templateId.toLowerCase(), code, code.toLowerCase()]) {
      const body = (await (await get(request, `/api/v1/templates?q=${encodeURIComponent(q)}`)).json()) as ApiTemplateSearch;
      expect(body.results[0]?.id, q).toBe(active.templateId);
    }
  });

  test("finds by every word of the name, starts-with first", async ({ request }) => {
    const { active } = await activeWithSuperseded();
    const words = active.templateName.split(/\s+/).filter((w) => /\w{3,}/.test(w));
    const q = [...words.slice(0, 2)].reverse().join(" ").toUpperCase();
    const body = (await (await get(request, `/api/v1/templates?q=${encodeURIComponent(q)}`)).json()) as ApiTemplateSearch;
    expect(body.results.map((r) => r.id)).toContain(active.templateId);
    for (const r of body.results) for (const w of q.toLowerCase().split(" ")) expect(r.name.toLowerCase()).toContain(w);
  });

  test("limit and after: pages by cursor, in order, never overlapping", async ({ request }) => {
    const body = (await (await get(request, "/api/v1/templates?limit=1")).json()) as ApiTemplateSearch;
    expect(body.results).toHaveLength(1);
    expect(body.hasMore).toBe(true);
    await expectError(await get(request, "/api/v1/templates?limit=51"), 400, "bad_request", "limit must be a number from 1 to 50.");

    // Walk the whole list two at a time. Other specs may activate or revoke templates meanwhile, so
    // check the walk's own shape, and that every template Active throughout shows up.
    const activeBefore = new Set((await versions()).filter((v) => v.state === "active").map((v) => v.templateId));
    const walk: ApiTemplateSearch["results"] = [];
    let after = "";
    for (let page = 0; ; page++) {
      expect(page, "the walk ends").toBeLessThan(100);
      const next = (await (await get(request, `/api/v1/templates?limit=2${after ? `&after=${after}` : ""}`)).json()) as ApiTemplateSearch;
      expect(next.results.length).toBeLessThanOrEqual(2);
      walk.push(...next.results);
      if (!next.hasMore) break;
      after = next.nextCursor;
    }
    const ids = walk.map((r) => r.id);
    expect(new Set(ids).size, "no template twice").toBe(ids.length);
    const names = walk.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const activeAfter = new Set((await versions()).filter((v) => v.state === "active").map((v) => v.templateId));
    for (const id of activeBefore) if (activeAfter.has(id)) expect(ids, id).toContain(id);

    await expectError(await get(request, `/api/v1/templates?q=rate&after=${body.nextCursor}`), 400, "bad_request", "after must be the nextCursor of an earlier page of this list.");
  });

  test("X-Consumer-Id is required and must be registered", async ({ request }) => {
    await expectError(await get(request, "/api/v1/templates", {}), 400, "consumer_required", "X-Consumer-Id is required.");
    await expectError(await get(request, "/api/v1/templates", { "X-Consumer-Id": "acme" }), 403, "unknown_consumer", 'Consumer "acme" isn\'t registered.');
  });
});

// ── 2. One template ──────────────────────────────────────────────────────────

test.describe("GET /api/v1/templates/{id}", () => {
  test("the Active contract, the released versions, and a JSON Schema the samples pass and JUNK fails", async ({ request }) => {
    const { active, old } = await activeWithSuperseded();
    const res = await get(request, `/api/v1/templates/${active.templateId}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = (await res.json()) as ApiTemplateDetail;
    expect(body).toMatchObject({ id: active.templateId, name: active.templateName, activeVersion: active.number });
    const released = (await versions()).filter((v) => v.templateId === active.templateId && RELEASED.includes(v.state));
    expect(body.versions.map((v) => v.number)).toEqual(released.map((v) => v.number).sort((a, b) => b! - a!));
    expect(body.versions.find((v) => v.number === old.number)).toMatchObject({ state: "superseded", supersededAt: expect.any(String) });
    expect(body.changes).toBeUndefined();

    const contract = body.contract!;
    expect(contract).toMatchObject({ version: active.number, state: "active", channels: active.channels });
    expect(contract.variables.map((v) => [v.key, v.type, v.required])).toEqual(active.variables.map((v) => [v.key, v.type, v.required]));
    expect(contract.jsonSchema.required).toEqual(active.variables.filter((v) => v.required).map((v) => v.key));

    const validator = z.fromJSONSchema(contract.jsonSchema as never);
    const variables = await samplesOf(active.id);
    const samples = Object.fromEntries(variables.map((v) => [v.key, v.sample]));
    expect(validator.safeParse(samples).success).toBe(true);
    for (const v of variables) expect(validator.safeParse({ ...samples, [v.key]: JUNK[v.type] }).success, v.key).toBe(false);
  });

  test("an older version's contract, and what changed since it", async ({ request }) => {
    const { active, old } = await activeWithSuperseded();
    const older = (await (await get(request, `/api/v1/templates/${active.templateId}?version=${old.number}`)).json()) as ApiTemplateDetail;
    expect(older.contract).toMatchObject({ version: old.number, state: "superseded" });

    const diff = (await (await get(request, `/api/v1/templates/${active.templateId}?since=${old.number}`)).json()) as ApiTemplateDetail;
    expect(diff.changes).toMatchObject({ since: old.number, to: active.number });
    const before = new Set(old.variables.map((v) => v.key));
    const added = active.variables.filter((v) => !before.has(v.key)).map((v) => v.key);
    expect(diff.changes!.items.filter((i) => i.kind === "added").map((i) => i.key)).toEqual(added);
    for (const item of diff.changes!.items) expect(item.text).toMatch(new RegExp(`^v${active.number} `));
  });

  test("errors: consumer, bad numbers, unknown and unreleased templates and versions", async ({ request }) => {
    const all = await versions();
    const { active } = await activeWithSuperseded();
    const base = `/api/v1/templates/${active.templateId}`;
    await expectError(await get(request, base, {}), 400, "consumer_required", "X-Consumer-Id is required.");
    await expectError(await get(request, base, { "X-Consumer-Id": "acme" }), 403, "unknown_consumer", 'Consumer "acme" isn\'t registered.');
    await expectError(await get(request, `${base}?version=zero`), 400, "bad_request", "version must be a version number.");
    await expectError(await get(request, `${base}?since=x`), 400, "bad_request", "since must be a version number.");
    await expectError(await get(request, `${base}?since=${active.number}`), 400, "bad_request", "since must be lower than version.");
    await expectError(await get(request, "/api/v1/templates/UC-ZZZZZZ"), 404, "template_not_found", "Template UC-ZZZZZZ doesn't exist.");
    const hidden = unreleased(all)[0]!;
    await expectError(await get(request, `/api/v1/templates/${hidden}`), 404, "template_not_found", `Template ${hidden} doesn't exist.`);
    await expectError(await get(request, `${base}?version=99`), 404, "version_not_found", `Template ${active.templateId} has no version 99.`);

    const inReview = pick(all, "numbered version in review", (v) => v.state === "in_review" && v.number !== null);
    const error = await expectError(
      await get(request, `/api/v1/templates/${inReview.templateId}?version=${inReview.number}`),
      409,
      "version_not_released",
      `Version ${inReview.number} is in review. ${inReview.activeNumber === null ? "No version is active yet." : `Version ${inReview.activeNumber} is active.`}`,
    );
    expect(error.details).toEqual({ version: inReview.number, activeVersion: inReview.activeNumber });
  });
});

// ── 3. Notices ───────────────────────────────────────────────────────────────

/** Every page of Coral's notices from `after` (none: the start), following nextCursor until hasMore is false. */
async function walkNotices(request: APIRequestContext, query: string, after = ""): Promise<{ pages: ApiNoticeList[]; end: string }> {
  const pages: ApiNoticeList[] = [];
  for (;;) {
    expect(pages.length, "the walk ends").toBeLessThan(200);
    const res = await get(request, `/api/v1/consumers/coral/notices?${query}${after ? `&after=${after}` : ""}`);
    expect(res.status()).toBe(200);
    const page = (await res.json()) as ApiNoticeList;
    pages.push(page);
    after = page.nextCursor;
    if (!page.hasMore) return { pages, end: after };
  }
}

/** Each notice's place in the outbox (consumer_notices.seq), in the order given; ids no longer stored are left out. */
async function seqs(ids: string[]): Promise<number[]> {
  const { rows } = await db.execute({ sql: `SELECT id, seq FROM consumer_notices WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids });
  const byId = new Map(rows.map((r) => [String(r.id), Number(r.seq)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

const increasing = (values: number[]) => values.every((v, i) => i === 0 || v > values[i - 1]!);

test.describe("GET /api/v1/consumers/{consumerId}/notices", () => {
  test("Coral's notices, oldest first in the order written, each one Coral's and worded", async ({ request }) => {
    const res = await get(request, "/api/v1/consumers/coral/notices?limit=200");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = (await res.json()) as ApiNoticeList;
    expect(body.consumerId).toBe("coral");
    expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(typeof body.hasMore).toBe("boolean");
    const { rows } = await db.execute("SELECT id FROM consumer_notices WHERE consumer_id = 'coral'");
    const coral = new Set(rows.map((r) => String(r.id)));
    expect(body.notices.length).toBeGreaterThan(0);
    for (const n of body.notices) {
      expect(coral.has(n.id), n.id).toBe(true);
      expect(n.message).toMatch(new RegExp(`^${n.template.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} v${n.versionNumber} `));
    }
    expect(increasing(await seqs(body.notices.map((n) => n.id))), "in seq order").toBe(true);

    // The seeded sunset (both payload shapes normalize to the same fields).
    const sunset = body.notices.find((n) => n.kind === "sunset_scheduled");
    expect(sunset).toMatchObject({ activeVersion: expect.any(Number), sunsetAt: expect.any(String), reason: null });
    expect(sunset!.message).toMatch(/ stops rendering on \w+ \d+, \d{4}\. Move to v\d+\.$/);
    const revoked = body.notices.find((n) => n.kind === "revoked");
    expect(revoked?.reason).toBeTruthy();
  });

  test("templateId filters; limit and after page through every notice once, in order", async ({ request }) => {
    const all = ((await (await get(request, "/api/v1/consumers/coral/notices?limit=200")).json()) as ApiNoticeList).notices;
    const templateId = all[0]!.template.id;
    const one = await walkNotices(request, `templateId=${templateId}&limit=1`);
    expect(one.pages.flatMap((p) => p.notices).every((n) => n.template.id === templateId)).toBe(true);

    // One at a time from the start. Other specs may write (or clean up) notices meanwhile: the walk
    // finds every earlier notice still stored, in the same order, never one twice or out of order.
    const { pages, end } = await walkNotices(request, "limit=1");
    expect(pages.slice(0, -1).every((p) => p.notices.length === 1 && p.hasMore)).toBe(true);
    const walked = pages.flatMap((p) => p.notices.map((n) => n.id));
    expect(new Set(walked).size, "no notice twice").toBe(walked.length);
    const { rows } = await db.execute("SELECT id FROM consumer_notices WHERE consumer_id = 'coral'");
    const stored = new Set(rows.map((r) => String(r.id)));
    const earlier = all.map((n) => n.id);
    expect(walked.filter((id) => earlier.includes(id))).toEqual(earlier.filter((id) => stored.has(id)));
    expect(increasing(await seqs(walked)), "in seq order").toBe(true);

    // The last cursor is where a poll resumes: nothing older comes back.
    const resumed = await walkNotices(request, "limit=50", end);
    expect(resumed.pages.flatMap((p) => p.notices).filter((n) => walked.includes(n.id))).toEqual([]);
  });

  test("errors: consumer, path consumer, mismatch, bad parameters", async ({ request }) => {
    const path = "/api/v1/consumers/coral/notices";
    await expectError(await get(request, path, {}), 400, "consumer_required", "X-Consumer-Id is required.");
    await expectError(await get(request, path, { "X-Consumer-Id": "acme" }), 403, "unknown_consumer", 'Consumer "acme" isn\'t registered.');
    await expectError(await get(request, "/api/v1/consumers/acme/notices"), 404, "consumer_not_found", "Consumer acme doesn't exist.");
    await expectError(await get(request, "/api/v1/consumers/deposits-online/notices"), 403, "consumer_mismatch", "X-Consumer-Id doesn't match consumer deposits-online.");
    await expectError(await get(request, `${path}?limit=500`), 400, "bad_request", "limit must be a number from 1 to 200.");
    const badAfter = "after must be the nextCursor of an earlier page of this list.";
    await expectError(await get(request, `${path}?after=soon`), 400, "bad_request", badAfter);
    await expectError(await get(request, `${path}?after=${encodeURIComponent("2026-10-05T12:00:00Z")}`), 400, "bad_request", badAfter);
    const search = (await (await get(request, "/api/v1/templates?limit=1")).json()) as ApiTemplateSearch;
    await expectError(await get(request, `${path}?after=${search.nextCursor}`), 400, "bad_request", badAfter);
  });
});
