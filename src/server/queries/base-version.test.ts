import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { channelFieldValues } from "@/domain/channel-fields";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getBaseVersion } from "./base-version";

// "Revert to v1" reads the base of the draft on the author's screen, named by its version id, against
// a temporary database filled by the real seed: Annual Fee Waiver has v1 (Changes requested) and an
// open draft started from it; Cash Back has v1 Superseded, v2 Active and v3 In review, and no draft.

const env = vi.hoisted(() => ({ dir: "" }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-base-version-");
  env.dir = temp.dir;
  return temp;
});
const { versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
  for (const id of ["maya", "eli"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

const version = (templateId: string, where: { number?: number; state?: "draft" }) =>
  db.query.versions.findFirst({
    where: and(
      eq(versions.templateId, templateId),
      where.number !== undefined ? eq(versions.number, where.number) : undefined,
      where.state ? eq(versions.state, where.state) : undefined,
    ),
  });

describe("getBaseVersion", () => {
  it("hands back the content of the version the draft on screen was started from", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const draft = (await version(templateId, { state: "draft" }))!;
    const v1 = (await version(templateId, { number: 1 }))!;
    expect(draft.basedOnVersionId).toBe(v1.id);

    const result = await getBaseVersion(people.maya!, { templateId, versionId: draft.id });
    expect(result).toEqual({
      ok: true,
      base: {
        number: 1,
        name: v1.name,
        body: v1.body,
        variables: v1.variables,
        channels: v1.channels,
        sampleSets: v1.sampleSets,
        // Every field of every channel, by id: null when the version has none.
        ...channelFieldValues(v1.channelFields),
      },
    });
  });

  it("refuses when the version named isn't an open draft any more, rather than reading another draft's base", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const v1 = (await version(templateId, { number: 1 }))!;
    expect(await getBaseVersion(people.maya!, { templateId, versionId: v1.id })).toEqual({
      ok: false,
      status: 409,
      code: "no_draft_to_revert",
      reason: "There is no draft to revert.",
    });
  });

  it("refuses a version of another template", async () => {
    const draft = (await version(ids["annual-fee-waiver"]!, { state: "draft" }))!;
    expect(await getBaseVersion(people.maya!, { templateId: ids["cash-back"]!, versionId: draft.id })).toEqual({
      ok: false,
      status: 404,
      code: "no_draft_to_revert",
      reason: "There is no draft to revert.",
    });
  });

  it("refuses someone who can't edit the team's drafts", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    const draft = (await version(templateId, { state: "draft" }))!;
    const result = await getBaseVersion(people.eli!, { templateId, versionId: draft.id });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a template that doesn't exist", async () => {
    expect(await getBaseVersion(people.maya!, { templateId: "UC-ZZZZZZ", versionId: "v_none" })).toEqual({
      ok: false,
      status: 404,
      code: "template_unavailable",
      reason: "This template isn't available.",
    });
  });

  it("refuses input that doesn't parse", async () => {
    const templateId = ids["annual-fee-waiver"]!;
    for (const input of [{ templateId, versionId: "" }, { templateId, versionId: "v".repeat(65) }, { templateId, versionId: null }, { templateId }]) {
      expect(await getBaseVersion(people.maya!, input as never)).toEqual({ ok: false, status: 400, code: "template_unavailable", reason: "This template isn't available." });
    }
  });
});
