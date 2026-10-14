import { beforeEach, describe, expect, it } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import type { DraftContent } from "@/domain/lifecycle/types";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { OUTPUT_KEYS } from "@/domain/review-outputs";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { ApproverRule } from "@/domain/types";
import type { StoredNotification } from "../notifications";
import { seededAccess, told } from "./access";
import type { ContractHarness } from "./harness";

// The approval chain under the versions in review, as every implementation must show it: a Platform Admin edits
// a content type's chain (`PlatformService.saveApprovalChain`) while versions go through review
// (`ReviewService`). A chain must be one somebody can approve (decision 0008), and a version keeps the stages it
// was submitted with (decision 0015): a chain edit reaches a version in review only through the stage it waits
// on, by that stage's id.
//
// From the seed: Disclosure (`ct_disclosure`) has one stage, "Team approver" (`stage_disclosure_0`: the team's
// approvers), and Cash Back v3 round 2 waits on it (submitted by Maya). Alex and Jordan approve on Coral Offers;
// Maya and Priya write there; Dana and Sam view it (Dana on no other team); Naomi approves on Deposits and Eli
// writes there; Riley is the Platform Admin. A case makes the versions it follows with `templates.create` and
// `review.submit`, as an author would.
//
// The first set runs against every implementation: it observes a chain through what the review commands answer,
// the decisions `versions.history` records (by the stage's name as the version has it) and the bell. The second
// set reads what the fake doesn't serve: the chain as the settings show it (`platform.approvalChains`, and with it
// the id of a stage a case added, which a reorder must name), the review screen, the queue and the badge. Each
// case sets the backend's clock and compares before and after; a refusal is checked by its code.

const CT = "ct_disclosure";
const CORAL = "t_coral";
const DEPOSITS = "t_deposits";
const TEAM_STAGE = "stage_disclosure_0";
const TEAM_RULE: ApproverRule = { kind: "team_role", role: "approver" };
const user = (userId: string): ApproverRule => ({ kind: "user", userId });
/** The seeded stage, as it is. */
const TEAM = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
/** Dana Park's stage: added after the team's approvers unless a case says otherwise. */
const LEGAL = { name: "Legal reviewer", rule: user("dana") };

/** A stage as `saveApprovalChain` takes it: an id keeps a stage, none adds one. */
type StageInput = { id?: string; name: string; rule: ApproverRule };

/** A first draft the BFF would have built for a Disclosure: one paragraph, for PDF and the web. */
const DRAFT: DraftContent = {
  name: "Card agreement",
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "b_terms" },
        content: [{ type: "text", text: "Terms apply." }],
      },
    ],
  },
  channelFields: {},
  channels: ["pdf", "web"],
  variables: [],
  sampleSets: [],
  starterKey: null,
};

/** A notification about the template. */
const about = (templateId: string) => (n: StoredNotification) =>
  (n.link as { templateId?: string }).templateId === templateId;

/** The steps every case takes, one clock minute apart. */
function chainSteps(h: ContractHarness, base: Date) {
  let step = 0;
  beforeEach(() => {
    step = 0;
  });
  /** Moves the backend's clock a minute on: each command a case runs comes a minute after the last. */
  const tick = () => {
    step += 1;
    h.setClock(new Date(base.getTime() + step * 60_000));
  };

  /** Riley saves Disclosure's chain: "changed", "unchanged" or the refusal's code. */
  async function setChain(stages: StageInput[]) {
    tick();
    const result = await h
      .services()
      .platform.saveApprovalChain(await h.as("riley"), {
        contentTypeId: CT,
        stages,
      });
    return result.ok ? (result.changed ? "changed" : "unchanged") : result.code;
  }

  /** Submits the template's draft as `author`, with the rev of the summary they read. */
  async function submit(author: string, templateId: string) {
    tick();
    const ctx = await h.as(author);
    const summary = await h.services().review.submitSummary(ctx, {
      templateId,
    });
    if (!summary.ok) throw new Error(summary.code);
    return h.services().review.submit(ctx, { templateId, rev: summary.rev });
  }

  /** A new Disclosure `author` creates on the team and submits: v1, round 1, on the chain as it is now. */
  async function submitted(author: string, teamId = CORAL) {
    tick();
    const created = await h.services().templates.create(await h.as(author), {
      teamId,
      contentTypeId: CT,
      draft: DRAFT,
    });
    if (!created.ok) throw new Error(`create refused: ${created.code}`);
    expect(await submit(author, created.templateId)).toEqual({
      ok: true,
      number: 1,
      round: 1,
    });
    return created.templateId;
  }

  /** `userId` approves the round, having viewed every output. */
  async function approve(
    userId: string,
    templateId: string,
    number = 1,
    round = 1,
  ) {
    tick();
    return h.services().review.approve(await h.as(userId), {
      templateId,
      versionNumber: number,
      round,
      outputsViewed: OUTPUT_KEYS,
      sampleSetsSeen: [],
    });
  }

  /** What `approve` answers, as its code or whether the round went live. */
  async function approves(
    userId: string,
    templateId: string,
    number = 1,
    round = 1,
  ) {
    const result = await approve(userId, templateId, number, round);
    return result.ok ? (result.wentLive ? "live" : "next stage") : result.code;
  }

  /** A round as the Versions read shows it to the Auditor: its state and its decisions, by stage name. */
  async function roundOf(templateId: string, number = 1, round = 1) {
    const history = await h
      .services()
      .versions.history(await h.as("taylor"), { templateId });
    if (!history.ok) throw new Error(history.code);
    const row = history.versions.find(
      (v) => v.number === number && v.round === round,
    )!;
    return {
      id: row.id,
      state: row.state,
      decisions: row.decisions.map((d) => [d.stageName, d.by, d.kind]),
    };
  }

  /** Everyone's bell, to see who a step told about the template. */
  async function bells(...userIds: string[]) {
    const all: Record<string, StoredNotification[]> = {};
    for (const id of userIds) {
      const list = await h
        .services()
        .notifications.list(await h.as(id), { limit: 100 });
      if (!list.ok) throw new Error(list.code);
      all[id] = list.items;
    }
    return all;
  }

  /** Who was told what about the template between two reads of the bells: [user, kind, facts.stage]. */
  const toldAbout = (
    templateId: string,
    before: Record<string, StoredNotification[]>,
    after: Record<string, StoredNotification[]>,
  ) =>
    Object.keys(after).flatMap((id) =>
      told(before[id]!, after[id]!)
        .filter(about(templateId))
        .map((n) => [id, n.kind, n.facts.stage ?? null]),
    );

  return {
    tick,
    setChain,
    submit,
    submitted,
    approve,
    approves,
    roundOf,
    bells,
    toldAbout,
  };
}

/** The cases every implementation runs. */
export function approvalChainContract(h: ContractHarness, base: Date) {
  const { tick, setChain, submitted, approves, roundOf, bells, toldAbout } =
    chainSteps(h, base);
  const cashBack = () => h.templates["cash-back"]!;

  describe("a chain edited while versions are in review (decision 0015)", () => {
    it("adds a stage: the version already in review goes live on its one stage, and one submitted now goes through both", async () => {
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
      expect(await approves("jordan", cashBack(), 3, 2)).toBe("live");
      expect((await roundOf(cashBack(), 3, 2)).decisions).toEqual([
        ["Team approver", "jordan", "approved"],
      ]);

      const templateId = await submitted("maya");
      expect(await approves("jordan", templateId)).toBe("next stage");
      expect(await approves("dana", templateId)).toBe("live");
    });

    it("gives the stage a version waits on a new rule and name: the person it names now is told in the version's words, and decides it", async () => {
      const before = await bells("naomi", "jordan");
      const round = await roundOf(cashBack(), 3, 2);
      expect(
        await setChain([
          { id: TEAM_STAGE, name: "Legal sign-off", rule: user("naomi") },
        ]),
      ).toBe("changed");
      // The version recorded the stage as "Team approver": that is what it waits on.
      expect(
        toldAbout(cashBack(), before, await bells("naomi", "jordan")),
      ).toEqual([["naomi", "review_requested", "Team approver"]]);
      expect(await approves("jordan", cashBack(), 3, 2)).toBe(
        "waiting_on_stage",
      );
      expect(await approves("naomi", cashBack(), 3, 2)).toBe("live");
      expect(await roundOf(cashBack(), 3, 2)).toEqual({
        ...round,
        state: "active",
        decisions: [...round.decisions, ["Team approver", "naomi", "approved"]],
      });
    });

    it("asks nobody when the stage a version waits on now names someone who approved an earlier stage of it; naming someone else unblocks it", async () => {
      expect(await setChain([LEGAL, TEAM])).toBe("changed");
      const templateId = await submitted("maya");
      expect(await approves("dana", templateId)).toBe("next stage");

      // The Legal stage is behind the version, so it may go; the stage it waits on now names Dana.
      const people = ["dana", "jordan", "alex", "naomi", "maya"];
      let before = await bells(...people);
      expect(await setChain([{ ...TEAM, rule: user("dana") }])).toBe("changed");
      expect(toldAbout(templateId, before, await bells(...people))).toEqual([]);
      expect(await approves("dana", templateId)).toBe(
        REFUSALS.approvedEarlierStage.code,
      );

      before = await bells(...people);
      expect(await setChain([{ ...TEAM, rule: user("naomi") }])).toBe(
        "changed",
      );
      expect(toldAbout(templateId, before, await bells(...people))).toEqual([
        ["naomi", "review_requested", "Team approver"],
      ]);
      expect(await approves("naomi", templateId)).toBe("live");
      expect((await roundOf(templateId)).decisions).toEqual([
        ["Legal reviewer", "dana", "approved"],
        ["Team approver", "naomi", "approved"],
      ]);
    });

    it("refuses removing a stage a version still needs, the one it waits on or one ahead of it, and allows it once none does", async () => {
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
      const onLegal = await submitted("maya");
      expect(await approves("jordan", onLegal)).toBe("next stage");
      const onTeam = await submitted("priya"); // Legal is ahead of it

      expect(await setChain([TEAM])).toBe("stage_in_use");
      expect(await approves("dana", onLegal)).toBe("live");
      expect(await setChain([TEAM])).toBe("stage_in_use");
      // The chain kept Legal: a version submitted now still needs Dana.
      const after = await submitted("maya");
      expect(await approves("jordan", after)).toBe("next stage");
      expect(await approves("dana", after)).toBe("live");

      expect(await approves("jordan", onTeam)).toBe("next stage");
      expect(await approves("dana", onTeam)).toBe("live");
      expect(await setChain([TEAM])).toBe("changed");
      expect(await approves("jordan", await submitted("maya"))).toBe("live");
    });

    it("lets nobody approve two stages of one round, though both name the team's approvers", async () => {
      expect(
        await setChain([TEAM, { name: "Second approver", rule: TEAM_RULE }]),
      ).toBe("changed");
      const templateId = await submitted("maya");
      expect(await approves("jordan", templateId)).toBe("next stage");
      expect(await approves("jordan", templateId)).toBe(
        REFUSALS.approvedEarlierStage.code,
      );
      expect((await roundOf(templateId)).state).toBe("in_review");
      expect(await approves("alex", templateId)).toBe("live");
      expect((await roundOf(templateId)).decisions).toEqual([
        ["Team approver", "jordan", "approved"],
        ["Second approver", "alex", "approved"],
      ]);
    });

    it("tells nobody who wrote the version when the stage it waits on goes back to the team's approvers", async () => {
      // Maya submitted Cash Back v3 round 2; Alex makes her an Approver too.
      tick();
      expect(
        await h.services().access.changeRoles(await h.as("alex"), {
          membershipId: seededAccess().membership("maya"),
          roles: ["author", "approver"],
        }),
      ).toEqual({ ok: true, changed: true });
      expect(await setChain([{ ...TEAM, rule: user("naomi") }])).toBe(
        "changed",
      );
      const before = await bells("alex", "jordan", "maya");
      expect(await setChain([TEAM])).toBe("changed");
      expect(
        toldAbout(cashBack(), before, await bells("alex", "jordan", "maya")),
      ).toEqual([
        ["alex", "review_requested", "Team approver"],
        ["jordan", "review_requested", "Team approver"],
      ]);
    });
  });

  describe("two stages: the team's approvers, then Dana Park's Legal reviewer", () => {
    beforeEach(async () => {
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
    });

    it("Maya submits; Jordan approves the first stage and Dana is asked; Dana approves the second and it goes live", async () => {
      const templateId = await submitted("maya");
      const people = ["dana", "maya", "jordan", "alex"];
      const before = await bells(...people);
      expect(await approves("jordan", templateId)).toBe("next stage");
      expect(await roundOf(templateId)).toMatchObject({
        state: "in_review",
        decisions: [["Team approver", "jordan", "approved"]],
      });
      const asked = await bells(...people);
      expect(toldAbout(templateId, before, asked)).toEqual([
        ["dana", "review_requested", "Legal reviewer"],
        ["maya", "stage_approved", "Team approver"],
      ]);
      expect(
        told(before.maya!, asked.maya!).find(about(templateId))?.facts,
      ).toMatchObject({ stage: "Team approver", next: "Legal reviewer" });

      expect(await approves("dana", templateId)).toBe("live");
      expect(await roundOf(templateId)).toMatchObject({
        state: "active",
        decisions: [
          ["Team approver", "jordan", "approved"],
          ["Legal reviewer", "dana", "approved"],
        ],
      });
      expect(
        toldAbout(templateId, asked, await bells(...people)).map(
          ([id, kind]) => [id, kind],
        ),
      ).toEqual([["maya", "version_live"]]);
    });

    it("refuses everyone the second stage doesn't name, and the submitter; Dana may comment on it, a viewer may not", async () => {
      const templateId = await submitted("maya");
      expect(await approves("jordan", templateId)).toBe("next stage");
      const round = await roundOf(templateId);

      expect(await approves("jordan", templateId)).toBe("waiting_on_stage");
      expect(await approves("alex", templateId)).toBe("waiting_on_stage");
      expect(await approves("sam", templateId)).toBe(REASONS.generic.code);
      expect(await approves("maya", templateId)).toBe(REASONS.ownVersion.code);
      expect(await roundOf(templateId)).toEqual(round);

      const comment = async (userId: string) => {
        tick();
        const result = await h.services().comments.add(await h.as(userId), {
          templateId,
          versionId: round.id,
          blockId: DOCUMENT_THREAD,
          body: "Legal looks fine.",
        });
        return result.ok ? "ok" : result.code;
      };
      expect(await comment("sam")).toBe(REASONS.generic.code);
      expect(await comment("dana")).toBe("ok");
    });

    it("lets Dana decide a Deposits version waiting on her stage, with no membership there; Sam can't", async () => {
      const templateId = await submitted("eli", DEPOSITS);
      expect(await approves("naomi", templateId)).toBe("next stage");
      tick();
      const commented = await h.services().comments.add(await h.as("dana"), {
        templateId,
        versionId: (await roundOf(templateId)).id,
        blockId: DOCUMENT_THREAD,
        body: "OK from Legal.",
      });
      expect(commented.ok).toBe(true);
      expect(await approves("sam", templateId)).toBe(REASONS.generic.code);
      expect(await approves("dana", templateId)).toBe("live");
      expect((await roundOf(templateId)).decisions).toEqual([
        ["Team approver", "naomi", "approved"],
        ["Legal reviewer", "dana", "approved"],
      ]);
    });
  });
}

/**
 * The cases that read what the fake doesn't serve: the chain as the settings show it, the review screen, the queue
 * and the badge. Their runner runs them against the local implementation (and the Java API later).
 */
export function approvalChainReadsContract(h: ContractHarness, base: Date) {
  const { tick, setChain, submit, submitted, approve, approves, roundOf } =
    chainSteps(h, base);

  /** Disclosure's chain as the settings read it (Riley's), with the facts the editor validates against. */
  async function chainRead() {
    const result = await h
      .services()
      .platform.approvalChains(await h.as("riley"));
    if (!result.ok) throw new Error(result.code);
    return {
      stages: result.chains.find((c) => c.contentTypeId === CT)!.stages,
      choices: result.choices,
      approvers: result.approvers,
    };
  }
  /** The id the chain gave the stage of this name. */
  const idOf = async (name: string) =>
    (await chainRead()).stages.find((s) => s.name === name)!.id;

  /** The review screen of v1 as `userId` opens it from a space, `round` or the bare link. */
  async function screen(
    userId: string,
    teamId: string,
    templateId: string,
    round: number | null = null,
  ) {
    return h.services().review.screen(await h.as(userId), {
      teamId,
      templateId,
      versionNumber: 1,
      round,
    });
  }
  async function opened(...args: Parameters<typeof screen>) {
    const result = await screen(...args);
    if (!result.ok) throw new Error(result.code);
    return result;
  }
  /** The screen's stepper: each stage of the version's own, with who decided it. */
  const steps = (facts: Awaited<ReturnType<typeof opened>>) => {
    const { stages, currentStage, decisions } = facts.version;
    return {
      stages: stages.map((s) => [s.id, s.name]),
      currentStage,
      decided: decisions.map((d) => [d.stageId, d.by, d.kind]),
    };
  };
  const OK = { ok: true };
  const decideAll = { approve: OK, requestChanges: OK, comment: OK };

  async function badge(userId: string) {
    const result = await h.services().review.badgeCount(await h.as(userId), {
      teamId: CORAL,
    });
    if (!result.ok) throw new Error(result.code);
    return result.count;
  }
  async function waitingFor(userId: string) {
    const queue = await h.services().review.queue(await h.as(userId), {
      teamId: CORAL,
    });
    if (!queue.ok) throw new Error(queue.code);
    return queue.waiting.map((r) => [r.templateId, r.teamId, r.stage.name]);
  }

  describe("the chain as the settings read it", () => {
    it("lists the added stage after the team's approvers, keeps the first stage's id, and counts what each still has waiting", async () => {
      const before = await chainRead();
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
      const after = await chainRead();
      expect(after.stages).toEqual([
        { ...TEAM, position: 0, waiting: before.stages[0]!.waiting },
        {
          id: expect.any(String),
          position: 1,
          ...LEGAL,
          // Cash Back v3 round 2 recorded only the team's stage.
          waiting: 0,
        },
      ]);
      expect(after.stages[1]!.id).not.toBe(TEAM_STAGE);

      // One waiting on Legal, and one with Legal ahead of the stage it waits on: both still need it.
      const onLegal = await submitted("maya");
      expect(await approves("jordan", onLegal)).toBe("next stage");
      await submitted("priya");
      expect(
        (await chainRead()).stages.map((s) => [s.name, s.waiting]),
      ).toEqual([
        ["Team approver", before.stages[0]!.waiting + 1],
        ["Legal reviewer", 2],
      ]);
    });

    it("offers a stage the people who could act on one, by the teams they see, and never who couldn't", async () => {
      const { choices } = await chainRead();
      expect(choices.find((c) => c.id === "dana")?.teamNames).toEqual([
        "Coral Offers",
      ]);
      // On no team (Morgan), the Auditor (Taylor), and the admin choosing (Riley).
      for (const id of ["morgan", "taylor", "riley"])
        expect(
          choices.map((c) => c.id),
          id,
        ).not.toContain(id);
    });

    it("checks a stage kept from before: a chain still naming someone who has since lost access can't be saved, and the facts say so", async () => {
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
      const legalId = await idOf("Legal reviewer");
      tick();
      expect(
        await h.services().access.removeMember(await h.as("alex"), {
          membershipId: seededAccess().membership("dana"),
        }),
      ).toEqual({ ok: true });

      const before = await chainRead();
      expect(
        await setChain([
          { ...TEAM, name: "Team sign-off" },
          { id: legalId, ...LEGAL },
        ]),
      ).toBe("no_active_access");
      const after = await chainRead();
      expect(after.stages).toEqual(before.stages);
      // The editor gets the same facts, so it shows the reason at Dana's stage before anyone saves.
      expect(after.choices.map((c) => c.id)).not.toContain("dana");
      expect(after.approvers.find((p) => p.id === "dana")).toEqual({
        id: "dana",
        name: "Dana Park",
        platformRole: null,
        activeTeamRole: false,
      });
    });
  });

  describe("a reorder or an insert leaves a version in review with its own stages (decision 0015)", () => {
    it("reordered while it waits on its first stage: it still waits there, then goes through the rest in its own order", async () => {
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
      const legal = { id: await idOf("Legal reviewer"), ...LEGAL };
      const templateId = await submitted("maya");
      const own = [
        [TEAM_STAGE, "Team approver"],
        [legal.id, "Legal reviewer"],
      ];

      expect(await setChain([legal, TEAM])).toBe("changed");
      expect((await chainRead()).stages.map((s) => s.id)).toEqual([
        legal.id,
        TEAM_STAGE,
      ]);
      expect(steps(await opened("jordan", CORAL, templateId))).toEqual({
        stages: own,
        currentStage: 0,
        decided: [],
      });
      // Dana's stage comes later in the version's own order: she, a Viewer, may not decide it yet.
      expect(await approves("dana", templateId)).toBe(REASONS.generic.code);
      expect(await approves("jordan", templateId)).toBe("next stage");
      expect(await approves("dana", templateId)).toBe("live");
      expect((await roundOf(templateId)).decisions).toEqual([
        ["Team approver", "jordan", "approved"],
        ["Legal reviewer", "dana", "approved"],
      ]);
    });

    it("the review's stall: Dana approves Legal, the chain is reordered, and Jordan's approval of the team's stage puts it live", async () => {
      expect(await setChain([LEGAL, TEAM])).toBe("changed");
      const legal = { id: await idOf("Legal reviewer"), ...LEGAL };
      const templateId = await submitted("maya");
      expect(await approves("dana", templateId)).toBe("next stage");

      expect(await setChain([TEAM, legal])).toBe("changed");
      const jordan = await opened("jordan", CORAL, templateId);
      expect(steps(jordan)).toEqual({
        stages: [
          [legal.id, "Legal reviewer"],
          [TEAM_STAGE, "Team approver"],
        ],
        currentStage: 1,
        decided: [[legal.id, "dana", "approved"]],
      });
      expect(jordan.can.approve).toEqual(OK);
      expect(await approves("jordan", templateId)).toBe("live");
      expect(steps(await opened("jordan", CORAL, templateId))).toMatchObject({
        decided: [
          [legal.id, "dana", "approved"],
          [TEAM_STAGE, "jordan", "approved"],
        ],
      });
    });

    it("a stage inserted before the one it waits on isn't added to it; a version submitted after goes through all three", async () => {
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
      const legal = { id: await idOf("Legal reviewer"), ...LEGAL };
      const templateId = await submitted("maya");
      expect(await approves("jordan", templateId)).toBe("next stage");

      const compliance = { name: "Compliance", rule: user("naomi") };
      expect(await setChain([TEAM, compliance, legal])).toBe("changed");
      expect(steps(await opened("dana", CORAL, templateId))).toEqual({
        stages: [
          [TEAM_STAGE, "Team approver"],
          [legal.id, "Legal reviewer"],
        ],
        currentStage: 1,
        decided: [[TEAM_STAGE, "jordan", "approved"]],
      });
      // Naomi's stage isn't this version's.
      expect(await approves("naomi", templateId)).toBe(REASONS.generic.code);
      expect(await approves("dana", templateId)).toBe("live");

      const next = await submitted("maya");
      expect(
        steps(await opened("jordan", CORAL, next)).stages.map(([, n]) => n),
      ).toEqual(["Team approver", "Compliance", "Legal reviewer"]);
      expect(await approves("jordan", next)).toBe("next stage");
      expect(await approves("naomi", next)).toBe("next stage");
      expect(await approves("dana", next)).toBe("live");
    });
  });

  describe("the screen, the queue and the badge follow a version's own stages", () => {
    it("show Dana the version once it waits on her stage, with the decisions so far; and Jordan why he can't approve again", async () => {
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
      const legalId = await idOf("Legal reviewer");
      const templateId = await submitted("maya");
      const badgeBefore = await badge("dana");
      expect(await waitingFor("dana")).not.toContainEqual([
        templateId,
        CORAL,
        "Legal reviewer",
      ]);

      expect(await approves("jordan", templateId)).toBe("next stage");
      const dana = await opened("dana", CORAL, templateId);
      expect(steps(dana)).toEqual({
        stages: [
          [TEAM_STAGE, "Team approver"],
          [legalId, "Legal reviewer"],
        ],
        currentStage: 1,
        decided: [[TEAM_STAGE, "jordan", "approved"]],
      });
      // A Viewer on Coral Offers: the stage names her, so she decides and comments.
      expect(dana.can).toEqual(decideAll);
      expect(await badge("dana")).toBe(badgeBefore + 1);
      expect(await waitingFor("dana")).toContainEqual([
        templateId,
        CORAL,
        "Legal reviewer",
      ]);
      expect(
        (await opened("jordan", CORAL, templateId)).can.approve,
      ).toMatchObject({ ok: false, code: "waiting_on_stage" });

      expect(await approves("dana", templateId)).toBe("live");
      expect(await badge("dana")).toBe(badgeBefore);
    });

    it("tell Jordan he approved an earlier stage, and leave the round out of his queue", async () => {
      expect(
        await setChain([TEAM, { name: "Second approver", rule: TEAM_RULE }]),
      ).toBe("changed");
      const templateId = await submitted("maya");
      expect((await waitingFor("jordan")).map(([id]) => id)).toContain(
        templateId,
      );
      expect(await approves("jordan", templateId)).toBe("next stage");
      expect(
        (await opened("jordan", CORAL, templateId)).can.approve,
      ).toMatchObject({ ok: false, code: REFUSALS.approvedEarlierStage.code });
      expect((await waitingFor("jordan")).map(([id]) => id)).not.toContain(
        templateId,
      );
      expect((await opened("alex", CORAL, templateId)).can.approve).toEqual(OK);
    });

    it("let Dana open another team's version from her own space while it waits on her and after she decides it; nobody else from Coral", async () => {
      expect(await setChain([TEAM, LEGAL])).toBe("changed");
      const templateId = await submitted("eli", DEPOSITS);
      expect(await approves("naomi", templateId)).toBe("next stage");

      expect(await waitingFor("dana")).toContainEqual([
        templateId,
        DEPOSITS,
        "Legal reviewer",
      ]);
      const dana = await opened("dana", CORAL, templateId);
      expect(dana.template).toMatchObject({
        teamId: DEPOSITS,
        teamSlug: "deposits",
      });
      expect(dana.can).toEqual(decideAll);
      expect(await approves("dana", templateId)).toBe("live");
      // She keeps seeing the version she decided; a stranger to it still gets a 404.
      expect((await opened("dana", CORAL, templateId)).version.state).toBe(
        "active",
      );
      expect(await screen("sam", CORAL, templateId)).toMatchObject({
        ok: false,
        status: 404,
        code: REQUEST_REFUSALS.versionUnavailable.code,
      });
    });
  });

  describe("a bare review link a stage reviewer outside the team was sent before a send-back", () => {
    it("opens the round Naomi sent back while the next round waits on a stage that doesn't name her; the team gets the head", async () => {
      expect(
        await setChain([TEAM, { name: "Legal reviewer", rule: user("naomi") }]),
      ).toBe("changed");
      const templateId = await submitted("maya");
      const naomiBefore = await h
        .services()
        .notifications.list(await h.as("naomi"), { limit: 100 });
      if (!naomiBefore.ok) throw new Error(naomiBefore.code);
      expect(await approves("jordan", templateId)).toBe("next stage");
      // Naomi isn't on Coral Offers: her link is the bare one (no round), placed in her own team.
      const naomiAfter = await h
        .services()
        .notifications.list(await h.as("naomi"), { limit: 100 });
      if (!naomiAfter.ok) throw new Error(naomiAfter.code);
      expect(
        told(naomiBefore.items, naomiAfter.items)
          .filter(about(templateId))
          .map((n) => [n.kind, n.link]),
      ).toEqual([
        [
          "review_requested",
          {
            to: "review",
            teamId: DEPOSITS,
            templateId,
            versionNumber: 1,
          },
        ],
      ]);

      tick();
      expect(
        await h.services().review.requestChanges(await h.as("naomi"), {
          templateId,
          versionNumber: 1,
          round: 1,
          reason: "Name the governing law.",
        }),
      ).toEqual({ ok: true });
      expect(await submit("maya", templateId)).toEqual({
        ok: true,
        number: 1,
        round: 2,
      });

      // Round 2 waits on the team's approvers, so her link opens round 1, which she decided.
      const sentBack = await opened("naomi", DEPOSITS, templateId);
      expect(sentBack.version).toMatchObject({
        number: 1,
        round: 1,
        state: "changes_requested",
      });
      expect(sentBack.can.approve.ok).toBe(false);
      // Its rail links to no round she can't open.
      expect(sentBack.replacedBy).toBeNull();
      // Access is no wider: round 2 is still a 404 for her, and the bare link for someone who decided no round.
      const unavailable = {
        ok: false,
        status: 404,
        code: REQUEST_REFUSALS.versionUnavailable.code,
      };
      expect(await screen("naomi", DEPOSITS, templateId, 2)).toMatchObject(
        unavailable,
      );
      expect(await screen("eli", DEPOSITS, templateId)).toMatchObject(
        unavailable,
      );
      // The team's link is the number's head, and round 1's screen links on to it.
      expect((await opened("jordan", CORAL, templateId)).version).toMatchObject(
        { round: 2, state: "in_review" },
      );
      expect((await opened("jordan", CORAL, templateId, 1)).replacedBy).toEqual(
        { number: 1, round: 2, state: "in_review" },
      );

      // Once round 2 waits on her stage, the same link opens it.
      expect(await approve("jordan", templateId, 1, 2)).toEqual({
        ok: true,
        wentLive: false,
        number: 1,
        round: 2,
      });
      const next = await opened("naomi", DEPOSITS, templateId);
      expect(next.version).toMatchObject({
        number: 1,
        round: 2,
        state: "in_review",
      });
      expect(next.can.approve).toEqual(OK);
      expect(
        (await opened("naomi", DEPOSITS, templateId, 1)).replacedBy,
        "round 1 now links on to it",
      ).toMatchObject({ round: 2 });
    });
  });
}
