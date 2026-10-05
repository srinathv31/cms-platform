import { describe, expect, it } from "vitest";
import {
  PLATFORM_REFUSALS,
  channelOffConsequences,
  conformToSections,
  createTeam,
  describeChainChange,
  ruleLabel,
  saveApprovalChain,
  sectionKey,
  setChannelRule,
  slugify,
  updateRequiredSections,
} from "./platform-config";
import type { ApprovalStage } from "./review-types";
import type { JSONContent, RequiredSection } from "./types";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const riley = { id: "riley", name: "Riley Brooks" };
const alex = { id: "alex", name: "Alex Kim" };
const dana = { id: "dana", name: "Dana Park" };
const people = [riley, alex, dana, { id: "jordan", name: "Jordan Ellis" }];
const EXISTING = [
  { slug: "coral-offers", name: "Coral Offers" },
  { slug: "deposits", name: "Deposits" },
];

// ── Teams ────────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it.each([
    ["Coral Offers", "coral-offers"],
    ["  Café & Co.  ", "cafe-co"],
    ["Home Loans 2027", "home-loans-2027"],
    ["***", ""],
  ])("%s → %s", (name, slug) => expect(slugify(name)).toBe(slug));
});

describe("createTeam", () => {
  const run = (over: Partial<Parameters<typeof createTeam>[0]> = {}) =>
    createTeam({
      name: "Home Loans",
      description: "Mortgage disclosures.",
      icon: "home",
      admin: alex,
      actor: riley,
      now: NOW,
      existing: EXISTING,
      ...over,
    });

  it("creates the team (id = slug) with its first Team Admin, records it and tells the admin", () => {
    const result = run();
    expect(result).toEqual({
      ok: true,
      team: { id: "home-loans", slug: "home-loans", name: "Home Loans", description: "Mortgage disclosures.", icon: "home", createdAt: NOW },
      membership: {
        kind: "insert",
        membership: { userId: "alex", teamId: "home-loans", roles: ["team_admin"], addedAt: NOW, addedBy: "riley" },
      },
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: "home-loans",
          details: {
            area: "teams",
            summary: "Created team Home Loans with Alex Kim as Team Admin",
            teamName: "Home Loans",
            slug: "home-loans",
            userId: "alex",
            userName: "Alex Kim",
          },
        },
        {
          kind: "audit",
          action: "access.granted",
          teamId: "home-loans",
          details: { userId: "alex", userName: "Alex Kim", role: "team_admin", roles: ["team_admin"], appointed: true },
        },
        {
          kind: "notification",
          notification: "team_admin_appointed",
          to: { kind: "user", userId: "alex" },
          teamId: "home-loans",
          title: "Riley Brooks made you Team Admin of Home Loans.",
          link: { to: "settings", teamId: "home-loans", section: "members" },
        },
      ],
    });
  });

  it("refuses an empty, long, reserved or taken name, a long description and an unknown icon", () => {
    expect(run({ name: "  " })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.teamName });
    expect(run({ name: "x".repeat(61) })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.teamNameTooLong });
    expect(run({ name: "All" })).toEqual({ ok: false, reason: '"All" can\'t be used as a team name.' });
    expect(run({ name: "!!!" })).toEqual({ ok: false, reason: '"!!!" can\'t be used as a team name.' });
    expect(run({ name: "coral offers" })).toEqual({ ok: false, reason: "A team called Coral Offers already exists." });
    expect(run({ name: "DEPOSITS" })).toEqual({ ok: false, reason: "A team called Deposits already exists." });
    expect(run({ description: "x".repeat(201) })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.descriptionTooLong });
    expect(run({ icon: "skull" })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.icon });
  });
});

// ── Required sections ────────────────────────────────────────────────────────

const SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];
const disclosure = { id: "ct_disclosure", name: "Disclosure", requiredSections: SECTIONS };

describe("sectionKey", () => {
  it.each([
    ["Rates and fees", "rates_and_fees"],
    ["  Privacy & data ", "privacy_data"],
    ["2027 changes", "section_2027_changes"],
    ["!!!", "section"],
  ])("%s → %s", (title, key) => expect(sectionKey(title)).toBe(key));
});

describe("updateRequiredSections", () => {
  const run = (next: RequiredSection[]) =>
    updateRequiredSections({ contentType: disclosure, next, actor: riley, now: NOW });

  it("adds a section with a key from its title, keeps renamed sections' keys, and records it", () => {
    const result = run([
      { key: "offer_details", title: "Offer summary" },
      SECTIONS[1]!,
      SECTIONS[2]!,
      { key: "", title: "Privacy" },
    ]);
    expect(result.ok && result.requiredSections).toEqual([
      { key: "offer_details", title: "Offer summary" },
      SECTIONS[1],
      SECTIONS[2],
      { key: "privacy", title: "Privacy" },
    ]);
    expect(result.ok && result.effects).toEqual([
      {
        kind: "audit",
        action: "platform.config_changed",
        teamId: null,
        details: {
          area: "content_types",
          summary: "Changed Disclosure required sections: added Privacy; renamed Offer details to Offer summary",
          contentTypeId: "ct_disclosure",
          contentTypeName: "Disclosure",
          added: ["Privacy"],
          removed: [],
          renamed: [{ from: "Offer details", to: "Offer summary" }],
          sections: ["Offer summary", "Rates and fees", "Legal notices", "Privacy"],
        },
      },
    ]);
  });

  it("removes a section (existing templates keep theirs; nothing at submit checks sections)", () => {
    const result = run([SECTIONS[0]!, SECTIONS[2]!]);
    expect(result.ok && result.requiredSections).toEqual([SECTIONS[0], SECTIONS[2]]);
    expect(result.ok && result.effects[0]?.kind === "audit" && result.effects[0].details.summary).toBe(
      "Changed Disclosure required sections: removed Rates and fees",
    );
  });

  it("never reuses a key the type has: a new section titled like an old key gets a suffix", () => {
    const result = run([...SECTIONS, { key: "new", title: "Legal-notices" }]);
    expect(result.ok && result.requiredSections.at(-1)).toEqual({ key: "legal_notices_2", title: "Legal-notices" });
  });

  it("records a reorder, and nothing when nothing changed", () => {
    const reordered = run([SECTIONS[1]!, SECTIONS[0]!, SECTIONS[2]!]);
    expect(reordered.ok && reordered.effects[0]?.kind === "audit" && reordered.effects[0].details.summary).toBe(
      "Changed Disclosure required sections: reordered the sections",
    );
    expect(run(SECTIONS.map((s) => ({ ...s, title: ` ${s.title} ` })))).toEqual({ ok: true, requiredSections: SECTIONS, effects: [] });
  });

  it("refuses no sections, a blank, long or duplicate title", () => {
    expect(run([])).toEqual({ ok: false, reason: PLATFORM_REFUSALS.oneSection });
    expect(run([{ key: "", title: " " }])).toEqual({ ok: false, reason: PLATFORM_REFUSALS.sectionTitle });
    expect(run([{ key: "", title: "x".repeat(61) }])).toEqual({ ok: false, reason: PLATFORM_REFUSALS.sectionTitleTooLong });
    expect(run([SECTIONS[0]!, { key: "", title: "offer DETAILS" }])).toEqual({
      ok: false,
      reason: "There are two sections called offer DETAILS.",
    });
  });
});

describe("conformToSections", () => {
  const h = (id: string, key: string | null, text: string): JSONContent => ({
    type: "heading",
    attrs: { id, level: 2, requiredKey: key },
    content: [{ type: "text", text }],
  });
  const p = (id: string): JSONContent => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text: id }] });
  const starter: JSONContent = {
    type: "doc",
    content: [h("a", "offer_details", "Offer details"), p("a1"), h("b", "rates_and_fees", "Rates and fees"), p("b1"), h("c", "legal_notices", "Legal notices")],
  };

  it("leaves a starter alone when the sections match", () => {
    expect(conformToSections(starter, SECTIONS, () => "x")).toEqual(starter);
  });

  it("unmarks removed sections, retitles renamed ones and appends new ones", () => {
    const next = [{ key: "offer_details", title: "Offer summary" }, SECTIONS[2]!, { key: "privacy", title: "Privacy" }];
    expect(conformToSections(starter, next, () => "new1").content).toEqual([
      h("a", "offer_details", "Offer summary"),
      p("a1"),
      h("b", null, "Rates and fees"),
      p("b1"),
      h("c", "legal_notices", "Legal notices"),
      h("new1", "privacy", "Privacy"),
    ]);
  });
});

// ── Channel rules ────────────────────────────────────────────────────────────

describe("setChannelRule", () => {
  const ct = { id: "ct_disclosure", name: "Disclosure", allowedChannels: ["pdf", "web", "email"] as const };
  const run = (over: Partial<Parameters<typeof setChannelRule>[0]> = {}) =>
    setChannelRule({ contentType: { ...ct, allowedChannels: [...ct.allowedChannels] }, channel: "email", allowed: false, activeUsing: 2, actor: riley, now: NOW, ...over });

  it("turning a channel off names the Active versions it stops", () => {
    expect(run()).toEqual({
      ok: true,
      allowedChannels: ["pdf", "web"],
      consequences: ["2 Active Disclosure versions stop rendering to Email.", "New Disclosure templates can't turn Email on."],
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: null,
          details: {
            area: "channel_rules",
            summary: "Turned off Email for Disclosure: 2 Active versions stopped rendering to Email",
            contentTypeId: "ct_disclosure",
            contentTypeName: "Disclosure",
            channel: "email",
            allowed: false,
            activeUsing: 2,
          },
        },
      ],
    });
    expect(channelOffConsequences("Disclosure", "pdf", 1)[0]).toBe("1 Active Disclosure version stops rendering to PDF.");
    expect(channelOffConsequences("Disclosure", "web", 0)[0]).toBe("No Active Disclosure version renders to Web.");
  });

  it("turning one back on keeps the channel order; a no-op writes nothing", () => {
    const on = run({ contentType: { ...ct, allowedChannels: ["web"] }, channel: "pdf", allowed: true });
    expect(on.ok && on.allowedChannels).toEqual(["pdf", "web"]);
    expect(on.ok && on.consequences).toEqual([]);
    expect(run({ allowed: true })).toEqual({ ok: true, allowedChannels: ["pdf", "web", "email"], consequences: [], effects: [] });
  });

  it("keeps at least one channel on", () => {
    expect(run({ contentType: { ...ct, allowedChannels: ["email"] } })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.oneChannel });
  });
});

// ── Approval chains ──────────────────────────────────────────────────────────

const TEAM: ApprovalStage & { id: string } = {
  id: "stage_team",
  position: 0,
  name: "Team approver",
  rule: { kind: "team_role", role: "approver" },
};
const LEGAL = { name: "Legal reviewer", rule: { kind: "user" as const, userId: "dana" } };

describe("saveApprovalChain", () => {
  const run = (over: Partial<Parameters<typeof saveApprovalChain>[0]> = {}) =>
    saveApprovalChain({
      contentType: { id: "ct_disclosure", name: "Disclosure" },
      current: [TEAM],
      next: [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }, LEGAL],
      inReview: [],
      people,
      actor: riley,
      now: NOW,
      ...over,
    });

  it("adds Dana Park's Legal reviewer stage after the team's approvers", () => {
    expect(run({ inReview: [{ versionId: "v3", currentStage: 0 }] })).toEqual({
      ok: true,
      stages: [
        { id: "stage_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } },
        { id: null, position: 1, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
      ],
      moves: [],
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: null,
          details: {
            area: "approval_chains",
            summary: "Set Disclosure approval chain: Team approver (Approver role) → Legal reviewer (Dana Park)",
            contentTypeId: "ct_disclosure",
            contentTypeName: "Disclosure",
            before: ["Team approver"],
            after: ["Team approver", "Legal reviewer"],
            stages: [
              { name: "Team approver", rule: { kind: "team_role", role: "approver" } },
              { name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
            ],
            moved: 0,
          },
        },
      ],
    });
  });

  it("in-review versions keep waiting on the same stage wherever it moves", () => {
    const result = run({
      next: [LEGAL, { id: "stage_team", name: "Team approval", rule: TEAM.rule }],
      inReview: [
        { versionId: "v3", currentStage: 0 },
        { versionId: "v9", currentStage: 4 }, // past the end: reads as the last stage
      ],
    });
    expect(result.ok && result.moves).toEqual([
      { versionId: "v3", from: 0, to: 1 },
      { versionId: "v9", from: 4, to: 1 },
    ]);
    expect(result.ok && result.stages.map((s) => [s.id, s.name])).toEqual([
      [null, "Legal reviewer"],
      ["stage_team", "Team approval"],
    ]);
  });

  it("refuses to remove a stage a version waits on, and allows it once nothing does", () => {
    const legal = { id: "stage_legal", position: 1, ...LEGAL };
    const current = [TEAM, legal];
    const next = [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }];
    const waiting = [
      { versionId: "v3", currentStage: 1 },
      { versionId: "v4", currentStage: 1 },
    ];
    expect(run({ current, next, inReview: waiting })).toEqual({ ok: false, reason: "2 versions are waiting on Legal reviewer." });
    expect(run({ current, next, inReview: [waiting[0]!] })).toEqual({ ok: false, reason: "1 version is waiting on Legal reviewer." });
    const removed = run({ current, next, inReview: [{ versionId: "v5", currentStage: 0 }] });
    expect(removed.ok && removed.stages.length).toBe(1);
    expect(removed.ok && removed.moves).toEqual([]);
  });

  it("refuses no stages, blank, long or duplicate names, an unknown person or role, and a stale stage id", () => {
    expect(run({ next: [] })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.oneStage });
    expect(run({ next: [{ ...LEGAL, name: " " }] })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.stageName });
    expect(run({ next: [{ ...LEGAL, name: "x".repeat(41) }] })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.stageNameTooLong });
    expect(run({ next: [LEGAL, { ...LEGAL, name: "legal REVIEWER" }] })).toEqual({
      ok: false,
      reason: "There are two stages called legal REVIEWER.",
    });
    expect(run({ next: [{ name: "Legal", rule: { kind: "user", userId: "nobody" } }] })).toEqual({
      ok: false,
      reason: PLATFORM_REFUSALS.pickPerson,
    });
    expect(run({ next: [{ name: "Boss", rule: { kind: "team_role", role: "boss" as never } }] })).toEqual({
      ok: false,
      reason: PLATFORM_REFUSALS.pickRole,
    });
    expect(run({ next: [{ id: "stage_gone", ...LEGAL }] })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.stageGone });
    expect(run({ next: [{ id: "stage_team", ...LEGAL }, { id: "stage_team", name: "Again", rule: TEAM.rule }] })).toEqual({
      ok: false,
      reason: PLATFORM_REFUSALS.stageGone,
    });
  });

  it("writes nothing when the chain is unchanged", () => {
    const same = run({ next: [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }] });
    expect(same.ok && same.effects).toEqual([]);
  });
});

describe("describeChainChange (the Now / After cards)", () => {
  it("says each stage needs a different person only when one person is named on two stages", () => {
    const twice = describeChainChange({
      contentTypeName: "Disclosure",
      current: [TEAM],
      next: [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }, LEGAL, { name: "Final", rule: LEGAL.rule }],
      people,
    });
    expect(twice.lines).toContain("Each stage needs a different person.");
  });

  it("shows the Legal stage added, and says Dana reviews every team's submissions", () => {
    expect(
      describeChainChange({
        contentTypeName: "Disclosure",
        current: [TEAM],
        next: [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }, LEGAL],
        people,
      }),
    ).toEqual({
      now: [{ id: "stage_team", name: "Team approver", ruleLabel: "Approver role", change: null }],
      after: [
        { id: "stage_team", name: "Team approver", ruleLabel: "Approver role", change: null },
        { id: null, name: "Legal reviewer", ruleLabel: "Dana Park", change: "added" },
      ],
      lines: [
        "Disclosure submissions will also wait on Legal reviewer (Dana Park).",
        "Dana Park will review Disclosure submissions from every team, including teams they aren't a member of.",
      ],
      changed: true,
    });
  });

  it("marks removed, renamed and moved stages, with the waiting count on a removal", () => {
    const legal = { id: "stage_legal", position: 1, ...LEGAL };
    const change = describeChainChange({
      contentTypeName: "Disclosure",
      current: [TEAM, legal],
      next: [{ id: "stage_team", name: "Team sign-off", rule: TEAM.rule }],
      people,
      waiting: { stage_legal: 2 },
    });
    expect(change.now.map((s) => s.change)).toEqual([null, "removed"]);
    expect(change.after.map((s) => s.change)).toEqual(["renamed"]);
    expect(change.lines).toEqual(["2 versions are waiting on Legal reviewer."]);

    const swapped = describeChainChange({
      contentTypeName: "Disclosure",
      current: [TEAM, legal],
      next: [{ id: "stage_legal", ...LEGAL }, { id: "stage_team", name: "Team approver", rule: TEAM.rule }],
      people,
    });
    expect(swapped.after.map((s) => s.change)).toEqual(["moved", "moved"]);
    expect(swapped.changed).toBe(true);
  });

  it("labels rules", () => {
    expect(ruleLabel({ kind: "team_role", role: "approver" }, people)).toBe("Approver role");
    expect(ruleLabel({ kind: "user", userId: "dana" }, people)).toBe("Dana Park");
  });
});
