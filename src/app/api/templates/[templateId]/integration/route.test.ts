import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import {
  expectOnlyGet,
  getRead,
  readAnswer,
} from "@/server/testing/read-routes";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import * as route from "./route";

// GET /api/templates/{templateId}/integration, the SHARE panel: the Active version's endpoint and examples, end to
// end: HTTP in, the real query against a temporary database filled by the real seed, HTTP out. Only the database
// handle, the clock, the request headers and the persona (`getViewer`) are swapped. A refusal is answered with its
// status and `{ ok: false, code, reason }`, and no answer may be cached.
//
// Seed facts used: Annual Fee Waiver (Coral Offers) has v1 Changes requested and an open draft started from it;
// Cash Back has v1 Superseded, v2 Active, v3 In review; Balance Transfer has v2 Active. Maya is an Author on Coral
// Offers, Sam a Viewer there, Eli an Author on Deposits only; Morgan has no team; Taylor is the Auditor.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-read-integration-");
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

let db: Db;
const people: Record<string, Viewer> = {};

const ids = seededDatabasePerTest({ base: env.now });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
  for (const id of ["maya", "sam", "eli", "morgan", "taylor"])
    people[id] = await loadPersona(db, id);
});

beforeEach(() => as("maya"));

function as(userId: string) {
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
}

const integration = route.GET;

describe("GET /api/templates/[templateId]/integration", () => {
  it("200 with the Active version's panel, for anyone who can see the template", async () => {
    const transfer = ids["balance-transfer"]!;
    as("sam");
    const { status, body } = await readAnswer(
      getRead(integration, "integration", transfer),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      panel: {
        active: { number: 2 },
        endpoint: {
          url: `http://localhost:3000/api/v1/templates/${transfer}/render`,
        },
      },
    });
  });

  it("400, 403, 404 and 409", async () => {
    expect(
      (await readAnswer(getRead(integration, "integration", "U".repeat(65))))
        .status,
    ).toBe(400);
    expect(
      (await readAnswer(getRead(integration, "integration", "UC-ZZZZZZ")))
        .status,
    ).toBe(404);
    expect(
      await readAnswer(
        getRead(integration, "integration", ids["annual-fee-waiver"]!),
      ),
    ).toEqual({
      status: 409,
      body: {
        ok: false,
        code: "no_active_version",
        reason: "This template has no Active version yet.",
      },
    });
    as("morgan");
    expect(
      (
        await readAnswer(
          getRead(integration, "integration", ids["balance-transfer"]!),
        )
      ).status,
    ).toBe(403);
  });

  it("is a GET handler and nothing else", async () => {
    await expectOnlyGet(route);
  });
});
