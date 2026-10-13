import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import {
  expectOnlyGet,
  getRead,
  readAnswer,
  versionOf,
} from "@/server/testing/read-routes";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import * as route from "./route";

// GET /api/templates/{templateId}/submit-summary, the submit dialog: what submit will freeze, end to end: HTTP in,
// the real query against a temporary database filled by the real seed, HTTP out. Only the database handle, the
// clock, the request headers and the persona (`getViewer`) are swapped. A refusal is answered with its status and
// `{ ok: false, code, reason }`, and no answer may be cached.
//
// Seed facts used: Annual Fee Waiver (Coral Offers) has v1 Changes requested and an open draft started from it;
// Cash Back has v1 Superseded, v2 Active, v3 In review; Balance Transfer has v2 Active. Maya is an Author on Coral
// Offers, Sam a Viewer there, Eli an Author on Deposits only; Morgan has no team; Taylor is the Auditor.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-read-submit-summary-");
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

const submitSummary = route.GET;

describe("GET /api/templates/[templateId]/submit-summary", () => {
  it("200 with what submit will freeze: the draft's rev and name among it", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const draft = await versionOf(db, fee, { state: "draft" });
    const { status, body } = await readAnswer(
      getRead(submitSummary, "submit-summary", fee),
    );
    expect(status).toBe(200);
    // v1 was sent back: its draft resubmits as v1, round 2.
    expect(body).toMatchObject({
      ok: true,
      summary: {
        templateId: fee,
        rev: draft.rev,
        name: draft.name,
        number: 1,
        round: 2,
      },
    });
  });

  it("400 for a malformed template id", async () => {
    expect(
      await readAnswer(
        getRead(submitSummary, "submit-summary", "U".repeat(65)),
      ),
    ).toEqual({
      status: 400,
      body: {
        ok: false,
        code: "template_unavailable",
        reason: "This template isn't available.",
      },
    });
  });

  it("403 for someone who may not submit on the team", async () => {
    as("sam");
    expect(
      (
        await readAnswer(
          getRead(submitSummary, "submit-summary", ids["annual-fee-waiver"]!),
        )
      ).status,
    ).toBe(403);
  });

  it("404 for an unknown template; 409 when the template has no draft", async () => {
    expect(
      (await readAnswer(getRead(submitSummary, "submit-summary", "UC-ZZZZZZ")))
        .status,
    ).toBe(404);
    expect(
      await readAnswer(
        getRead(submitSummary, "submit-summary", ids["cash-back"]!),
      ),
    ).toEqual({
      status: 409,
      body: {
        ok: false,
        code: "already_in_review",
        reason: "This version is already in review.",
      },
    });
  });

  it("is a GET handler and nothing else", async () => {
    await expectOnlyGet(route);
  });
});
