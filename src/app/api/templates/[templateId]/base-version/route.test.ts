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

// GET /api/templates/{templateId}/base-version, Revert to vN: the content the draft was started from, end to end:
// HTTP in, the real query against a temporary database filled by the real seed, HTTP out. Only the database handle,
// the clock, the request headers and the persona (`getViewer`) are swapped. A refusal is answered with its status
// and `{ ok: false, code, reason }`, and no answer may be cached.
//
// Seed facts used: Annual Fee Waiver (Coral Offers) has v1 Changes requested and an open draft started from it;
// Cash Back has v1 Superseded, v2 Active, v3 In review; Balance Transfer has v2 Active. Maya is an Author on Coral
// Offers, Sam a Viewer there, Eli an Author on Deposits only; Morgan has no team; Taylor is the Auditor.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-read-base-version-");
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

const baseVersion = route.GET;

describe("GET /api/templates/[templateId]/base-version", () => {
  it("200 with the content of the version the draft was started from", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const [v1, draft] = [
      await versionOf(db, fee, { number: 1 }),
      await versionOf(db, fee, { state: "draft" }),
    ];
    const { status, body } = await readAnswer(
      getRead(baseVersion, "base-version", fee, `?draft=${draft.id}`),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      base: {
        number: 1,
        name: v1.name,
        body: v1.body,
        variables: v1.variables,
      },
    });
  });

  it("400 without the draft's id", async () => {
    for (const query of ["", "?draft=", `?draft=${"v".repeat(65)}`]) {
      expect(
        await readAnswer(
          getRead(
            baseVersion,
            "base-version",
            ids["annual-fee-waiver"]!,
            query,
          ),
        ),
      ).toEqual({
        status: 400,
        body: {
          ok: false,
          code: "template_unavailable",
          reason: "This template isn't available.",
        },
      });
    }
  });

  it("403 for someone who may not edit the team's drafts, with the reason", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const draft = await versionOf(db, fee, { state: "draft" });
    for (const persona of ["sam", "eli", "morgan"]) {
      as(persona);
      const { status, body } = await readAnswer(
        getRead(baseVersion, "base-version", fee, `?draft=${draft.id}`),
      );
      expect(status, persona).toBe(403);
      expect(body).toEqual({
        ok: false,
        code: expect.any(String),
        reason: expect.stringMatching(/\S/),
      });
    }
  });

  it("404 for an unknown template; 409 when the version named isn't an open draft", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const v1 = await versionOf(db, fee, { number: 1 });
    expect(
      (
        await readAnswer(
          getRead(baseVersion, "base-version", "UC-ZZZZZZ", `?draft=${v1.id}`),
        )
      ).status,
    ).toBe(404);
    expect(
      await readAnswer(
        getRead(baseVersion, "base-version", fee, `?draft=${v1.id}`),
      ),
    ).toEqual({
      status: 409,
      body: {
        ok: false,
        code: "no_draft_to_revert",
        reason: "There is no draft to revert.",
      },
    });
  });

  it("is a GET handler and nothing else", async () => {
    await expectOnlyGet(route);
  });
});
