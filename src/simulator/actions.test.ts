import { rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiContract, ApiTemplateDetail, ApiVariable } from "@/contracts/api-v1";
import { simCustomers, simDeliveries, simLinks, simNoticeReads, simOffers } from "@/server/db/schema/sim";

// The simulator's actions and read models against a temporary sim database and a fake UCOMP behind
// fetch. The fake answers like /api/v1: one template, v2 Active (v3 can go Active with a new required
// annual_fee; v2 can pass its sunset), Coral's notices, and the render route's errors.

const env = vi.hoisted(() => {
  process.env.UCOMP_API_ORIGIN = "http://ucomp.test";
  return { dir: "" };
});

vi.mock("@/simulator/db", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const sim = await import("@/server/db/schema/sim");
  env.dir = mkdtempSync(join(tmpdir(), "ucomp-sim-actions-"));
  const simLibsql = createClient({ url: `file:${join(env.dir, "test.db")}` });
  return { simLibsql, simDb: drizzle(simLibsql, { schema: sim }), withBusyRetry: <T>(write: () => Promise<T>) => write() };
});
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));

const { simDb, simLibsql } = await import("@/simulator/db");
const actions = await import("./actions");
const queries = await import("./queries");
const { refresh } = await import("next/cache");

// ── Fake UCOMP ───────────────────────────────────────────────────────────────

const TPL = "UC-TEST01";
const NAME = "Spring Travel Rewards — Terms";
const SUNSET_MESSAGE = `${NAME} v2 stopped rendering on March 1, 2027. Move to v3.`;
const variable = (key: string, label: string, type: ApiVariable["type"], required = true): ApiVariable => ({ key, label, type, required, example: "x" });
const V2_VARS = [
  variable("first_name", "First name", "text"),
  variable("last_name", "Last name", "text"),
  variable("purchase_apr", "Purchase APR", "percent"),
  variable("home_state", "Home state", "us_state"),
  variable("offer_end_date", "Offer end date", "date", false),
];
const V3_VARS = [...V2_VARS, variable("annual_fee", "Annual fee", "currency")];

const ucomp = { active: 2, v2Sunset: false, inFlight: 0, maxInFlight: 0, renders: [] as { body: Record<string, unknown>; headers: Headers }[] };

function contract(version: number): ApiContract {
  return {
    version,
    state: version === ucomp.active ? "active" : "superseded",
    channels: ["pdf", "web", "email"],
    variables: version === 3 ? V3_VARS : V2_VARS,
    jsonSchema: {} as ApiContract["jsonSchema"],
  };
}

function detail(version: number | null, since: number | null): ApiTemplateDetail {
  const numbers = ucomp.active === 3 ? [3, 2] : [2];
  const target = version ?? ucomp.active;
  return {
    id: TPL,
    name: NAME,
    team: { id: "coral-offers", name: "Coral Offers" },
    contentType: { key: "disclosure", name: "Disclosure" },
    asOf: "2026-10-05T12:00:00.000Z",
    activeVersion: ucomp.active,
    versions: numbers.map((n) => ({
      number: n,
      state: n === ucomp.active ? "active" : "superseded",
      activatedAt: "2026-09-01T00:00:00.000Z",
      supersededAt: n === ucomp.active ? null : "2026-10-01T00:00:00.000Z",
      sunsetAt: n === ucomp.active ? null : "2027-03-01T00:00:00.000Z",
      sunsetPassed: n === 2 && ucomp.v2Sunset,
      revokedAt: null,
      renders: !(n === 2 && ucomp.v2Sunset),
      channels: ["pdf", "web", "email"],
    })),
    contract: contract(target),
    ...(since
      ? {
          changes: {
            since,
            to: target,
            breaking: true,
            items: [{ kind: "added", key: "annual_fee", breaking: true, text: "v3 adds required `annual_fee` (Currency)." }],
            newRequired: ["annual_fee"],
          },
        }
      : {}),
  };
}

const NOTICES = [
  { id: "ntc_2", kind: "new_version", createdAt: "2026-10-04T00:00:00.000Z", template: { id: TPL, name: NAME }, versionNumber: 3, activeVersion: 3, sunsetAt: null, reason: null, changes: [{ kind: "added", key: "annual_fee", breaking: true, text: "v3 adds required `annual_fee` (Currency)." }], message: `${NAME} v3 is available. It adds the required variable annual_fee.` },
  { id: "ntc_1", kind: "new_version", createdAt: "2026-09-01T00:00:00.000Z", template: { id: "UC-OTHER1", name: "Other" }, versionNumber: 2, activeVersion: 2, sunsetAt: null, reason: null, changes: [], message: "Other v2 is available. No contract changes." },
];

const apiError = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

async function fakeUcomp(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  if (headers.get("X-Consumer-Id") !== "coral") return apiError(400, "consumer_required", "X-Consumer-Id is required.");
  const path = url.pathname;
  if (path === "/api/v1/templates") {
    return Response.json({ query: url.searchParams.get("q") ?? "", asOf: "", results: [{ id: TPL, name: NAME, activeVersion: ucomp.active }] });
  }
  if (path === "/api/v1/consumers/coral/notices") {
    const t = url.searchParams.get("templateId");
    return Response.json({ consumerId: "coral", asOf: "", notices: NOTICES.filter((n) => !t || n.template.id === t) });
  }
  if (path === `/api/v1/templates/${TPL}`) {
    const version = url.searchParams.get("version");
    const since = url.searchParams.get("since");
    return Response.json(detail(version ? Number(version) : null, since ? Number(since) : null));
  }
  if (path.startsWith("/api/v1/templates/") && !path.endsWith("/render")) {
    return apiError(404, "template_not_found", "No template has the ID UC-NOPE00.");
  }
  if (path === `/api/v1/templates/${TPL}/render` && init.method === "POST") {
    const body = JSON.parse(String(init.body)) as { version: number; channel: string; values: Record<string, string>; encoding?: string };
    ucomp.renders.push({ body, headers });
    ucomp.inFlight++;
    ucomp.maxInFlight = Math.max(ucomp.maxInFlight, ucomp.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    ucomp.inFlight--;
    if (body.version === 2 && ucomp.v2Sunset) return apiError(410, "version_sunset", SUNSET_MESSAGE);
    const missing = (body.version === 3 ? V3_VARS : V2_VARS).filter((v) => v.required && !body.values[v.key]).map((v) => v.key);
    if (missing.length) return apiError(422, "missing_variables", `Missing required variables: ${missing.join(", ")}.`);
    const newer = body.version < ucomp.active ? { "X-Stencil-Newer-Version": String(ucomp.active) } : undefined;
    if (body.channel === "pdf") {
      return Response.json({ channel: "pdf", contentType: "application/pdf", encoding: "base64", data: Buffer.from("%PDF-1.7 fake").toString("base64"), newerVersion: null }, { headers: newer });
    }
    if (body.channel === "web") return new Response(`<!doctype html><p>Hello ${body.values.first_name}</p>`, { headers: newer });
    return Response.json({ subject: "Your Spring Travel terms", preheader: "Read before you spend", html: "<p>Email</p>", text: "Email", newerVersion: null }, { headers: newer });
  }
  return apiError(404, "template_not_found", "Not found.");
}

// ── Setup ────────────────────────────────────────────────────────────────────

const LONG = { first: "Maximiliano-Bartholomew", last: "Featherstonehaugh-Villiers-Montgomery" };

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(fakeUcomp));
  await migrate(simDb, { migrationsFolder: "./src/server/db/migrations" });
  await simDb.insert(simOffers).values([
    { id: "offer_spring_travel", name: "Spring Travel Rewards", headline: "Spend $1,000 in 3 months, get $200 back", terms: { spend: 1000, bonus: 200, months: 3, annualFee: 95, endsOn: "2027-06-30" } },
    { id: "offer_cash_back", name: "Cash Back Welcome Bonus", headline: "Earn $200", terms: { spend: 1000, bonus: 200, months: 3 } },
  ]);
  await simDb.insert(simCustomers).values([
    { id: "cust_01", firstName: "Olivia", lastName: "Bennett", email: "olivia.bennett@example.com", homeState: "NJ", purchaseApr: "21.99", annualFee: "95" },
    { id: "cust_02", firstName: "Marcus", lastName: "Delgado", email: "marcus.delgado@example.com", homeState: "CA", purchaseApr: "24.49", annualFee: "0" },
    { id: "cust_10", firstName: LONG.first, lastName: LONG.last, email: "long@example.com", homeState: "NC", purchaseApr: "29.99", annualFee: "695" },
  ]);
});

afterAll(() => {
  vi.unstubAllGlobals();
  simLibsql.close();
  rmSync(env.dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  ucomp.renders = [];
  ucomp.maxInFlight = 0;
});

const V2_MAPPING = { first_name: "customer.firstName", last_name: "customer.lastName", purchase_apr: "customer.purchaseApr", home_state: "customer.homeState" } as const;

// ── Tests (in order: link → send → upgrade → sunset → relink) ────────────────

describe("searchTemplates", () => {
  it("returns the API's results", async () => {
    const result = await actions.searchTemplates({ q: "spring" });
    expect(result.ok && result.results.map((r) => r.id)).toEqual([TPL]);
  });
});

describe("linkTemplate", () => {
  it("refuses a version that isn't Active, channels outside the version, and unknown templates", async () => {
    const base = { offerId: "offer_spring_travel", templateId: TPL, channels: ["pdf" as const], mapping: {} };
    expect(await actions.linkTemplate({ ...base, version: 1 })).toEqual({ ok: false, reason: "v1 isn't the Active version. Link v2." });
    expect(await actions.linkTemplate({ ...base, version: 2, channels: [] })).toEqual({ ok: false, reason: "Choose at least one channel." });
    expect(await actions.linkTemplate({ ...base, templateId: "UC-NOPE00", version: 2 })).toEqual({ ok: false, reason: "No template has the ID UC-NOPE00." });
    expect(await actions.linkTemplate({ ...base, offerId: "offer_nope", version: 2 })).toEqual({ ok: false, reason: "That offer doesn't exist." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("links the Active version, keeping known keys and fields only", async () => {
    const result = await actions.linkTemplate({
      offerId: "offer_spring_travel",
      templateId: TPL,
      version: 2,
      channels: ["email", "pdf", "web"],
      mapping: { ...V2_MAPPING, offer_end_date: null, retired: "customer.email", home_state: "customer.homeState" },
    });
    expect(result).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledOnce();
    const [link] = await simDb.select().from(simLinks).where(eq(simLinks.offerId, "offer_spring_travel"));
    expect(link).toMatchObject({ templateId: TPL, templateName: NAME, pinnedVersion: 2, channels: ["pdf", "web", "email"], mapping: V2_MAPPING });
  });
});

describe("sendToCustomers", () => {
  it("sends every linked channel per customer, as Coral, at most 3 in flight, and keeps the outputs", async () => {
    const result = await actions.sendToCustomers({ offerId: "offer_spring_travel", customerIds: ["cust_10", "cust_01"] });
    if (!result.ok) throw new Error(result.reason);
    const { batch } = result;
    expect(batch).toMatchObject({ templateId: TPL, versionNumber: 2, channels: ["pdf", "web", "email"], counts: { delivered: 6, failed: 0 } });
    expect(batch.rows.map((r) => r.customerName)).toEqual([`${LONG.first} ${LONG.last}`, "Olivia Bennett"]);
    expect(batch.rows[0].results.map((r) => [r.channel, r.status, r.error])).toEqual([
      ["pdf", "delivered", null],
      ["web", "delivered", null],
      ["email", "delivered", null],
    ]);

    expect(ucomp.renders).toHaveLength(6);
    expect(ucomp.maxInFlight).toBeLessThanOrEqual(3);
    expect(new Set(ucomp.renders.map((r) => r.headers.get("X-Correlation-Id"))).size).toBe(6);
    expect(ucomp.renders.every((r) => r.body.version === 2)).toBe(true);
    expect(ucomp.renders.filter((r) => r.body.encoding === "base64").map((r) => r.body.channel)).toEqual(["pdf", "pdf"]);
    expect(ucomp.renders[0].body.values).toEqual({ first_name: LONG.first, last_name: LONG.last, purchase_apr: "29.99", home_state: "NC" });

    const rows = await simDb.select().from(simDeliveries).where(eq(simDeliveries.batchId, batch.id));
    const byChannel = Object.fromEntries(rows.filter((r) => r.customerId === "cust_01").map((r) => [r.channel, r.output]));
    expect(Buffer.from(byChannel.pdf!, "base64").toString()).toBe("%PDF-1.7 fake");
    expect(byChannel.web).toBe("<!doctype html><p>Hello Olivia</p>");
    expect(JSON.parse(byChannel.email!)).toMatchObject({ subject: "Your Spring Travel terms", html: "<p>Email</p>" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("serves a delivery's file and its customer view", async () => {
    const page = await queries.getSimOfferPage("offer_spring_travel");
    const [pdf, web, email] = page!.lastBatch!.rows[1].results;
    const file = await queries.loadDeliveryFile(pdf.deliveryId);
    expect(file?.contentType).toBe("application/pdf");
    expect(Buffer.from(file!.body as Uint8Array).toString()).toBe("%PDF-1.7 fake");
    expect((await queries.loadDeliveryFile(email.deliveryId))?.body).toBe("<p>Email</p>");

    const view = await actions.getDeliveryView({ deliveryId: email.deliveryId });
    expect(view.ok && view.view).toMatchObject({
      customer: { name: "Olivia Bennett", email: "olivia.bennett@example.com" },
      offerName: "Spring Travel Rewards",
      templateName: NAME,
      versionNumber: 2,
      channel: "email",
      status: "delivered",
      view: { kind: "inbox", src: `/sim/deliveries/${email.deliveryId}/file`, subject: "Your Spring Travel terms", preheader: "Read before you spend" },
    });
    const phone = await actions.getDeliveryView({ deliveryId: web.deliveryId });
    expect(phone.ok && phone.view.view).toEqual({ kind: "phone", src: `/sim/deliveries/${web.deliveryId}/file` });
    expect(await actions.getDeliveryView({ deliveryId: "dlv_nope" })).toEqual({ ok: false, reason: "That delivery doesn't exist." });
  });

  it("refuses with nothing to send", async () => {
    expect(await actions.sendToCustomers({ offerId: "offer_spring_travel", customerIds: [] })).toEqual({ ok: false, reason: "Choose customers to send to." });
    expect(await actions.sendToCustomers({ offerId: "offer_cash_back", customerIds: ["cust_01"] })).toEqual({ ok: false, reason: "Link a template to send." });
    expect(ucomp.renders).toHaveLength(0);
  });
});

describe("upgrade, sunset and relink", () => {
  it("shows v3 available with the diff and still sends on v2", async () => {
    ucomp.active = 3;
    const home = await queries.getSimHome();
    const card = home.offers.find((o) => o.id === "offer_spring_travel")!;
    expect(card.link).toMatchObject({ pinnedVersion: 2, pinnedState: "superseded", sunsetAt: "2027-03-01T00:00:00.000Z", renders: true });
    expect(card.upgrade).toMatchObject({ toVersion: 3, diff: { since: 2, newRequired: ["annual_fee"] } });
    expect(card.lastSend).toMatchObject({ delivered: 6, failed: 0 });
    expect(home.offers.find((o) => o.id === "offer_cash_back")).toMatchObject({ link: null, upgrade: null, lastSend: null });

    const result = await actions.sendToCustomers({ offerId: "offer_spring_travel", customerIds: ["cust_02"] });
    expect(result.ok && result.batch.rows[0].results.map((r) => [r.status, r.newerVersion])).toEqual([
      ["delivered", 3],
      ["delivered", 3],
      ["delivered", 3],
    ]);
  });

  it("stores the API's exact error when the pinned version has passed its sunset", async () => {
    ucomp.v2Sunset = true;
    const result = await actions.sendToCustomers({ offerId: "offer_spring_travel", customerIds: ["cust_01", "cust_02"] });
    if (!result.ok) throw new Error(result.reason);
    expect(result.batch.counts).toEqual({ delivered: 0, failed: 6 });
    for (const row of result.batch.rows) {
      for (const r of row.results) expect(r.error).toEqual({ status: 410, code: "version_sunset", message: SUNSET_MESSAGE });
    }
    const failed = await queries.getSimDeliveryView(result.batch.rows[0].results[0].deliveryId);
    expect(failed).toMatchObject({ status: "failed", view: null, error: { message: SUNSET_MESSAGE } });
    expect(await queries.loadDeliveryFile(result.batch.rows[0].results[0].deliveryId)).toBeNull();

    const page = await queries.getSimOfferPage("offer_spring_travel");
    expect(page?.link).toMatchObject({ sunsetPassed: true, renders: false });
    expect(page?.lastBatch?.id).toBe(result.batch.id);
  });

  it("relinks to v3: the flow asks for annual_fee, an unmapped save blocks Send, and mapping it sends", async () => {
    const flow = await queries.getSimLinkFlow("offer_spring_travel", TPL);
    expect(flow?.apiError).toBeNull();
    expect(flow?.candidate).toMatchObject({ version: 3, diff: { newRequired: ["annual_fee"] }, mapping: { ...V2_MAPPING } });
    expect(flow?.candidate?.mapping).not.toHaveProperty("annual_fee");
    expect(flow?.fields.length).toBeGreaterThan(10);

    // Saved without annual_fee: allowed, but Send names it.
    expect(await actions.linkTemplate({ offerId: "offer_spring_travel", templateId: TPL, version: 3, channels: ["pdf", "web", "email"], mapping: flow!.candidate!.mapping })).toEqual({ ok: true });
    const blockedPage = await queries.getSimOfferPage("offer_spring_travel");
    expect(blockedPage?.blocked).toEqual({ missing: [{ key: "annual_fee", label: "Annual fee" }], sentence: "Map Annual fee to send." });
    expect(blockedPage?.link?.mapping.find((m) => m.key === "annual_fee")).toMatchObject({ required: true, field: null, fieldLabel: null });
    expect(blockedPage?.upgrade).toBeNull();
    expect(await actions.sendToCustomers({ offerId: "offer_spring_travel", customerIds: ["cust_01"] })).toEqual({ ok: false, reason: "Map Annual fee to send." });

    // Map it on the offer page.
    expect(await actions.saveMapping({ offerId: "offer_spring_travel", mapping: { bogus: "offer.annualFee" } })).toEqual({ ok: false, reason: "v3 has no variable bogus." });
    expect(await actions.saveMapping({ offerId: "offer_spring_travel", mapping: { annual_fee: "offer.annualFee" } })).toEqual({ ok: true });
    const page = await queries.getSimOfferPage("offer_spring_travel");
    expect(page?.blocked).toBeNull();
    expect(page?.link?.mapping.find((m) => m.key === "annual_fee")).toMatchObject({ field: "offer.annualFee", fieldLabel: "Offer · Annual fee" });

    const result = await actions.sendToCustomers({ offerId: "offer_spring_travel", customerIds: ["cust_01", "cust_10"] });
    expect(result.ok && result.batch.counts).toEqual({ delivered: 6, failed: 0 });
    expect(ucomp.renders.every((r) => r.body.version === 3 && (r.body.values as Record<string, string>).annual_fee === "95")).toBe(true);
  });

  it("an unknown template in the flow is reported with the API's message", async () => {
    const flow = await queries.getSimLinkFlow("offer_cash_back", "UC-NOPE00");
    expect(flow).toMatchObject({ current: null, candidate: null, apiError: { status: 404, code: "template_not_found", message: "No template has the ID UC-NOPE00." } });
    expect(await queries.getSimLinkFlow("offer_nope")).toBeNull();
  });
});

describe("notices", () => {
  it("lists Coral's notices with read state and linked offers, and marks them read", async () => {
    const before = await queries.getSimHome();
    expect(before.unread).toBe(2);
    expect(before.notices[0]).toMatchObject({ id: "ntc_2", templateName: NAME, versionNumber: 3, read: false, offerIds: ["offer_spring_travel"], lines: ["v3 adds required `annual_fee` (Currency)."] });

    expect(await actions.markNoticesRead({ noticeIds: ["ntc_2", "ntc_2"] })).toEqual({ ok: true });
    expect(await actions.markNoticesRead({ noticeIds: ["ntc_2"] })).toEqual({ ok: true }); // idempotent
    expect(await actions.markNoticesRead({ noticeIds: [] })).toEqual({ ok: false, reason: "Choose notices to mark read." });
    expect(await simDb.select().from(simNoticeReads)).toHaveLength(1);

    const after = await queries.getSimHome();
    expect(after.unread).toBe(1);
    const page = await queries.getSimOfferPage("offer_spring_travel");
    expect(page?.notices.map((n) => [n.id, n.read])).toEqual([["ntc_2", true]]);
  });
});
