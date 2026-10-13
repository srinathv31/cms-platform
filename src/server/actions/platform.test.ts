import { readFileSync, readdirSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, asc, eq, gte } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { OUTPUT_KEYS } from "@/domain/review-outputs";
import { PLATFORM_REFUSALS } from "@/domain/platform-config/refusals";
import { describeConfigChange } from "@/domain/platform-config/effects";
import { validateChain } from "@/domain/platform-config/approval-chains";
import type { ApproverRule, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import {
  getApprovalChainsSection,
  getBusinessZoneSection,
  getTeamsSection,
} from "@/server/queries/platform";
import {
  getReviewBadgeCount,
  getReviewQueue,
  getReviewScreen,
} from "@/server/queries/review";
import { asShown } from "@/server/testing/notifications";
import {
  createTemplateWithDraft,
  draftRev,
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { addComment } from "./comments";
import { saveApprovalChain } from "./platform";
import { approveVersion, requestChanges, submitVersion } from "./review";

// The approval chain and the two-stage approval it enables, end to end against a temporary database filled by the
// real seed. Only the database handle, the demo clock, the persona and Next's cache calls are swapped. What the
// platform commands do on their own is the platform contract's (src/server/services/contract/platform.ts, on both
// implementations); these cases cross areas that haven't all moved behind the services: the chain is saved through
// the action and `services().platform`, versions are submitted and decided by the review actions still on the
// legacy kit (plan P1), and the settings sections are read by their read models (plan P4b). They move to the
// contract suite with those.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-platform-actions-");
});
vi.mock("@/server/services/local/clock", () => ({
  now: vi.fn(async () => env.now),
}));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const {
  approvals,
  approvalStages,
  auditEvents,
  membershipRoles,
  memberships,
  notifications,
  versions,
} = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const CT = "ct_disclosure";
const TEAM_STAGE = "stage_disclosure_0";
const TEAM_RULE: ApproverRule = { kind: "team_role", role: "approver" };
const LEGAL = {
  name: "Legal reviewer",
  rule: { kind: "user", userId: "dana" } as ApproverRule,
};

let db: Db;
let libsql: Client;
const people: Record<string, Viewer> = {};

seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  for (const id of [
    "maya",
    "jordan",
    "alex",
    "sam",
    "riley",
    "dana",
    "eli",
    "naomi",
  ])
    people[id] = await loadPersona(db, id);
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

const auditAt = (at: Date) =>
  db
    .select()
    .from(auditEvents)
    .where(gte(auditEvents.at, at))
    .orderBy(asc(auditEvents.id));
// The rows as the bell shows them (decision 0055): the stored facts and link, worded and linked on read. A team
// the test created isn't in the seed's slugs, so the tests that need it pass its own.
const notificationsAt = async (at: Date, slugs?: Record<string, string>) =>
  (
    await db
      .select()
      .from(notifications)
      .where(gte(notifications.createdAt, at))
      .orderBy(asc(notifications.userId))
  ).map((n) => asShown(n, slugs));
const chain = () =>
  db
    .select()
    .from(approvalStages)
    .where(eq(approvalStages.contentTypeId, CT))
    .orderBy(asc(approvalStages.position));
const versionOf = (templateId: string) =>
  db.query.versions.findFirst({
    where: and(eq(versions.templateId, templateId), eq(versions.number, 1)),
  });
const approve = (templateId: string) =>
  approveVersion({
    templateId,
    versionNumber: 1,
    round: 1,
    outputsViewed: OUTPUT_KEYS,
    sampleSetsSeen: ["typical"],
  });

/** Dana Park's Legal reviewer stage is on the chain, after the Team approver. Returns the Legal stage's id. */
async function addLegalStage() {
  as("riley");
  expect(
    await saveApprovalChain({
      contentTypeId: CT,
      stages: [
        { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
        LEGAL,
      ],
    }),
  ).toEqual({
    ok: true,
  });
  return (await chain())[1]!.id;
}

async function submitted(teamId: string, author: string) {
  const { templateId } = await createTemplateWithDraft(db, {
    teamId,
    createdBy: author,
    at: env.now,
  });
  as(author);
  expect(
    await submitVersion({ templateId, rev: await draftRev(db, templateId) }),
  ).toEqual({ ok: true, number: 1, round: 1 });
  return templateId;
}

// ── The business time zone's section ──────────────────────────

describe("the business time zone's section", () => {
  it("is Eastern until a Platform Admin picks another, from the US zones and UTC", async () => {
    as("riley");
    const section = await getBusinessZoneSection();
    expect(section.zone).toBe("America/New_York");
    expect(section.zones[0]).toEqual({
      id: "America/New_York",
      label: "Eastern (America/New_York)",
    });
    expect(section.zones.map((z) => z.id)).toContain("UTC");
    // Decided for the screen: Riley may change it, and Balance Transfer v1's seeded sunset (still to come) stays.
    expect(section.can).toEqual({ change: { ok: true } });
    expect(section.consequences).toEqual([
      "1 sunset already set doesn't move: its consumers have been told when it ends.",
    ]);
  });

  it("is Not found to anyone but a Platform Admin, as the Teams section is", async () => {
    as("alex");
    await expect(getTeamsSection()).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
    await expect(getBusinessZoneSection()).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });
});

// ── Approval chains ───────────────────────────────────────────

describe("saveApprovalChain", () => {
  it("adds Dana Park's Legal reviewer stage; versions in review keep their stage", async () => {
    const waiting = await submitted("t_coral", "maya");
    const at = as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
          LEGAL,
        ],
      }),
    ).toEqual({
      ok: true,
    });
    expect(
      (await chain()).map((s) => [s.position, s.name, s.approverRule]),
    ).toEqual([
      [0, "Team approver", TEAM_RULE],
      [1, "Legal reviewer", LEGAL.rule],
    ]);
    expect((await chain())[0]!.id).toBe(TEAM_STAGE);
    expect((await versionOf(waiting))?.currentStage).toBe(0);
    const changed = await auditAt(at);
    expect(changed.map((r) => describeConfigChange(r.details!))).toEqual([
      "set Disclosure approval chain: Team approver (Approver role) → Legal reviewer (Dana Park)",
    ]);
    // The stages are stored as facts: a user rule keeps the name the person had, and no sentence is stored.
    expect(changed[0]!.details).not.toHaveProperty("summary");
    expect(changed[0]!.details).toMatchObject({
      stages: [
        { name: "Team approver", rule: TEAM_RULE },
        { name: "Legal reviewer", rule: LEGAL.rule, userName: "Dana Park" },
      ],
    });

    const section = (await getApprovalChainsSection()).chains.find(
      (c) => c.contentTypeId === CT,
    )!;
    expect(section.stages.map((s) => [s.name, s.ruleLabel])).toEqual([
      ["Team approver", "Approver role"],
      ["Legal reviewer", "Dana Park"],
    ]);
    expect(section.stages[0]!.waiting).toBeGreaterThanOrEqual(1);
    const choices = (await getApprovalChainsSection()).people;
    expect(choices.find((p) => p.id === "dana")?.teams).toEqual([
      "Coral Offers",
    ]);
    expect(choices.some((p) => p.id === "morgan")).toBe(false); // no access anywhere: could never act
  });

  it("leaves a version in review as it is when stages are reordered: it keeps its own stages", async () => {
    const legalId = await addLegalStage();
    const templateId = await submitted("t_coral", "maya");
    const own = [
      { id: TEAM_STAGE, name: "Team approver" },
      { id: legalId, name: "Legal reviewer" },
    ];
    expect(await versionOf(templateId)).toMatchObject({
      stages: own,
      currentStage: 0,
    });
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
    expect(await versionOf(templateId)).toMatchObject({
      stages: own,
      currentStage: 0,
    }); // still the Team approver stage
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
    expect(await versionOf(templateId)).toMatchObject({
      stages: own,
      currentStage: 0,
    });
  });

  it("refuses naming an Auditor or someone with no access; the choices leave them out", async () => {
    as("riley");
    const team = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
    const naming = (userId: string) => ({
      name: "Audit sign-off",
      rule: { kind: "user", userId } as ApproverRule,
    });
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [team, naming("taylor")],
      }),
    ).toEqual({
      ok: false,
      code: "auditor_cant_approve",
      reason: "Taylor Nguyen is an Auditor and can't approve.",
    });
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [team, naming("morgan")],
      }),
    ).toEqual({
      ok: false,
      code: "no_active_access",
      reason: "Morgan Lee has no active access.",
    });
    expect(
      (await getApprovalChainsSection()).people.some((p) => p.id === "taylor"),
    ).toBe(false);
  });

  it("refuses an admin naming themselves, or a Platform Admin with no team role; the choices leave them out", async () => {
    const before = await chain();
    const at = as("riley");
    // Keeping the stage id and switching its rule to the acting admin: the self-approval route.
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          {
            id: TEAM_STAGE,
            name: "Sign-off",
            rule: { kind: "user", userId: "riley" },
          },
        ],
      }),
    ).toEqual({
      ok: false,
      code: "names_yourself",
      reason: "You can't name yourself as an approver.",
    });
    expect(await auditAt(at)).toEqual([]);
    expect(await chain()).toEqual(before);
    expect(
      (await getApprovalChainsSection()).people.some((p) => p.id === "riley"),
    ).toBe(false);

    // Another Platform Admin with no team role: a platform role alone is no approve power.
    await db.insert(schema.users).values({
      id: "pat",
      name: "Pat Admin",
      email: "pat@example.test",
      initials: "PA",
      avatarHue: 10,
      title: "",
      platformRole: "platform_admin",
    });
    try {
      expect(
        await saveApprovalChain({
          contentTypeId: CT,
          stages: [
            { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
            { name: "Sign-off", rule: { kind: "user", userId: "pat" } },
          ],
        }),
      ).toEqual({
        ok: false,
        code: "admin_without_team_role",
        reason:
          "Pat Admin is a Platform Admin with no team role and can't approve.",
      });
      expect(
        (await getApprovalChainsSection()).people.some((p) => p.id === "pat"),
      ).toBe(false);
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, "pat"));
    }
  });

  it("an admin another admin named on a stage can still save the chain, but never names themselves", async () => {
    // Casey: a second Platform Admin who is also an Approver on Deposits, so a stage may name them.
    await db.insert(schema.users).values({
      id: "casey",
      name: "Casey Admin",
      email: "casey@example.test",
      initials: "CA",
      avatarHue: 20,
      title: "",
      platformRole: "platform_admin",
    });
    await db.insert(memberships).values({
      id: "m_casey",
      userId: "casey",
      teamId: "t_deposits",
      status: "active",
      addedAt: BASE,
    });
    await db
      .insert(membershipRoles)
      .values({ membershipId: "m_casey", role: "approver" });
    people.casey = await loadPersona(db, "casey");
    const legal = { id: await addLegalStage() };
    const team = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
    const legalStage = { id: legal.id, ...LEGAL };
    const casey: ApproverRule = { kind: "user", userId: "casey" };
    try {
      as("riley");
      expect(
        await saveApprovalChain({
          contentTypeId: CT,
          stages: [team, legalStage, { name: "Admin sign-off", rule: casey }],
        }),
      ).toEqual({ ok: true });
      const caseyStage = {
        id: (await chain())[2]!.id,
        name: "Admin sign-off",
        rule: casey,
      };

      // Casey renames another stage and saves: the stage Riley named them on stays theirs.
      as("casey");
      expect(
        await saveApprovalChain({
          contentTypeId: CT,
          stages: [{ ...team, name: "Team sign-off" }, legalStage, caseyStage],
        }),
      ).toEqual({ ok: true });
      expect((await chain()).map((s) => s.name)).toEqual([
        "Team sign-off",
        "Legal reviewer",
        "Admin sign-off",
      ]);
      // The editor agrees from its read model: Casey isn't offered, but their own stage raises nothing.
      const section = await getApprovalChainsSection();
      const saved = section.chains.find((c) => c.contentTypeId === CT)!.stages;
      expect(section.people.some((p) => p.id === "casey")).toBe(false);
      expect(
        validateChain({
          stages: saved,
          current: saved,
          actorId: section.viewerId,
          people: section.approvers,
        }),
      ).toEqual([]);

      // Casey can't newly name themselves on another stage, or swap a stage someone else held to themselves.
      const before = await chain();
      const at = as("casey");
      expect(
        await saveApprovalChain({
          contentTypeId: CT,
          stages: [
            team,
            legalStage,
            caseyStage,
            { name: "Final sign-off", rule: casey },
          ],
        }),
      ).toEqual({
        ok: false,
        ...PLATFORM_REFUSALS.nameYourself,
      });
      expect(
        await saveApprovalChain({
          contentTypeId: CT,
          stages: [team, { ...legalStage, rule: casey }],
        }),
      ).toEqual({
        ok: false,
        ...PLATFORM_REFUSALS.nameYourself,
      });
      expect(await chain()).toEqual(before);
      expect(await auditAt(at)).toEqual([]);
    } finally {
      as("riley");
      expect(
        await saveApprovalChain({
          contentTypeId: CT,
          stages: [team, legalStage],
        }),
      ).toEqual({ ok: true });
      await db.delete(auditEvents).where(eq(auditEvents.actorId, "casey"));
      await db
        .delete(membershipRoles)
        .where(eq(membershipRoles.membershipId, "m_casey"));
      await db.delete(memberships).where(eq(memberships.id, "m_casey"));
      await db.delete(schema.users).where(eq(schema.users.id, "casey"));
    }
  });

  it("refuses one person on two stages, and writes nothing", async () => {
    const before = await chain();
    const kept = before.map((s) => ({
      id: s.id,
      name: s.name,
      rule: s.approverRule,
    }));
    const jordan: ApproverRule = { kind: "user", userId: "jordan" };
    const at = as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          ...kept,
          { name: "Compliance", rule: jordan },
          { name: "Final sign-off", rule: jordan },
        ],
      }),
    ).toEqual({
      ok: false,
      code: "person_on_two_stages",
      reason: `Jordan Ellis already reviews stage ${before.length + 1}.`,
    });
    expect(await chain()).toEqual(before);
    expect(await auditAt(at)).toEqual([]);
    expect(await notificationsAt(at)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a team role other than Approver as bad input: only that role decides", async () => {
    const before = await chain();
    as("riley");
    const viewers = {
      id: TEAM_STAGE,
      name: "Team approver",
      rule: { kind: "team_role", role: "viewer" } as ApproverRule,
    };
    expect(
      await saveApprovalChain({ contentTypeId: CT, stages: [viewers] }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
      reason: "Check the form and try again.",
    });
    expect(await chain()).toEqual(before);
  });

  it("checks people named before too: a chain naming someone who has since lost access can't be saved", async () => {
    await addLegalStage();
    const before = await chain();
    expect(
      before.some(
        (s) =>
          s.approverRule.kind === "user" && s.approverRule.userId === "dana",
      ),
    ).toBe(true);
    const renamed = before.map((s) => ({
      id: s.id,
      name: s.id === TEAM_STAGE ? "Team sign-off" : s.name,
      rule: s.approverRule,
    }));
    await db
      .update(memberships)
      .set({ status: "suspended" })
      .where(eq(memberships.userId, "dana"));
    try {
      const at = as("riley");
      expect(
        await saveApprovalChain({ contentTypeId: CT, stages: renamed }),
      ).toEqual({
        ok: false,
        code: "no_active_access",
        reason: "Dana Park has no active access.",
      });
      expect(await chain()).toEqual(before);
      expect(await auditAt(at)).toEqual([]);
      // The editor gets the same facts, so it shows the reason at Dana's stage before anyone saves.
      const section = await getApprovalChainsSection();
      expect(section.people.some((p) => p.id === "dana")).toBe(false);
      expect(section.approvers.find((p) => p.id === "dana")).toEqual({
        id: "dana",
        name: "Dana Park",
        platformRole: null,
        activeTeamRole: false,
      });
    } finally {
      await db
        .update(memberships)
        .set({ status: "active" })
        .where(eq(memberships.userId, "dana"));
    }
  });

  it("when a waiting stage names someone else, they're told about the versions already waiting", async () => {
    const legalId = await addLegalStage();
    const templateId = await submitted("t_coral", "maya"); // waits on the Team approver stage
    const at = as("riley");
    const stages = (rule: ApproverRule) => [
      { id: TEAM_STAGE, name: "Team approver", rule },
      { id: legalId, ...LEGAL },
    ];
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: stages({ kind: "user", userId: "naomi" }),
      }),
    ).toEqual({ ok: true });
    const told = (
      await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, "naomi"),
            eq(notifications.kind, "review_requested"),
            gte(notifications.createdAt, at),
          ),
        )
    ).map((n) => asShown(n));
    // Naomi isn't on Coral Offers: the link opens in her own space.
    expect(told.map((n) => n.href)).toContainEqual(
      `/deposits/review/${templateId}/1`,
    );
    // The stored link names her own team by id.
    expect(told.map((n) => n.link)).toContainEqual({
      to: "review",
      teamId: "t_deposits",
      templateId,
      versionNumber: 1,
    });
    as("riley");
    expect(
      await saveApprovalChain({ contentTypeId: CT, stages: stages(TEAM_RULE) }),
    ).toEqual({ ok: true });
  });

  it("when a waiting stage goes back to the team's approvers, nobody who wrote the version is told", async () => {
    const legalId = await addLegalStage();
    const templateId = await submitted("t_coral", "maya");
    // Alex holds Approver on Coral Offers; say he edited Maya's draft too.
    await db
      .update(versions)
      .set({ writers: ["maya", "alex"] })
      .where(and(eq(versions.templateId, templateId), eq(versions.number, 1)));
    const stages = (rule: ApproverRule) => [
      { id: TEAM_STAGE, name: "Team approver", rule },
      { id: legalId, ...LEGAL },
    ];
    as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: stages({ kind: "user", userId: "naomi" }),
      }),
    ).toEqual({ ok: true });

    const at = as("riley");
    expect(
      await saveApprovalChain({ contentTypeId: CT, stages: stages(TEAM_RULE) }),
    ).toEqual({ ok: true });
    const told = (await notificationsAt(at)).filter(
      (n) => n.kind === "review_requested" && n.href?.includes(templateId),
    );
    expect(told.map((n) => n.userId)).toEqual(["jordan"]);
  });
});

// ── Two-stage approval, end to end ────────────────────────────

describe("two-stage approval: Team approver, then Dana Park's Legal reviewer", () => {
  let legalId: string;

  beforeEach(async () => {
    legalId = await addLegalStage();
  });

  it("Maya submits → Jordan approves stage 1 → it waits on Dana → Dana approves stage 2 → Active", async () => {
    const templateId = await submitted("t_coral", "maya");

    as("dana");
    expect(await getReviewBadgeCount("coral-offers")).toBe(0);

    // Stage 1: the team's approver.
    const first = as("jordan");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
      round: 1,
    });
    expect(await versionOf(templateId)).toMatchObject({
      state: "in_review",
      currentStage: 1,
      activatedAt: null,
    });
    expect(
      (await notificationsAt(first)).map((n) => [n.userId, n.kind]),
    ).toEqual([
      ["dana", "review_requested"],
      ["maya", "stage_approved"],
    ]);

    // The stepper advanced; Dana's queue and badge count it; she may decide and comment (a Viewer on Coral).
    as("dana");
    const screen = await getReviewScreen("coral-offers", templateId, 1, null);
    expect(
      screen.steps.map((s) => [s.name, s.status, s.decidedBy?.id]),
    ).toEqual([
      ["Team approver", "done", "jordan"],
      ["Legal reviewer", "current", undefined],
    ]);
    expect(screen.can).toEqual({
      approve: { ok: true },
      requestChanges: { ok: true },
      comment: { ok: true },
    });
    expect(await getReviewBadgeCount("coral-offers")).toBe(1);
    expect(
      (await getReviewQueue("coral-offers")).waiting.map((r) => r.templateId),
    ).toEqual([templateId]);
    const comment = await addComment({
      templateId,
      versionId: screen.version.id,
      blockId: "doc",
      body: "Legal looks fine.",
    });
    expect(comment.ok).toBe(true);

    // Jordan's part is done: the screen says why, and approving again is refused.
    as("jordan");
    expect(
      (await getReviewScreen("coral-offers", templateId, 1, null)).can.approve,
    ).toEqual({
      ok: false,
      code: "waiting_on_stage",
      reason: "Waiting on Legal reviewer.",
    });
    expect(await approve(templateId)).toEqual({
      ok: false,
      code: "waiting_on_stage",
      reason: "Waiting on Legal reviewer.",
    });

    // Stage 2: Dana.
    const live = as("dana");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });
    const v1 = (await versionOf(templateId))!;
    expect(v1).toMatchObject({ state: "active", activatedAt: live });
    expect(
      (
        await db
          .select()
          .from(approvals)
          .where(eq(approvals.versionId, v1.id))
          .orderBy(asc(approvals.decidedAt))
      ).map((a) => [a.stageName, a.actorId]),
    ).toEqual([
      ["Team approver", "jordan"],
      ["Legal reviewer", "dana"],
    ]);
    expect(
      (await notificationsAt(live)).map((n) => [n.userId, n.kind]),
    ).toEqual([["maya", "version_live"]]);
    expect(await getReviewBadgeCount("coral-offers")).toBe(0);
  });

  it("refuses anyone the Legal stage doesn't name, and the submitter", async () => {
    const templateId = await submitted("t_coral", "maya");
    as("jordan");
    expect(await approve(templateId)).toMatchObject({
      ok: true,
      wentLive: false,
    });

    as("alex"); // an Approver (and Team Admin) on Coral, but not Dana
    expect(await approve(templateId)).toEqual({
      ok: false,
      code: "waiting_on_stage",
      reason: "Waiting on Legal reviewer.",
    });
    as("sam"); // a Viewer
    expect(await approve(templateId)).toEqual({
      ok: false,
      ...REASONS.generic,
    });
    as("maya");
    expect(await approve(templateId)).toEqual({
      ok: false,
      ...REASONS.ownVersion,
    });
    expect(await versionOf(templateId)).toMatchObject({
      state: "in_review",
      currentStage: 1,
    });

    // Sam can't comment either; Dana can.
    const version = (await versionOf(templateId))!;
    as("sam");
    expect(
      await addComment({
        templateId,
        versionId: version.id,
        blockId: "doc",
        body: "Hi",
      }),
    ).toEqual({
      ok: false,
      ...REASONS.generic,
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
    const templateId = await submitted("t_coral", "maya");

    as("jordan");
    expect(await approve(templateId)).toMatchObject({
      ok: true,
      wentLive: false,
    });
    as("jordan");
    expect(
      (await getReviewScreen("coral-offers", templateId, 1, null)).can.approve,
    ).toEqual({
      ok: false,
      ...REFUSALS.approvedEarlierStage,
    });
    expect(
      (await getReviewQueue("coral-offers")).waiting.some(
        (r) => r.templateId === templateId,
      ),
    ).toBe(false);
    expect(await approve(templateId)).toEqual({
      ok: false,
      code: "approved_earlier_stage",
      reason: "You approved an earlier stage.",
    });
    expect(await versionOf(templateId)).toMatchObject({
      state: "in_review",
      currentStage: 1,
    });

    as("alex");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });

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
    const templateId = await submitted("t_coral", "maya");
    as("jordan");
    expect(await approve(templateId)).toMatchObject({
      ok: true,
      wentLive: false,
    });

    as("riley");
    const result = await saveApprovalChain({
      contentTypeId: CT,
      stages: [{ id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE }],
    });
    expect(result).toEqual({
      ok: false,
      code: "stage_in_use",
      reason: expect.stringMatching(
        /^\d+ versions? in review still needs? Legal reviewer\.$/,
      ),
    });
    expect((await chain()).length).toBe(2);
    expect(
      (await getApprovalChainsSection()).chains.find(
        (c) => c.contentTypeId === CT,
      )!.stages[1]!.waiting,
    ).toBeGreaterThanOrEqual(1);
  });

  it("Dana decides a Deposits submission from her own space, with no Deposits membership", async () => {
    const templateId = await submitted("t_deposits", "eli");
    as("naomi");
    expect(await approve(templateId)).toMatchObject({
      ok: true,
      wentLive: false,
    });

    as("dana");
    expect(
      (await getReviewQueue("coral-offers")).waiting.map((r) => [
        r.templateId,
        r.teamSlug,
      ]),
    ).toContainEqual([templateId, "deposits"]);
    const screen = await getReviewScreen("coral-offers", templateId, 1, null);
    expect(screen.template.teamSlug).toBe("deposits");
    expect(screen.can).toEqual({
      approve: { ok: true },
      requestChanges: { ok: true },
      comment: { ok: true },
    });
    expect(
      (
        await addComment({
          templateId,
          versionId: screen.version.id,
          blockId: "doc",
          body: "OK from Legal.",
        })
      ).ok,
    ).toBe(true);
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });
    // She keeps seeing the version she decided; a stranger to it still gets a 404.
    expect(
      (await getReviewScreen("coral-offers", templateId, 1, null)).version
        .state,
    ).toBe("active");
    as("sam");
    await expect(
      getReviewScreen("coral-offers", templateId, 1, null),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

// ── Editing the chain mid-review (finding D3) ─────────────────

describe("editing the chain while versions are in review: each version keeps the stages it was submitted with", () => {
  const team = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
  let legal: { id: string; name: string; rule: ApproverRule };

  beforeEach(async () => {
    legal = { id: await addLegalStage(), ...LEGAL };
  });

  async function setChain(
    stages: { id?: string; name: string; rule: ApproverRule }[],
  ) {
    as("riley");
    expect(await saveApprovalChain({ contentTypeId: CT, stages })).toEqual({
      ok: true,
    });
  }
  const steps = async (templateId: string) =>
    (await getReviewScreen("coral-offers", templateId, 1, null)).steps.map(
      (s) => [s.name, s.status, s.decidedBy?.id],
    );
  const decided = async (templateId: string) =>
    (
      await db
        .select()
        .from(approvals)
        .where(eq(approvals.versionId, (await versionOf(templateId))!.id))
        .orderBy(asc(approvals.decidedAt))
    ).map((a) => [a.stageId, a.stageName, a.actorId]);

  it("the review's stall: Dana approves Legal, the chain is reordered, Jordan approves Team and it goes Active", async () => {
    await setChain([legal, team]);
    const templateId = await submitted("t_coral", "maya");
    as("dana");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
      round: 1,
    });

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
    expect(
      (await getReviewScreen("coral-offers", templateId, 1, null)).can.approve,
    ).toEqual({ ok: true });
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });

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
    const templateId = await submitted("t_coral", "maya");
    as("jordan");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
      round: 1,
    });

    const compliance = {
      name: "Compliance",
      rule: { kind: "user", userId: "naomi" } as ApproverRule,
    };
    await setChain([team, compliance, legal]);
    expect(await versionOf(templateId)).toMatchObject({
      state: "in_review",
      currentStage: 1,
    });

    // Still waiting on Legal, with no Compliance step; Naomi's new stage isn't this version's.
    as("dana");
    expect(await steps(templateId)).toEqual([
      ["Team approver", "done", "jordan"],
      ["Legal reviewer", "current", undefined],
    ]);
    as("naomi");
    expect((await approve(templateId)).ok).toBe(false);
    as("dana");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });
    expect(await decided(templateId)).toEqual([
      [TEAM_STAGE, "Team approver", "jordan"],
      [legal.id, "Legal reviewer", "dana"],
    ]);

    // A version submitted now goes through all three.
    const next = await submitted("t_coral", "maya");
    expect((await versionOf(next))?.stages?.map((s) => s.name)).toEqual([
      "Team approver",
      "Compliance",
      "Legal reviewer",
    ]);
  });

  it("removing a stage still ahead of a version in its own stages is refused", async () => {
    const compliance = {
      name: "Compliance",
      rule: { kind: "user", userId: "naomi" } as ApproverRule,
    };
    await setChain([team, compliance, legal]);
    await submitted("t_coral", "maya"); // another version in review on the three stages
    const current = await chain();
    const templateId = await submitted("t_coral", "maya"); // recorded Team, Compliance, Legal; waits on Team
    as("riley");
    const withoutCompliance = current
      .filter((s) => s.name !== "Compliance")
      .map((s) => ({ id: s.id, name: s.name, rule: s.approverRule }));
    expect(
      await saveApprovalChain({ contentTypeId: CT, stages: withoutCompliance }),
    ).toEqual({
      ok: false,
      code: "stage_in_use",
      reason: expect.stringMatching(
        /^\d+ versions? in review still needs? Compliance\.$/,
      ),
    });
    const section = (await getApprovalChainsSection()).chains.find(
      (c) => c.contentTypeId === CT,
    )!;
    expect(
      section.stages.find((s) => s.name === "Compliance")!.waiting,
    ).toBeGreaterThanOrEqual(2);
    expect(await chain()).toEqual(current);
    expect((await versionOf(templateId))?.state).toBe("in_review");
  });

  it("a new rule on the stage it waits on reaches it: Naomi decides what waited on Dana", async () => {
    const templateId = await submitted("t_coral", "maya");
    as("jordan");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
      round: 1,
    });

    const at = as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          team,
          {
            id: legal.id,
            name: "Legal sign-off",
            rule: { kind: "user", userId: "naomi" },
          },
        ],
      }),
    ).toEqual({ ok: true });
    // Naomi is told, in the version's own words for the stage.
    const told = (await notificationsAt(at)).filter(
      (n) => n.userId === "naomi" && n.href?.includes(templateId),
    );
    expect(told.map((n) => [n.kind, n.title])).toEqual([
      [
        "review_requested",
        `${await versionTemplateName(templateId)} v1 is waiting on Legal reviewer.`,
      ],
    ]);

    as("dana");
    expect((await approve(templateId)).ok).toBe(false);
    as("naomi");
    const screen = await getReviewScreen("deposits", templateId, 1, null);
    expect(screen.can.approve).toEqual({ ok: true });
    expect(screen.steps.map((s) => s.name)).toEqual([
      "Team approver",
      "Legal reviewer",
    ]);
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });
    expect(await decided(templateId)).toEqual([
      [TEAM_STAGE, "Team approver", "jordan"],
      [legal.id, "Legal reviewer", "naomi"],
    ]);
  });

  it("a waiting stage changed to name someone who already approved the version asks nobody; another change unblocks it", async () => {
    await setChain([team, legal]);
    const templateId = await submitted("t_coral", "maya");
    as("jordan");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
      round: 1,
    });

    // Jordan approved the Team stage; the Legal stage it waits on is swapped to name him.
    let at = as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [team, { ...legal, rule: { kind: "user", userId: "jordan" } }],
      }),
    ).toEqual({ ok: true });
    expect(
      (await notificationsAt(at)).filter((n) => n.href?.includes(templateId)),
      "nobody is asked",
    ).toEqual([]);
    as("jordan");
    expect(await approve(templateId)).toEqual({
      ok: false,
      ...REFUSALS.approvedEarlierStage,
    });

    // The unblock path of decision 0007: name someone else, who is told and decides.
    at = as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [team, { ...legal, rule: { kind: "user", userId: "naomi" } }],
      }),
    ).toEqual({ ok: true });
    expect(
      (await notificationsAt(at))
        .filter((n) => n.href?.includes(templateId))
        .map((n) => n.userId),
    ).toEqual(["naomi"]);
    as("naomi");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });
  });
});

// ── A stage reviewer's stored link after a send-back ──────────

describe("a bare review link a stage reviewer outside the team was sent before a send-back", () => {
  const team = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
  const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;

  beforeEach(async () => {
    as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          team,
          { name: "Legal reviewer", rule: { kind: "user", userId: "naomi" } },
        ],
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("opens the round Naomi sent back while the next round waits on a stage that doesn't name her; the team gets the head", async () => {
    const templateId = await submitted("t_coral", "maya");
    const asked = as("jordan");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
      round: 1,
    });
    // Naomi isn't on Coral Offers: her link is bare (round 1 shows no round) and opens in her own space.
    const told = (await notificationsAt(asked)).filter(
      (n) => n.userId === "naomi" && n.href?.includes(templateId),
    );
    expect(told.map((n) => [n.kind, n.href])).toEqual([
      ["review_requested", `/deposits/review/${templateId}/1`],
    ]);

    as("naomi");
    expect(
      await requestChanges({
        templateId,
        versionNumber: 1,
        round: 1,
        reason: "Name the governing law.",
      }),
    ).toEqual({ ok: true });
    as("maya");
    expect(
      await submitVersion({ templateId, rev: await draftRev(db, templateId) }),
    ).toEqual({ ok: true, number: 1, round: 2 });

    // Round 2 waits on the team's approvers, so the stored link opens round 1, which she decided.
    as("naomi");
    const screen = await getReviewScreen("deposits", templateId, 1, null);
    expect(screen.version).toMatchObject({
      number: 1,
      round: 1,
      state: "changes_requested",
    });
    expect(screen.can.approve.ok).toBe(false);
    // Its rail links to no round she can't open.
    expect(screen.replacedBy).toBeNull();
    // Access is no wider: round 2 is still a 404 for her, and the bare link for someone who decided no round.
    await expect(getReviewScreen("deposits", templateId, 1, 2)).rejects.toThrow(
      NOT_FOUND,
    );
    as("eli");
    await expect(
      getReviewScreen("deposits", templateId, 1, null),
    ).rejects.toThrow(NOT_FOUND);
    // The team's link is the number's head, and round 1's screen links on to it.
    as("jordan");
    expect(
      (await getReviewScreen("coral-offers", templateId, 1, null)).version,
    ).toMatchObject({ round: 2, state: "in_review" });
    expect(
      (await getReviewScreen("coral-offers", templateId, 1, 1)).replacedBy,
    ).toEqual({
      number: 1,
      round: 2,
      state: "in_review",
      label: "v1, round 2",
    });

    // Once round 2 waits on her stage, the same link opens it.
    expect(
      await approveVersion({
        templateId,
        versionNumber: 1,
        round: 2,
        outputsViewed: OUTPUT_KEYS,
        sampleSetsSeen: ["typical"],
      }),
    ).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
      round: 2,
    });
    as("naomi");
    const next = await getReviewScreen("deposits", templateId, 1, null);
    expect(next.version).toMatchObject({
      number: 1,
      round: 2,
      state: "in_review",
    });
    expect(next.can.approve).toEqual({ ok: true });
    expect(
      (await getReviewScreen("deposits", templateId, 1, 1)).replacedBy,
      "round 1 now links on to it",
    ).toMatchObject({ round: 2 });
  });
});

/** The name of the template's v1: what its notifications call it (the name is versioned). */
async function versionTemplateName(templateId: string) {
  const row = await db.query.versions.findFirst({
    where: and(
      eq(schema.versions.templateId, templateId),
      eq(schema.versions.number, 1),
    ),
  });
  return row!.name;
}

// ── The migration's backfill ──────────────────────────────────

// Last: rows from before `versions.stages` and `approvals.stage_id` get today's chain, by position.
describe("the stages backfill in the migration", () => {
  const folder = "./src/server/db/migrations";
  const file = readdirSync(folder).find((name) =>
    name.endsWith("_version_stages.sql"),
  )!;
  const [, , ...backfill] = readFileSync(`${folder}/${file}`, "utf8").split(
    "--> statement-breakpoint",
  );

  it("gives every submitted version today's chain, and each decision the stage at its position", async () => {
    as("riley");
    expect(
      await saveApprovalChain({
        contentTypeId: CT,
        stages: [
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
          LEGAL,
        ],
      }),
    ).toEqual({
      ok: true,
    });
    const today = (await chain()).map((s) => ({ id: s.id, name: s.name }));

    await libsql.execute("UPDATE versions SET stages = NULL");
    await libsql.execute("UPDATE approvals SET stage_id = NULL");
    await libsql.execute(
      "UPDATE versions SET current_stage = 7 WHERE state = 'in_review'",
    ); // past the end
    for (const statement of backfill) await libsql.execute(statement);

    // Each version gets its own content type's chain: Disclosure's as edited above, Alert's untouched.
    const alertChain = [{ id: "stage_alert_0", name: "Team approver" }];
    const onAlert = new Set(
      (
        await db
          .select({ id: schema.templates.id })
          .from(schema.templates)
          .where(eq(schema.templates.contentTypeId, "ct_alert"))
      ).map((t) => t.id),
    );
    expect(onAlert.size).toBeGreaterThan(0);
    const chainOf = (v: { templateId: string }) =>
      onAlert.has(v.templateId) ? alertChain : today;

    const rows = await db.select().from(versions);
    expect(rows.some((v) => v.number === null)).toBe(true);
    for (const v of rows) {
      expect(v.stages).toEqual(v.number === null ? null : chainOf(v));
      if (v.state === "in_review")
        expect(v.currentStage, "read as the last stage, as before").toBe(
          chainOf(v).length - 1,
        );
    }
    const decisions = await db.select().from(approvals);
    expect(decisions.length).toBeGreaterThan(0);
    const versionById = new Map(rows.map((v) => [v.id, v]));
    for (const d of decisions)
      expect(d.stageId).toBe(
        chainOf(versionById.get(d.versionId)!)[d.stagePosition]?.id ?? null,
      );
  });

  it("someone who approved before the migration can't approve the stage their approval was matched to", async () => {
    const templateId = await submitted("t_coral", "maya");
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
    await db
      .update(versions)
      .set({ stages: null, currentStage: 0 })
      .where(eq(versions.id, version.id));
    for (const statement of backfill) await libsql.execute(statement);
    expect(await versionOf(templateId)).toMatchObject({
      stages: [{ id: TEAM_STAGE, name: "Team approver" }],
      currentStage: 0,
    });
    expect(
      (
        await db.query.approvals.findFirst({
          where: eq(approvals.id, "ap_before_stage_ids"),
        })
      )?.stageId,
    ).toBe(TEAM_STAGE);

    // Matched to the stage the version waits on, his approval still counts: two stages need two people.
    as("jordan");
    expect(
      (await getReviewScreen("coral-offers", templateId, 1, null)).can.approve,
    ).toEqual({ ok: false, ...REFUSALS.approvedEarlierStage });
    expect(await approve(templateId)).toEqual({
      ok: false,
      ...REFUSALS.approvedEarlierStage,
    });
    as("alex");
    expect(await approve(templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });
  });
});
