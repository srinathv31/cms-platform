import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { RequestContext } from "../types";
import { localServices } from "./index";

// The local Library read (`templates.library`) against a temporary database filled by the real seed: each row
// says which kind of template it is, a Document or an Alert, from the template's content type, and the answer
// says whether the viewer may create in the space.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-library-local-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const ALERTS = [
  "payment-due-reminder",
  "card-used-abroad",
  "rate-change-heads-up",
];

/** The backend's clock: every test starts at the seed's base. */
let now = BASE;
const services = localServices({ clock: async () => now });

let db: Db;
const people: Record<string, Viewer> = {};

const ids = seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
  for (const id of ["maya", "riley", "eli", "taylor"])
    people[id] = await loadPersona(db, id);
});

beforeEach(() => {
  now = BASE;
});

function as(userId: string): RequestContext {
  return {
    viewer: people[userId]!,
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

/** The Library's answer for a viewer in a space (a team by id, or null for All teams); it must have succeeded. */
async function library(userId: string, teamId: string | null) {
  const result = await services.templates.library(as(userId), { teamId });
  if (!result.ok) throw new Error(`${userId} in ${teamId}: ${result.reason}`);
  return result;
}

describe("templates.library: the template's kind", () => {
  it("marks Coral Offers' three alerts as alerts and every other template as a document", async () => {
    const { rows } = await library("maya", "t_coral");
    const alertIds = new Set(ALERTS.map((key) => ids[key]));
    expect(
      rows
        .filter((row) => row.family === "message")
        .map((row) => row.id)
        .sort(),
    ).toEqual([...alertIds].sort());
    expect(rows.filter((row) => row.family === "document").length).toBe(
      rows.length - alertIds.size,
    );
    expect(
      rows.filter((row) => row.family === "document").length,
      "Coral has documents too",
    ).toBeGreaterThan(0);
  });

  it("gives every template in All teams the family of its content type", async () => {
    const [{ rows }, templates] = await Promise.all([
      library("riley", null),
      db
        .select({
          id: schema.templates.id,
          contentTypeId: schema.templates.contentTypeId,
        })
        .from(schema.templates),
    ]);
    expect(rows).toHaveLength(templates.length);
    for (const row of rows) {
      const template = templates.find((t) => t.id === row.id)!;
      expect(row.family, row.id).toBe(
        template.contentTypeId === "ct_alert" ? "message" : "document",
      );
    }
  });

  it("reads the kind from the content type, not from a version's channels", async () => {
    const reminder = ids["payment-due-reminder"]!;
    const [latest] = await db
      .select({ id: schema.versions.id, channels: schema.versions.channels })
      .from(schema.versions)
      .where(eq(schema.versions.templateId, reminder));
    expect(latest!.channels).toEqual(["push", "sms"]);
    // A crafted save that left the alert's version on the document channels doesn't turn it into a document.
    await db
      .update(schema.versions)
      .set({ channels: ["pdf"] })
      .where(eq(schema.versions.id, latest!.id));
    const row = (await library("maya", "t_coral")).rows.find(
      (r) => r.id === reminder,
    );
    expect(row?.family).toBe("message");
  });
});

describe("templates.library: the space", () => {
  it("lists only the space's own templates, newest edit first, and answers the instant it read at", async () => {
    now = new Date(BASE.getTime() + 3_600_000);
    const result = await library("maya", "t_coral");
    expect(result.asOf).toBe(now.toISOString());
    expect(result.rows.length).toBeGreaterThan(0);
    expect(new Set(result.rows.map((r) => r.teamId))).toEqual(
      new Set(["t_coral"]),
    );
    const edited = result.rows.map((r) => r.lastEditedAt ?? "");
    expect(edited).toEqual([...edited].sort().reverse());

    const all = await library("riley", null);
    expect(all.rows.length).toBeGreaterThan(result.rows.length);
    expect(new Set(all.rows.map((r) => r.teamId))).toEqual(
      new Set(["t_coral", "t_deposits", "t_cards"]),
    );
  });

  it("refuses 404 space_unavailable when the viewer can't enter the space", async () => {
    // Eli is on Deposits only; Maya is on Coral Offers only, so All teams isn't hers either.
    expect(
      await services.templates.library(as("eli"), { teamId: "t_coral" }),
    ).toMatchObject({ ok: false, status: 404, code: "space_unavailable" });
    expect(
      await services.templates.library(as("maya"), { teamId: null }),
    ).toMatchObject({ ok: false, status: 404, code: "space_unavailable" });
  });
});

describe("templates.library: creating", () => {
  it("lets an author create in their own team", async () => {
    expect((await library("maya", "t_coral")).can.create).toEqual({ ok: true });
  });

  it("refuses an auditor in All teams, which has no team to create in", async () => {
    const result = await library("taylor", null);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.can.create).toMatchObject({ ok: false, code: "generic" });
    if (!result.can.create.ok) expect(result.can.create.reason).toMatch(/\S/);
  });

  it("refuses an auditor in a team too: they read, they don't write", async () => {
    expect((await library("taylor", "t_coral")).can.create).toMatchObject({
      ok: false,
      code: "generic",
    });
  });
});
