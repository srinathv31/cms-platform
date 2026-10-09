import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PLATFORM_REFUSALS } from "@/domain/platform-config";
import type { Db } from "@/server/db/client";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { setChannelRule } from "@/server/actions/platform";
import { getChannelRulesSection } from "./platform";

// The Platform read models against a temporary database filled by the real seed: what a screen may do
// comes decided, so the screens never work a rule out themselves.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-platform-queries-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let libsql: Client;

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: BASE });
  vi.mocked(getViewer).mockResolvedValue(await loadPersona(db, "riley"));
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

describe("platform read models", () => {
  it("Channel rules: every switch may flip until one channel is left on, which shows why it can't", async () => {
    const before = (await getChannelRulesSection()).rows.find((r) => r.contentTypeId === "ct_disclosure")!;
    expect(before.allowed).toEqual({ pdf: true, web: true, email: true });
    expect(before.can.toggle).toEqual({ pdf: { ok: true }, web: { ok: true }, email: { ok: true } });

    for (const channel of ["email", "web"] as const) {
      expect(await setChannelRule({ contentTypeId: "ct_disclosure", channel, allowed: false })).toEqual({ ok: true });
    }
    const after = (await getChannelRulesSection()).rows.find((r) => r.contentTypeId === "ct_disclosure")!;
    expect(after.allowed).toEqual({ pdf: true, web: false, email: false });
    expect(after.can.toggle).toEqual({
      pdf: { ok: false, reason: PLATFORM_REFUSALS.oneChannel },
      web: { ok: true },
      email: { ok: true },
    });
    // The action refuses with the same sentence the switch carries.
    expect(await setChannelRule({ contentTypeId: "ct_disclosure", channel: "pdf", allowed: false })).toEqual(after.can.toggle.pdf);
  });
});
