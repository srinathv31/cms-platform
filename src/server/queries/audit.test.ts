import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseCsv } from "@/domain/audit";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { getAuditExport, getAuditPage } from "./audit";

// The Audit page and its export against a temporary database filled by the real seed: three teams
// (Coral Offers, Deposits, Card Statements), their memberships granted by Riley and the Team Admins,
// platform-wide configuration events (team null), Chris's pending request and Devon's inactivity flag.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-audit-queries-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let libsql: Client;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: BASE });
  for (const id of ["taylor", "riley", "alex", "maya"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

function as(userId: string) {
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
}

const isNextError = (digest: string) => (e: unknown) =>
  typeof e === "object" && e !== null && String((e as { digest?: unknown }).digest).startsWith(digest);

describe("getAuditPage: who sees what", () => {
  it("shows the Auditor every team and the platform-wide events in All teams", async () => {
    as("taylor");
    const page = await getAuditPage("all", {});
    expect(page.space).toEqual({ slug: "all", isAll: true, name: "All teams" });
    const teams = new Set(page.rows.map((r) => r.team?.slug ?? null));
    expect(teams).toEqual(new Set(["coral-offers", "deposits", "card-statements", null]));
    expect(page.total).toBe(page.rows.length);
    expect(page.options.teams.map((t) => t.slug).sort()).toEqual(["card-statements", "coral-offers", "deposits"]);
    expect(page.options.categories.map((c) => c.value)).toEqual(["templates", "access", "platform"]);
    expect(page.options.people.at(-1)).toMatchObject({ id: "system", name: "UCOMP" });
    expect(page.options.datePresets.map((p) => p.days)).toEqual([7, 30, 90]);
    expect(page.today).toBe("2026-10-04");
    expect(page.csvHref).toBe("/all/audit/export");
    // Newest first.
    const ats = page.rows.map((r) => r.at);
    expect(ats).toEqual([...ats].sort().reverse());
  });

  it("pins a team space to its team, for the Auditor and for its Team Admin", async () => {
    for (const who of ["taylor", "alex"]) {
      as(who);
      const page = await getAuditPage("coral-offers", { team: "deposits" });
      expect(page.rows.length).toBeGreaterThan(0);
      expect(page.rows.every((r) => r.team?.slug === "coral-offers")).toBe(true);
      expect(page.applied.team).toBeUndefined();
      expect(page.options.teams).toEqual([]);
    }
  });

  it("hides the page from people without audit.view, and All teams from a Team Admin", async () => {
    as("maya");
    await expect(getAuditPage("coral-offers", {})).rejects.toSatisfy(isNextError("NEXT_HTTP_ERROR_FALLBACK;404"));
    as("alex");
    await expect(getAuditPage("all", {})).rejects.toSatisfy(isNextError("NEXT_REDIRECT"));
    as("alex");
    await expect(getAuditPage("deposits", {})).rejects.toSatisfy(isNextError("NEXT_REDIRECT"));
  });

  it("writes rows with a sentence, labels and demo-clock times", async () => {
    as("taylor");
    const page = await getAuditPage("all", {});
    for (const r of page.rows) {
      expect(r.summary, r.action).toMatch(/[.]$/);
      expect(r.actionLabel).toBeTruthy();
      // UTC, labelled; the year only when it isn't the demo clock's.
      expect(r.when).toMatch(/^[A-Z][a-z]{2} \d{1,2}, (20\d\d, )?\d{1,2}:\d\d [AP]M UTC$/);
      expect(r.ago).toBeTruthy();
    }
    const flagged = page.rows.find((r) => r.action === "access.flagged_inactive")!;
    expect(flagged).toMatchObject({ actor: null, subject: { id: "devon" }, category: "access", ago: "5 days ago" });
    const config = page.rows.find((r) => r.action === "platform.config_changed" && r.team === null)!;
    expect(config.category).toBe("platform");
    const submitted = page.rows.find((r) => r.action === "version.submitted")!;
    expect(submitted.template?.id).toMatch(/^UC-/);
    expect(submitted.versionNumber).toEqual(expect.any(Number));
  });
});

describe("getAuditPage: filters", () => {
  it("filters by person, action and team together, with counts under the other filters", async () => {
    as("taylor");
    const all = await getAuditPage("all", {});
    const page = await getAuditPage("all", { team: "coral-offers", person: "alex", action: "access" });
    expect(page.rows.length).toBeGreaterThan(0);
    for (const r of page.rows) {
      expect(r.team?.slug).toBe("coral-offers");
      expect(r.category).toBe("access");
      expect([r.actor?.id, r.subject?.id]).toContain("alex");
    }
    const alexOption = page.options.people.find((p) => p.id === "alex")!;
    expect(alexOption.count).toBe(page.total);
    const accessOption = page.options.categories.find((c) => c.value === "access")!;
    expect(accessOption.count).toBe(page.total);
    // The team menu counts ignore the team pick: Deposits shows its own count.
    expect(page.options.teams.find((t) => t.slug === "deposits")!.count).toBeGreaterThanOrEqual(0);
    expect(page.csvHref).toBe("/all/audit/export?team=coral-offers&person=alex&action=access");
    expect(page.total).toBeLessThan(all.total);
  });

  it("filters by template and by demo-clock day", async () => {
    as("taylor");
    const all = await getAuditPage("all", {});
    const template = all.options.templates[0]!;
    const page = await getAuditPage("all", { template: template.id });
    expect(page.total).toBe(template.count);
    expect(page.rows.every((r) => r.template?.id === template.id)).toBe(true);

    const today = await getAuditPage("all", { from: "2026-10-04", to: "2026-10-04" });
    expect(today.rows.every((r) => r.at.startsWith("2026-10-04"))).toBe(true);
    const week = all.options.datePresets[0]!;
    const lastWeek = await getAuditPage("all", { from: week.from, to: week.to });
    expect(lastWeek.total).toBeGreaterThanOrEqual(today.total);
    expect(lastWeek.total).toBeLessThan(all.total);
  });

  it("drops values the space doesn't know", async () => {
    as("taylor");
    const page = await getAuditPage("all", { team: "nowhere", person: "nobody,alex", template: "UC-ZZZZZZ" });
    expect(page.applied).toEqual({ person: "alex" });
  });
});

describe("getAuditExport", () => {
  it("exports every matching event as CSV, permission-checked", async () => {
    as("taylor");
    const page = await getAuditPage("all", { action: "access" });
    const out = await getAuditExport(people.taylor!, "all", { action: "access" });
    if (!out.ok) throw new Error(out.reason);
    expect(out.filename).toBe("ucomp-audit-all-2026-10-04.csv");
    expect(out.count).toBe(page.total);
    const lines = parseCsv(out.csv);
    expect(lines[0]).toEqual(["When", "Who", "Team", "Template", "Version", "Action", "Details"]);
    expect(lines).toHaveLength(page.total + 1);
    expect(lines[1]![0]).toBe(page.rows[0]!.at);
    // Chris's request reason has a comma and an apostrophe: it survives the round trip.
    const request = lines.find((l) => l[5] === "Access requested")!;
    expect(request[6]).toContain("I'm joining the Offers content team next week");
  });

  it("refuses a space without audit.view (403) and an unknown team (404)", async () => {
    expect(await getAuditExport(people.maya!, "coral-offers", {})).toMatchObject({ ok: false, status: 403 });
    expect(await getAuditExport(people.alex!, "all", {})).toMatchObject({ ok: false, status: 403 });
    expect(await getAuditExport(people.alex!, "deposits", {})).toMatchObject({ ok: false, status: 403 });
    expect(await getAuditExport(people.taylor!, "nowhere", {})).toMatchObject({ ok: false, status: 404 });
    const own = await getAuditExport(people.alex!, "coral-offers", {});
    expect(own.ok).toBe(true);
    const riley = await getAuditExport(people.riley!, "deposits", {});
    expect(riley.ok).toBe(true);
  });
});
