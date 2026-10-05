import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { getCopilotPrompt } from "./copilot";

// The Copilot prompt action against a temporary database filled by the real seed. Annual Fee Waiver
// has an open draft; Cash Back's latest version is in review (no draft).

const env = vi.hoisted(() => ({ dir: "" }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-copilot-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: new Date("2026-10-04T12:00:00.000Z") })).templates;
  for (const id of ["maya", "taylor"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

const as = (userId: string) => vi.mocked(getViewer).mockResolvedValue(people[userId]!);

describe("getCopilotPrompt", () => {
  it("builds the prompt from the saved draft for someone who may edit it", async () => {
    as("maya");
    const result = await getCopilotPrompt({ templateId: ids["annual-fee-waiver"]! });
    if (!result.ok) throw new Error(result.reason);
    expect(result.prompt.text).toContain("Help me write the body of a disclosure for Coral Offers.");
    expect(result.prompt.text).toContain("## Offer details\n## Rates and fees\n## Legal notices");
    expect(result.prompt.includesDraft).toBe(true);
    expect(result.prompt.text).toContain("Improve this draft:");
  });

  it("refuses a viewer who can't edit drafts on the team", async () => {
    as("taylor");
    const result = await getCopilotPrompt({ templateId: ids["annual-fee-waiver"]! });
    expect(result.ok).toBe(false);
  });

  it("says so when there is no draft, or no such template", async () => {
    as("maya");
    expect(await getCopilotPrompt({ templateId: ids["cash-back"]! })).toEqual({ ok: false, reason: "There is no draft to write." });
    expect(await getCopilotPrompt({ templateId: "UC-NOPE00" })).toEqual({ ok: false, reason: "This template isn't available." });
    expect(await getCopilotPrompt({ templateId: "" })).toEqual({ ok: false, reason: "This template isn't available." });
  });
});
