import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getCopilotPrompt } from "./copilot";

// The Copilot prompt read against a temporary database filled by the real seed. Annual Fee Waiver
// has an open draft; Cash Back's latest version is in review (no draft).

const env = vi.hoisted(() => ({ dir: "" }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-copilot-");
  env.dir = temp.dir;
  return temp;
});

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

describe("getCopilotPrompt", () => {
  it("builds the prompt from the saved draft for someone who may edit it", async () => {
    const result = await getCopilotPrompt(people.maya!, { templateId: ids["annual-fee-waiver"]! });
    if (!result.ok) throw new Error(result.reason);
    expect(result.prompt.text).toContain("Help me write the body of a disclosure for Coral Offers.");
    expect(result.prompt.text).toContain("## Offer details\n## Rates and fees\n## Legal notices");
    expect(result.prompt.includesDraft).toBe(true);
    expect(result.prompt.text).toContain("Improve this draft:");
  });

  it("refuses a viewer who can't edit drafts on the team", async () => {
    const result = await getCopilotPrompt(people.taylor!, { templateId: ids["annual-fee-waiver"]! });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("says so when there is no draft, or no such template", async () => {
    const maya = people.maya!;
    expect(await getCopilotPrompt(maya, { templateId: ids["cash-back"]! })).toEqual({ ok: false, status: 409, code: "no_draft_to_write", reason: "There is no draft to write." });
    expect(await getCopilotPrompt(maya, { templateId: "UC-NOPE00" })).toEqual({ ok: false, status: 404, code: "template_unavailable", reason: "This template isn't available." });
    expect(await getCopilotPrompt(maya, { templateId: "" })).toEqual({ ok: false, status: 400, code: "template_unavailable", reason: "This template isn't available." });
  });

  it("refuses an alert's draft: Copilot writes a document's body, and an alert has none", async () => {
    expect(await getCopilotPrompt(people.maya!, { templateId: ids["rate-change-heads-up"]! })).toEqual({
      ok: false,
      status: 409,
      code: "copilot_documents_only",
      reason: "Copilot drafts documents only.",
    });
  });
});
