import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACCESS_REFUSALS } from "@/domain/access";
import { PermissionError, REASONS } from "@/domain/permissions";
import type { Db } from "@/server/db/client";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { decideAccessRequest, requestAccess } from "@/server/actions/access";
import { runAccessSweep } from "@/server/access-sweep";
import {
  getAccessRequestsSection,
  getHomeCard,
  getInactivitySection,
  getMembersSection,
  getRecertificationSection,
  getRequestAccessData,
  getSidebarCards,
} from "./access";

// The access read models against a temporary database filled by the real seed.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-access-queries-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

let db: Db;
let libsql: Client;

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: BASE });
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

let minute = 0;
async function as(userId: string) {
  minute += 1;
  env.now = new Date(BASE.getTime() + minute * 60_000);
  vi.mocked(getViewer).mockResolvedValue(await loadPersona(db, userId));
}

describe("access read models", () => {
  it("Request access: every team with its admin; nothing asked or ended yet", async () => {
    await as("morgan");
    const data = await getRequestAccessData();
    expect(data.teams.map((t) => [t.slug, t.admins.map((a) => a.id), t.myRoles])).toEqual([
      ["card-statements", ["hana"], []],
      ["coral-offers", ["alex"], []],
      ["deposits", ["naomi"], []],
    ]);
    expect(data.requests).toEqual([]);
    expect(data.ended).toEqual([]);
    expect(data.roles).toEqual(["viewer", "author", "approver"]);
    expect(await getHomeCard()).toBeNull();
  });

  it("Morgan's pending request replaces the form and fills the home card; Alex's card counts it", async () => {
    await as("alex");
    expect(await getSidebarCards()).toEqual({
      "coral-offers": expect.objectContaining({ kind: "access_requests", count: 1, firstName: "Chris", role: "author" }),
    });

    await as("morgan");
    expect((await requestAccess({ teamId: "coral-offers", role: "author", reason: "Spring offers." })).ok).toBe(true);
    await as("morgan");
    const data = await getRequestAccessData();
    expect(data.requests).toEqual([
      expect.objectContaining({ teamId: "coral-offers", teamName: "Coral Offers", role: "author", status: "pending" }),
    ]);
    expect(await getHomeCard()).toEqual(
      expect.objectContaining({ kind: "my_request", teamName: "Coral Offers", role: "author", adminName: "Alex Kim" }),
    );

    await as("alex");
    const cards = await getSidebarCards();
    expect(cards["coral-offers"]).toMatchObject({ kind: "access_requests", count: 2, firstName: "Morgan" });
    await as("jordan");
    expect(await getSidebarCards()).toEqual({ "coral-offers": null });
  });

  it("Access requests section: pending oldest first; your own request can't be decided", async () => {
    await as("alex");
    const section = await getAccessRequestsSection("coral-offers");
    expect(section.pending.map((r) => [r.person.id, r.can.decide.ok])).toEqual([
      ["chris", true],
      ["morgan", true],
    ]);
    expect(section.decided).toEqual([]);
  });

  it("Members section: active first, by name; nobody can change their own access", async () => {
    await as("alex");
    const section = await getMembersSection("coral-offers");
    expect(section.rows.map((r) => r.person.id)).toEqual(["alex", "dana", "devon", "jordan", "maya", "priya", "sam"]);
    const alex = section.rows.find((r) => r.isYou)!;
    expect(alex.person.id).toBe("alex");
    expect(alex.can.remove).toEqual({ ok: false, reason: REASONS.ownAccess });
    const maya = section.rows.find((r) => r.person.id === "maya")!;
    expect(maya.can).toEqual({
      editRoles: { ok: true },
      remove: { ok: true },
      reinstate: { ok: false, reason: ACCESS_REFUSALS.alreadyActive },
    });
    await as("maya");
    await expect(getMembersSection("coral-offers")).rejects.toBeInstanceOf(PermissionError);
  });

  it("Recertification and Inactivity sections, and the recert card once requests are decided", async () => {
    await as("alex");
    const recert = await getRecertificationSection("coral-offers");
    expect(recert.current).toMatchObject({ phase: "open", progress: { label: "0 of 6 confirmed" }, lapsed: [] });
    expect(recert.current!.items.map((i) => [i.userId, i.can.decide.ok])).toEqual([
      ["dana", true],
      ["devon", true],
      ["jordan", true],
      ["maya", true],
      ["priya", true],
      ["sam", true],
    ]);
    expect(recert.can.start).toEqual({ ok: false, reason: ACCESS_REFUSALS.reviewOpen });

    const idle = await getInactivitySection("coral-offers");
    expect(idle.flagged.map((r) => [r.person.id, r.daysInactive, r.suspendsAt])).toEqual([
      ["devon", 95, new Date(BASE.getTime() + 25 * DAY).toISOString()],
    ]);
    expect(idle.suspended).toEqual([]);

    for (const r of (await getAccessRequestsSection("coral-offers")).pending) {
      await as("alex");
      expect((await decideAccessRequest({ requestId: r.id, decision: "deny", note: "Not now." })).ok).toBe(true);
    }
    await as("alex");
    expect((await getSidebarCards())["coral-offers"]).toMatchObject({
      kind: "recert_due",
      progressLabel: "0 of 6 confirmed",
    });
  });

  it("after 31 days: Sam's ended access shows on Request access; the closed review names who lapsed", async () => {
    env.now = new Date(BASE.getTime() + 31 * DAY);
    await runAccessSweep();
    vi.mocked(getViewer).mockResolvedValue(await loadPersona(db, "sam"));
    expect((await getRequestAccessData()).ended).toEqual([
      {
        teamId: "coral-offers",
        teamName: "Coral Offers",
        status: "lapsed",
        reason: "recert_unconfirmed",
        at: new Date(BASE.getTime() + 30 * DAY).toISOString(),
      },
    ]);

    vi.mocked(getViewer).mockResolvedValue(await loadPersona(db, "alex"));
    const recert = await getRecertificationSection("coral-offers");
    expect(recert.current!.phase).toBe("closed");
    expect(recert.current!.lapsed.map((p) => p.id)).toEqual(["dana", "jordan", "maya", "priya", "sam"]);
    // Everyone but Alex lapsed or was suspended: nobody left to review.
    expect(recert.can.start).toEqual({ ok: false, reason: ACCESS_REFUSALS.nobodyToReview });
    const idle = await getInactivitySection("coral-offers");
    expect(idle.suspended.map((r) => [r.person.id, r.statusReason])).toEqual([["devon", "inactivity_auto"]]);
    const members = await getMembersSection("coral-offers");
    expect(members.rows.find((r) => r.person.id === "sam")!.can.reinstate).toEqual({ ok: true });
  });
});
