import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { versions } from "@/server/db/schema/ucomp";
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

// GET /api/templates/{templateId}/compare, Compare: two versions' content, older first, end to end: HTTP in, the
// real query against a temporary database filled by the real seed, HTTP out. Only the database handle, the clock,
// the request headers and the persona (`getViewer`) are swapped. A refusal is answered with its status and `{ ok:
// false, code, reason }`, and no answer may be cached.
//
// Seed facts used: Annual Fee Waiver (Coral Offers) has v1 Changes requested and an open draft started from it;
// Cash Back has v1 Superseded, v2 Active, v3 In review; Balance Transfer has v2 Active. Maya is an Author on Coral
// Offers, Sam a Viewer there, Eli an Author on Deposits only; Morgan has no team; Taylor is the Auditor.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-read-compare-");
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

const compare = route.GET;

describe("GET /api/templates/[templateId]/compare", () => {
  it("200 with the two versions, older first, for anyone who can see the template", async () => {
    const cashBack = ids["cash-back"]!;
    const [v1, v2] = [
      await versionOf(db, cashBack, { number: 1 }),
      await versionOf(db, cashBack, { number: 2 }),
    ];
    for (const persona of ["maya", "sam"]) {
      as(persona);
      const { status, body } = await readAnswer(
        getRead(compare, "compare", cashBack, `?from=${v1.id}&to=${v2.id}`),
      );
      expect(status).toBe(200);
      const side = (v: typeof v1, number: number, state: string) => ({
        id: v.id,
        number,
        round: 1,
        state,
        name: v.name,
        body: v.body,
        channels: v.channels,
        channelFields: v.channelFields,
        smsFooter: null,
        variables: v.variables,
      });
      expect(body).toEqual({
        ok: true,
        family: "document",
        from: side(v1, 1, "superseded"),
        to: side(v2, 2, "active"),
      });
    }
  });

  it("gives an alert's versions each the SMS footer it prints: frozen at submit, the draft's the content type's now", async () => {
    const alert = ids["payment-due-reminder"]!;
    const v1 = await versionOf(db, alert, { number: 1 });
    // A draft after it, and a new footer on the Alert content type since v1 was submitted.
    await db.insert(versions).values({
      ...v1,
      id: "v_payment_draft",
      number: null,
      round: null,
      state: "draft",
      smsFooter: null,
    });
    const { contentTypes } = await import("@/server/db/schema/ucomp");
    const NOW = "Coral: Reply STOP to end.";
    await db
      .update(contentTypes)
      .set({ smsFooter: NOW })
      .where(eq(contentTypes.id, "ct_alert"));
    try {
      as("maya");
      const { body } = await readAnswer(
        getRead(compare, "compare", alert, `?from=${v1.id}&to=v_payment_draft`),
      );
      expect(body).toMatchObject({
        ok: true,
        family: "message",
        from: { smsFooter: "Coral: Reply STOP to opt out, HELP for help." },
        to: { smsFooter: NOW },
      });
    } finally {
      await db.delete(versions).where(eq(versions.id, "v_payment_draft"));
      await db
        .update(contentTypes)
        .set({ smsFooter: "Coral: Reply STOP to opt out, HELP for help." })
        .where(eq(contentTypes.id, "ct_alert"));
    }
  });

  it("the open draft has no number", async () => {
    const fee = ids["annual-fee-waiver"]!;
    const [v1, draft] = [
      await versionOf(db, fee, { number: 1 }),
      await versionOf(db, fee, { state: "draft" }),
    ];
    const { body } = await readAnswer(
      getRead(compare, "compare", fee, `?from=${v1.id}&to=${draft.id}`),
    );
    expect(body).toMatchObject({
      ok: true,
      to: { id: draft.id, number: null, round: null, state: "draft" },
    });
  });

  it("400 when a version is missing or malformed", async () => {
    const cashBack = ids["cash-back"]!;
    const v1 = await versionOf(db, cashBack, { number: 1 });
    for (const query of [
      "",
      `?from=${v1.id}`,
      `?from=${v1.id}&to=`,
      `?from=${v1.id}&to=${"v".repeat(65)}`,
    ]) {
      expect(
        await readAnswer(getRead(compare, "compare", cashBack, query)),
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

  it("403 for someone who can't see the template's team", async () => {
    as("morgan");
    const cashBack = ids["cash-back"]!;
    const [v1, v2] = [
      await versionOf(db, cashBack, { number: 1 }),
      await versionOf(db, cashBack, { number: 2 }),
    ];
    expect(
      await readAnswer(
        getRead(compare, "compare", cashBack, `?from=${v1.id}&to=${v2.id}`),
      ),
    ).toEqual({
      status: 403,
      body: {
        ok: false,
        code: "template_unavailable",
        reason: "This template isn't available.",
      },
    });
  });

  it("404 for an unknown template, or a version of another template", async () => {
    const v1 = await versionOf(db, ids["cash-back"]!, { number: 1 });
    const other = await versionOf(db, ids["balance-transfer"]!, { number: 2 });
    expect(
      (
        await readAnswer(
          getRead(
            compare,
            "compare",
            "UC-ZZZZZZ",
            `?from=${v1.id}&to=${other.id}`,
          ),
        )
      ).status,
    ).toBe(404);
    expect(
      await readAnswer(
        getRead(
          compare,
          "compare",
          ids["cash-back"]!,
          `?from=${v1.id}&to=${other.id}`,
        ),
      ),
    ).toEqual({
      status: 404,
      body: {
        ok: false,
        code: "version_unavailable",
        reason: "This version isn't available.",
      },
    });
  });

  it("is a GET handler and nothing else", async () => {
    await expectOnlyGet(route);
  });
});
