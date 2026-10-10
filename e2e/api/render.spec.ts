import type { Client } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { sunsetDay, sunsetInstant } from "@/domain/business-zone";
import {
  JUNK,
  LABEL,
  LOG_COLUMNS,
  NOUNS,
  allVersions,
  andList,
  asPersona,
  correlation,
  demoNow,
  expectError,
  isDocument,
  logFor,
  longDate,
  openDb,
  pick,
  postChunked,
  render,
  validValues,
  withTemporarily,
  type Channel,
  type SeedVersion,
  type Variable,
  type VariableType,
} from "./helpers";

// The render API gate (build plan, phase 3): POST /api/v1/templates/{templateId}/render, called the
// way a consumer would, with the seeded database read to find what to render and to look inside
// render_log. Contract: src/domain/render/types.ts.
//
//   1. Each channel's content type, and the headers every 200 carries.
//   2. The base64 opt-in.
//   3. Values: missing (listed by key), wrong type (named), both, friendly forms, optional keys, the
//      length limit.
//   4. Channels: not enabled on the version, not allowed by the content type, unknown.
//   5. Version rules for consumers; the request errors that come before them, the body size limit
//      among them (declared, and chunked with no Content-Length).
//   6. Previews: tagged, and only for people who can see the template's team.
//   7. render_log: one row per render, and never a value.
//
// No page is opened, so there is no console to watch. Nothing is hardcoded by id: versions are found
// by state in the seeded database. Two rules the seed has no row for (a sunset that has passed, a
// content type that narrows its channels) are set on a row for the length of one test and put back
// in a `finally`.

const ALL_CHANNELS: readonly Channel[] = ["pdf", "web", "email"];
const SENTINEL_TEXT = "Zyxwvut-Sentinel";

let db: Client;

test.beforeAll(() => {
  db = openDb();
});

test.afterAll(() => {
  db.close();
});

// ── Finding things ───────────────────────────────────────────────────────────

/** The documents' versions: the rules below are checked on PDF, Web and Email. Alerts are at the end. */
const versions = async () => (await allVersions(db)).filter(isDocument);

const rendersTo = (channel: Channel) => (v: SeedVersion) => v.state === "active" && v.channels.includes(channel);
const rendersToAll = (v: SeedVersion) => v.state === "active" && ALL_CHANNELS.every((c) => v.channels.includes(c));

/** An Active version with every channel on. */
async function activeEverywhere(): Promise<SeedVersion> {
  return pick(await versions(), "Active version with pdf, web and email on", rendersToAll);
}

/** An Active version with at least three required variables (so two can be missing and one left over). */
async function activeWithManyRequired(): Promise<SeedVersion> {
  return pick(await versions(), "Active version with three required variables", (v) => v.state === "active" && v.variables.filter((x) => x.required).length >= 3);
}

const required = (v: SeedVersion) => v.variables.filter((x) => x.required);

/** "Version 2 is active." or the given fallback. */
const activeSentence = (activeNumber: number | null, none: string) => (activeNumber === null ? none : `Version ${activeNumber} is active.`);

/** A consumer's request body for a version. */
const bodyFor = (v: SeedVersion, channel: Channel, values: Record<string, unknown> = validValues(v.variables), extra: object = {}) => ({
  version: v.number,
  channel,
  values,
  ...extra,
});

const pdfMagic = (bytes: Buffer) => bytes.subarray(0, 4).toString("latin1");

// ── 1. Content types and headers ─────────────────────────────────────────────

test.describe("each channel's content type", () => {
  test("pdf renders application/pdf and the body is a PDF", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "pdf") });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toBe(`inline; filename="${v.templateId}-v${v.number}.pdf"`);
    const bytes = await res.body();
    expect(pdfMagic(bytes)).toBe("%PDF");
    expect(bytes.length, "a real document, not a stub").toBeGreaterThan(1000);
  });

  test("web renders text/html and the body is a complete HTML document", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "web") });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain("</html>");
  });

  test("email renders JSON with subject, preheader, html and text, and newerVersion null", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "email") });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/json");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["html", "newerVersion", "preheader", "subject", "text"]);
    for (const field of ["subject", "preheader", "html", "text"]) {
      expect(typeof body[field], field).toBe("string");
      expect(body[field].length, `${field} isn't empty`).toBeGreaterThan(0);
    }
    expect(body.html).toMatch(/<!doctype html>/i);
    expect(body.newerVersion).toBeNull();
  });

  test("an Active version renders for every consumer that is registered", async ({ request }) => {
    const v = await activeEverywhere();
    const consumers = (await db.execute("SELECT id FROM consumers")).rows.map((r) => String(r.id));
    expect(consumers.length).toBeGreaterThan(1);
    for (const consumer of consumers) {
      const { res } = await render(request, { templateId: v.templateId, consumer, body: bodyFor(v, "web") });
      expect(res.status(), `consumer ${consumer}`).toBe(200);
    }
  });
});

test.describe("headers", () => {
  test("X-Correlation-Id is echoed when it is sent", async ({ request }) => {
    const v = await activeEverywhere();
    const sent = correlation("echo");
    const { res } = await render(request, { templateId: v.templateId, correlationId: sent, body: bodyFor(v, "web") });
    expect(res.headers()["x-correlation-id"]).toBe(sent);
  });

  test("X-Correlation-Id is generated when it is not sent, and each request gets its own", async ({ request }) => {
    const v = await activeEverywhere();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { res } = await render(request, { templateId: v.templateId, correlationId: null, body: bodyFor(v, "web") });
      expect(res.status()).toBe(200);
      const id = res.headers()["x-correlation-id"];
      expect(id, "a generated id").toMatch(/^[\x21-\x7e]{1,128}$/);
      ids.push(id);
    }
    expect(ids[0]).not.toBe(ids[1]);
    // The generated id is the one in the log.
    expect(await logFor(db, ids[0])).toHaveLength(1);
  });

  test("an id that is too long is not echoed; a fresh one is generated", async ({ request }) => {
    const v = await activeEverywhere();
    const tooLong = "x".repeat(129);
    const { res } = await render(request, { templateId: v.templateId, correlationId: tooLong, body: bodyFor(v, "web") });
    expect(res.status()).toBe(200);
    const id = res.headers()["x-correlation-id"];
    expect(id).toBeTruthy();
    expect(id).not.toBe(tooLong);
  });

  test("every channel's 200 names the template and version, and is not cached", async ({ request }) => {
    const v = await activeEverywhere();
    for (const channel of ALL_CHANNELS) {
      const sent = correlation(`hdr-${channel}`);
      const { res } = await render(request, { templateId: v.templateId, correlationId: sent, body: bodyFor(v, channel) });
      expect(res.status(), channel).toBe(200);
      const h = res.headers();
      expect(h["x-stencil-template-id"], channel).toBe(v.templateId);
      expect(h["x-stencil-version"], channel).toBe(String(v.number));
      expect(h["cache-control"], channel).toBe("no-store");
      expect(h["x-correlation-id"], channel).toBe(sent);
      // An Active version has no newer one, and a consumer render isn't a preview.
      expect(h["x-stencil-newer-version"], channel).toBeUndefined();
      expect(h["x-stencil-preview"], channel).toBeUndefined();
    }
  });

  test("an error carries the correlation id and is not cached", async ({ request }) => {
    const v = await activeEverywhere();
    const sent = correlation("err-hdr");
    const { res } = await render(request, { templateId: v.templateId, correlationId: sent, body: bodyFor(v, "web", {}) });
    await expectError(res, 422, "missing_variables");
    expect(res.headers()["x-correlation-id"]).toBe(sent);
  });
});

// ── 2. base64 ────────────────────────────────────────────────────────────────

test.describe("base64 opt-in", () => {
  test("pdf comes back as JSON with the document in base64", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "pdf", undefined, { encoding: "base64" }) });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/json");
    expect(res.headers()["x-stencil-template-id"]).toBe(v.templateId);
    expect(res.headers()["x-stencil-version"]).toBe(String(v.number));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["channel", "contentType", "data", "encoding", "newerVersion"]);
    expect(body).toMatchObject({ channel: "pdf", contentType: "application/pdf", encoding: "base64", newerVersion: null });
    const bytes = Buffer.from(body.data, "base64");
    expect(pdfMagic(bytes)).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  test("web comes back as JSON with the HTML in base64, the same HTML the plain render returns", async ({ request }) => {
    const v = await activeEverywhere();
    const values = validValues(v.variables);
    const plain = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", values) });
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", values, { encoding: "base64" }) });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/json");
    const body = await res.json();
    expect(body).toMatchObject({ channel: "web", contentType: "text/html; charset=utf-8", encoding: "base64", newerVersion: null });
    const html = Buffer.from(body.data, "base64").toString("utf8");
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toBe(await plain.res.text());
  });

  test("email keeps subject and preheader as text and base64-encodes html and text", async ({ request }) => {
    const v = await activeEverywhere();
    const values = validValues(v.variables);
    const plain = await (await render(request, { templateId: v.templateId, body: bodyFor(v, "email", values) })).res.json();
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "email", values, { encoding: "base64" }) });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/json");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["encoding", "html", "newerVersion", "preheader", "subject", "text"]);
    expect(body.encoding).toBe("base64");
    expect(body.newerVersion).toBeNull();
    expect(body.subject).toBe(plain.subject);
    expect(body.preheader).toBe(plain.preheader);
    const html = Buffer.from(body.html, "base64").toString("utf8");
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toBe(plain.html);
    expect(Buffer.from(body.text, "base64").toString("utf8")).toBe(plain.text);
  });

  test("an error stays a plain JSON error when base64 is asked for", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "pdf", {}, { encoding: "base64" }) });
    await expectError(res, 422, "missing_variables");
  });
});

// ── 3. Values ────────────────────────────────────────────────────────────────

test.describe("values", () => {
  test("missing required variables are listed by key, in the version's order", async ({ request }) => {
    const v = await activeWithManyRequired();
    const req = required(v);
    const missing = [req[0].key, req[req.length - 1].key];
    // The request lists its keys in reverse; the answer follows the version's variable order.
    const values = Object.fromEntries(Object.entries(validValues(v.variables)).filter(([key]) => !missing.includes(key)).reverse());

    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", values) });
    const error = await expectError(res, 422, "missing_variables", `Missing required variables: ${missing.join(", ")}.`);
    expect(error.details).toEqual({ missing, invalid: [] });
  });

  test("a blank, a whitespace-only and a null value count as missing", async ({ request }) => {
    const v = await activeWithManyRequired();
    const [a, b, c] = required(v);
    const values = validValues(v.variables, { [a.key]: "", [b.key]: "   ", [c.key]: null });
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", values) });
    const error = await expectError(res, 422, "missing_variables", `Missing required variables: ${[a, b, c].map((x) => x.key).join(", ")}.`);
    expect(error.details).toEqual({ missing: [a.key, b.key, c.key], invalid: [] });
  });

  test("every type's wrong value is a 422 invalid_values that names the key and the type, and never the value", async ({ request }) => {
    const all = await versions();
    const covered: VariableType[] = [];
    for (const type of Object.keys(NOUNS) as VariableType[]) {
      const v = all.find((x) => x.state === "active" && x.variables.some((variable) => variable.type === type));
      if (!v) continue; // the seed has no variable of this type
      const variable = v.variables.find((x) => x.type === type)!;
      // A text variable is only ever wrong when it isn't a string; the others get an unmistakable string.
      const submitted = type === "text" ? JUNK.text : `${SENTINEL_TEXT}-${JUNK[type]}`;
      const channel = v.channels[0];
      const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, channel, validValues(v.variables, { [variable.key]: submitted })) });
      const error = await expectError(res, 422, "invalid_values", `${variable.key} must be ${NOUNS[type]}.`);
      expect(error.details, type).toEqual({ missing: [], invalid: [{ key: variable.key, expected: type }] });
      expect(JSON.stringify(error), `${type}: the error never contains the submitted value`).not.toContain(SENTINEL_TEXT);
      covered.push(type);
    }
    expect(covered, "at least the types the disclosures use").toEqual(expect.arrayContaining(["text", "percent", "currency", "date", "us_state"]));
  });

  test("a percentage given \"abc\" is named: purchase_apr must be a percentage, like 21.99.", async ({ request }) => {
    const v = pick(await versions(), "Active version with a required percent variable", (x) => x.state === "active" && x.variables.some((y) => y.type === "percent" && y.required));
    const percent = v.variables.find((x) => x.type === "percent" && x.required)!;
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, v.channels[0], validValues(v.variables, { [percent.key]: "abc" })) });
    const error = await expectError(res, 422, "invalid_values", `${percent.key} must be a percentage, like 21.99.`);
    expect(error.details).toEqual({ missing: [], invalid: [{ key: percent.key, expected: "percent" }] });
    expect(JSON.stringify(error)).not.toContain("abc");
  });

  test("several wrong values are each named, in the version's order", async ({ request }) => {
    const v = pick(await versions(), "Active version with two non-text variables", (x) => x.state === "active" && x.variables.filter((y) => y.type !== "text").length >= 2);
    const [a, b] = v.variables.filter((x) => x.type !== "text");
    // Submitted in reverse order, with the unmistakable string.
    const values = Object.fromEntries(
      Object.entries(validValues(v.variables, { [b.key]: `${SENTINEL_TEXT}-b`, [a.key]: `${SENTINEL_TEXT}-a` })).reverse(),
    );
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, v.channels[0], values) });
    const error = await expectError(res, 422, "invalid_values", `${a.key} must be ${NOUNS[a.type]}. ${b.key} must be ${NOUNS[b.type]}.`);
    expect(error.details).toEqual({
      missing: [],
      invalid: [
        { key: a.key, expected: a.type },
        { key: b.key, expected: b.type },
      ],
    });
    expect(JSON.stringify(error)).not.toContain(SENTINEL_TEXT);
  });

  test("missing and invalid together: the code is missing_variables and the message runs the missing sentence into the invalid ones", async ({ request }) => {
    const v = await activeWithManyRequired();
    const wrong = required(v).find((x) => x.type !== "text")!;
    const absent = required(v).find((x) => x.key !== wrong.key)!;
    const values = validValues(v.variables, { [wrong.key]: `${SENTINEL_TEXT}-wrong`, [absent.key]: undefined });
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", values) });
    const error = await expectError(res, 422, "missing_variables", `Missing required variables: ${absent.key}. ${wrong.key} must be ${NOUNS[wrong.type]}.`);
    expect(error.details).toEqual({ missing: [absent.key], invalid: [{ key: wrong.key, expected: wrong.type }] });
    expect(JSON.stringify(error)).not.toContain(SENTINEL_TEXT);
  });

  test("friendly forms (21.99%, New Jersey, 3/4/2027, $1,234.56) render exactly what the canonical ones do", async ({ request }) => {
    const v = await activeEverywhere();
    const FRIENDLY: Partial<Record<VariableType, string>> = {
      currency: "$1,234.56",
      percent: "21.99%",
      date: "3/4/2027",
      us_state: "New Jersey",
    };
    const friendly = Object.fromEntries(v.variables.map((x) => [x.key, FRIENDLY[x.type] ?? validValues([x])[x.key]]));
    const canonical = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", validValues(v.variables)) });
    const other = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", friendly) });
    expect(other.res.status()).toBe(200);
    expect(await other.res.text()).toBe(await canonical.res.text());
  });

  test("an optional variable can be left out, and keys the version doesn't have are ignored", async ({ request }) => {
    const v = pick(await versions(), "Active version with an optional variable", (x) => x.state === "active" && x.variables.some((y) => !y.required));
    const optional = v.variables.filter((x) => !x.required).map((x) => x.key);
    const values = Object.fromEntries(Object.entries(validValues(v.variables)).filter(([key]) => !optional.includes(key)));
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, v.channels[0], { ...values, not_a_variable: "ignored" }) });
    expect(res.status()).toBe(200);
  });

  test("a value of 1,000 characters renders exactly as sent; one more is a 422 invalid_values that names the limit, never the value", async ({ request }) => {
    const v = pick(await versions(), "Active web version with a text variable", (x) => rendersTo("web")(x) && x.variables.some((y) => y.type === "text"));
    const text = v.variables.find((x) => x.type === "text")!;
    // 1,000 characters, nearly twice as many UTF-16 units: the limit counts characters, so an emoji is one.
    const atLimit = `${SENTINEL_TEXT}${"😀".repeat(1000 - SENTINEL_TEXT.length - 1)}!`;
    expect([...atLimit]).toHaveLength(1000);

    const ok = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", validValues(v.variables, { [text.key]: atLimit })) });
    expect(ok.res.status()).toBe(200);
    expect(await ok.res.text()).toContain(atLimit);

    const cid = correlation("too-long");
    const { res } = await render(request, { templateId: v.templateId, correlationId: cid, body: bodyFor(v, "web", validValues(v.variables, { [text.key]: `${atLimit}!` })) });
    const error = await expectError(res, 422, "invalid_values", `${text.key} must be at most 1,000 characters.`);
    expect(error.details).toEqual({ missing: [], invalid: [{ key: text.key, expected: "text", maxLength: 1000 }] });
    expect(JSON.stringify(error)).not.toContain(SENTINEL_TEXT);
    expect(await logFor(db, cid)).toEqual([expect.objectContaining({ outcome: "error", error_code: "invalid_values" })]);
  });

  test("text in a value can't break out of the HTML", async ({ request }) => {
    const v = pick(await versions(), "Active web version with a text variable", (x) => rendersTo("web")(x) && x.variables.some((y) => y.type === "text"));
    const text = v.variables.find((x) => x.type === "text")!;
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "web", validValues(v.variables, { [text.key]: "<b>x</b>" })) });
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain("<b>x</b>");
  });
});

// ── 4. Channels ──────────────────────────────────────────────────────────────

test.describe("channels", () => {
  test("a channel the version doesn't have on is a 422 channel_not_enabled that lists the channels it has", async ({ request }) => {
    const v = pick(await versions(), "Active version without email", (x) => x.state === "active" && !x.channels.includes("email"));
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "email") });
    const enabled = ALL_CHANNELS.filter((c) => v.channels.includes(c));
    const error = await expectError(res, 422, "channel_not_enabled", `Version ${v.number} doesn't render to Email. Its channels are ${andList(enabled.map((c) => LABEL[c]))}.`);
    expect(error.details).toEqual({ channel: "email", channels: enabled });
  });

  test("a channel the content type doesn't allow is a 422 channel_not_allowed, ahead of the version's own channels", async ({ request }) => {
    const v = await activeEverywhere();
    const without = pick(await versions(), "Active version without email", (x) => x.state === "active" && !x.channels.includes("email"));
    const contentType = (await db.execute("SELECT id FROM content_types WHERE key = 'disclosure'")).rows[0];
    expect(contentType, "the disclosure content type").toBeTruthy();

    await withTemporarily(db, "content_types", String(contentType.id), { allowed_channels: JSON.stringify(["pdf", "web"]) }, async () => {
      // The version has email on; the content type no longer does.
      const blocked = await render(request, { templateId: v.templateId, body: bodyFor(v, "email") });
      const error = await expectError(blocked.res, 422, "channel_not_allowed", "Disclosures don't render to Email.");
      expect(error.details).toEqual({ channel: "email" });

      // A version that never had email on: still channel_not_allowed, because the content type is checked first.
      const never = await render(request, { templateId: without.templateId, body: bodyFor(without, "email") });
      await expectError(never.res, 422, "channel_not_allowed", "Disclosures don't render to Email.");

      // The channels it still allows are untouched.
      for (const channel of ["pdf", "web"] as const) {
        const ok = await render(request, { templateId: v.templateId, body: bodyFor(v, channel) });
        expect(ok.res.status(), channel).toBe(200);
      }
    });

    // Put back.
    const after = await render(request, { templateId: v.templateId, body: bodyFor(v, "email") });
    expect(after.res.status(), "email allowed again once the content type is restored").toBe(200);
  });

  test("an unknown channel name is a 400 bad_request", async ({ request }) => {
    const v = await activeEverywhere();
    for (const channel of ["fax", "PDF", "", 7, null]) {
      const { res } = await render(request, { templateId: v.templateId, body: { version: v.number, channel, values: validValues(v.variables) } });
      await expectError(res, 400, "bad_request", "channel must be one of pdf, web, email, push, sms.");
    }
  });
});

// ── 5. Version rules and request errors ──────────────────────────────────────

test.describe("version rules for consumers", () => {
  test("a Superseded version that isn't past its sunset still renders, and names the Active version", async ({ request }) => {
    const at = await demoNow(db);
    const superseded = (await versions()).filter((v) => v.state === "superseded" && v.activeNumber !== null && (v.sunsetAt === null || v.sunsetAt > at));
    expect(superseded.length, "the seed has Superseded versions that haven't sunset").toBeGreaterThan(0);
    for (const v of superseded) {
      const channel = v.channels.includes("web") ? "web" : v.channels[0];
      const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, channel) });
      expect(res.status(), `${v.templateId} v${v.number}`).toBe(200);
      expect(res.headers()["x-stencil-version"]).toBe(String(v.number));
      expect(res.headers()["x-stencil-newer-version"], `${v.templateId} v${v.number}`).toBe(String(v.activeNumber));
    }
  });

  test("the same on the email channel: the JSON has newerVersion", async ({ request }) => {
    const at = await demoNow(db);
    const v = pick(await versions(), "Superseded version that hasn't sunset", (x) => x.state === "superseded" && x.activeNumber !== null && (x.sunsetAt === null || x.sunsetAt > at));
    // The seed's Superseded versions don't have Email on; turn it on for this test.
    await withTemporarily(db, "versions", v.id, { channels: JSON.stringify(["pdf", "web", "email"]) }, async () => {
      const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "email") });
      expect(res.status()).toBe(200);
      expect(res.headers()["x-stencil-newer-version"]).toBe(String(v.activeNumber));
      const body = await res.json();
      expect(body.newerVersion).toBe(v.activeNumber);
      expect(typeof body.subject).toBe("string");
    });
  });

  test("a Superseded version past its sunset is a 410 version_sunset", async ({ request }) => {
    const at = await demoNow(db);
    // A sunset the seed already passed, when it has one. The message names its day in the business
    // time zone (Eastern, the default).
    const seeded = (await versions()).filter((v) => v.state === "superseded" && v.sunsetAt !== null && v.sunsetAt <= at);
    for (const v of seeded) {
      const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, v.channels[0]) });
      const day = sunsetDay(new Date(v.sunsetAt!), "America/New_York");
      await expectError(res, 410, "version_sunset", `Version ${v.number} was sunset on ${longDate(`${day}T00:00:00Z`)}. ${activeSentence(v.activeNumber, "No version is active.")}`);
    }

    // And one set here: March 1, 2020, which ends at 00:00 Eastern (05:00 UTC).
    const v = pick(await versions(), "Superseded version with an Active successor and no sunset", (x) => x.state === "superseded" && x.activeNumber !== null && x.sunsetAt === null);
    const sunset = sunsetInstant("2020-03-01", "America/New_York").getTime();
    await withTemporarily(db, "versions", v.id, { sunset_at: sunset }, async () => {
      const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, v.channels[0]) });
      const error = await expectError(res, 410, "version_sunset", `Version ${v.number} was sunset on March 1, 2020. Version ${v.activeNumber} is active.`);
      expect(error.details).toEqual({ version: v.number, activeVersion: v.activeNumber, at: "2020-03-01T05:00:00.000Z" });
    });
  });

  test("a revoked version is a 410 version_revoked that gives the date and the Active version", async ({ request }) => {
    const v = pick(await versions(), "revoked version", (x) => x.state === "revoked");
    expect(v.revokedAt, "a confirmed revoke").toBeTruthy();
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, v.channels[0]) });
    const error = await expectError(
      res,
      410,
      "version_revoked",
      `Version ${v.number} was revoked on ${longDate(v.revokedAt!)}. ${activeSentence(v.activeNumber, "No version is active.")}`,
    );
    expect(error.details).toEqual({ version: v.number, activeVersion: v.activeNumber, at: new Date(v.revokedAt!).toISOString() });
  });

  test("a version in review is a 409 version_not_released", async ({ request }) => {
    const v = pick(await versions(), "version in review", (x) => x.state === "in_review");
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, v.channels[0]) });
    const error = await expectError(res, 409, "version_not_released", `Version ${v.number} is in review. ${activeSentence(v.activeNumber, "No version is active yet.")}`);
    expect(error.details).toEqual({ version: v.number, activeVersion: v.activeNumber });
  });

  test("a version sent back for changes is a 409 too, and says so when nothing is active yet", async ({ request }) => {
    // Its latest round: a round sent back before a later one isn't what its number means (decision 0033).
    const v = pick(await versions(), "version whose latest round was sent back for changes", (x) => x.state === "changes_requested" && x.head);
    const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, v.channels[0]) });
    const error = await expectError(res, 409, "version_not_released", `Version ${v.number} was sent back for changes. ${activeSentence(v.activeNumber, "No version is active yet.")}`);
    expect(error.details).toEqual({ version: v.number, activeVersion: v.activeNumber });
  });

  test("a number whose round was sent back and whose next round is in review answers for the round in review, naming no round", async ({ request }) => {
    const all = await versions();
    const sentBack = pick(all, "round sent back with a later round in review", (x) =>
      x.state === "changes_requested" && !x.head && all.some((y) => y.templateId === x.templateId && y.number === x.number && y.head && y.state === "in_review"),
    );
    const { res } = await render(request, { templateId: sentBack.templateId, body: bodyFor(sentBack, sentBack.channels[0]) });
    const error = await expectError(res, 409, "version_not_released", `Version ${sentBack.number} is in review. ${activeSentence(sentBack.activeNumber, "No version is active yet.")}`);
    expect(error.details).toEqual({ version: sentBack.number, activeVersion: sentBack.activeNumber });
    expect(JSON.stringify(error), "a consumer never sees a round").not.toMatch(/round/i);
  });

  test("a version number the template doesn't have is a 404 version_not_found", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: v.templateId, body: { version: 9999, channel: "web", values: validValues(v.variables) } });
    await expectError(res, 404, "version_not_found", `Template ${v.templateId} has no version 9999.`);
  });

  test("a template that doesn't exist is a 404 template_not_found", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: "UC-ZZZZZZ", body: { version: 1, channel: "web", values: validValues(v.variables) } });
    await expectError(res, 404, "template_not_found", "Template UC-ZZZZZZ doesn't exist.");
  });

  test("\"draft\" without preview is a 400 bad_request", async ({ request }) => {
    const v = pick(await versions(), "open draft", (x) => x.state === "draft");
    const { res } = await render(request, { templateId: v.templateId, body: { version: "draft", channel: "web", values: validValues(v.variables) } });
    await expectError(res, 400, "bad_request", "version must be a version number.");
    const explicit = await render(request, { templateId: v.templateId, body: { version: "draft", channel: "web", values: validValues(v.variables), preview: false } });
    await expectError(explicit.res, 400, "bad_request", "version must be a version number.");
  });

  test("no X-Consumer-Id is a 400 consumer_required", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: v.templateId, consumer: null, body: bodyFor(v, "web") });
    await expectError(res, 400, "consumer_required", "X-Consumer-Id is required.");
  });

  test("an unknown consumer is a 403 unknown_consumer", async ({ request }) => {
    const v = await activeEverywhere();
    const { res } = await render(request, { templateId: v.templateId, consumer: "acme", body: bodyFor(v, "web") });
    await expectError(res, 403, "unknown_consumer", `Consumer "acme" isn't registered.`);
  });
});

test.describe("a malformed request is a 400 bad_request", () => {
  const BODY = "The body must be JSON with version, channel and values.";

  test("the body", async ({ request }) => {
    const v = await activeEverywhere();
    const values = validValues(v.variables);
    const cases: Array<[string, unknown, string]> = [
      ["not JSON", "this is not json", BODY],
      ["an array", [], BODY],
      ["no version", { channel: "web", values }, BODY],
      ["no channel", { version: v.number, values }, BODY],
      ["no values", { version: v.number, channel: "web" }, BODY],
      ["a version as a string", { version: String(v.number), channel: "web", values }, "version must be a version number."],
      ["version 0", { version: 0, channel: "web", values }, "version must be a version number."],
      ["a fractional version", { version: 1.5, channel: "web", values }, "version must be a version number."],
      ["values as an array", { version: v.number, channel: "web", values: [] }, "values must be an object."],
      ["values as a string", { version: v.number, channel: "web", values: "x" }, "values must be an object."],
      ["an encoding that isn't base64", { version: v.number, channel: "web", values, encoding: "gzip" }, "encoding must be base64."],
      ["preview that isn't a boolean", { version: v.number, channel: "web", values, preview: "yes" }, "preview must be true or false."],
    ];
    for (const [what, body, message] of cases) {
      const { res } = await render(request, { templateId: v.templateId, body });
      await expectError(res, 400, "bad_request", message).catch((reason) => {
        throw new Error(`${what}: ${reason instanceof Error ? reason.message : reason}`);
      });
    }
  });
});

test.describe("a body over 1,000,000 bytes is a 413 body_too_large", () => {
  const LIMIT = 1_000_000;
  const TOO_LARGE = "The body must be at most 1,000,000 bytes.";

  test("declared by Content-Length: one byte over is refused, a body at the limit renders", async ({ request }) => {
    const v = await activeEverywhere();
    const json = JSON.stringify(bodyFor(v, "web"));
    const over = await render(request, { templateId: v.templateId, body: json + " ".repeat(LIMIT - json.length + 1) });
    await expectError(over.res, 413, "body_too_large", TOO_LARGE);
    const at = await render(request, { templateId: v.templateId, body: json + " ".repeat(LIMIT - json.length) });
    expect(at.res.status()).toBe(200);
  });

  test("sent chunked, with no Content-Length: refused once the count passes the limit, and the rest is never read", async ({ baseURL }) => {
    const v = await activeEverywhere();
    // Up to 64 MB of spaces in 1 MB chunks; sending stops when the answer comes.
    const sent = await postChunked(new URL(`/api/v1/templates/${v.templateId}/render`, baseURL), {
      headers: { "Content-Type": "application/json", "X-Consumer-Id": "coral" },
      megabytes: 64,
      fill: 0x20,
    });
    expect(sent.status).toBe(413);
    expect(JSON.parse(sent.body)).toEqual({ error: { code: "body_too_large", message: TOO_LARGE } });
    expect(sent.sentMb).toBeLessThan(64);
  });
});

// ── 6. Previews ──────────────────────────────────────────────────────────────

const PERSONA_CAN_SEE = "maya"; // Coral Offers author
const PERSONA_CANNOT_SEE_DEPOSITS = "maya";
const PERSONA_WITH_NO_TEAM = "morgan";

test.describe("previews", () => {
  test("a draft previews as the persona and is tagged a preview", async ({ playwright, baseURL }) => {
    const draft = pick(await versions(), "open draft in Coral Offers with web on", (v) => v.state === "draft" && v.teamId === "coral-offers" && v.channels.includes("web"));
    const cid = correlation("preview-draft");
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      // The consumer header is ignored on a preview, even one that names nobody registered.
      const { res } = await render(request, {
        templateId: draft.templateId,
        correlationId: cid,
        consumer: "acme",
        body: { version: "draft", channel: "web", values: validValues(draft.variables), preview: true },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("text/html; charset=utf-8");
      expect(res.headers()["x-stencil-preview"]).toBe("true");
      expect(res.headers()["x-stencil-version"]).toBe("draft");
      expect(res.headers()["x-stencil-template-id"]).toBe(draft.templateId);
      expect(res.headers()["cache-control"]).toBe("no-store");
      expect(res.headers()["x-correlation-id"]).toBe(cid);
      expect(await res.text()).toMatch(/<!doctype html>/i);
    });

    const rows = await logFor(db, cid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      template_id: draft.templateId,
      version_id: draft.id,
      version_number: null,
      channel: "web",
      is_preview: 1,
      consumer_id: null,
      outcome: "ok",
      error_code: null,
    });
  });

  test("a draft's PDF preview is named for the draft", async ({ playwright, baseURL }) => {
    const draft = pick(await versions(), "open draft in Coral Offers with pdf on", (v) => v.state === "draft" && v.teamId === "coral-offers" && v.channels.includes("pdf"));
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      const { res } = await render(request, {
        templateId: draft.templateId,
        consumer: null,
        body: { version: "draft", channel: "pdf", values: validValues(draft.variables), preview: true },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("application/pdf");
      expect(res.headers()["content-disposition"]).toBe(`inline; filename="${draft.templateId}-draft.pdf"`);
      expect(res.headers()["x-stencil-preview"]).toBe("true");
      expect(pdfMagic(await res.body())).toBe("%PDF");
    });
  });

  test("any state previews: in review, revoked and Superseded skip the version rules", async ({ playwright, baseURL }) => {
    const all = await versions();
    const unreleased = [
      pick(all, "Coral Offers version in review", (v) => v.state === "in_review" && v.teamId === "coral-offers"),
      pick(all, "Coral Offers revoked version", (v) => v.state === "revoked" && v.teamId === "coral-offers"),
      pick(all, "Coral Offers Superseded version with an Active successor", (v) => v.state === "superseded" && v.teamId === "coral-offers" && v.activeNumber !== null),
    ];
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      for (const v of unreleased) {
        const cid = correlation(`preview-${v.state}`);
        const { res } = await render(request, {
          templateId: v.templateId,
          consumer: null,
          correlationId: cid,
          body: bodyFor(v, v.channels[0], validValues(v.variables), { preview: true }),
        });
        expect(res.status(), v.state).toBe(200);
        expect(res.headers()["x-stencil-preview"], v.state).toBe("true");
        expect(res.headers()["x-stencil-version"], v.state).toBe(String(v.number));
        // A Superseded version still points to the version that replaced it.
        expect(res.headers()["x-stencil-newer-version"], v.state).toBe(v.state === "superseded" ? String(v.activeNumber) : undefined);
        expect((await logFor(db, cid))[0], v.state).toMatchObject({ is_preview: 1, consumer_id: null, outcome: "ok" });
      }
    });
  });

  test("a preview still checks the version's channels and the values", async ({ playwright, baseURL }) => {
    const draft = pick(await versions(), "open draft in Coral Offers without email", (v) => v.state === "draft" && v.teamId === "coral-offers" && !v.channels.includes("email"));
    const enabled = ALL_CHANNELS.filter((c) => draft.channels.includes(c));
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      const notEnabled = await render(request, {
        templateId: draft.templateId,
        consumer: null,
        body: { version: "draft", channel: "email", values: validValues(draft.variables), preview: true },
      });
      await expectError(notEnabled.res, 422, "channel_not_enabled", `This draft doesn't render to Email. Its channels are ${andList(enabled.map((c) => LABEL[c]))}.`);

      const missing = await render(request, {
        templateId: draft.templateId,
        consumer: null,
        body: { version: "draft", channel: "web", values: {}, preview: true },
      });
      await expectError(missing.res, 422, "missing_variables", `Missing required variables: ${required(draft).map((x) => x.key).join(", ")}.`);
    });
  });

  test("a persona who can't see the template's team gets a 403 preview_forbidden, and it is logged as a preview", async ({ playwright, baseURL }) => {
    const all = await versions();
    const deposits = pick(all, "open draft in Deposits", (v) => v.state === "draft" && v.teamId === "deposits");
    const coral = pick(all, "open draft in Coral Offers", (v) => v.state === "draft" && v.teamId === "coral-offers");

    for (const [persona, draft] of [
      [PERSONA_CANNOT_SEE_DEPOSITS, deposits],
      [PERSONA_WITH_NO_TEAM, coral],
    ] as const) {
      const cid = correlation(`forbidden-${persona}`);
      await asPersona(playwright, baseURL!, persona, async (request) => {
        const { res } = await render(request, {
          templateId: draft.templateId,
          consumer: null,
          correlationId: cid,
          body: { version: "draft", channel: "web", values: validValues(draft.variables), preview: true },
        });
        await expectError(res, 403, "preview_forbidden", "You can't preview this template.");
        expect(res.headers()["x-stencil-preview"]).toBeUndefined();
      });
      const rows = await logFor(db, cid);
      expect(rows, persona).toHaveLength(1);
      expect(rows[0], persona).toMatchObject({ is_preview: 1, consumer_id: null, outcome: "error", error_code: "preview_forbidden" });
    }
  });

  test("the persona cookie has no say in a consumer render", async ({ playwright, baseURL }) => {
    const v = pick(await versions(), "Active Deposits version", (x) => x.state === "active" && x.teamId === "deposits" && x.channels.includes("web"));
    await asPersona(playwright, baseURL!, PERSONA_CANNOT_SEE_DEPOSITS, async (request) => {
      const { res } = await render(request, { templateId: v.templateId, body: bodyFor(v, "web") });
      expect(res.status()).toBe(200);
      expect(res.headers()["x-stencil-preview"]).toBeUndefined();
    });
  });

  test("a consumer render of a draft is refused even with the persona cookie", async ({ playwright, baseURL }) => {
    const draft = pick(await versions(), "open draft in Coral Offers", (v) => v.state === "draft" && v.teamId === "coral-offers");
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      const { res } = await render(request, { templateId: draft.templateId, body: { version: "draft", channel: "web", values: validValues(draft.variables) } });
      await expectError(res, 400, "bad_request", "version must be a version number.");
    });
  });
});

// ── 7. render_log ────────────────────────────────────────────────────────────

test.describe("render_log", () => {
  test("a successful consumer render writes exactly one row, ok, for that consumer", async ({ request }) => {
    const v = await activeEverywhere();
    for (const channel of ALL_CHANNELS) {
      const cid = correlation(`log-ok-${channel}`);
      const { res } = await render(request, { templateId: v.templateId, correlationId: cid, consumer: "deposits-online", body: bodyFor(v, channel) });
      expect(res.status(), channel).toBe(200);
      const rows = await logFor(db, cid);
      expect(rows, channel).toHaveLength(1);
      expect(rows[0], channel).toMatchObject({
        template_id: v.templateId,
        version_id: v.id,
        version_number: v.number,
        consumer_id: "deposits-online",
        channel,
        is_preview: 0,
        correlation_id: cid,
        outcome: "ok",
        error_code: null,
      });
      expect(Number(rows[0].duration_ms), channel).toBeGreaterThanOrEqual(0);
      expect(Number(rows[0].at), channel).toBeGreaterThan(0);
    }
  });

  test("a failed render writes one row, error, with the error code", async ({ request }) => {
    const all = await versions();
    const active = await activeEverywhere();
    const withoutEmail = pick(all, "Active version without email", (v) => v.state === "active" && !v.channels.includes("email"));
    const revoked = pick(all, "revoked version", (v) => v.state === "revoked");
    const inReview = pick(all, "version in review", (v) => v.state === "in_review");
    const wrong = required(active).find((x) => x.type !== "text")!;

    const cases: Array<{ what: string; templateId: string; version: SeedVersion; body: unknown; status: number; code: string }> = [
      { what: "invalid", templateId: active.templateId, version: active, status: 422, code: "invalid_values", body: bodyFor(active, "web", validValues(active.variables, { [wrong.key]: JUNK[wrong.type] })) },
      { what: "missing", templateId: active.templateId, version: active, status: 422, code: "missing_variables", body: bodyFor(active, "web", {}) },
      { what: "channel not enabled", templateId: withoutEmail.templateId, version: withoutEmail, status: 422, code: "channel_not_enabled", body: bodyFor(withoutEmail, "email") },
      { what: "revoked", templateId: revoked.templateId, version: revoked, status: 410, code: "version_revoked", body: bodyFor(revoked, revoked.channels[0]) },
      { what: "in review", templateId: inReview.templateId, version: inReview, status: 409, code: "version_not_released", body: bodyFor(inReview, inReview.channels[0]) },
    ];
    for (const c of cases) {
      const cid = correlation(`log-${c.code}`);
      const { res } = await render(request, { templateId: c.templateId, correlationId: cid, body: c.body });
      await expectError(res, c.status, c.code);
      const rows = await logFor(db, cid);
      expect(rows, c.what).toHaveLength(1);
      expect(rows[0], c.what).toMatchObject({
        template_id: c.version.templateId,
        version_id: c.version.id,
        version_number: c.version.number,
        consumer_id: "coral",
        is_preview: 0,
        outcome: "error",
        error_code: c.code,
      });
    }
  });

  test("a request that never reached a known template and version isn't logged", async ({ request }) => {
    const all = await versions();
    const v = await activeEverywhere();
    const draft = pick(all, "open draft", (x) => x.state === "draft");
    const hasDraft = new Set(all.filter((x) => x.state === "draft").map((x) => x.templateId));
    const noDraft = pick(all, "Active version on a template with no open draft", (x) => x.state === "active" && !hasDraft.has(x.templateId));
    const values = validValues(v.variables);
    const cases: Array<[string, Parameters<typeof render>[1]]> = [
      ["unknown template", { templateId: "UC-ZZZZZZ", body: { version: 1, channel: "web", values } }],
      ["unknown version", { templateId: v.templateId, body: { version: 9999, channel: "web", values } }],
      ["no open draft", { templateId: noDraft.templateId, body: { version: "draft", channel: "web", values: validValues(noDraft.variables), preview: true } }],
      ["malformed body", { templateId: v.templateId, body: { version: v.number, channel: "fax", values } }],
      ["draft without preview", { templateId: draft.templateId, body: { version: "draft", channel: "web", values } }],
      ["no consumer", { templateId: v.templateId, consumer: null, body: bodyFor(v, "web") }],
    ];
    for (const [what, call] of cases) {
      const cid = correlation("log-none");
      const { res } = await render(request, { ...call, correlationId: cid });
      expect(res.status(), what).toBeGreaterThanOrEqual(400);
      expect(await logFor(db, cid), what).toHaveLength(0);
    }
  });

  test("the table has exactly the expected columns, and none for values", async () => {
    const { rows } = await db.execute("PRAGMA table_info(render_log)");
    expect(rows.map((r) => String(r.name)).sort()).toEqual([...LOG_COLUMNS].sort());
  });

  test("no variable value, raw or formatted, is ever in render_log", async ({ request, playwright, baseURL }) => {
    // Values that can't be mistaken for anything else, per type. The formatted forms are what the
    // renderer prints ("$98,765.43", "87.65%", "July 19, 2031"), so they count too. (A bare digit
    // run like the number's 7654321 could turn up inside a timestamp, so only its formatted form is searched for.)
    const SENTINEL_VALUE: Record<VariableType, string> = {
      text: SENTINEL_TEXT,
      currency: "98765.43",
      percent: "87.65",
      date: "2031-07-19",
      number: "7654321",
      us_state: "NJ",
    };
    const SENTINELS = [SENTINEL_TEXT, "Zyxwvut", "98765.43", "98,765.43", "$98,765.43", "87.65", "87.65%", "2031-07-19", "July 19, 2031", "7,654,321"];
    const sentinelValues = (variables: readonly Variable[], overrides: Record<string, unknown> = {}) => ({
      ...Object.fromEntries(variables.map((x) => [x.key, SENTINEL_VALUE[x.type]])),
      ...overrides,
    });

    const all = await versions();
    // The deposits disclosure has a currency variable; the Coral one is a second template. Prefer both.
    const withCurrency = pick(all, "Active version with all channels and a currency variable", (v) => rendersToAll(v) && v.variables.some((x) => x.type === "currency"));
    const other = pick(all, "second Active version", (v) => v.state === "active" && v.templateId !== withCurrency.templateId && v.channels.includes("web"));
    const draft = pick(all, "open draft in Coral Offers with web on", (v) => v.state === "draft" && v.teamId === "coral-offers" && v.channels.includes("web"));
    const wrongOnWithCurrency = required(withCurrency).find((x) => x.type !== "text")!;
    const wrongOnDraft = required(draft).find((x) => x.type !== "text")!;
    const [absent1, absent2] = required(other);

    interface Sent {
      what: string;
      cid: string;
      status: number;
    }
    const sent: Sent[] = [];
    const send = async (what: string, call: Parameters<typeof render>[1], status: number, context = request) => {
      const cid = correlation(`sentinel-${what.replace(/\W+/g, "-")}`);
      const { res } = await render(context, { ...call, correlationId: cid });
      expect(res.status(), what).toBe(status);
      sent.push({ what, cid, status });
      return res;
    };

    // ok, in each channel and with base64
    const values = sentinelValues(withCurrency.variables);
    const pdf = await send("ok pdf", { templateId: withCurrency.templateId, body: bodyFor(withCurrency, "pdf", values) }, 200);
    expect(pdfMagic(await pdf.body())).toBe("%PDF");
    const web = await send("ok web", { templateId: withCurrency.templateId, body: bodyFor(withCurrency, "web", values) }, 200);
    // The values did go through the renderer: this is not a test of a request that never rendered.
    expect(await web.text()).toContain(SENTINEL_TEXT);
    const email = await send("ok email", { templateId: withCurrency.templateId, body: bodyFor(withCurrency, "email", values) }, 200);
    expect(JSON.stringify(await email.json())).toContain(SENTINEL_TEXT);
    await send("ok web base64", { templateId: withCurrency.templateId, body: bodyFor(withCurrency, "web", values, { encoding: "base64" }) }, 200);
    await send("ok email base64", { templateId: withCurrency.templateId, body: bodyFor(withCurrency, "email", values, { encoding: "base64" }) }, 200);
    await send("ok other template", { templateId: other.templateId, body: bodyFor(other, "web", sentinelValues(other.variables)) }, 200);

    // invalid: one value wrong, the rest sentinels
    await send(
      "invalid",
      { templateId: withCurrency.templateId, body: bodyFor(withCurrency, "web", sentinelValues(withCurrency.variables, { [wrongOnWithCurrency.key]: `${SENTINEL_TEXT}-wrong` })) },
      422,
    );

    // missing: two required keys left out, the rest sentinels
    const missingValues = sentinelValues(other.variables);
    delete missingValues[absent1.key];
    delete missingValues[absent2.key];
    await send("missing", { templateId: other.templateId, body: bodyFor(other, "web", missingValues) }, 422);

    // not released, with sentinels in the request
    const inReview = pick(all, "version in review", (v) => v.state === "in_review");
    await send("in review", { templateId: inReview.templateId, body: bodyFor(inReview, inReview.channels[0], sentinelValues(inReview.variables)) }, 409);

    // previews, ok and invalid
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (preview) => {
      await send(
        "preview ok",
        { templateId: draft.templateId, consumer: null, body: { version: "draft", channel: "web", values: sentinelValues(draft.variables), preview: true } },
        200,
        preview,
      );
      await send(
        "preview invalid",
        {
          templateId: draft.templateId,
          consumer: null,
          body: { version: "draft", channel: "web", values: sentinelValues(draft.variables, { [wrongOnDraft.key]: `${SENTINEL_TEXT}-wrong` }), preview: true },
        },
        422,
        preview,
      );
    });

    // Every row these requests wrote: one each, with exactly the expected columns, and no sentinel in any of them.
    for (const { what, cid } of sent) {
      const rows = await logFor(db, cid);
      expect(rows, `${what}: one row`).toHaveLength(1);
      expect(Object.keys(rows[0]).sort(), `${what}: the columns`).toEqual([...LOG_COLUMNS].sort());
      const everything = JSON.stringify(Object.values(rows[0]));
      for (const sentinel of SENTINELS) {
        expect(everything, `${what}: render_log row contains ${sentinel}`).not.toContain(sentinel);
      }
    }

    // And nowhere in the table: every column of every row, matched as text.
    const { rows: columns } = await db.execute("PRAGMA table_info(render_log)");
    const asText = columns.map((c) => `coalesce(cast("${String(c.name)}" as text), '')`).join(" || ' ' || ");
    for (const sentinel of SENTINELS) {
      const { rows } = await db.execute({ sql: `SELECT count(*) AS n FROM render_log WHERE instr(${asText}, ?) > 0`, args: [sentinel] });
      expect(Number(rows[0].n), `rows in render_log containing ${sentinel}`).toBe(0);
    }
  });
});

// ── 8. Alerts: Push and SMS ──────────────────────────────────────────────────

test.describe("alerts", () => {
  test("the seeded Active alert renders a push for each platform, and an SMS with its footer, all as JSON", async ({ request }) => {
    const v = pick(await allVersions(db), "Active alert with push and SMS on", (x) => x.state === "active" && x.channels.includes("push") && x.channels.includes("sms"));
    const values = validValues(v.variables, { first_name: "Maya", card_last4: "4821" });
    const json = async (body: object) => {
      const { res, correlationId } = await render(request, { templateId: v.templateId, body: { version: v.number, values, ...body } });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/^application\/json/);
      expect(res.headers()["x-stencil-version"]).toBe(String(v.number));
      expect((await logFor(db, correlationId!))[0]).toMatchObject({ outcome: "ok", channel: "channel" in body ? body.channel : null, consumer_id: "coral" });
      return (await res.json()) as Record<string, unknown>;
    };

    // One message for both phones; the subtitle is the iPhone's alone, and no title carries a value.
    const ios = await json({ channel: "push", platform: "ios" });
    const android = await json({ channel: "push", platform: "android" });
    expect(ios).toMatchObject({ title: "Your payment is due soon", subtitle: "Coral card ending in 4821" });
    expect(ios.body).toBe("Hi Maya, your minimum payment of $1,234.56 is due March 4, 2027. Pay in the app to avoid a late fee.");
    expect(android).toMatchObject({ title: ios.title, body: ios.body });
    expect(android).not.toHaveProperty("subtitle");
    for (const push of [ios, android]) expect(push.payloadBytes).toEqual(expect.any(Number));

    const sms = await json({ channel: "sms" });
    expect(sms).toMatchObject({
      text: "Coral: Your minimum payment of $1,234.56 is due March 4, 2027.\nPay at coral.example/pay\nCoral: Reply STOP to opt out, HELP for help.",
      encoding: "GSM-7",
      parts: 1,
    });
    expect(sms.characters).toBe((sms.text as string).length);
  });
});
