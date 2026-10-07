import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Base64ResponseBody, EmailResponseBody, RenderErrorBody } from "@/domain/render/types";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { contentTypes, renderLog, versions } from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { getViewer } from "@/server/viewer";
import { POST } from "./route";

// The route end to end: HTTP in, the real pipeline and adapters, a temporary database filled by the
// real seed, HTTP out. Only the database handle, the demo clock and the persona are swapped.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/server/db/schema/ucomp");
  env.dir = mkdtempSync(join(tmpdir(), "ucomp-render-route-"));
  const url = `file:${join(env.dir, "route.db")}`;
  const libsql = createClient({ url });
  return { DATABASE_URL: url, libsql, db: drizzle(libsql, { schema }) };
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

let db: Db;
let libsql: Client;
let ids: Record<string, string>;

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: env.now })).templates;
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

const persona = (userId: string, teamIds: string[]): Viewer => ({
  userId,
  name: userId,
  initials: userId.slice(0, 2).toUpperCase(),
  title: "Tester",
  platformRole: null,
  memberships: teamIds.map((teamId) => ({ teamId, teamSlug: teamId, teamName: teamId, roles: ["author"], status: "active" })),
});
const maya = persona("maya", ["coral-offers"]);
const morgan = persona("morgan", []);

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(maya);
});

const CUSTOMER = { first_name: "Maya", last_name: "Chen", purchase_apr: "21.99", home_state: "NJ" };
const CORAL = { "X-Consumer-Id": "coral" };

function post(template: string, body: unknown, headers: Record<string, string> = CORAL) {
  const templateId = ids[template] ?? template;
  const request = new Request(`http://localhost/api/v1/templates/${templateId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as NextRequest;
  return POST(request, { params: Promise.resolve({ templateId }) });
}

async function expectError(res: Response, status: number, code: string, message?: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Correlation-Id")).toBeTruthy();
  const body = (await res.json()) as RenderErrorBody;
  expect(body.error.code).toBe(code);
  if (message !== undefined) expect(body.error.message).toBe(message);
  return body.error;
}

const logRows = (correlationId: string) =>
  db.select().from(renderLog).where(eq(renderLog.correlationId, correlationId));

// ── Success, per channel ─────────────────────────────────────────────────────

describe("POST /api/v1/templates/[templateId]/render: channels", () => {
  it("web: a text/html document with the X-Stencil headers", async () => {
    const res = await post("balance-transfer", { version: 2, channel: "web", values: CUSTOMER }, { ...CORAL, "X-Correlation-Id": "abc-123" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Correlation-Id")).toBe("abc-123");
    expect(res.headers.get("X-Stencil-Template-Id")).toBe(ids["balance-transfer"]);
    expect(res.headers.get("X-Stencil-Version")).toBe("2");
    expect(res.headers.get("X-Stencil-Newer-Version")).toBeNull();
    expect(res.headers.get("X-Stencil-Preview")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("21.99%");
  });

  it("pdf: application/pdf bytes, inline, with the version's filename", async () => {
    const res = await post("balance-transfer", { version: 2, channel: "pdf", values: CUSTOMER });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="${ids["balance-transfer"]}-v2.pdf"`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  }, 30_000);

  it("email: JSON with subject, preheader, html, text and the newer-version flag", async () => {
    const res = await post("rate-change-notice", {
      version: 1,
      channel: "email",
      values: { ...CUSTOMER, effective_date: "3/4/2027" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    const body = (await res.json()) as EmailResponseBody;
    expect(Object.keys(body).sort()).toEqual(["html", "newerVersion", "preheader", "subject", "text"]);
    expect(body.subject).toBe("Your purchase APR is changing on March 4, 2027");
    expect(body.newerVersion).toBeNull();
    expect(body.html).toContain("<!doctype html>");
    expect(body.text).toContain("Hi Maya");
  });
});

describe("POST …/render: base64 opt-in", () => {
  it("pdf comes back as a JSON envelope", async () => {
    const res = await post("balance-transfer", { version: 2, channel: "pdf", values: CUSTOMER, encoding: "base64" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    const body = (await res.json()) as Base64ResponseBody;
    expect(body).toMatchObject({ channel: "pdf", contentType: "application/pdf", encoding: "base64", newerVersion: null });
    expect(Buffer.from(body.data, "base64").subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 30_000);

  it("web comes back as a JSON envelope of the UTF-8 document", async () => {
    const res = await post("balance-transfer", { version: 2, channel: "web", values: CUSTOMER, encoding: "base64" });
    const body = (await res.json()) as Base64ResponseBody;
    expect(body).toMatchObject({ channel: "web", contentType: "text/html; charset=utf-8", encoding: "base64" });
    const html = Buffer.from(body.data, "base64").toString("utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("—"); // non-ASCII survives the round trip (the title has an em dash)
  });

  it("email base64-encodes html and text, and says so", async () => {
    const res = await post("rate-change-notice", {
      version: 1,
      channel: "email",
      values: { ...CUSTOMER, effective_date: "2027-03-04" },
      encoding: "base64",
    });
    const body = (await res.json()) as EmailResponseBody;
    expect(body.encoding).toBe("base64");
    expect(body.subject).toBe("Your purchase APR is changing on March 4, 2027");
    expect(Buffer.from(body.html, "base64").toString("utf8")).toContain("<!doctype html>");
    expect(Buffer.from(body.text, "base64").toString("utf8")).toContain("Hi Maya");
  });
});

describe("POST …/render: superseded versions", () => {
  it("a Superseded version renders with X-Stencil-Newer-Version", async () => {
    const res = await post("balance-transfer", { version: 1, channel: "web", values: CUSTOMER });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stencil-Version")).toBe("1");
    expect(res.headers.get("X-Stencil-Newer-Version")).toBe("2");
  });

  it("the email JSON carries newerVersion too", async () => {
    // No seeded Superseded version has email on, so turn it on for this one.
    const id = ids["high-yield-savings"]!;
    const where = and(eq(versions.templateId, id), eq(versions.number, 1));
    const [v1] = await db.select().from(versions).where(where);
    const subject = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Your savings rate" }] }] };
    await db.update(versions).set({ channels: ["pdf", "web", "email"], emailSubject: subject }).where(where);
    try {
      const values = Object.fromEntries(v1!.variables.map((v) => [v.key, v.sample]));
      const res = await post("high-yield-savings", { version: 1, channel: "email", values }, { "X-Consumer-Id": "deposits-online" });
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Stencil-Newer-Version")).toBe("2");
      const body = (await res.json()) as EmailResponseBody;
      expect(body).toMatchObject({ subject: "Your savings rate", preheader: "", newerVersion: 2 });
    } finally {
      await db.update(versions).set({ channels: v1!.channels, emailSubject: v1!.emailSubject }).where(where);
    }
  });

  it("a Superseded version past its sunset is 410 with what happened and which version is active", async () => {
    const saved = env.now;
    env.now = new Date(saved.getTime() + 22 * 86_400_000);
    try {
      const res = await post("balance-transfer", { version: 1, channel: "web", values: CUSTOMER });
      const error = await expectError(res, 410, "version_sunset");
      expect(error.message).toMatch(/^Version 1 was sunset on \w+ \d+, \d{4}\. Version 2 is active\.$/);
    } finally {
      env.now = saved;
    }
  });
});

describe("POST …/render: previews", () => {
  it("previews the open draft as the persona, tagged in the headers and in render_log", async () => {
    const res = await post(
      "annual-fee-waiver",
      { version: "draft", channel: "pdf", values: CUSTOMER, preview: true },
      { "X-Correlation-Id": "preview-1", "X-Consumer-Id": "coral" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stencil-Version")).toBe("draft");
    expect(res.headers.get("X-Stencil-Preview")).toBe("true");
    expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="${ids["annual-fee-waiver"]}-draft.pdf"`);
    expect(getViewer).toHaveBeenCalledTimes(1);
    expect(await logRows("preview-1")).toEqual([
      expect.objectContaining({ isPreview: true, consumerId: null, versionNumber: null, channel: "pdf", outcome: "ok" }),
    ]);
  }, 30_000);

  it("doesn't need X-Consumer-Id", async () => {
    const res = await post("balance-transfer", { version: 2, channel: "web", values: CUSTOMER, preview: true }, {});
    expect(res.status).toBe(200);
  });

  it("is forbidden (403) for a persona without the template's team, and logged as a preview", async () => {
    vi.mocked(getViewer).mockResolvedValue(morgan);
    const res = await post(
      "balance-transfer",
      { version: 2, channel: "web", values: CUSTOMER, preview: true },
      { "X-Correlation-Id": "preview-forbidden" },
    );
    await expectError(res, 403, "preview_forbidden", "You can't preview this template.");
    expect(await logRows("preview-forbidden")).toEqual([
      expect.objectContaining({ isPreview: true, consumerId: null, outcome: "error", errorCode: "preview_forbidden" }),
    ]);
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────

describe("POST …/render: 400 bad requests", () => {
  const good = { version: 2, channel: "web", values: CUSTOMER };
  const BODY = "The body must be JSON with version, channel and values.";

  it.each([
    ["a body that isn't JSON", "{nope", BODY],
    ["a JSON array", "[]", BODY],
    ["no values", { version: 2, channel: "web" }, BODY],
    ["no version", { channel: "web", values: {} }, BODY],
    ["an unknown channel", { ...good, channel: "sms" }, "channel must be one of pdf, web, email."],
    ["a version as a string", { ...good, version: "2" }, "version must be a version number."],
    ["version 0", { ...good, version: 0 }, "version must be a version number."],
    ["a fractional version", { ...good, version: 1.5 }, "version must be a version number."],
    ["values as an array", { ...good, values: [] }, "values must be an object."],
    ["values as null", { ...good, values: null }, "values must be an object."],
    ["another encoding", { ...good, encoding: "hex" }, "encoding must be base64."],
    ["preview as a string", { ...good, preview: "yes" }, "preview must be true or false."],
    ["the draft without preview", { ...good, version: "draft" }, "version must be a version number."],
  ])("%s", async (_, body, message) => {
    await expectError(await post("balance-transfer", body), 400, "bad_request", message);
  });

  it("a missing X-Consumer-Id is consumer_required", async () => {
    await expectError(await post("balance-transfer", good, {}), 400, "consumer_required", "X-Consumer-Id is required.");
  });

  it("generates a correlation id when none is sent, and replaces an unusable one", async () => {
    const res = await post("balance-transfer", { ...good, channel: "sms" });
    expect(res.headers.get("X-Correlation-Id")).toMatch(/^req_[0-9a-z]{12}$/);
    const odd = await post("balance-transfer", good, { ...CORAL, "X-Correlation-Id": "x".repeat(200) });
    expect(odd.headers.get("X-Correlation-Id")).toMatch(/^req_/);
  });
});

describe("POST …/render: 403, 404 and 422", () => {
  it("an unregistered consumer is 403", async () => {
    await expectError(
      await post("balance-transfer", { version: 2, channel: "web", values: CUSTOMER }, { "X-Consumer-Id": "acme" }),
      403,
      "unknown_consumer",
      'Consumer "acme" isn\'t registered.',
    );
  });

  it("an unknown template is 404, and isn't logged", async () => {
    const res = await post("UC-ZZZZZZ", { version: 1, channel: "web", values: {} }, { ...CORAL, "X-Correlation-Id": "no-template" });
    await expectError(res, 404, "template_not_found", "Template UC-ZZZZZZ doesn't exist.");
    expect(await logRows("no-template")).toEqual([]);
  });

  it("an unknown version is 404", async () => {
    await expectError(
      await post("balance-transfer", { version: 9, channel: "web", values: CUSTOMER }),
      404,
      "version_not_found",
      `Template ${ids["balance-transfer"]} has no version 9.`,
    );
  });

  it("missing required variables are 422, listed by key", async () => {
    const error = await expectError(
      await post("balance-transfer", { version: 2, channel: "web", values: { first_name: "Maya" } }),
      422,
      "missing_variables",
      "Missing required variables: last_name, purchase_apr, home_state.",
    );
    expect(error.details).toEqual({ missing: ["last_name", "purchase_apr", "home_state"], invalid: [] });
  });

  it("a wrong type is 422, naming the variable and the type, never the value", async () => {
    const res = await post("balance-transfer", { version: 2, channel: "web", values: { ...CUSTOMER, home_state: "Atlantis" } });
    const error = await expectError(res, 422, "invalid_values", "home_state must be a US state, like NJ.");
    expect(JSON.stringify(error)).not.toContain("Atlantis");
  });

  it("a channel the version hasn't turned on is 422", async () => {
    await expectError(
      await post("balance-transfer", { version: 2, channel: "email", values: CUSTOMER }),
      422,
      "channel_not_enabled",
      "Version 2 doesn't render to Email. Its channels are PDF and Web.",
    );
  });

  it("a channel the content type doesn't allow is 422", async () => {
    await db.update(contentTypes).set({ allowedChannels: ["pdf", "web"] }).where(eq(contentTypes.key, "disclosure"));
    try {
      await expectError(
        await post("rate-change-notice", { version: 1, channel: "email", values: { ...CUSTOMER, effective_date: "2027-03-04" } }),
        422,
        "channel_not_allowed",
        "Disclosures don't render to Email.",
      );
    } finally {
      await db.update(contentTypes).set({ allowedChannels: ["pdf", "web", "email"] }).where(eq(contentTypes.key, "disclosure"));
    }
  });
});
