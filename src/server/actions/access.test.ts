import { rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq, isNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { refresh, revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_REFUSALS } from "@/domain/access";
import { REASONS } from "@/domain/permissions";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { seedDatabase } from "@/server/seed";
import { loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import {
  changeMemberRoles,
  decideAccessRequest,
  decideRecertItem,
  keepInactive,
  reinstateMember,
  removeMember,
  requestAccess,
  startRecertification,
  suspendInactive,
} from "./access";

// The access actions end to end against a temporary database filled by the real seed. Only the
// database handle, the demo clock, the persona and Next's cache calls are swapped. Seed facts: Alex is
// Coral Offers' only Team Admin; Chris has a pending Author request on Coral; the Coral review is open
// and covers Dana, Devon, Jordan, Maya, Priya and Sam; Devon is flagged (95 days without a sign-in).

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-access-actions-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const { accessRequests, auditEvents, memberships, membershipRoles, notifications, recertifications, recertItems, users } =
  schema;
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

// Every step happens a minute after the last, as a persona read fresh from the database.
let minute = 0;
async function as(userId: string, viewer?: Viewer) {
  minute += 1;
  env.now = new Date(BASE.getTime() + minute * 60_000);
  vi.mocked(getViewer).mockResolvedValue(viewer ?? (await loadPersona(db, userId)));
  return env.now;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

const membershipOf = async (userId: string, teamId = "coral-offers") => {
  const m = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.teamId, teamId)),
  });
  if (!m) return null;
  const roles = await db.select().from(membershipRoles).where(eq(membershipRoles.membershipId, m.id));
  return { ...m, roles: roles.map((r) => r.role).sort() };
};
const membershipId = async (userId: string, teamId = "coral-offers") => (await membershipOf(userId, teamId))!.id;
const auditAt = (at: Date) => db.select().from(auditEvents).where(eq(auditEvents.at, at)).orderBy(auditEvents.action);
const notificationsAt = (at: Date) =>
  db.select().from(notifications).where(eq(notifications.createdAt, at)).orderBy(notifications.userId);
const requestCount = async () => (await db.select().from(accessRequests)).length;
const coralRecert = async () =>
  (await db.query.recertifications.findFirst({ where: eq(recertifications.teamId, "coral-offers") }))!;

// ── Requesting and deciding access (scenario 8) ──────────────

describe("requesting and deciding access", () => {
  let morganRequest: string;

  it("Morgan asks for Author on Coral Offers; Alex (the Team Admin) is told", async () => {
    const at = await as("morgan");
    const result = await requestAccess({ teamId: "coral-offers", role: "author", reason: "  Drafting the spring offers.  " });
    expect(result).toEqual({ ok: true, requestId: expect.stringMatching(/^ar_/) });
    if (!result.ok) return;
    morganRequest = result.requestId;
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(refresh).toHaveBeenCalledTimes(1);

    expect(await db.query.accessRequests.findFirst({ where: eq(accessRequests.id, morganRequest) })).toMatchObject({
      userId: "morgan",
      teamId: "coral-offers",
      role: "author",
      reason: "Drafting the spring offers.",
      status: "pending",
      createdAt: at,
    });
    expect((await auditAt(at)).map((r) => [r.action, r.actorId, r.teamId])).toEqual([
      ["access.requested", "morgan", "coral-offers"],
    ]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind, n.title, n.href])).toEqual([
      [
        "alex",
        "access_requested",
        "Morgan Lee asked for Author access to Coral Offers.",
        "/coral-offers/settings/access-requests",
      ],
    ]);
  });

  it("refuses a second pending request, an empty reason, Team Admin, a role already held and an unknown team", async () => {
    const before = await requestCount();
    await as("morgan");
    expect(await requestAccess({ teamId: "coral-offers", role: "viewer", reason: "Also this." })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.pending("Coral Offers"),
    });
    expect(await requestAccess({ teamId: "deposits", role: "viewer", reason: "   " })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.giveReason,
    });
    expect(
      await requestAccess({ teamId: "deposits", role: "team_admin" as never, reason: "Please." }),
    ).toEqual({ ok: false, ...ACCESS_REFUSALS.pickRole });
    expect(await requestAccess({ teamId: "nowhere", role: "viewer", reason: "Please." })).toEqual({
      ok: false,
      code: "team_gone",
      reason: "This team no longer exists.",
    });
    await as("maya");
    expect(await requestAccess({ teamId: "coral-offers", role: "author", reason: "Again." })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.hasRole("author", "Coral Offers"),
    });
    expect(await requestCount()).toBe(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a decision from someone who isn't the team's Team Admin, and on your own request", async () => {
    await as("jordan");
    expect(await decideAccessRequest({ requestId: morganRequest, decision: "approve" })).toEqual({
      ok: false,
      ...REASONS.generic,
    });
    await as("alex");
    const own = await requestAccess({ teamId: "coral-offers", role: "viewer", reason: "Checking the read-only view." });
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    await as("alex");
    expect(await decideAccessRequest({ requestId: own.requestId, decision: "approve" })).toEqual({
      ok: false,
      ...REASONS.ownRequest,
    });
    expect((await db.query.accessRequests.findFirst({ where: eq(accessRequests.id, own.requestId) }))!.status).toBe(
      "pending",
    );
  });

  it("a denial needs a note, which the requester sees", async () => {
    const chris = (await db.query.accessRequests.findFirst({ where: eq(accessRequests.userId, "chris") }))!;
    await as("alex");
    expect(await decideAccessRequest({ requestId: chris.id, decision: "deny", note: "  " })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.denyNote,
    });
    const at = await as("alex");
    expect(
      await decideAccessRequest({ requestId: chris.id, decision: "deny", note: "Ask again once your start date is set." }),
    ).toEqual({ ok: true });
    expect(await db.query.accessRequests.findFirst({ where: eq(accessRequests.id, chris.id) })).toMatchObject({
      status: "denied",
      decidedBy: "alex",
      decidedAt: at,
      decisionNote: "Ask again once your start date is set.",
    });
    expect(await membershipOf("chris")).toBeNull();
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["access.denied"]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind, n.body, n.href])).toEqual([
      ["chris", "access_denied", "Ask again once your start date is set.", "/request-access"],
    ]);
  });

  it("Alex approves Morgan: a membership with the role, and Morgan is told", async () => {
    const at = await as("alex");
    expect(await decideAccessRequest({ requestId: morganRequest, decision: "approve" })).toEqual({ ok: true });
    expect(await membershipOf("morgan")).toMatchObject({
      status: "active",
      roles: ["author"],
      addedAt: at,
      addedBy: "alex",
    });
    expect(await db.query.accessRequests.findFirst({ where: eq(accessRequests.id, morganRequest) })).toMatchObject({
      status: "approved",
      decidedBy: "alex",
      decisionNote: null,
    });
    expect((await auditAt(at)).map((r) => [r.action, r.actorId])).toEqual([["access.granted", "alex"]]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind, n.href])).toEqual([
      ["morgan", "access_granted", "/coral-offers/library"],
    ]);
    expect((await loadPersona(db, "morgan")).memberships.map((m) => m.teamSlug)).toEqual(["coral-offers"]);

    await as("alex");
    expect(await decideAccessRequest({ requestId: morganRequest, decision: "approve" })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.decided,
    });
  });
});

// ── Members ──────────────────────────────────────────────────

describe("the Auditor holds no team role (adversarial review fix)", () => {
  it("Taylor can't ask for one: the refusal says why, and nothing is written", async () => {
    const before = await requestCount();
    const at = await as("taylor");
    expect(await requestAccess({ teamId: "deposits", role: "approver", reason: "Spot checks." })).toEqual({
      ok: false,
      ...REASONS.auditorReadOnly,
    });
    expect(await requestCount()).toBe(before);
    expect(await auditAt(at)).toEqual([]);
  });

  it("a request Taylor already has can't be approved, only denied", async () => {
    await db.insert(accessRequests).values({
      id: "ar_taylor_test",
      userId: "taylor",
      teamId: "coral-offers",
      role: "approver",
      reason: "Made before the audit role.",
      createdAt: BASE,
    });
    await as("alex");
    expect(await decideAccessRequest({ requestId: "ar_taylor_test", decision: "approve" })).toEqual({
      ok: false,
      code: "requester_is_auditor",
      reason: "Taylor Nguyen is an Auditor and can't hold team roles.",
    });
    expect(await membershipOf("taylor")).toBeNull();
    expect(await decideAccessRequest({ requestId: "ar_taylor_test", decision: "deny", note: "Auditors are read-only." })).toEqual({ ok: true });
  });
});

describe("members", () => {
  it("nobody changes their own access", async () => {
    const alex = await membershipId("alex");
    await as("alex");
    for (const result of [
      await changeMemberRoles({ membershipId: alex, roles: ["approver"] }),
      await removeMember({ membershipId: alex }),
      await suspendInactive({ membershipId: alex }),
      await keepInactive({ membershipId: alex }),
      await reinstateMember({ membershipId: alex }),
    ]) {
      expect(result).toEqual({ ok: false, ...REASONS.ownAccess });
    }
    expect((await membershipOf("alex"))!.roles).toEqual(["approver", "team_admin"]);
  });

  it("a Team Admin manages only their own team", async () => {
    await as("alex");
    expect(await removeMember({ membershipId: await membershipId("priya", "deposits") })).toEqual({
      ok: false,
      ...REASONS.generic,
    });
    await as("maya");
    expect(await removeMember({ membershipId: await membershipId("sam") })).toEqual({
      ok: false,
      ...REASONS.generic,
    });
  });

  it("changes a member's roles, and the member is told", async () => {
    const at = await as("alex");
    expect(await changeMemberRoles({ membershipId: await membershipId("morgan"), roles: ["approver", "author"] })).toEqual({
      ok: true,
    });
    expect((await membershipOf("morgan"))!.roles).toEqual(["approver", "author"]);
    const [audit] = await auditAt(at);
    expect(audit).toMatchObject({ action: "access.role_changed", details: { from: ["author"], to: ["author", "approver"] } });
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind])).toEqual([["morgan", "roles_changed"]]);

    await as("alex");
    expect(await changeMemberRoles({ membershipId: await membershipId("morgan"), roles: [] })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.pickRoles,
    });
  });

  it("keeps the last Team Admin: two admins demoting each other at once, the second is refused", async () => {
    await as("alex");
    expect(
      await changeMemberRoles({ membershipId: await membershipId("jordan"), roles: ["approver", "team_admin"] }),
    ).toEqual({ ok: true });
    const staleAlex = await loadPersona(db, "alex"); // Alex's page, loaded while he was still an admin
    await as("jordan");
    expect(await changeMemberRoles({ membershipId: await membershipId("alex"), roles: ["approver"] })).toEqual({ ok: true });
    await as("alex", staleAlex);
    expect(await changeMemberRoles({ membershipId: await membershipId("jordan"), roles: ["approver"] })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.lastAdmin("Coral Offers"),
    });
    expect(await removeMember({ membershipId: await membershipId("jordan") })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.lastAdmin("Coral Offers"),
    });

    // Put the seed back: Alex is the only Team Admin again.
    await as("jordan");
    expect(
      await changeMemberRoles({ membershipId: await membershipId("alex"), roles: ["approver", "team_admin"] }),
    ).toEqual({ ok: true });
    await as("alex");
    expect(await changeMemberRoles({ membershipId: await membershipId("jordan"), roles: ["approver"] })).toEqual({ ok: true });
    expect((await membershipOf("jordan"))!.roles).toEqual(["approver"]);
  });

  it("removes a member: the membership is gone, and they're told", async () => {
    const at = await as("alex");
    expect(await removeMember({ membershipId: await membershipId("morgan") })).toEqual({ ok: true });
    expect(await membershipOf("morgan")).toBeNull();
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["access.removed"]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind, n.href])).toEqual([
      ["morgan", "access_removed", "/request-access"],
    ]);
    expect(await removeMember({ membershipId: "m_gone" })).toEqual({ ok: false, code: "no_longer_member", reason: "This person is no longer a member." });
  });
});

// ── Inactivity ───────────────────────────────────────────────

describe("inactivity", () => {
  it("refuses to suspend or keep someone who signed in recently", async () => {
    await as("alex");
    expect(await keepInactive({ membershipId: await membershipId("maya") })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.notFlagged,
    });
    expect(await suspendInactive({ membershipId: await membershipId("maya") })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.notFlagged,
    });
  });

  it("suspends flagged Devon, then reinstates him with a fresh inactivity clock", async () => {
    const devon = await membershipId("devon");
    const at = await as("alex");
    expect(await suspendInactive({ membershipId: devon })).toEqual({ ok: true });
    expect(await membershipOf("devon")).toMatchObject({
      status: "suspended",
      statusReason: "inactivity",
      statusChangedAt: at,
      roles: ["viewer"],
    });
    expect((await auditAt(at)).map((r) => [r.action, (r.details as { reason?: string }).reason])).toEqual([
      ["access.suspended", "inactivity"],
    ]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind])).toEqual([["devon", "access_suspended"]]);

    const back = await as("alex");
    expect(await reinstateMember({ membershipId: devon })).toEqual({ ok: true });
    expect(await membershipOf("devon")).toMatchObject({
      status: "active",
      statusReason: null,
      inactivityFlaggedAt: null,
      inactivityKeptAt: back,
      roles: ["viewer"],
    });
    await as("alex");
    expect(await reinstateMember({ membershipId: devon })).toEqual({ ok: false, ...ACCESS_REFUSALS.alreadyActive });
    expect(await keepInactive({ membershipId: devon })).toEqual({ ok: false, ...ACCESS_REFUSALS.notFlagged });
  });

  it("keeps a flagged member: the clock restarts", async () => {
    // Dana joined 60 days ago: make her last sign-in and her joining both 100 days old.
    const longAgo = new Date(BASE.getTime() - 100 * DAY);
    await db.update(users).set({ lastActiveAt: longAgo }).where(eq(users.id, "dana"));
    await db.update(memberships).set({ addedAt: longAgo }).where(eq(memberships.id, await membershipId("dana")));
    const at = await as("alex");
    expect(await keepInactive({ membershipId: await membershipId("dana") })).toEqual({ ok: true });
    expect(await membershipOf("dana")).toMatchObject({ status: "active", inactivityKeptAt: at, inactivityFlaggedAt: null });
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["access.kept"]);
    await as("alex");
    expect(await keepInactive({ membershipId: await membershipId("dana") })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.notFlagged,
    });
  });
});

// ── Recertification ──────────────────────────────────────────

describe("recertification", () => {
  const item = async (recertId: string, userId: string) =>
    db.query.recertItems.findFirst({ where: and(eq(recertItems.recertId, recertId), eq(recertItems.userId, userId)) });

  it("refuses your own item, someone outside the review, and a non-admin", async () => {
    const recert = await coralRecert();
    await as("alex");
    expect(await decideRecertItem({ recertId: recert.id, userId: "alex", decision: "keep" })).toEqual({
      ok: false,
      ...REASONS.ownAccess,
    });
    expect(await decideRecertItem({ recertId: recert.id, userId: "morgan", decision: "keep" })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.notInReview,
    });
    await as("jordan");
    expect(await decideRecertItem({ recertId: recert.id, userId: "sam", decision: "keep" })).toEqual({
      ok: false,
      ...REASONS.generic,
    });
    expect(await startRecertification({ teamId: "coral-offers" })).toEqual({ ok: false, ...REASONS.generic });
  });

  it("keeps four, removes Priya (her access ends at once), and refuses a second decision", async () => {
    const recert = await coralRecert();
    for (const userId of ["dana", "devon", "jordan", "maya"]) {
      const at = await as("alex");
      expect(await decideRecertItem({ recertId: recert.id, userId, decision: "keep" })).toEqual({ ok: true });
      expect(await item(recert.id, userId)).toMatchObject({ decision: "keep", decidedBy: "alex", decidedAt: at });
    }
    const at = await as("alex");
    expect(await decideRecertItem({ recertId: recert.id, userId: "priya", decision: "remove" })).toEqual({ ok: true });
    expect(await membershipOf("priya")).toBeNull();
    expect(await membershipOf("priya", "deposits")).toMatchObject({ status: "active" }); // other teams untouched
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["recert.removed"]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind])).toEqual([["priya", "access_removed"]]);
    expect((await coralRecert()).completedAt).toBeNull();

    await as("alex");
    expect(await decideRecertItem({ recertId: recert.id, userId: "maya", decision: "remove" })).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.alreadyReviewed,
    });
  });

  it("the last decision closes the review early; then nothing more can be decided", async () => {
    const recert = await coralRecert();
    const at = await as("alex");
    expect(await decideRecertItem({ recertId: recert.id, userId: "sam", decision: "keep" })).toEqual({ ok: true });
    expect((await coralRecert()).completedAt).toEqual(at);
    const audit = await auditAt(at);
    expect(audit.map((r) => r.action)).toEqual(["recert.closed", "recert.kept"]);
    expect(audit[0]!.details).toMatchObject({ kept: 5, removed: 1, lapsed: 0 });

    await as("alex");
    const late = await decideRecertItem({ recertId: recert.id, userId: "sam", decision: "remove" });
    expect(late).toEqual({ ok: false, code: "recert_closed", reason: expect.stringMatching(/^This review closed on /) });
  });

  it("starts a new review over the current members, due in 30 days; only one at a time", async () => {
    const at = await as("alex");
    const result = await startRecertification({ teamId: "coral-offers" });
    expect(result).toEqual({ ok: true, recertId: expect.stringMatching(/^rc_/) });
    if (!result.ok) return;
    expect(await db.query.recertifications.findFirst({ where: eq(recertifications.id, result.recertId) })).toMatchObject({
      teamId: "coral-offers",
      startsAt: at,
      dueAt: new Date(at.getTime() + 30 * DAY),
      completedAt: null,
    });
    const items = await db.select().from(recertItems).where(eq(recertItems.recertId, result.recertId)).orderBy(recertItems.userId);
    expect(items.map((i) => [i.userId, i.decision])).toEqual([
      ["dana", null],
      ["devon", null],
      ["jordan", null],
      ["maya", null],
      ["sam", null],
    ]);
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["recert.started"]);

    await as("alex");
    expect(await startRecertification({ teamId: "coral-offers" })).toEqual({ ok: false, ...ACCESS_REFUSALS.reviewOpen });
  });

  it("runs the sweep first: a past-due review is closed, with its lapses, before a new one starts", async () => {
    const open = await db.query.recertifications.findFirst({
      where: and(eq(recertifications.teamId, "coral-offers"), isNull(recertifications.completedAt)),
    });
    expect(open).toBeDefined();
    if (!open) return;
    await as("alex");
    env.now = new Date(open.dueAt.getTime() + DAY); // the deadline passed with nobody signing in
    // Every undecided member ended at the deadline, so nobody is left for a new review.
    expect(await startRecertification({ teamId: "coral-offers" })).toEqual({ ok: false, ...ACCESS_REFUSALS.nobodyToReview });
    expect((await db.query.recertifications.findFirst({ where: eq(recertifications.id, open.id) }))?.completedAt).toEqual(open.dueAt);
    expect(await membershipOf("sam")).toMatchObject({ status: "lapsed", statusChangedAt: open.dueAt });
    expect(await membershipOf("alex")).toMatchObject({ status: "active" });
  });
});
