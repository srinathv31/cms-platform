import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { versions } from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { GET as baseVersion } from "./base-version/route";
import { GET as compare } from "./compare/route";
import { GET as copilotPrompt } from "./copilot-prompt/route";
import { GET as integration } from "./integration/route";
import { GET as submitSummary } from "./submit-summary/route";

// The template reads a screen makes on demand, end to end: HTTP in, the real query against a temporary
// database filled by the real seed, HTTP out. Only the database handle, the clock, the request headers
// and the persona (`getViewer`) are swapped. Each route answers a refusal with its status and
// `{ ok: false, reason }`, and never lets the answer be cached.
//
// Seed facts used: Annual Fee Waiver (Coral Offers) has v1 Changes requested and an open draft started
// from it; Cash Back has v1 Superseded, v2 Active, v3 In review; Balance Transfer has v2 Active. Maya is
// an Author on Coral Offers, Sam a Viewer there, Eli an Author on Deposits only; Morgan has no team.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-template-reads-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "localhost:3000" })) }));

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: env.now })).templates;
  for (const id of ["maya", "sam", "eli", "morgan", "taylor"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

beforeEach(() => as("maya"));

function as(userId: string) {
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
}

type Handler = (request: NextRequest, ctx: { params: Promise<{ templateId: string }> }) => Promise<Response>;

/** GET /api/templates/{templateId}/{read}{query} through the route's handler. */
function get(handler: Handler, read: string, templateId: string, query = "") {
  const url = `http://localhost/api/templates/${encodeURIComponent(templateId)}/${read}${query}`;
  return handler(new NextRequest(url), { params: Promise.resolve({ templateId }) });
}

/** The status and body, checking the headers every answer has. */
async function answer(response: Promise<Response>) {
  const res = await response;
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const versionOf = (templateId: string, where: { number?: number; state?: "draft" }) =>
  db.query.versions
    .findFirst({
      where: and(
        eq(versions.templateId, templateId),
        where.number !== undefined ? eq(versions.number, where.number) : undefined,
        where.state ? eq(versions.state, where.state) : undefined,
      ),
    })
    .then((v) => v!);

describe("GET /api/templates/[templateId]/compare", () => {
  it("200 with the two versions, older first, for anyone who can see the template", async () => {
    const cashBack = ids["cash-back"]!;
    const [v1, v2] = [await versionOf(cashBack, { number: 1 }), await versionOf(cashBack, { number: 2 })];
    for (const persona of ["maya", "sam"]) {
      as(persona);
      const { status, body } = await answer(get(compare, "compare", cashBack, `?from=${v1.id}&to=${v2.id}`));
      expect(status).toBe(200);
      expect(body).toEqual({
        ok: true,
        from: { id: v1.id, number: 1, state: "superseded", name: v1.name, body: v1.body, variables: v1.variables },
        to: { id: v2.id, number: 2, state: "active", name: v2.name, body: v2.body, variables: v2.variables },
      });
    }
  });

  it("the open draft has no number", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const [v1, draft] = [await versionOf(fee, { number: 1 }), await versionOf(fee, { state: "draft" })];
    const { body } = await answer(get(compare, "compare", fee, `?from=${v1.id}&to=${draft.id}`));
    expect(body).toMatchObject({ ok: true, to: { id: draft.id, number: null, state: "draft" } });
  });

  it("400 when a version is missing or malformed", async () => {
    const cashBack = ids["cash-back"]!;
    const v1 = await versionOf(cashBack, { number: 1 });
    for (const query of ["", `?from=${v1.id}`, `?from=${v1.id}&to=`, `?from=${v1.id}&to=${"v".repeat(65)}`]) {
      expect(await answer(get(compare, "compare", cashBack, query))).toEqual({
        status: 400,
        body: { ok: false, reason: "This template isn't available to you." },
      });
    }
  });

  it("403 for someone who can't see the template's team", async () => {
    as("morgan");
    const cashBack = ids["cash-back"]!;
    const [v1, v2] = [await versionOf(cashBack, { number: 1 }), await versionOf(cashBack, { number: 2 })];
    expect(await answer(get(compare, "compare", cashBack, `?from=${v1.id}&to=${v2.id}`))).toEqual({
      status: 403,
      body: { ok: false, reason: "This template isn't available to you." },
    });
  });

  it("404 for an unknown template, or a version of another template", async () => {
    const v1 = await versionOf(ids["cash-back"]!, { number: 1 });
    const other = await versionOf(ids["balance-transfer"]!, { number: 2 });
    expect((await answer(get(compare, "compare", "UC-ZZZZZZ", `?from=${v1.id}&to=${other.id}`))).status).toBe(404);
    expect(await answer(get(compare, "compare", ids["cash-back"]!, `?from=${v1.id}&to=${other.id}`))).toEqual({
      status: 404,
      body: { ok: false, reason: "This version isn't available." },
    });
  });
});

describe("GET /api/templates/[templateId]/base-version", () => {
  it("200 with the content of the version the draft was started from", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const [v1, draft] = [await versionOf(fee, { number: 1 }), await versionOf(fee, { state: "draft" })];
    const { status, body } = await answer(get(baseVersion, "base-version", fee, `?draft=${draft.id}`));
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, base: { number: 1, name: v1.name, body: v1.body, variables: v1.variables } });
  });

  it("400 without the draft's id", async () => {
    for (const query of ["", "?draft=", `?draft=${"v".repeat(65)}`]) {
      expect(await answer(get(baseVersion, "base-version", ids["annual-fee-waiver"]!, query))).toEqual({
        status: 400,
        body: { ok: false, reason: "This template isn't available." },
      });
    }
  });

  it("403 for someone who may not edit the team's drafts, with the reason", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const draft = await versionOf(fee, { state: "draft" });
    for (const persona of ["sam", "eli", "morgan"]) {
      as(persona);
      const { status, body } = await answer(get(baseVersion, "base-version", fee, `?draft=${draft.id}`));
      expect(status, persona).toBe(403);
      expect(body).toEqual({ ok: false, reason: expect.stringMatching(/\S/) });
    }
  });

  it("404 for an unknown template; 409 when the version named isn't an open draft", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const v1 = await versionOf(fee, { number: 1 });
    expect((await answer(get(baseVersion, "base-version", "UC-ZZZZZZ", `?draft=${v1.id}`))).status).toBe(404);
    expect(await answer(get(baseVersion, "base-version", fee, `?draft=${v1.id}`))).toEqual({
      status: 409,
      body: { ok: false, reason: "There is no draft to revert." },
    });
  });
});

describe("GET /api/templates/[templateId]/submit-summary", () => {
  it("200 with what submit will freeze: the draft's rev and name among it", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const draft = await versionOf(fee, { state: "draft" });
    const { status, body } = await answer(get(submitSummary, "submit-summary", fee));
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, summary: { templateId: fee, rev: draft.rev, name: draft.name, number: 2 } });
  });

  it("400 for a malformed template id", async () => {
    expect(await answer(get(submitSummary, "submit-summary", "U".repeat(65)))).toEqual({
      status: 400,
      body: { ok: false, reason: "This template isn't available." },
    });
  });

  it("403 for someone who may not submit on the team", async () => {
    as("sam");
    expect((await answer(get(submitSummary, "submit-summary", ids["annual-fee-waiver"]!))).status).toBe(403);
  });

  it("404 for an unknown template; 409 when the template has no draft", async () => {
    expect((await answer(get(submitSummary, "submit-summary", "UC-ZZZZZZ"))).status).toBe(404);
    expect(await answer(get(submitSummary, "submit-summary", ids["cash-back"]!))).toEqual({
      status: 409,
      body: { ok: false, reason: "This version is already in review." },
    });
  });
});

describe("GET /api/templates/[templateId]/copilot-prompt", () => {
  it("200 with the prompt built from the saved draft", async () => {
    const { status, body } = await answer(get(copilotPrompt, "copilot-prompt", ids["annual-fee-waiver"]!));
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, prompt: { includesDraft: true, text: expect.stringContaining("Coral Offers") } });
  });

  it("400, 403, 404 and 409", async () => {
    expect((await answer(get(copilotPrompt, "copilot-prompt", "U".repeat(65)))).status).toBe(400);
    expect((await answer(get(copilotPrompt, "copilot-prompt", "UC-ZZZZZZ"))).status).toBe(404);
    expect(await answer(get(copilotPrompt, "copilot-prompt", ids["cash-back"]!))).toEqual({
      status: 409,
      body: { ok: false, reason: "There is no draft to write." },
    });
    as("taylor");
    expect((await answer(get(copilotPrompt, "copilot-prompt", ids["annual-fee-waiver"]!))).status).toBe(403);
  });
});

describe("GET /api/templates/[templateId]/integration", () => {
  it("200 with the Active version's panel, for anyone who can see the template", async () => {
    const transfer = ids["balance-transfer"]!;
    as("sam");
    const { status, body } = await answer(get(integration, "integration", transfer));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      panel: { active: { number: 2 }, endpoint: { url: `http://localhost:3000/api/v1/templates/${transfer}/render` } },
    });
  });

  it("400, 403, 404 and 409", async () => {
    expect((await answer(get(integration, "integration", "U".repeat(65)))).status).toBe(400);
    expect((await answer(get(integration, "integration", "UC-ZZZZZZ"))).status).toBe(404);
    expect(await answer(get(integration, "integration", ids["annual-fee-waiver"]!))).toEqual({
      status: 409,
      body: { ok: false, reason: "This template has no Active version yet." },
    });
    as("morgan");
    expect((await answer(get(integration, "integration", ids["balance-transfer"]!))).status).toBe(403);
  });
});

describe("every read", () => {
  it("is a GET handler and nothing else", async () => {
    for (const route of ["base-version", "compare", "copilot-prompt", "integration", "submit-summary"]) {
      const exported = (await import(`./${route}/route.ts`)) as Record<string, unknown>;
      expect(Object.keys(exported), route).toEqual(["GET"]);
    }
  });
});
