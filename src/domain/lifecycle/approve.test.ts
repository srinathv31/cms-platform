import { OUTPUT_KEYS } from "../review-outputs";
import { describe, expect, it } from "vitest";
import { REFUSALS } from "./refusals";
import { approve, replacedActive } from "./approve";
import type { ReviewVersion } from "./types";
import { describeNotification } from "../notifications";
import { REASONS } from "../permissions";
import type {
  ApprovalStage,
  LifecycleEffect,
  VersionStage,
} from "../review-types";
import {
  NOW,
  TEMPLATE,
  CHAIN_1,
  CHAIN_2,
  STAGES_2,
  ZONE,
  TOMORROW_DAY,
  MARCH_1_DAY,
  MARCH_1,
  LATE_EVENING,
  ANNUAL_FEE_ADDED,
  reviewVersion,
  tryRequestChanges,
} from "./fixtures";

describe("approve", () => {
  const v2 = reviewVersion({
    id: "v_2",
    number: 2,
    contractChanges: [ANNUAL_FEE_ADDED],
  });
  const run = (over: Partial<Parameters<typeof approve>[0]> = {}) =>
    approve({
      version: v2,
      chain: CHAIN_1,
      actorId: "jordan",
      actorName: "Jordan Ellis",
      now: NOW,
      active: { id: "v_1", number: 1 },
      sunsetPrevious: null,
      zone: ZONE,
      sampleSetsSeen: ["typical", "long"],
      outputsViewed: OUTPUT_KEYS,
      templateName: TEMPLATE.name,
      ...over,
    });

  /** A notification effect as its reader sees it (`describeNotification`): null for any other effect. */
  const worded = (effect: LifecycleEffect | undefined, readerId = "maya") =>
    effect?.kind === "notification"
      ? describeNotification(effect.notification, effect.facts, readerId)
      : null;

  const activated = (supersedes: number | null, stage = "Team approver") => ({
    kind: "audit",
    action: "version.activated",
    details: {
      number: 2,
      round: 1,
      supersedes,
      stage,
      outputsViewed: ["pdf", "web", "email"],
    },
  });
  const superseded = {
    kind: "audit",
    action: "version.superseded",
    versionId: "v_1",
    details: { number: 1, supersededBy: 2 },
  };
  const live = {
    kind: "notification",
    notification: "version_live",
    to: { kind: "user", userId: "maya" },
    facts: {
      actorName: "Jordan Ellis",
      templateName: TEMPLATE.name,
      number: 2,
    },
    link: { to: "template", templateId: TEMPLATE.id },
  };
  const newVersion = {
    kind: "consumer_notice",
    notice: "new_version",
    versionId: "v_2",
    payload: {
      versionNumber: 2,
      activeVersion: 2,
      contractChanges: [ANNUAL_FEE_ADDED],
    },
  };

  it("makes the last stage's approval go live, and supersedes the previous Active version", () => {
    expect(run()).toEqual({
      ok: true,
      changes: { state: "active", currentStage: 0, activatedAt: NOW },
      approval: {
        versionId: "v_2",
        stageId: "st_team",
        stagePosition: 0,
        stageName: "Team approver",
        actorId: "jordan",
        decision: "approved",
        reason: null,
        sampleSetsSeen: ["typical", "long"],
        decidedAt: NOW,
      },
      previous: {
        id: "v_1",
        changes: { state: "superseded", supersededAt: NOW },
      },
      wentLive: true,
      effects: [activated(1), superseded, live, newVersion],
    });
  });

  it("tells the submitter their version is Active, worded when it is read", () => {
    const result = run();
    expect(result.ok && worded(result.effects[2])).toEqual({
      title: "Spring Travel Rewards — Terms v2 is now Active.",
      body: "Jordan Ellis approved it.",
    });
  });

  it("sets the previous version's sunset in the same step, at 00:00 Eastern that day, and tells its consumers", () => {
    const result = run({ sunsetPrevious: MARCH_1_DAY });
    expect(result.ok && result.previous).toEqual({
      id: "v_1",
      changes: {
        state: "superseded",
        supersededAt: NOW,
        sunsetAt: MARCH_1,
        sunsetSetBy: "jordan",
      },
    });
    expect(result.ok && result.effects).toEqual([
      activated(1),
      superseded,
      {
        kind: "audit",
        action: "version.sunset_set",
        versionId: "v_1",
        details: {
          number: 1,
          sunsetAt: "2027-03-01T05:00:00.000Z",
          sunsetDay: "2027-03-01",
          zone: ZONE,
          previousSunsetAt: null,
        },
      },
      live,
      newVersion,
      {
        kind: "consumer_notice",
        notice: "sunset_scheduled",
        versionId: "v_1",
        payload: {
          versionNumber: 1,
          activeVersion: 2,
          sunsetAt: "2027-03-01T05:00:00.000Z",
          sunsetDay: "2027-03-01",
          zone: ZONE,
          contractChanges: [ANNUAL_FEE_ADDED],
        },
      },
    ]);
  });

  it("goes live on a later round as the version consumers know: v2, with the round on the audit row only", () => {
    const result = run({ version: { ...v2, id: "v_2r3", round: 3 } });
    expect(result.ok && result.effects).toEqual([
      {
        ...activated(1),
        details: {
          number: 2,
          round: 3,
          supersedes: 1,
          stage: "Team approver",
          outputsViewed: ["pdf", "web", "email"],
        },
      },
      superseded,
      live,
      { ...newVersion, versionId: "v_2r3" },
    ]);
  });

  it("goes live with nothing to supersede when no version is Active", () => {
    const result = run({ active: null });
    expect(result.ok && "previous" in result).toBe(false);
    expect(result.ok && result.effects).toEqual([
      activated(null),
      live,
      newVersion,
    ]);
  });

  it("has nothing to sunset when no version is Active", () => {
    const result = run({ active: null, sunsetPrevious: MARCH_1_DAY });
    expect(result.ok && "previous" in result).toBe(false);
    expect(
      result.ok &&
        result.effects.map((e) => (e.kind === "audit" ? e.action : e.kind)),
    ).toEqual(["version.activated", "notification", "consumer_notice"]);
  });

  it.each([
    ["today", "2026-10-04"],
    ["in the past", "2026-09-01"],
  ])("refuses a sunset date %s", (_, day) => {
    expect(run({ sunsetPrevious: day })).toEqual({
      ok: false,
      code: "sunset_not_after_today",
      reason: "Pick a date after today.",
    });
  });

  it("accepts a sunset date of tomorrow", () => {
    expect(run({ sunsetPrevious: TOMORROW_DAY }).ok).toBe(true);
  });

  it("reads today in the business time zone: at 23:30 Eastern, tomorrow is still tomorrow", () => {
    expect(run({ now: LATE_EVENING, sunsetPrevious: TOMORROW_DAY }).ok).toBe(
      true,
    );
    expect(run({ now: LATE_EVENING, sunsetPrevious: "2026-10-04" })).toEqual({
      ok: false,
      code: "sunset_not_after_today",
      reason: "Pick a date after today.",
    });
    // In UTC it is already the 5th there, so the 5th isn't after today.
    expect(
      run({ now: LATE_EVENING, sunsetPrevious: TOMORROW_DAY, zone: "UTC" }),
    ).toEqual({
      ok: false,
      code: "sunset_not_after_today",
      reason: "Pick a date after today.",
    });
  });

  it("refuses the submitter: nobody approves their own version", () => {
    expect(run({ actorId: "maya", actorName: "Maya Chen" })).toEqual({
      ok: false,
      code: "submitted_version",
      reason: "You submitted this version.",
    });
  });

  it("refuses anyone else who wrote it, even when someone else submitted it", () => {
    const version = { ...v2, writers: ["priya", "maya"] };
    expect(
      run({ version, actorId: "priya", actorName: "Priya Raman" }),
    ).toEqual({
      ok: false,
      code: "wrote_version",
      reason: "You wrote part of this version.",
    });
    expect(run({ version }).ok, "Jordan wrote none of it").toBe(true);
  });

  it("records each sample set the approver saw once", () => {
    const result = run({ sampleSetsSeen: ["typical", "long", "typical"] });
    expect(result.ok && result.approval.sampleSetsSeen).toEqual([
      "typical",
      "long",
    ]);
  });

  it("says nothing to a submitter who isn't on record", () => {
    const result = run({ version: { ...v2, submittedBy: null } });
    expect(result.ok && result.effects).toEqual([
      activated(1),
      superseded,
      newVersion,
    ]);
  });

  // Decision 0037: every output of the version, rendered on the approver's screen, before Approve.
  describe("the outputs the approver viewed", () => {
    it("refuses a document version while an output is unviewed, naming what's left", () => {
      expect(run({ outputsViewed: ["pdf"] })).toEqual({
        ok: false,
        code: "output_not_viewed",
        reason: "Preview Web and Email first.",
      });
      expect(run({ outputsViewed: [] })).toMatchObject({
        ok: false,
        code: "output_not_viewed",
      });
    });

    it("counts a push on each phone: an alert needs iPhone, Android and SMS", () => {
      const alert: ReviewVersion = { ...v2, channels: ["push", "sms"] };
      expect(
        run({ version: alert, outputsViewed: ["push.ios", "sms"] }),
      ).toEqual({
        ok: false,
        code: "output_not_viewed",
        reason: "Preview Push (Android) first.",
      });
      const approved = run({
        version: alert,
        outputsViewed: ["sms", "push.android", "push.ios"],
      });
      expect(approved.ok && approved.effects[0]).toMatchObject({
        action: "version.activated",
        details: { outputsViewed: ["push.ios", "push.android", "sms"] },
      });
    });

    it("a single channel needs only its own output", () => {
      expect(
        run({ version: { ...v2, channels: ["pdf"] }, outputsViewed: ["pdf"] })
          .ok,
      ).toBe(true);
    });

    it("gates every stage, not only the last", () => {
      expect(
        run({ chain: CHAIN_2, outputsViewed: ["pdf", "web"] }),
      ).toMatchObject({ ok: false, code: "output_not_viewed" });
    });

    it("never gates Request changes", () => {
      expect(tryRequestChanges(v2).ok).toBe(true);
    });

    it("refuses maker-checker first: someone who wrote the version hears that, not the outputs", () => {
      expect(run({ actorId: "maya", outputsViewed: [] })).toEqual({
        ok: false,
        ...REASONS.ownVersion,
      });
    });
  });

  describe("with two stages", () => {
    it("moves the first stage's approval on to the next stage, and asks it to review", () => {
      expect(run({ chain: CHAIN_2 })).toEqual({
        ok: true,
        changes: { state: "in_review", currentStage: 1, activatedAt: null },
        approval: {
          versionId: "v_2",
          stageId: "st_team",
          stagePosition: 0,
          stageName: "Team approver",
          actorId: "jordan",
          decision: "approved",
          reason: null,
          sampleSetsSeen: ["typical", "long"],
          decidedAt: NOW,
        },
        wentLive: false,
        effects: [
          {
            kind: "audit",
            action: "version.stage_approved",
            details: {
              number: 2,
              round: 1,
              stage: "Team approver",
              stagePosition: 0,
              next: "Legal reviewer",
              outputsViewed: ["pdf", "web", "email"],
            },
          },
          {
            kind: "notification",
            notification: "review_requested",
            to: { kind: "user", userId: "dana" },
            facts: {
              actorName: "Jordan Ellis",
              templateName: TEMPLATE.name,
              number: 2,
              round: 1,
              stage: "Legal reviewer",
            },
            link: { to: "review", templateId: TEMPLATE.id, versionNumber: 2 },
          },
          {
            kind: "notification",
            notification: "stage_approved",
            to: { kind: "user", userId: "maya" },
            facts: {
              actorName: "Jordan Ellis",
              templateName: TEMPLATE.name,
              number: 2,
              round: 1,
              stage: "Team approver",
              next: "Legal reviewer",
            },
            link: { to: "review", templateId: TEMPLATE.id, versionNumber: 2 },
          },
        ],
      });
    });

    it("words the two notifications when they are read: who is waiting, and what the submitter hears", () => {
      const result = run({ chain: CHAIN_2 });
      expect(result.ok && worded(result.effects[1], "dana")).toEqual({
        title: "Spring Travel Rewards — Terms v2 is waiting on Legal reviewer.",
        body: null,
      });
      expect(result.ok && worded(result.effects[2])).toEqual({
        title:
          "Jordan Ellis approved Spring Travel Rewards — Terms v2 for Team approver.",
        body: "Next: Legal reviewer.",
      });
    });

    it("names a second round in the stage's titles and links, so the link opens that round", () => {
      const round2 = { ...v2, id: "v_2r2", round: 2 };
      const result = run({ chain: CHAIN_2, version: round2 });
      const review = {
        to: "review",
        templateId: TEMPLATE.id,
        versionNumber: 2,
        round: 2,
      };
      expect(result.ok && result.effects).toEqual([
        {
          kind: "audit",
          action: "version.stage_approved",
          details: {
            number: 2,
            round: 2,
            stage: "Team approver",
            stagePosition: 0,
            next: "Legal reviewer",
            outputsViewed: ["pdf", "web", "email"],
          },
        },
        expect.objectContaining({
          notification: "review_requested",
          facts: expect.objectContaining({ round: 2, stage: "Legal reviewer" }),
          link: review,
        }),
        expect.objectContaining({
          notification: "stage_approved",
          facts: expect.objectContaining({ round: 2, stage: "Team approver" }),
          link: review,
        }),
      ]);
      expect(result.ok && worded(result.effects[1], "dana")?.title).toBe(
        "Spring Travel Rewards — Terms v2, round 2 is waiting on Legal reviewer.",
      );
      expect(result.ok && worded(result.effects[2])?.title).toBe(
        "Jordan Ellis approved Spring Travel Rewards — Terms v2, round 2 for Team approver.",
      );
    });

    it("doesn't supersede or sunset anything before the last stage", () => {
      const result = run({ chain: CHAIN_2, sunsetPrevious: MARCH_1_DAY });
      expect(result.ok && result.wentLive).toBe(false);
      expect(result.ok && "previous" in result).toBe(false);
      expect(
        result.ok && result.effects.some((e) => e.kind === "consumer_notice"),
      ).toBe(false);
    });

    it("goes live at the second stage", () => {
      const result = run({
        chain: CHAIN_2,
        version: { ...v2, currentStage: 1 },
        actorId: "dana",
        actorName: "Dana Park",
      });
      expect(result.ok && result.wentLive).toBe(true);
      expect(result.ok && result.changes).toEqual({
        state: "active",
        currentStage: 1,
        activatedAt: NOW,
      });
      expect(result.ok && result.approval).toMatchObject({
        stagePosition: 1,
        stageName: "Legal reviewer",
        actorId: "dana",
      });
      expect(result.ok && result.effects[0]).toEqual(
        activated(1, "Legal reviewer"),
      );
    });

    it("follows the stages' positions, whatever order the chain arrives in", () => {
      const result = run({ chain: [...CHAIN_2].reverse() });
      expect(result.ok && result.approval.stageName).toBe("Team approver");
      expect(result.ok && result.changes.currentStage).toBe(1);
    });

    it("asks a team-role stage's approvers, never the submitter or whoever approved a stage of this round", () => {
      const teamSecond: ApprovalStage[] = [
        {
          id: "st_legal",
          position: 0,
          name: "Legal reviewer",
          rule: { kind: "user", userId: "dana" },
        },
        {
          id: "st_team",
          position: 1,
          name: "Team approver",
          rule: { kind: "team_role", role: "approver" },
        },
      ];
      const result = run({
        chain: teamSecond,
        actorId: "dana",
        actorName: "Dana Park",
      });
      expect(result.ok && result.effects[1]).toMatchObject({
        notification: "review_requested",
        to: {
          kind: "team_role",
          role: "approver",
          exceptUserIds: ["maya", "dana"],
        },
        facts: {
          actorName: "Dana Park",
          templateName: TEMPLATE.name,
          number: 2,
          round: 1,
          stage: "Team approver",
        },
      });
      expect(result.ok && worded(result.effects[1], "jordan")?.title).toBe(
        "Spring Travel Rewards — Terms v2 is waiting on Team approver.",
      );

      const coWritten = run({
        chain: teamSecond,
        version: { ...v2, writers: ["priya", "maya"] },
        actorId: "dana",
        actorName: "Dana Park",
      });
      expect(coWritten.ok && coWritten.effects[1]).toMatchObject({
        notification: "review_requested",
        to: {
          kind: "team_role",
          role: "approver",
          exceptUserIds: ["priya", "maya", "dana"],
        },
      });
    });

    it("asks nobody when the next stage names someone who already approved a stage of this round", () => {
      // Three stages, Jordan named on the third; he approved the first (rules swapped since, say).
      const three: ApprovalStage[] = [
        ...CHAIN_2,
        {
          id: "st_final",
          position: 2,
          name: "Final sign-off",
          rule: { kind: "user", userId: "jordan" },
        },
      ];
      const version = { ...v2, currentStage: 1 };
      const result = run({
        chain: three,
        version,
        actorId: "dana",
        actorName: "Dana Park",
        decisions: [
          { stageId: "st_team", actorId: "jordan", decision: "approved" },
        ],
      });
      expect(result.ok && result.changes.currentStage).toBe(2);
      expect(
        result.ok &&
          result.effects
            .filter((e) => e.kind === "notification")
            .map((e) => e.notification),
      ).toEqual(["stage_approved"]);
    });

    it("refuses someone who approved an earlier stage of the same round", () => {
      const second = { ...v2, currentStage: 1 };
      const twoTeamStages: ApprovalStage[] = [
        {
          id: "st_team",
          position: 0,
          name: "Team approver",
          rule: { kind: "team_role", role: "approver" },
        },
        {
          id: "st_second",
          position: 1,
          name: "Second approver",
          rule: { kind: "team_role", role: "approver" },
        },
      ];
      const approvedTeam = (actorId: string) => [
        { stageId: "st_team", actorId, decision: "approved" as const },
      ];
      expect(
        run({
          chain: twoTeamStages,
          version: second,
          decisions: approvedTeam("jordan"),
        }),
      ).toEqual({
        ok: false,
        code: "approved_earlier_stage",
        reason: "You approved an earlier stage.",
      });
      expect(REFUSALS.approvedEarlierStage.reason).toBe(
        "You approved an earlier stage.",
      );
      expect(
        run({
          chain: twoTeamStages,
          version: second,
          decisions: approvedTeam("alex"),
        }).ok,
      ).toBe(true);
      expect(
        run({ chain: twoTeamStages, version: second, decisions: [] }).ok,
      ).toBe(true);
    });
  });

  // Finding D3: the version goes through the stages it recorded at submit, whatever the chain becomes.
  describe("after the chain is edited mid-review", () => {
    const DANA_APPROVED_LEGAL = [
      { stageId: "st_legal", actorId: "dana", decision: "approved" as const },
    ];
    const LEGAL_FIRST: VersionStage[] = [STAGES_2[1]!, STAGES_2[0]!];

    it("a reorder doesn't send it back to a stage it passed: Jordan's Team approval makes it Active", () => {
      // Submitted under [Legal, Team]; Dana approved Legal; the chain is now [Team, Legal].
      const version = { ...v2, stages: LEGAL_FIRST, currentStage: 1 };
      const result = run({
        chain: CHAIN_2,
        version,
        decisions: DANA_APPROVED_LEGAL,
      });
      expect(result.ok && result.changes).toEqual({
        state: "active",
        currentStage: 1,
        activatedAt: NOW,
      });
      expect(result.ok && result.approval).toMatchObject({
        stageId: "st_team",
        stagePosition: 1,
        stageName: "Team approver",
      });
    });

    it("an inserted stage isn't added to it, and it still waits on the stage it was at", () => {
      const compliance: ApprovalStage = {
        id: "st_comp",
        position: 0,
        name: "Compliance",
        rule: { kind: "user", userId: "naomi" },
      };
      const inserted = [
        compliance,
        ...CHAIN_2.map((s) => ({ ...s, position: s.position + 1 })),
      ];
      const atTeam = run({
        chain: inserted,
        version: { ...v2, stages: STAGES_2, currentStage: 0 },
      });
      expect(atTeam.ok && atTeam.changes).toEqual({
        state: "in_review",
        currentStage: 1,
        activatedAt: null,
      });
      expect(atTeam.ok && atTeam.effects[0]).toMatchObject({
        details: { stage: "Team approver", next: "Legal reviewer" },
      });

      const atLegal = run({
        chain: inserted,
        version: { ...v2, stages: STAGES_2, currentStage: 1 },
        actorId: "dana",
        actorName: "Dana Park",
      });
      expect(atLegal.ok && atLegal.wentLive).toBe(true);
      expect(atLegal.ok && atLegal.approval).toMatchObject({
        stageId: "st_legal",
        stageName: "Legal reviewer",
      });
    });

    it("a stage's new rule reaches it: the stage's own name, whoever the chain names now", () => {
      const naomiOnLegal = CHAIN_2.map((s) =>
        s.id === "st_legal"
          ? {
              ...s,
              name: "Legal sign-off",
              rule: { kind: "user" as const, userId: "naomi" },
            }
          : s,
      );
      const result = run({
        chain: naomiOnLegal,
        version: { ...v2, stages: STAGES_2 },
      });
      expect(result.ok && result.effects[1]).toMatchObject({
        notification: "review_requested",
        to: { kind: "user", userId: "naomi" },
        facts: {
          actorName: "Jordan Ellis",
          templateName: TEMPLATE.name,
          number: 2,
          round: 1,
          stage: "Legal reviewer",
        },
      });
      expect(result.ok && worded(result.effects[1], "naomi")?.title).toBe(
        "Spring Travel Rewards — Terms v2 is waiting on Legal reviewer.",
      );
    });

    it("on migrated data, an approval matched to the stage it waits on still bars its approver", () => {
      // Before stage ids: chain [Team1, Team2], Jordan approved Team1, an admin removed Team1 and the
      // version moved to position 0. The 0005 backfill then matched Jordan's position-0 approval to Team2.
      const team2: ApprovalStage = {
        id: "st_team2",
        position: 0,
        name: "Second approver",
        rule: { kind: "team_role", role: "approver" },
      };
      const version = {
        ...v2,
        stages: [{ id: "st_team2", name: "Second approver" }],
        currentStage: 0,
      };
      const decisions = [
        {
          stageId: "st_team2",
          actorId: "jordan",
          decision: "approved" as const,
        },
      ];
      expect(run({ chain: [team2], version, decisions })).toEqual({
        ok: false,
        ...REFUSALS.approvedEarlierStage,
      });
      expect(
        run({
          chain: [team2],
          version,
          decisions,
          actorId: "alex",
          actorName: "Alex Kim",
        }).ok,
      ).toBe(true);
    });

    it("a version that recorded Release 1's default stage stays decidable once the content type has a chain", () => {
      const version = {
        ...v2,
        stages: [{ id: "default", name: "Team approver" }],
        currentStage: 0,
      };
      const result = run({ chain: CHAIN_2, version });
      expect(result.ok && result.wentLive).toBe(true);
      expect(result.ok && result.approval).toMatchObject({
        stageId: "default",
        stageName: "Team approver",
      });
    });

    it("refuses when the stage it waits on, or the next one, has left the chain", () => {
      const missing = {
        ok: false,
        code: "stage_missing",
        reason: "This version's approval stage no longer exists.",
      };
      expect(
        run({ chain: [CHAIN_2[1]!], version: { ...v2, stages: STAGES_2 } }),
      ).toEqual(missing);
      expect(
        run({ chain: CHAIN_1, version: { ...v2, stages: STAGES_2 } }),
      ).toEqual(missing);
    });
  });

  it("refuses when the chain has no stage for the version", () => {
    expect(run({ version: { ...v2, currentStage: 1 } })).toEqual({
      ok: false,
      code: "stage_missing",
      reason: "This version's approval stage no longer exists.",
    });
  });
});

describe("replacedActive", () => {
  it("is the template's Active version, unless it is the round being approved or has no number", () => {
    const round = { id: "v_3" };
    expect(replacedActive({ id: "v_2", number: 2 }, round)).toEqual({
      id: "v_2",
      number: 2,
    });
    expect(replacedActive({ id: "v_3", number: 3 }, round)).toBeNull();
    expect(replacedActive({ id: "v_2", number: null }, round)).toBeNull();
    expect(replacedActive(undefined, round)).toBeNull();
  });
});
