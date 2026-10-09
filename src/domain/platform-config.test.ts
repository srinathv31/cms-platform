import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ApproverFacts } from "./access-types";
import {
  PLATFORM_REFUSALS,
  RESERVED_SLUGS,
  approverProblem,
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
  validateChain,
} from "./platform-config";
import type { ApprovalStage } from "./review-types";
import type { ApproverRule, JSONContent, RequiredSection } from "./types";

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

  it("refuses a name whose slug is a top-level route: every top-level segment under src/app is reserved", () => {
    expect(run({ name: "SIM" })).toEqual({ ok: false, reason: '"SIM" can\'t be used as a team name.' });
    // Route groups "(x)" are looked through; dynamic "[x]", private "_x" and files are not segments.
    const segments = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("[") && !e.name.startsWith("_") && !e.name.startsWith("@"))
        .flatMap((e) => (e.name.startsWith("(") ? segments(join(dir, e.name)) : [e.name]));
    const top = segments(join(process.cwd(), "src/app"));
    expect(top).toEqual(expect.arrayContaining(["api", "sim", "request-access", "design"]));
    expect(top.filter((s) => !RESERVED_SLUGS.has(s))).toEqual([]);
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

const TEAM: ApprovalStage = {
  id: "stage_team",
  position: 0,
  name: "Team approver",
  rule: { kind: "team_role", role: "approver" },
};
const LEGAL = { name: "Legal reviewer", rule: { kind: "user" as const, userId: "dana" } };

/**
 * Everyone a chain test may name. Riley is the Platform Admin saving; Alex, Dana and Jordan hold active
 * team roles; Taylor is the Auditor; Morgan has no active access; Pat is a Platform Admin with no team
 * role; Casey is a Platform Admin who also holds a team role, so another admin may name them.
 */
const approvers: ApproverFacts[] = [
  { ...riley, platformRole: "platform_admin", activeTeamRole: false },
  { ...alex, platformRole: null, activeTeamRole: true },
  { ...dana, platformRole: null, activeTeamRole: true },
  { id: "jordan", name: "Jordan Ellis", platformRole: null, activeTeamRole: true },
  { id: "taylor", name: "Taylor Nguyen", platformRole: "auditor", activeTeamRole: false },
  { id: "morgan", name: "Morgan Lee", platformRole: null, activeTeamRole: false },
  { id: "pat", name: "Pat Admin", platformRole: "platform_admin", activeTeamRole: false },
  { id: "casey", name: "Casey Admin", platformRole: "platform_admin", activeTeamRole: true },
];
const naming = (userId: string, name = "Sign-off") => ({ name, rule: { kind: "user" as const, userId } });

describe("validateChain", () => {
  const check = (
    stages: { id?: string; name: string; rule: ApproverRule }[],
    actorId = "riley",
    current: { id: string; rule: ApproverRule }[] = [],
  ) => validateChain({ stages, current, actorId, people: approvers });
  const team = { name: "Team approver", rule: TEAM.rule };

  it("passes a chain somebody can approve: the Approver role, then different people", () => {
    expect(check([team, LEGAL, naming("alex", "Final sign-off")])).toEqual([]);
    expect(check([team, { name: "Second approver", rule: TEAM.rule }])).toEqual([]); // two people with the role
  });

  it("refuses one person on two stages, at the later stage", () => {
    expect(check([team, LEGAL, naming("dana", "Final sign-off")])).toEqual([
      { stage: 2, field: "reviewer", reason: "Dana Park already reviews stage 2." },
    ]);
  });

  it("refuses every team role but Approver: none of them can decide", () => {
    for (const [role, label] of [
      ["viewer", "Viewer"],
      ["author", "Author"],
      ["team_admin", "Team Admin"],
    ] as const) {
      expect(check([team, { name: "Second look", rule: { kind: "team_role", role } }])).toEqual([
        { stage: 1, field: "reviewer", reason: `The ${label} role can't approve.` },
      ]);
    }
    expect(check([{ name: "Boss", rule: { kind: "team_role", role: "boss" as never } }])).toEqual([
      { stage: 0, field: "reviewer", reason: PLATFORM_REFUSALS.pickRole },
    ]);
  });

  it("refuses the admin naming themselves", () => {
    expect(check([team, naming("riley")])).toEqual([{ stage: 1, field: "reviewer", reason: "You can't name yourself as an approver." }]);
    expect(check([team, naming("riley")], "pat")).toEqual([
      { stage: 1, field: "reviewer", reason: "Riley Brooks is a Platform Admin with no team role and can't approve." },
    ]);
  });

  describe("naming yourself is about the act: Casey, named on stage 1 by Riley, saves the chain", () => {
    const saved = [
      { id: "stage_casey", rule: { kind: "user" as const, userId: "casey" } },
      { id: "stage_team", rule: TEAM.rule },
    ];
    const caseyStage = { id: "stage_casey", name: "Admin sign-off", rule: saved[0]!.rule };

    it("can rename stage 2 and save: the stage Riley named them on stays theirs", () => {
      expect(check([caseyStage, { id: "stage_team", name: "Team sign-off", rule: TEAM.rule }], "casey", saved)).toEqual([]);
      expect(check([{ id: "stage_team", ...team }, caseyStage], "casey", saved)).toEqual([]); // moved, same stage id
    });

    it("can't newly name themselves on another stage", () => {
      expect(check([caseyStage, { id: "stage_team", ...team }, naming("casey", "Final sign-off")], "casey", saved)).toEqual([
        { stage: 2, field: "reviewer", reason: "You can't name yourself as an approver." },
      ]);
    });

    it("can't swap a stage's reviewer to themselves after someone else held it", () => {
      expect(check([{ id: "stage_team", ...naming("casey", "Team approver") }], "casey", saved)).toEqual([
        { stage: 0, field: "reviewer", reason: "You can't name yourself as an approver." },
      ]);
    });

    it("still can't keep a stage that would stall: the other checks apply to stages the actor kept", () => {
      const lapsed = [{ id: "stage_casey", rule: { kind: "user" as const, userId: "pat" } }];
      expect(check([{ id: "stage_casey", ...naming("pat") }], "pat", lapsed)).toEqual([
        { stage: 0, field: "reviewer", reason: "Pat Admin is a Platform Admin with no team role and can't approve." },
      ]);
    });
  });

  it("refuses an Auditor", () => {
    expect(check([team, naming("taylor")])).toEqual([{ stage: 1, field: "reviewer", reason: "Taylor Nguyen is an Auditor and can't approve." }]);
  });

  it("refuses someone who can't approve: no active team role, whatever their platform role", () => {
    expect(check([team, naming("morgan")])).toEqual([{ stage: 1, field: "reviewer", reason: "Morgan Lee has no active access." }]);
    expect(check([team, naming("pat")])).toEqual([
      { stage: 1, field: "reviewer", reason: "Pat Admin is a Platform Admin with no team role and can't approve." },
    ]);
    expect(check([team, naming("nobody")])).toEqual([{ stage: 1, field: "reviewer", reason: PLATFORM_REFUSALS.pickPerson }]);
  });

  it("checks every stage, names too, in stage order with the name first", () => {
    expect(check([{ name: " ", rule: { kind: "team_role", role: "author" } }, naming("taylor", "team APPROVER"), naming("morgan", "Team approver")])).toEqual([
      { stage: 0, field: "name", reason: PLATFORM_REFUSALS.stageName },
      { stage: 0, field: "reviewer", reason: "The Author role can't approve." },
      { stage: 1, field: "reviewer", reason: "Taylor Nguyen is an Auditor and can't approve." },
      { stage: 2, field: "name", reason: "There are two stages called Team approver." },
      { stage: 2, field: "reviewer", reason: "Morgan Lee has no active access." },
    ]);
    expect(check([{ ...team, name: "x".repeat(41) }])).toEqual([{ stage: 0, field: "name", reason: PLATFORM_REFUSALS.stageNameTooLong }]);
  });

  it("offers in the picker only the people approverProblem allows", () => {
    expect(approvers.filter((p) => !approverProblem(p, "riley")).map((p) => p.id)).toEqual(["alex", "dana", "jordan", "casey"]);
    expect(approvers.filter((p) => !approverProblem(p, "casey")).map((p) => p.id)).toEqual(["alex", "dana", "jordan"]);
  });
});

describe("saveApprovalChain", () => {
  const run = (over: Partial<Parameters<typeof saveApprovalChain>[0]> = {}) =>
    saveApprovalChain({
      contentType: { id: "ct_disclosure", name: "Disclosure" },
      current: [TEAM],
      next: [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }, LEGAL],
      inReview: [],
      people: approvers,
      actor: riley,
      now: NOW,
      ...over,
    });

  it("adds Dana Park's Legal reviewer stage after the team's approvers", () => {
    expect(run({ inReview: [{ versionId: "v3", stages: [{ id: "stage_team", name: "Team approver" }], currentStage: 0 }] })).toEqual({
      ok: true,
      stages: [
        { id: "stage_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } },
        { id: null, position: 1, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
      ],
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
          },
        },
      ],
    });
  });

  it("reorders and renames stages, keeping their ids; versions in review are left as they are", () => {
    const result = run({
      next: [LEGAL, { id: "stage_team", name: "Team approval", rule: TEAM.rule }],
      inReview: [{ versionId: "v3", stages: [{ id: "stage_team", name: "Team approver" }], currentStage: 0 }],
    });
    expect(result.ok && result.stages.map((s) => [s.id, s.name])).toEqual([
      [null, "Legal reviewer"],
      ["stage_team", "Team approval"],
    ]);
    expect(result.ok && Object.keys(result)).toEqual(["ok", "stages", "effects"]);
  });

  describe("removing a stage", () => {
    const legal = { id: "stage_legal", position: 1, ...LEGAL };
    const current = [TEAM, legal];
    const next = [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }];
    const both = [
      { id: "stage_team", name: "Team approver" },
      { id: "stage_legal", name: "Legal reviewer" },
    ];

    it("refuses while a version waits on it", () => {
      const waiting = [
        { versionId: "v3", stages: both, currentStage: 1 },
        { versionId: "v4", stages: both, currentStage: 1 },
      ];
      expect(run({ current, next, inReview: waiting })).toEqual({ ok: false, reason: "2 versions in review still need Legal reviewer." });
      expect(run({ current, next, inReview: [waiting[0]!] })).toEqual({ ok: false, reason: "1 version in review still needs Legal reviewer." });
    });

    it("refuses while it is ahead of a version in that version's own stages", () => {
      // v3 waits on the Team approver stage and goes to Legal next; v4 recorded Legal first and passed it.
      const legalFirst = [both[1]!, both[0]!];
      expect(run({ current, next, inReview: [{ versionId: "v3", stages: both, currentStage: 0 }] })).toEqual({
        ok: false,
        reason: "1 version in review still needs Legal reviewer.",
      });
      expect(run({ current, next, inReview: [{ versionId: "v4", stages: legalFirst, currentStage: 1 }] }).ok).toBe(true);
    });

    it("allows it once no version in review needs it, whatever the chain looked like at their submit", () => {
      const before = [{ id: "stage_team", name: "Team approver" }];
      const removed = run({ current, next, inReview: [{ versionId: "v5", stages: before, currentStage: 0 }] });
      expect(removed.ok && removed.stages.length).toBe(1);
    });
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

  it("refuses a chain nobody can approve with validateChain's first problem, and writes nothing", () => {
    const team = { id: "stage_team", name: "Team approver", rule: TEAM.rule };
    expect(run({ next: [team, LEGAL, naming("dana", "Final sign-off")] })).toEqual({ ok: false, reason: "Dana Park already reviews stage 2." });
    expect(run({ next: [{ ...team, rule: { kind: "team_role", role: "viewer" } }] })).toEqual({ ok: false, reason: "The Viewer role can't approve." });
    expect(run({ next: [team, naming("riley")] })).toEqual({ ok: false, reason: PLATFORM_REFUSALS.nameYourself });
    expect(run({ next: [team, naming("taylor")] })).toEqual({ ok: false, reason: "Taylor Nguyen is an Auditor and can't approve." });
    expect(run({ next: [team, naming("morgan")] })).toEqual({ ok: false, reason: "Morgan Lee has no active access." });
  });

  it("lets an admin save a chain another admin named them on, but not swap a stage to themselves", () => {
    const casey = { id: "casey", name: "Casey Admin" };
    const caseyStage = { id: "stage_casey", position: 1, name: "Admin sign-off", rule: { kind: "user" as const, userId: "casey" } };
    const current = [TEAM, caseyStage];
    const kept = { id: "stage_casey", name: caseyStage.name, rule: caseyStage.rule };
    expect(run({ actor: casey, current, next: [{ id: "stage_team", name: "Team sign-off", rule: TEAM.rule }, kept] }).ok).toBe(true);
    expect(run({ actor: casey, current, next: [{ id: "stage_team", name: "Team approver", rule: caseyStage.rule }, kept] })).toEqual({
      ok: false,
      reason: PLATFORM_REFUSALS.nameYourself,
    });
  });

  it("refuses re-saving a stage whose person has lost access since they were named", () => {
    const legal = { id: "stage_legal", position: 1, ...LEGAL };
    const lapsed = approvers.map((p) => (p.id === "dana" ? { ...p, activeTeamRole: false } : p));
    const renamed = [{ id: "stage_team", name: "Team sign-off", rule: TEAM.rule }, { id: "stage_legal", ...LEGAL }];
    expect(run({ current: [TEAM, legal], next: renamed, people: lapsed })).toEqual({ ok: false, reason: "Dana Park has no active access." });
    expect(run({ current: [TEAM, legal], next: renamed }).ok).toBe(true);
  });
});

describe("describeChainChange (the Now / After cards)", () => {

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
    expect(change.lines).toEqual(["2 versions in review still need Legal reviewer."]);

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
