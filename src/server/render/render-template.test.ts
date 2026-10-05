import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EmailRender } from "@/domain/render/types";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { runRender, type RenderInput, type RenderResult } from "./render-template";

// The pipeline end to end against a temporary database filled by the real seed (every lifecycle
// state is in it). runRender takes the database and the time, the way applyDraftPatch does.

// The app database and the demo clock are never touched: runRender gets both as arguments.
vi.mock("@/server/db/client", () => ({ db: null }));
vi.mock("@/server/clock", () => ({ now: vi.fn() }));
// Spy on the web adapter so one test can make it throw.
vi.mock("./channels/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./channels/web")>();
  return { renderWeb: vi.fn(actual.renderWeb) };
});

const { renderLog, versions, contentTypes } = schema;
const DAY = 86_400_000;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let dir: string;
let client: Client;
let db: Db;
let ids: Record<string, string>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ucomp-render-"));
  client = createClient({ url: `file:${join(dir, "render.db")}` });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
}, 60_000);

afterAll(() => {
  client?.close();
  rmSync(dir, { recursive: true, force: true });
});

function viewer(userId: string, teams: { id: string; roles: Viewer["memberships"][number]["roles"] }[]): Viewer {
  return {
    userId,
    name: userId,
    initials: userId.slice(0, 2).toUpperCase(),
    title: "Tester",
    platformRole: null,
    memberships: teams.map((t) => ({ teamId: t.id, teamSlug: t.id, teamName: t.id, roles: t.roles, status: "active" })),
  };
}
const maya = viewer("maya", [{ id: "coral-offers", roles: ["author"] }]);
const morgan = viewer("morgan", []);

const CUSTOMER = { first_name: "Maya", last_name: "Chen", purchase_apr: "21.99", home_state: "NJ" };

let counter = 0;
async function render(over: Partial<RenderInput> & { template: string }, at = BASE) {
  const correlationId = `test_${++counter}`;
  const { template, ...rest } = over;
  const result = await runRender(
    db,
    {
      templateId: ids[template] ?? template,
      version: 1,
      channel: "web",
      values: CUSTOMER,
      preview: false,
      consumerId: "coral",
      correlationId,
      viewer: null,
      ...rest,
    },
    at,
  );
  const rows = await db.select().from(renderLog).where(eq(renderLog.correlationId, correlationId));
  return { result, rows, correlationId };
}

function ok(result: RenderResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result;
}
function failed(result: RenderResult) {
  if (result.ok) throw new Error("expected an error");
  return result.error;
}

describe("runRender: consumer renders", () => {
  it("renders the web channel of an Active version and logs one ok row", async () => {
    const { result, rows, correlationId } = await render({ template: "balance-transfer", version: 2 });
    const out = ok(result);
    expect(out).toMatchObject({ channel: "web", versionNumber: 2, newerVersion: null });
    expect(out.filename).toBe(`${ids["balance-transfer"]}-v2.html`);
    expect(out.body).toEqual(expect.stringContaining("<!doctype html>"));
    expect(out.body).toEqual(expect.stringContaining("21.99%"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      templateId: ids["balance-transfer"],
      versionNumber: 2,
      consumerId: "coral",
      channel: "web",
      isPreview: false,
      correlationId,
      outcome: "ok",
      errorCode: null,
      at: BASE,
    });
    expect(Number.isInteger(rows[0]!.durationMs)).toBe(true);
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("renders the email channel with the subject and preheader resolved", async () => {
    const { result } = await render({
      template: "rate-change-notice",
      channel: "email",
      values: { ...CUSTOMER, effective_date: "2027-03-04" },
    });
    const email = ok(result).body as EmailRender;
    expect(email.subject).toBe("Your purchase APR is changing on March 4, 2027");
    expect(email.preheader).toBe("Hi Maya, here is what is changing on your Coral account.");
    expect(email.html).toContain("<!doctype html>");
    expect(email.text).toContain("Maya");
    expect(ok(result).filename).toMatch(/-v1\.json$/);
  });

  it("renders the PDF channel as bytes", async () => {
    const { result } = await render({ template: "balance-transfer", version: 2, channel: "pdf" });
    const out = ok(result);
    expect(out.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.from((out.body as Uint8Array).slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(out.filename).toBe(`${ids["balance-transfer"]}-v2.pdf`);
  }, 30_000);

  it("accepts friendly values", async () => {
    const { result } = await render({
      template: "balance-transfer",
      version: 2,
      values: { ...CUSTOMER, purchase_apr: "19.5%", home_state: "New Jersey" },
    });
    expect(ok(result).body).toEqual(expect.stringContaining("19.50%"));
  });
});

describe("runRender: version rules", () => {
  it("renders a Superseded version before its sunset and names the newer version", async () => {
    const { result } = await render({ template: "balance-transfer", version: 1 });
    expect(ok(result)).toMatchObject({ versionNumber: 1, newerVersion: 2 });
  });

  it("refuses a Superseded version past its sunset (410), logged", async () => {
    const { result, rows } = await render({ template: "balance-transfer", version: 1 }, new Date(BASE.getTime() + 22 * DAY));
    const error = failed(result);
    expect(error.code).toBe("version_sunset");
    expect(error.message).toMatch(/^Version 1 was sunset on \w+ \d+, \d{4}\. Version 2 is active\.$/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "error", errorCode: "version_sunset" });
  });

  it("refuses a Revoked version with the revoke date", async () => {
    const error = failed((await render({ template: "holiday-points", version: 1 })).result);
    expect(error.code).toBe("version_revoked");
    expect(error.message).toMatch(/^Version 1 was revoked on \w+ \d+, \d{4}\. Version 2 is active\.$/);
  });

  it("refuses a version in review", async () => {
    const error = failed((await render({ template: "cash-back", version: 3 })).result);
    expect(error).toMatchObject({ code: "version_not_released", message: "Version 3 is in review. Version 2 is active." });
  });
});

describe("runRender: previews", () => {
  it("previews the open draft for a persona on the team, logged as a preview with no consumer", async () => {
    const { result, rows } = await render({
      template: "annual-fee-waiver",
      version: "draft",
      preview: true,
      consumerId: "coral",
      viewer: maya,
    });
    const out = ok(result);
    expect(out.versionNumber).toBeNull();
    expect(out.filename).toBe(`${ids["annual-fee-waiver"]}-draft.html`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isPreview: true, consumerId: null, versionNumber: null, outcome: "ok" });
  });

  it("skips the version rules: an In review version previews", async () => {
    const { result } = await render({ template: "cash-back", version: 3, preview: true, viewer: maya, values: { ...CUSTOMER, annual_fee: "95" } });
    expect(ok(result).versionNumber).toBe(3);
  });

  it("still names the newer version when previewing a Superseded one", async () => {
    const { result } = await render({ template: "balance-transfer", version: 1, preview: true, viewer: maya });
    expect(ok(result).newerVersion).toBe(2);
  });

  it("forbids a preview to a persona who can't see the team (403), logged as a preview", async () => {
    const { result, rows } = await render({ template: "high-yield-savings", version: 2, preview: true, viewer: maya });
    expect(failed(result)).toEqual({ code: "preview_forbidden", message: "You can't preview this template." });
    expect(rows[0]).toMatchObject({ isPreview: true, consumerId: null, outcome: "error", errorCode: "preview_forbidden" });

    expect(failed((await render({ template: "balance-transfer", version: 2, preview: true, viewer: morgan })).result).code).toBe(
      "preview_forbidden",
    );
    expect(failed((await render({ template: "balance-transfer", version: 2, preview: true, viewer: null })).result).code).toBe(
      "preview_forbidden",
    );
  });
});

describe("runRender: refusals before the version is known are not logged", () => {
  it("unknown template (404)", async () => {
    const { result, rows } = await render({ template: "UC-ZZZZZZ" });
    expect(failed(result)).toEqual({ code: "template_not_found", message: "Template UC-ZZZZZZ doesn't exist." });
    expect(rows).toHaveLength(0);
  });

  it("unknown version (404)", async () => {
    const { result, rows } = await render({ template: "balance-transfer", version: 7 });
    expect(failed(result)).toEqual({
      code: "version_not_found",
      message: `Template ${ids["balance-transfer"]} has no version 7.`,
    });
    expect(rows).toHaveLength(0);
  });

  it("no open draft (404)", async () => {
    const { result } = await render({ template: "balance-transfer", version: "draft", preview: true, viewer: maya });
    expect(failed(result).message).toBe(`Template ${ids["balance-transfer"]} has no open draft.`);
  });

  it("a draft without preview, and a consumer render without a consumer (400)", async () => {
    const draft = await render({ template: "annual-fee-waiver", version: "draft" });
    expect(failed(draft.result)).toEqual({ code: "bad_request", message: "version must be a version number." });
    expect(draft.rows).toHaveLength(0);
    const anonymous = await render({ template: "balance-transfer", version: 2, consumerId: null });
    expect(failed(anonymous.result).code).toBe("consumer_required");
    expect(anonymous.rows).toHaveLength(0);
  });
});

describe("runRender: consumer, channel and value errors are logged", () => {
  it("unknown consumer (403)", async () => {
    const { result, rows } = await render({ template: "balance-transfer", version: 2, consumerId: "acme" });
    expect(failed(result)).toEqual({ code: "unknown_consumer", message: 'Consumer "acme" isn\'t registered.' });
    expect(rows[0]).toMatchObject({ consumerId: "acme", outcome: "error", errorCode: "unknown_consumer" });
  });

  it("a channel the version hasn't turned on (422)", async () => {
    const { result, rows } = await render({ template: "balance-transfer", version: 2, channel: "email" });
    expect(failed(result)).toMatchObject({
      code: "channel_not_enabled",
      message: "Version 2 doesn't render to Email. Its channels are PDF and Web.",
    });
    expect(rows[0]).toMatchObject({ channel: "email", errorCode: "channel_not_enabled" });
  });

  it("a channel the content type doesn't allow (422)", async () => {
    await db.update(contentTypes).set({ allowedChannels: ["pdf", "web"] }).where(eq(contentTypes.key, "disclosure"));
    try {
      const { result } = await render({
        template: "rate-change-notice",
        channel: "email",
        values: { ...CUSTOMER, effective_date: "2027-03-04" },
      });
      expect(failed(result)).toMatchObject({ code: "channel_not_allowed", message: "Disclosures don't render to Email." });
    } finally {
      await db
        .update(contentTypes)
        .set({ allowedChannels: ["pdf", "web", "email"] })
        .where(eq(contentTypes.key, "disclosure"));
    }
  });

  it("missing required variables (422), listed by key in the version's order", async () => {
    const { result, rows } = await render({ template: "balance-transfer", version: 2, values: { last_name: "Chen" } });
    expect(failed(result)).toMatchObject({
      code: "missing_variables",
      message: "Missing required variables: first_name, purchase_apr, home_state.",
      details: { missing: ["first_name", "purchase_apr", "home_state"], invalid: [] },
    });
    expect(rows[0]).toMatchObject({ errorCode: "missing_variables" });
  });

  it("a value of the wrong type (422), named with its type", async () => {
    const { result } = await render({ template: "balance-transfer", version: 2, values: { ...CUSTOMER, purchase_apr: "lots" } });
    expect(failed(result)).toMatchObject({
      code: "invalid_values",
      message: "purchase_apr must be a percentage, like 21.99.",
      details: { missing: [], invalid: [{ key: "purchase_apr", expected: "percent" }] },
    });
  });
});

describe("runRender: render failures", () => {
  it("an adapter that throws is render_failed (500), logged, and the server log leaves the message out", async () => {
    const { renderWeb: web } = await import("./channels/web");
    vi.mocked(web).mockImplementationOnce(() => {
      throw new Error("could not lay out Maya Chen");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result, rows } = await render({ template: "balance-transfer", version: 2 });
      expect(failed(result)).toEqual({ code: "render_failed", message: "The web page couldn't be rendered. Try again." });
      expect(rows[0]).toMatchObject({ outcome: "error", errorCode: "render_failed" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]![0])).not.toContain("Maya");
    } finally {
      spy.mockRestore();
    }
  });

  it("a stored body that doesn't fit the editor schema is render_failed", async () => {
    const id = ids["checking-fees"]!;
    const [row] = await db.select().from(versions).where(and(eq(versions.templateId, id), eq(versions.number, 1)));
    await db
      .update(versions)
      .set({ body: { type: "doc", content: [{ type: "marquee", content: [{ type: "text", text: "x" }] }] } })
      .where(eq(versions.id, row!.id));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result } = await render({
        template: "checking-fees",
        consumerId: "deposits-online",
        values: Object.fromEntries(row!.variables.map((v) => [v.key, v.sample])),
      });
      expect(failed(result)).toEqual({ code: "render_failed", message: "The web page couldn't be rendered. Try again." });
    } finally {
      spy.mockRestore();
      await db.update(versions).set({ body: row!.body }).where(eq(versions.id, row!.id));
    }
  });
});

describe("render_log never holds values", () => {
  it("no column of any row a render writes contains a submitted or formatted value", async () => {
    // Distinctive values, in canonical and friendly forms, and how they come out formatted.
    const values = {
      first_name: "Quillon",
      last_name: "Zarathustra-Vex",
      purchase_apr: "17.43",
      home_state: "Wyoming",
      offer_end_date: "2031-07-19",
    };
    const shown = ["Quillon", "Zarathustra", "17.43", "Wyoming", "2031-07-19", "July 19, 2031"];

    const runs = await Promise.all([
      render({ template: "balance-transfer", version: 2, values }), // ok
      render({ template: "balance-transfer", version: 2, values, channel: "pdf" }), // ok, PDF
      render({ template: "balance-transfer", version: 2, values: { ...values, purchase_apr: "x17.43x" } }), // invalid
      render({ template: "balance-transfer", version: 2, values: { last_name: values.last_name } }), // missing
      render({ template: "balance-transfer", version: 2, values, preview: true, viewer: maya }), // preview
    ]);

    // The output did carry them, so the check below is meaningful.
    expect(ok(runs[0]!.result).body).toEqual(expect.stringContaining("Quillon"));
    expect(ok(runs[0]!.result).body).toEqual(expect.stringContaining("July 19, 2031"));

    const rows = runs.flatMap((r) => r.rows);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "at",
          "channel",
          "consumerId",
          "correlationId",
          "durationMs",
          "errorCode",
          "id",
          "isPreview",
          "outcome",
          "templateId",
          "versionId",
          "versionNumber",
        ].sort(),
      );
      for (const [column, cell] of Object.entries(row)) {
        const text = cell instanceof Date ? cell.toISOString() : String(cell);
        for (const value of shown) expect(text, `${column} holds "${value}"`).not.toContain(value);
      }
    }

    // And straight from SQLite, every column as text.
    const raw = await client.execute({
      sql: "select * from render_log where correlation_id in (?, ?, ?, ?, ?)",
      args: runs.map((r) => r.correlationId),
    });
    expect(raw.rows).toHaveLength(5);
    for (const row of raw.rows) {
      for (const cell of Object.values(row)) {
        for (const value of shown) expect(String(cell)).not.toContain(value);
      }
    }
  }, 30_000);
});
