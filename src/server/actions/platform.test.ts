import { readFileSync, readdirSync, rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, asc, eq, gte } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { refresh, revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformActions } from "@/domain/access-types";
import { REFUSALS } from "@/domain/lifecycle";
import { REASONS } from "@/domain/permissions";
import { PLATFORM_REFUSALS, validateChain } from "@/domain/platform-config";
import type { ApproverRule, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { getApprovalChainsSection, getChannelRulesSection, getContentTypesSection, getTeamsSection } from "@/server/queries/platform";
import { getReviewBadgeCount, getReviewQueue, getReviewScreen } from "@/server/queries/review";
import { seedDatabase } from "@/server/seed";
import { createTemplateWithDraft, draftRev, loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { addComment } from "./comments";
import { createTeam, saveApprovalChain, setChannelRule, updateContentType } from "./platform";
import { approveVersion, submitVersion } from "./review";

// Platform settings and the two-stage approval they enable, end to end against a temporary database
// filled by the real seed. Only the database handle, the demo clock, the persona and Next's cache
// calls are swapped.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-platform-actions-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

// The contract (access-types.ts): the actions have exactly these signatures.
const _contract: PlatformActions = { createTeam, updateContentType, setChannelRule, saveApprovalChain };
void _contract;

const { approvals, approvalStages, auditEvents, contentTypes, membershipRoles, memberships, notifications, teams, versions } =
  schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const CT = "ct_disclosure";
const TEAM_STAGE = "stage_disclosure_0";
const TEAM_RULE: ApproverRule = { kind: "team_role", role: "approver" };
const LEGAL = { name: "Legal reviewer", rule: { kind: "user", userId: "dana" } as ApproverRule };

let db: Db;
let libsql: Client;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await seedDatabase(db, { base: BASE });
  for (const id of ["maya", "jordan", "alex", "sam", "riley", "dana", "eli", "naomi"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

let minute = 0;
function as(userId: string) {
  minute += 1;
  env.now = new Date(BASE.getTime() + minute * 60_000);
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
  return env.now;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

const auditAt = (at: Date) => db.select().from(auditEvents).where(gte(auditEvents.at, at)).orderBy(asc(auditEvents.id));
const notificationsAt = (at: Date) =>
  db.select().from(notifications).where(gte(notifications.createdAt, at)).orderBy(asc(notifications.userId));
const chain = () =>
  db.select().from(approvalStages).where(eq(approvalStages.contentTypeId, CT)).orderBy(asc(approvalStages.position));
const versionOf = (templateId: string) =>
  db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.number, 1)) });
const approve = (templateId: string) => approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: ["typical"] });

/**
 * Back to the seeded chain: the team's approvers only. A stage a version in review still needs can't be
 * removed, so this file's versions still in review are taken out of review first.
 */
async function resetChain() {
  as("riley");
  const current = await chain();
  if (current.length === 1 && current[0]!.id === TEAM_STAGE) return;
  const extra = current.filter((s) => s.id !== TEAM_STAGE).map((s) => s.id);
  for (const v of await db.select().from(versions).where(eq(versions.state, "in_review"))) {
    if (v.stages?.some((s) => extra.includes(s.id))) {
      await db.update(versions).set({ state: "changes_requested" }).where(eq(versions.id, v.id));
    }
  }
  expect(await saveApprovalChain({ contentTypeId: CT, stages: [{ id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE }] })).toEqual({
    ok: true,
  });
}

async function submitted(teamId: string, author: string) {
  const { templateId } = await createTemplateWithDraft(db, { teamId, createdBy: author, at: env.now });
  as(author);
  expect(await submitVersion({ templateId, rev: await draftRev(db, templateId) })).toEqual({ ok: true, number: 1 });
  return templateId;
}

// ── Permission ────────────────────────────────────────────────

describe("only a Platform Admin", () => {
  it("refuses everyone else, and writes nothing", async () => {
    for (const id of ["alex", "maya", "dana"]) {
      const at = as(id);
      expect(await createTeam({ name: "Home Loans", description: "", icon: "home", adminUserId: "alex" })).toEqual({
        ok: false,
        reason: REASONS.generic,
      });
      expect(await setChannelRule({ contentTypeId: CT, channel: "email", allowed: false })).toEqual({ ok: false, reason: REASONS.generic });
      expect(await updateContentType({ contentTypeId: CT, requiredSections: [] })).toEqual({ ok: false, reason: REASONS.generic });
      expect(await saveApprovalChain({ contentTypeId: CT, stages: [] })).toEqual({ ok: false, reason: REASONS.generic });
      expect(await auditAt(at)).toEqual([]);
    }
    await expect(getTeamsSection()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

// ── Teams ─────────────────────────────────────────────────────

describe("createTeam", () => {
  it("creates Home Loans with Alex as its first Team Admin, records it and tells Alex", async () => {
    const at = as("riley");
    expect(await createTeam({ name: "Home Loans", description: "Mortgage disclosures.", icon: "home", adminUserId: "alex" })).toEqual({
      ok: true,
      slug: "home-loans",
    });
    expect(await db.query.teams.findFirst({ where: eq(teams.id, "home-loans") })).toMatchObject({
      slug: "home-loans",
      name: "Home Loans",
      icon: "home",
      createdAt: at,
    });
    const membership = await db.query.memberships.findFirst({
      where: and(eq(memberships.teamId, "home-loans"), eq(memberships.userId, "alex")),
    });
    expect(membership).toMatchObject({ status: "active", addedBy: "riley" });
    expect((await db.select().from(membershipRoles).where(eq(membershipRoles.membershipId, membership!.id))).map((r) => r.role)).toEqual([
      "team_admin",
    ]);
    expect((await auditAt(at)).map((r) => [r.action, r.teamId, r.actorId]).sort()).toEqual([
      ["access.granted", "home-loans", "riley"],
      ["platform.config_changed", "home-loans", "riley"],
    ]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind, n.href])).toEqual([
      ["alex", "team_admin_appointed", "/home-loans/settings/members"],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(refresh).toHaveBeenCalledTimes(1);

    const teamsSection = await getTeamsSection();
    expect(teamsSection.teams.find((t) => t.slug === "home-loans")).toMatchObject({
      admins: [expect.objectContaining({ id: "alex" })],
      members: 1,
      templates: 0,
    });
    expect(teamsSection.people.some((p) => p.id === "morgan")).toBe(true);
  });

  it("refuses a taken name and an unknown person", async () => {
    as("riley");
    expect(await createTeam({ name: "coral offers", description: "", icon: "home", adminUserId: "alex" })).toEqual({
      ok: false,
      reason: "A team called Coral Offers already exists.",
    });
    expect(await createTeam({ name: "Auto Loans", description: "", icon: "car", adminUserId: "nobody" })).toEqual({
      ok: false,
      reason: PLATFORM_REFUSALS.pickPerson,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses an Auditor as the first Team Admin; the choices leave them out", async () => {
    const at = as("riley");
    expect(await createTeam({ name: "Auto Loans", description: "", icon: "car", adminUserId: "taylor" })).toEqual({
      ok: false,
      reason: "Taylor Nguyen is an Auditor and can't be a Team Admin.",
    });
    expect(await auditAt(at)).toEqual([]);
    expect((await getTeamsSection()).people.some((p) => p.id === "taylor")).toBe(false);
  });
});

// ── Content types ─────────────────────────────────────────────

describe("updateContentType", () => {
  it("renames, adds and removes required sections; existing templates keep theirs", async () => {
    as("riley");
    const before = (await getContentTypesSection()).types.find((t) => t.id === CT)!;
    expect(before.requiredSections.map((s) => s.key)).toEqual(["offer_details", "rates_and_fees", "legal_notices"]);
    expect(before.templates).toBeGreaterThan(0);

    const at = as("riley");
    const next = [
      { key: "offer_details", title: "Offer summary" },
      { key: "legal_notices", title: "Legal notices" },
      { key: "", title: "Privacy" },
    ];
    expect(await updateContentType({ contentTypeId: CT, requiredSections: next })).toEqual({ ok: true });
    expect((await db.query.contentTypes.findFirst({ where: eq(contentTypes.id, CT) }))?.requiredSections).toEqual([
      { key: "offer_details", title: "Offer summary" },
      { key: "legal_notices", title: "Legal notices" },
      { key: "privacy", title: "Privacy" },
    ]);
    expect((await auditAt(at)).map((r) => [r.action, r.teamId, (r.details as { area: string }).area])).toEqual([
      ["platform.config_changed", null, "content_types"],
    ]);

    // An existing draft that still has "Rates and fees" submits as before (nothing at submit checks sections).
    const templateId = await submitted("coral-offers", "maya");
    expect((await versionOf(templateId))?.state).toBe("in_review");

    // The same list again writes nothing; then back to the seeded sections.
    const again = as("riley");
    expect(await updateContentType({ contentTypeId: CT, requiredSections: next.map((s, i) => (i === 2 ? { ...s, key: "privacy" } : s)) })).toEqual({
      ok: true,
    });
    expect(await auditAt(again)).toEqual([]);
    as("riley");
    expect(await updateContentType({ contentTypeId: CT, requiredSections: before.requiredSections })).toEqual({ ok: true });
    expect((await db.query.contentTypes.findFirst({ where: eq(contentTypes.id, CT) }))?.requiredSections).toEqual(before.requiredSections);
  });

  it("refuses no sections and a duplicate title", async () => {
    as("riley");
    expect(await updateContentType({ contentTypeId: CT, requiredSections: [] })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.oneSection });
    expect(
      await updateContentType({
        contentTypeId: CT,
        requiredSections: [
          { key: "offer_details", title: "Offer details" },
          { key: "", title: "offer details" },
        ],
      }),
    ).toEqual({ ok: false, reason: "There are two sections called offer details." });
    expect(await updateContentType({ contentTypeId: "ct_nope", requiredSections: [{ key: "", title: "A" }] })).toEqual({
      ok: false,
      reason: "This content type no longer exists.",
    });
  });
});

// ── Channel rules ─────────────────────────────────────────────

describe("setChannelRule", () => {
  it("turning Email off counts the Active versions it stops; turning it on restores it", async () => {
    as("riley");
    const row = (await getChannelRulesSection()).rows.find((r) => r.contentTypeId === CT)!;
    expect(row.allowed).toEqual({ pdf: true, web: true, email: true });
    const activeEmail = (
      await db
        .select({ channels: versions.channels })
        .from(versions)
        .innerJoin(schema.templates, eq(schema.templates.id, versions.templateId))
        .where(and(eq(versions.state, "active"), eq(schema.templates.contentTypeId, CT)))
    ).filter((v) => v.channels.includes("email")).length;
    expect(row.activeUsing.email).toBe(activeEmail);

    const off = as("riley");
    expect(await setChannelRule({ contentTypeId: CT, channel: "email", allowed: false })).toEqual({ ok: true });
    expect((await db.query.contentTypes.findFirst({ where: eq(contentTypes.id, CT) }))?.allowedChannels).toEqual(["pdf", "web"]);
    const [audit] = await auditAt(off);
    expect(audit?.details).toMatchObject({ area: "channel_rules", channel: "email", allowed: false, activeUsing: activeEmail });

    as("riley");
    expect(await setChannelRule({ contentTypeId: CT, channel: "pdf", allowed: false })).toEqual({ ok: true });
    as("riley");
    expect(await setChannelRule({ contentTypeId: CT, channel: "web", allowed: false })).toEqual({
      ok: false,
      reason: PLATFORM_REFUSALS.oneChannel,
    });

    for (const channel of ["pdf", "email"] as const) {
      as("riley");
      expect(await setChannelRule({ contentTypeId: CT, channel, allowed: true })).toEqual({ ok: true });
    }
    expect((await db.query.contentTypes.findFirst({ where: eq(contentTypes.id, CT) }))?.allowedChannels).toEqual(["pdf", "web", "email"]);
  });
});

// ── Approval chains ───────────────────────────────────────────

describe("saveApprovalChain", () => {
  afterAll(resetChain);

  it("adds Dana Park's Legal reviewer stage; versions in review keep their stage", async () => {
    const waiting = await submitted("coral-offers", "maya");
    const at = as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages: [{ id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE }, LEGAL] })).toEqual({
      ok: true,
    });
    expect((await chain()).map((s) => [s.position, s.name, s.approverRule])).toEqual([
      [0, "Team approver", TEAM_RULE],
      [1, "Legal reviewer", LEGAL.rule],
    ]);
    expect((await chain())[0]!.id).toBe(TEAM_STAGE);
    expect((await versionOf(waiting))?.currentStage).toBe(0);
    expect((await auditAt(at)).map((r) => (r.details as { summary: string }).summary)).toEqual([
      "Set Disclosure approval chain: Team approver (Approver role) → Legal reviewer (Dana Park)",
    ]);

    const section = (await getApprovalChainsSection()).chains.find((c) => c.contentTypeId === CT)!;
    expect(section.stages.map((s) => [s.name, s.ruleLabel])).toEqual([
      ["Team approver", "Approver role"],
      ["Legal reviewer", "Dana Park"],
    ]);
    expect(section.stages[0]!.waiting).toBeGreaterThanOrEqual(1);
    const choices = (await getApprovalChainsSection()).people;
    expect(choices.find((p) => p.id === "dana")?.teams).toEqual(["Coral Offers"]);
    expect(choices.some((p) => p.id === "morgan")).toBe(false); // no access anywhere: could never act
  });

  it("leaves a version in review as it is when stages are reordered: it keeps its own stages", async () => {
    const templateId = await submitted("coral-offers", "maya");
    const legalId = (await chain())[1]!.id;
    const own = [
      { id: TEAM_STAGE, name: "Team approver" },
      { id: legalId, name: "Legal reviewer" },
    ];
    expect(await versionOf(templateId)).toMatchObject({ stages: own, currentStage: 0 });
    as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          { id: legalId, ...LEGAL },
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
        ],
      }),
    ).toEqual({ ok: true });
    expect(await versionOf(templateId)).toMatchObject({ stages: own, currentStage: 0 }); // still the Team approver stage
    as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
          { id: legalId, ...LEGAL },
        ],
      }),
    ).toEqual({ ok: true });
    expect(await versionOf(templateId)).toMatchObject({ stages: own, currentStage: 0 });
  });

  it("refuses naming an Auditor or someone with no access; the choices leave them out", async () => {
    as("riley");
    const team = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
    const naming = (userId: string) => ({ name: "Audit sign-off", rule: { kind: "user", userId } as ApproverRule });
    expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, naming("taylor")] })).toEqual({
      ok: false,
      reason: "Taylor Nguyen is an Auditor and can't approve.",
    });
    expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, naming("morgan")] })).toEqual({
      ok: false,
      reason: "Morgan Lee has no active access.",
    });
    expect((await getApprovalChainsSection()).people.some((p) => p.id === "taylor")).toBe(false);
  });

  it("refuses an admin naming themselves, or a Platform Admin with no team role; the choices leave them out", async () => {
    const before = await chain();
    const at = as("riley");
    // Keeping the stage id and switching its rule to the acting admin: the self-approval route.
    expect(await saveApprovalChain({ contentTypeId: CT, stages: [{ id: TEAM_STAGE, name: "Sign-off", rule: { kind: "user", userId: "riley" } }] })).toEqual({
      ok: false,
      reason: "You can't name yourself as an approver.",
    });
    expect(await auditAt(at)).toEqual([]);
    expect(await chain()).toEqual(before);
    expect((await getApprovalChainsSection()).people.some((p) => p.id === "riley")).toBe(false);

    // Another Platform Admin with no team role: a platform role alone is no approve power.
    await db.insert(schema.users).values({ id: "pat", name: "Pat Admin", email: "pat@example.test", initials: "PA", avatarHue: 10, title: "", platformRole: "platform_admin" });
    try {
      expect(await saveApprovalChain({ contentTypeId: CT, stages: [{ id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE }, { name: "Sign-off", rule: { kind: "user", userId: "pat" } }] })).toEqual({
        ok: false,
        reason: "Pat Admin is a Platform Admin with no team role and can't approve.",
      });
      expect((await getApprovalChainsSection()).people.some((p) => p.id === "pat")).toBe(false);
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, "pat"));
    }
  });

  it("an admin another admin named on a stage can still save the chain, but never names themselves", async () => {
    // Casey: a second Platform Admin who is also an Approver on Deposits, so a stage may name them.
    await db.insert(schema.users).values({ id: "casey", name: "Casey Admin", email: "casey@example.test", initials: "CA", avatarHue: 20, title: "", platformRole: "platform_admin" });
    await db.insert(memberships).values({ id: "m_casey", userId: "casey", teamId: "deposits", status: "active", addedAt: BASE });
    await db.insert(membershipRoles).values({ membershipId: "m_casey", role: "approver" });
    people.casey = await loadPersona(db, "casey");
    const legal = (await chain()).find((s) => s.name === "Legal reviewer")!;
    const team = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
    const legalStage = { id: legal.id, ...LEGAL };
    const casey: ApproverRule = { kind: "user", userId: "casey" };
    try {
      as("riley");
      expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, legalStage, { name: "Admin sign-off", rule: casey }] })).toEqual({ ok: true });
      const caseyStage = { id: (await chain())[2]!.id, name: "Admin sign-off", rule: casey };

      // Casey renames another stage and saves: the stage Riley named them on stays theirs.
      as("casey");
      expect(await saveApprovalChain({ contentTypeId: CT, stages: [{ ...team, name: "Team sign-off" }, legalStage, caseyStage] })).toEqual({ ok: true });
      expect((await chain()).map((s) => s.name)).toEqual(["Team sign-off", "Legal reviewer", "Admin sign-off"]);
      // The editor agrees from its read model: Casey isn't offered, but their own stage raises nothing.
      const section = await getApprovalChainsSection();
      const saved = section.chains.find((c) => c.contentTypeId === CT)!.stages;
      expect(section.people.some((p) => p.id === "casey")).toBe(false);
      expect(validateChain({ stages: saved, current: saved, actorId: section.viewerId, people: section.approvers })).toEqual([]);

      // Casey can't newly name themselves on another stage, or swap a stage someone else held to themselves.
      const before = await chain();
      const at = as("casey");
      expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, legalStage, caseyStage, { name: "Final sign-off", rule: casey }] })).toEqual({
        ok: false,
        reason: PLATFORM_REFUSALS.nameYourself,
      });
      expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, { ...legalStage, rule: casey }] })).toEqual({
        ok: false,
        reason: PLATFORM_REFUSALS.nameYourself,
      });
      expect(await chain()).toEqual(before);
      expect(await auditAt(at)).toEqual([]);
    } finally {
      as("riley");
      expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, legalStage] })).toEqual({ ok: true });
      await db.delete(auditEvents).where(eq(auditEvents.actorId, "casey"));
      await db.delete(membershipRoles).where(eq(membershipRoles.membershipId, "m_casey"));
      await db.delete(memberships).where(eq(memberships.id, "m_casey"));
      await db.delete(schema.users).where(eq(schema.users.id, "casey"));
    }
  });

  it("refuses one person on two stages, and writes nothing", async () => {
    const before = await chain();
    const kept = before.map((s) => ({ id: s.id, name: s.name, rule: s.approverRule }));
    const jordan: ApproverRule = { kind: "user", userId: "jordan" };
    const at = as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [...kept, { name: "Compliance", rule: jordan }, { name: "Final sign-off", rule: jordan }],
      }),
    ).toEqual({ ok: false, reason: `Jordan Ellis already reviews stage ${before.length + 1}.` });
    expect(await chain()).toEqual(before);
    expect(await auditAt(at)).toEqual([]);
    expect(await notificationsAt(at)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a team role other than Approver as bad input: only that role decides", async () => {
    const before = await chain();
    as("riley");
    const viewers = { id: TEAM_STAGE, name: "Team approver", rule: { kind: "team_role", role: "viewer" } as ApproverRule };
    expect(await saveApprovalChain({ contentTypeId: CT, stages: [viewers] })).toEqual({ ok: false, reason: "Check the form and try again." });
    expect(await chain()).toEqual(before);
  });

  it("checks people named before too: a chain naming someone who has since lost access can't be saved", async () => {
    const before = await chain();
    expect(before.some((s) => s.approverRule.kind === "user" && s.approverRule.userId === "dana")).toBe(true);
    const renamed = before.map((s) => ({ id: s.id, name: s.id === TEAM_STAGE ? "Team sign-off" : s.name, rule: s.approverRule }));
    await db.update(memberships).set({ status: "suspended" }).where(eq(memberships.userId, "dana"));
    try {
      const at = as("riley");
      expect(await saveApprovalChain({ contentTypeId: CT, stages: renamed })).toEqual({ ok: false, reason: "Dana Park has no active access." });
      expect(await chain()).toEqual(before);
      expect(await auditAt(at)).toEqual([]);
      // The editor gets the same facts, so it shows the reason at Dana's stage before anyone saves.
      const section = await getApprovalChainsSection();
      expect(section.people.some((p) => p.id === "dana")).toBe(false);
      expect(section.approvers.find((p) => p.id === "dana")).toEqual({ id: "dana", name: "Dana Park", platformRole: null, activeTeamRole: false });
    } finally {
      await db.update(memberships).set({ status: "active" }).where(eq(memberships.userId, "dana"));
    }
  });

  it("when a waiting stage names someone else, they're told about the versions already waiting", async () => {
    const templateId = await submitted("coral-offers", "maya"); // waits on the Team approver stage
    const legalId = (await chain())[1]!.id;
    const at = as("riley");
    const stages = (rule: ApproverRule) => [
      { id: TEAM_STAGE, name: "Team approver", rule },
      { id: legalId, ...LEGAL },
    ];
    expect(await saveApprovalChain({ contentTypeId: CT, stages: stages({ kind: "user", userId: "naomi" }) })).toEqual({ ok: true });
    const told = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, "naomi"), eq(notifications.kind, "review_requested"), gte(notifications.createdAt, at)));
    // Naomi isn't on Coral Offers: the link opens in her own space.
    expect(told.map((n) => n.href)).toContainEqual(`/deposits/review/${templateId}/1`);
    as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages: stages(TEAM_RULE) })).toEqual({ ok: true });
  });

  it("when a waiting stage goes back to the team's approvers, nobody who wrote the version is told", async () => {
    const templateId = await submitted("coral-offers", "maya");
    // Alex holds Approver on Coral Offers; say he edited Maya's draft too.
    await db
      .update(versions)
      .set({ writers: ["maya", "alex"] })
      .where(and(eq(versions.templateId, templateId), eq(versions.number, 1)));
    const legalId = (await chain())[1]!.id;
    const stages = (rule: ApproverRule) => [
      { id: TEAM_STAGE, name: "Team approver", rule },
      { id: legalId, ...LEGAL },
    ];
    as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages: stages({ kind: "user", userId: "naomi" }) })).toEqual({ ok: true });

    const at = as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages: stages(TEAM_RULE) })).toEqual({ ok: true });
    const told = (await notificationsAt(at)).filter((n) => n.kind === "review_requested" && n.href?.includes(templateId));
    expect(told.map((n) => n.userId)).toEqual(["jordan"]);
  });
});

// ── Two-stage approval, end to end ────────────────────────────

describe("two-stage approval: Team approver, then Dana Park's Legal reviewer", () => {
  let legalId: string;

  beforeAll(async () => {
    as("riley");
    const current = await chain();
    const legal = current.find((s) => s.name === "Legal reviewer");
    const stages = [{ id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE }, legal ? { id: legal.id, ...LEGAL } : LEGAL];
    expect(await saveApprovalChain({ contentTypeId: CT, stages })).toEqual({ ok: true });
    legalId = (await chain())[1]!.id;
  });

  it("Maya submits → Jordan approves stage 1 → it waits on Dana → Dana approves stage 2 → Active", async () => {
    const templateId = await submitted("coral-offers", "maya");

    as("dana");
    expect(await getReviewBadgeCount("coral-offers")).toBe(0);

    // Stage 1: the team's approver.
    const first = as("jordan");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: false, number: 1 });
    expect(await versionOf(templateId)).toMatchObject({ state: "in_review", currentStage: 1, activatedAt: null });
    expect((await notificationsAt(first)).map((n) => [n.userId, n.kind])).toEqual([
      ["dana", "review_requested"],
      ["maya", "stage_approved"],
    ]);

    // The stepper advanced; Dana's queue and badge count it; she may decide and comment (a Viewer on Coral).
    as("dana");
    const screen = await getReviewScreen("coral-offers", templateId, 1);
    expect(screen.steps.map((s) => [s.name, s.status, s.decidedBy?.id])).toEqual([
      ["Team approver", "done", "jordan"],
      ["Legal reviewer", "current", undefined],
    ]);
    expect(screen.can).toEqual({ approve: { ok: true }, requestChanges: { ok: true }, comment: { ok: true } });
    expect(await getReviewBadgeCount("coral-offers")).toBe(1);
    expect((await getReviewQueue("coral-offers")).waiting.map((r) => r.templateId)).toEqual([templateId]);
    const comment = await addComment({ templateId, versionId: screen.version.id, blockId: "doc", body: "Legal looks fine." });
    expect(comment.ok).toBe(true);

    // Jordan's part is done: the screen says why, and approving again is refused.
    as("jordan");
    expect((await getReviewScreen("coral-offers", templateId, 1)).can.approve).toEqual({
      ok: false,
      reason: "Waiting on Legal reviewer.",
    });
    expect(await approve(templateId)).toEqual({ ok: false, reason: "Waiting on Legal reviewer." });

    // Stage 2: Dana.
    const live = as("dana");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: true, number: 1 });
    const v1 = (await versionOf(templateId))!;
    expect(v1).toMatchObject({ state: "active", activatedAt: live });
    expect(
      (await db.select().from(approvals).where(eq(approvals.versionId, v1.id)).orderBy(asc(approvals.decidedAt))).map((a) => [
        a.stageName,
        a.actorId,
      ]),
    ).toEqual([
      ["Team approver", "jordan"],
      ["Legal reviewer", "dana"],
    ]);
    expect((await notificationsAt(live)).map((n) => [n.userId, n.kind])).toEqual([["maya", "version_live"]]);
    expect(await getReviewBadgeCount("coral-offers")).toBe(0);
  });

  it("refuses anyone the Legal stage doesn't name, and the submitter", async () => {
    const templateId = await submitted("coral-offers", "maya");
    as("jordan");
    expect(await approve(templateId)).toMatchObject({ ok: true, wentLive: false });

    as("alex"); // an Approver (and Team Admin) on Coral, but not Dana
    expect(await approve(templateId)).toEqual({ ok: false, reason: "Waiting on Legal reviewer." });
    as("sam"); // a Viewer
    expect(await approve(templateId)).toEqual({ ok: false, reason: REASONS.generic });
    as("maya");
    expect(await approve(templateId)).toEqual({ ok: false, reason: REASONS.ownVersion });
    expect(await versionOf(templateId)).toMatchObject({ state: "in_review", currentStage: 1 });

    // Sam can't comment either; Dana can.
    const version = (await versionOf(templateId))!;
    as("sam");
    expect(await addComment({ templateId, versionId: version.id, blockId: "doc", body: "Hi" })).toEqual({
      ok: false,
      reason: REASONS.generic,
    });
  });

  it("nobody approves two stages of the same round", async () => {
    // Two team-role stages: the same approver may not take both.
    as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
          { id: legalId, name: "Second approver", rule: TEAM_RULE },
        ],
      }),
    ).toEqual({ ok: true });
    const templateId = await submitted("coral-offers", "maya");

    as("jordan");
    expect(await approve(templateId)).toMatchObject({ ok: true, wentLive: false });
    as("jordan");
    expect((await getReviewScreen("coral-offers", templateId, 1)).can.approve).toEqual({
      ok: false,
      reason: REFUSALS.approvedEarlierStage,
    });
    expect((await getReviewQueue("coral-offers")).waiting.some((r) => r.templateId === templateId)).toBe(false);
    expect(await approve(templateId)).toEqual({ ok: false, reason: "You approved an earlier stage." });
    expect(await versionOf(templateId)).toMatchObject({ state: "in_review", currentStage: 1 });

    as("alex");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: true, number: 1 });

    as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
          { id: legalId, ...LEGAL },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("refuses removing the Legal stage while a version waits on it", async () => {
    const templateId = await submitted("coral-offers", "maya");
    as("jordan");
    expect(await approve(templateId)).toMatchObject({ ok: true, wentLive: false });

    as("riley");
    const result = await saveApprovalChain({ contentTypeId: CT, stages: [{ id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE }] });
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/^\d+ versions? in review still needs? Legal reviewer\.$/) });
    expect((await chain()).length).toBe(2);
    expect((await getApprovalChainsSection()).chains[0]!.stages[1]!.waiting).toBeGreaterThanOrEqual(1);
  });

  it("Dana decides a Deposits submission from her own space, with no Deposits membership", async () => {
    const templateId = await submitted("deposits", "eli");
    as("naomi");
    expect(await approve(templateId)).toMatchObject({ ok: true, wentLive: false });

    as("dana");
    expect((await getReviewQueue("coral-offers")).waiting.map((r) => [r.templateId, r.teamSlug])).toContainEqual([templateId, "deposits"]);
    const screen = await getReviewScreen("coral-offers", templateId, 1);
    expect(screen.template.teamSlug).toBe("deposits");
    expect(screen.can).toEqual({ approve: { ok: true }, requestChanges: { ok: true }, comment: { ok: true } });
    expect((await addComment({ templateId, versionId: screen.version.id, blockId: "doc", body: "OK from Legal." })).ok).toBe(true);
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: true, number: 1 });
    // She keeps seeing the version she decided; a stranger to it still gets a 404.
    expect((await getReviewScreen("coral-offers", templateId, 1)).version.state).toBe("active");
    as("sam");
    await expect(getReviewScreen("coral-offers", templateId, 1)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

// ── Editing the chain mid-review (finding D3) ─────────────────

describe("editing the chain while versions are in review: each version keeps the stages it was submitted with", () => {
  const team = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
  let legal: { id: string; name: string; rule: ApproverRule };

  beforeAll(async () => {
    as("riley");
    const found = (await chain()).find((s) => s.name === "Legal reviewer");
    if (!found) expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, LEGAL] })).toEqual({ ok: true });
    legal = { id: (await chain()).find((s) => s.name === "Legal reviewer")!.id, ...LEGAL };
  });
  afterAll(resetChain);

  async function setChain(stages: { id?: string; name: string; rule: ApproverRule }[]) {
    as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages })).toEqual({ ok: true });
  }
  const steps = async (templateId: string) =>
    (await getReviewScreen("coral-offers", templateId, 1)).steps.map((s) => [s.name, s.status, s.decidedBy?.id]);
  const decided = async (templateId: string) =>
    (await db.select().from(approvals).where(eq(approvals.versionId, (await versionOf(templateId))!.id)).orderBy(asc(approvals.decidedAt))).map(
      (a) => [a.stageId, a.stageName, a.actorId],
    );

  it("the review's stall: Dana approves Legal, the chain is reordered, Jordan approves Team and it goes Active", async () => {
    await setChain([legal, team]);
    const templateId = await submitted("coral-offers", "maya");
    as("dana");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: false, number: 1 });

    await setChain([team, legal]);
    expect(await versionOf(templateId)).toMatchObject({
      currentStage: 1,
      stages: [
        { id: legal.id, name: "Legal reviewer" },
        { id: TEAM_STAGE, name: "Team approver" },
      ],
    });

    // Jordan sees the version's own order, Dana's approval under Legal, and his stage current.
    as("jordan");
    expect(await steps(templateId)).toEqual([
      ["Legal reviewer", "done", "dana"],
      ["Team approver", "current", undefined],
    ]);
    expect((await getReviewScreen("coral-offers", templateId, 1)).can.approve).toEqual({ ok: true });
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: true, number: 1 });

    expect(await versionOf(templateId)).toMatchObject({ state: "active" });
    expect(await steps(templateId)).toEqual([
      ["Legal reviewer", "done", "dana"],
      ["Team approver", "done", "jordan"],
    ]);
    expect(await decided(templateId)).toEqual([
      [legal.id, "Legal reviewer", "dana"],
      [TEAM_STAGE, "Team approver", "jordan"],
    ]);
  });

  it("a stage inserted before the one it waits on isn't added to it, and it doesn't skip the one it waits on", async () => {
    await setChain([team, legal]);
    const templateId = await submitted("coral-offers", "maya");
    as("jordan");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: false, number: 1 });

    const compliance = { name: "Compliance", rule: { kind: "user", userId: "naomi" } as ApproverRule };
    await setChain([team, compliance, legal]);
    expect(await versionOf(templateId)).toMatchObject({ state: "in_review", currentStage: 1 });

    // Still waiting on Legal, with no Compliance step; Naomi's new stage isn't this version's.
    as("dana");
    expect(await steps(templateId)).toEqual([
      ["Team approver", "done", "jordan"],
      ["Legal reviewer", "current", undefined],
    ]);
    as("naomi");
    expect((await approve(templateId)).ok).toBe(false);
    as("dana");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: true, number: 1 });
    expect(await decided(templateId)).toEqual([
      [TEAM_STAGE, "Team approver", "jordan"],
      [legal.id, "Legal reviewer", "dana"],
    ]);

    // A version submitted now goes through all three.
    const next = await submitted("coral-offers", "maya");
    expect((await versionOf(next))?.stages?.map((s) => s.name)).toEqual(["Team approver", "Compliance", "Legal reviewer"]);
  });

  it("removing a stage still ahead of a version in its own stages is refused", async () => {
    const current = await chain();
    const templateId = await submitted("coral-offers", "maya"); // recorded Team, Compliance, Legal; waits on Team
    as("riley");
    const withoutCompliance = current.filter((s) => s.name !== "Compliance").map((s) => ({ id: s.id, name: s.name, rule: s.approverRule }));
    expect(await saveApprovalChain({ contentTypeId: CT, stages: withoutCompliance })).toEqual({
      ok: false,
      reason: expect.stringMatching(/^\d+ versions? in review still needs? Compliance\.$/),
    });
    const section = (await getApprovalChainsSection()).chains.find((c) => c.contentTypeId === CT)!;
    expect(section.stages.find((s) => s.name === "Compliance")!.waiting).toBeGreaterThanOrEqual(2);
    expect(await chain()).toEqual(current);
    expect((await versionOf(templateId))?.state).toBe("in_review");
  });

  it("a new rule on the stage it waits on reaches it: Naomi decides what waited on Dana", async () => {
    await resetChain(); // takes the earlier tests' versions out of review, so Compliance can go
    await setChain([team, LEGAL]);
    legal = { id: (await chain())[1]!.id, ...LEGAL };
    const templateId = await submitted("coral-offers", "maya");
    as("jordan");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: false, number: 1 });

    const at = as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [team, { id: legal.id, name: "Legal sign-off", rule: { kind: "user", userId: "naomi" } }],
      }),
    ).toEqual({ ok: true });
    // Naomi is told, in the version's own words for the stage.
    const told = (await notificationsAt(at)).filter((n) => n.userId === "naomi" && n.href?.includes(templateId));
    expect(told.map((n) => [n.kind, n.title])).toEqual([["review_requested", `${(await versionTemplateName(templateId))} v1 is waiting on Legal reviewer.`]]);

    as("dana");
    expect((await approve(templateId)).ok).toBe(false);
    as("naomi");
    const screen = await getReviewScreen("deposits", templateId, 1);
    expect(screen.can.approve).toEqual({ ok: true });
    expect(screen.steps.map((s) => s.name)).toEqual(["Team approver", "Legal reviewer"]);
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: true, number: 1 });
    expect(await decided(templateId)).toEqual([
      [TEAM_STAGE, "Team approver", "jordan"],
      [legal.id, "Legal reviewer", "naomi"],
    ]);
  });

  it("a waiting stage changed to name someone who already approved the version asks nobody; another change unblocks it", async () => {
    await setChain([team, legal]);
    const templateId = await submitted("coral-offers", "maya");
    as("jordan");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: false, number: 1 });

    // Jordan approved the Team stage; the Legal stage it waits on is swapped to name him.
    let at = as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, { ...legal, rule: { kind: "user", userId: "jordan" } }] })).toEqual({ ok: true });
    expect((await notificationsAt(at)).filter((n) => n.href?.includes(templateId)), "nobody is asked").toEqual([]);
    as("jordan");
    expect(await approve(templateId)).toEqual({ ok: false, reason: REFUSALS.approvedEarlierStage });

    // The unblock path of decision 0007: name someone else, who is told and decides.
    at = as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages: [team, { ...legal, rule: { kind: "user", userId: "naomi" } }] })).toEqual({ ok: true });
    expect((await notificationsAt(at)).filter((n) => n.href?.includes(templateId)).map((n) => n.userId)).toEqual(["naomi"]);
    as("naomi");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: true, number: 1 });
  });
});

async function versionTemplateName(templateId: string) {
  const row = await db.query.templates.findFirst({ where: eq(schema.templates.id, templateId) });
  return row!.name;
}

// ── The migration's backfill ──────────────────────────────────

// Last: rows from before `versions.stages` and `approvals.stage_id` get today's chain, by position.
describe("the stages backfill in the migration", () => {
  const folder = "./src/server/db/migrations";
  const file = readdirSync(folder).find((name) => name.endsWith("_version_stages.sql"))!;
  const [, , ...backfill] = readFileSync(`${folder}/${file}`, "utf8").split("--> statement-breakpoint");

  it("gives every submitted version today's chain, and each decision the stage at its position", async () => {
    as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages: [{ id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE }, LEGAL] })).toEqual({
      ok: true,
    });
    const today = (await chain()).map((s) => ({ id: s.id, name: s.name }));

    await libsql.execute("UPDATE versions SET stages = NULL");
    await libsql.execute("UPDATE approvals SET stage_id = NULL");
    await libsql.execute("UPDATE versions SET current_stage = 7 WHERE state = 'in_review'"); // past the end
    for (const statement of backfill) await libsql.execute(statement);

    const rows = await db.select().from(versions);
    expect(rows.some((v) => v.number === null)).toBe(true);
    for (const v of rows) {
      expect(v.stages).toEqual(v.number === null ? null : today);
      if (v.state === "in_review") expect(v.currentStage, "read as the last stage, as before").toBe(today.length - 1);
    }
    const decisions = await db.select().from(approvals);
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) expect(d.stageId).toBe(today[d.stagePosition]?.id ?? null);
  });

  it("someone who approved before the migration can't approve the stage their approval was matched to", async () => {
    await resetChain(); // the chain is the Team approver stage alone
    const templateId = await submitted("coral-offers", "maya");
    const version = (await versionOf(templateId))!;
    // The data as it stood before stage ids: under [First approver, Team approver] Jordan approved the
    // first stage; an admin then removed it and the version moved to position 0, the Team approver stage.
    await db.insert(approvals).values({
      id: "ap_before_stage_ids",
      versionId: version.id,
      stageId: null,
      stagePosition: 0,
      stageName: "First approver",
      actorId: "jordan",
      decision: "approved",
      reason: null,
      sampleSetsSeen: ["typical"],
      decidedAt: env.now,
    });
    await db.update(versions).set({ stages: null, currentStage: 0 }).where(eq(versions.id, version.id));
    for (const statement of backfill) await libsql.execute(statement);
    expect(await versionOf(templateId)).toMatchObject({ stages: [{ id: TEAM_STAGE, name: "Team approver" }], currentStage: 0 });
    expect((await db.query.approvals.findFirst({ where: eq(approvals.id, "ap_before_stage_ids") }))?.stageId).toBe(TEAM_STAGE);

    // Matched to the stage the version waits on, his approval still counts: two stages need two people.
    as("jordan");
    expect((await getReviewScreen("coral-offers", templateId, 1)).can.approve).toEqual({ ok: false, reason: REFUSALS.approvedEarlierStage });
    expect(await approve(templateId)).toEqual({ ok: false, reason: REFUSALS.approvedEarlierStage });
    as("alex");
    expect(await approve(templateId)).toEqual({ ok: true, wentLive: true, number: 1 });
  });
});
