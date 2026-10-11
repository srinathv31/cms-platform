import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seededDatabasePerTest } from "@/server/testing/review-fixtures";
import { getLibraryRows } from "./library";

// The Library's read model against a temporary database filled by the real seed: each row says which kind of
// template it is, a Document or an Alert, from the template's content type.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-library-queries-");
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const ALERTS = ["payment-due-reminder", "card-used-abroad", "rate-change-heads-up"];

let db: Db;

const ids = seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

describe("Library rows: the template's kind", () => {
  it("marks Coral Offers' three alerts as alerts and every other template as a document", async () => {
    const rows = await getLibraryRows("coral-offers");
    const alertIds = new Set(ALERTS.map((key) => ids[key]));
    expect(rows.filter((row) => row.family === "message").map((row) => row.id).sort()).toEqual([...alertIds].sort());
    expect(rows.filter((row) => row.family === "document").length).toBe(rows.length - alertIds.size);
    expect(rows.filter((row) => row.family === "document").length, "Coral has documents too").toBeGreaterThan(0);
  });

  it("gives every template in All teams the family of its content type", async () => {
    const [rows, templates] = await Promise.all([
      getLibraryRows("all"),
      db.select({ id: schema.templates.id, contentTypeId: schema.templates.contentTypeId }).from(schema.templates),
    ]);
    expect(rows).toHaveLength(templates.length);
    for (const row of rows) {
      const template = templates.find((t) => t.id === row.id)!;
      expect(row.family, row.id).toBe(template.contentTypeId === "ct_alert" ? "message" : "document");
    }
  });

  it("reads the kind from the content type, not from a version's channels", async () => {
    const reminder = ids["payment-due-reminder"]!;
    const [latest] = await db.select({ id: schema.versions.id, channels: schema.versions.channels }).from(schema.versions).where(eq(schema.versions.templateId, reminder));
    expect(latest!.channels).toEqual(["push", "sms"]);
    // A crafted save that left the alert's version on the document channels doesn't turn it into a document.
    await db.update(schema.versions).set({ channels: ["pdf"] }).where(eq(schema.versions.id, latest!.id));
    try {
      const row = (await getLibraryRows("coral-offers")).find((r) => r.id === reminder);
      expect(row?.family).toBe("message");
    } finally {
      await db.update(schema.versions).set({ channels: latest!.channels }).where(eq(schema.versions.id, latest!.id));
    }
  });
});
