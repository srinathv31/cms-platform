import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ApproverFacts } from "./access-types";
import {
  PLATFORM_REFUSALS,
  RESERVED_SLUGS,
  approverProblem,
  channelOffConsequences,
  channelRuleRefusal,
  conformToSections,
  createTeam,
  describeChainChange,
  describeSectionsChange,
  describeZoneChange,
  newTeamConsequences,
  removeSectionRefusal,
  removeStageRefusal,
  ruleLabel,
  saveApprovalChain,
  sectionKey,
  setBusinessZone,
  setChannelRule,
  slugify,
  updateRequiredSections,
  validateChain,
  validateNewTeam,
  validateRequiredSections,
  zoneChangeConsequences,
} from "./platform-config";
import type { ApprovalStage } from "./review-types";
import type { ApproverRule, Channel, JSONContent, RequiredSection } from "./types";

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
    expect(run({ name: "  " })).toEqual({ ok: false, ...PLATFORM_REFUSALS.teamName });
    expect(run({ name: "x".repeat(61) })).toEqual({ ok: false, ...PLATFORM_REFUSALS.teamNameTooLong });
    expect(run({ name: "All" })).toEqual({ ok: false, code: "team_name_reserved", reason: '"All" can\'t be used as a team name.' });
    expect(run({ name: "!!!" })).toEqual({ ok: false, code: "team_name_reserved", reason: '"!!!" can\'t be used as a team name.' });
    expect(run({ name: "coral offers" })).toEqual({ ok: false, code: "team_name_taken", reason: "A team called Coral Offers already exists." });
    expect(run({ name: "DEPOSITS" })).toEqual({ ok: false, code: "team_name_taken", reason: "A team called Deposits already exists." });
    expect(run({ description: "x".repeat(201) })).toEqual({ ok: false, ...PLATFORM_REFUSALS.descriptionTooLong });
    expect(run({ icon: "skull" })).toEqual({ ok: false, ...PLATFORM_REFUSALS.icon });
  });

  it("refuses a name whose slug is a top-level route: every top-level segment under src/app is reserved", () => {
    expect(run({ name: "SIM" })).toEqual({ ok: false, code: "team_name_reserved", reason: '"SIM" can\'t be used as a team name.' });
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

describe("validateNewTeam (the Create team form, as the admin types)", () => {
  const check = (over: Partial<Parameters<typeof validateNewTeam>[0]> = {}) =>
    validateNewTeam({ name: "Home Loans", description: "Mortgage disclosures.", icon: "home", existing: EXISTING, ...over });

  it("tidies what was typed and finds nothing wrong with a new team", () => {
    expect(check({ name: "  Home   Loans ", description: " Mortgages. " })).toEqual({
      name: "Home Loans",
      description: "Mortgages.",
      slug: "home-loans",
      problem: null,
    });
  });

  it("gives the reason createTeam refuses with, in the same order", () => {
    const cases: { name?: string; description?: string; icon?: string }[] = [
      { name: " " },
      { name: "x".repeat(61) },
      { description: "x".repeat(201) },
      { icon: "skull" },
      { name: "All" },
      { name: "coral offers" },
      // A reserved name and a long description: the description is said first, as the server does.
      { name: "Sim", description: "x".repeat(201) },
    ];
    for (const over of cases) {
      const { problem } = check(over);
      expect(problem).not.toBeNull();
      const created = createTeam({ name: "Home Loans", description: "", icon: "home", admin: alex, actor: riley, now: NOW, existing: EXISTING, ...over });
      expect(created).toEqual({ ok: false, ...problem });
    }
    expect(check({ name: "coral offers" }).problem).toEqual({ code: "team_name_taken", reason: "A team called Coral Offers already exists." });
    expect(check({ name: "Sim", description: "x".repeat(201) }).problem).toBe(PLATFORM_REFUSALS.descriptionTooLong);
  });

  it("newTeamConsequences: who becomes Team Admin, and that it starts empty", () => {
    expect(newTeamConsequences("Home Loans", "Alex Kim")).toEqual([
      "Alex Kim becomes Team Admin of Home Loans and approves its access requests.",
      "Home Loans starts with no templates.",
    ]);
  });
});

// ── Required sections ────────────────────────────────────────────────────────

const SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];
const disclosure = { id: "ct_disclosure", name: "Disclosure", requiredSections: SECTIONS, allowedChannels: ["pdf", "web", "email"] as Channel[] };

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
    expect(run([])).toEqual({ ok: false, ...PLATFORM_REFUSALS.oneSection });
    expect(run([{ key: "", title: " " }])).toEqual({ ok: false, ...PLATFORM_REFUSALS.sectionTitle });
    expect(run([{ key: "", title: "x".repeat(61) }])).toEqual({ ok: false, ...PLATFORM_REFUSALS.sectionTitleTooLong });
    expect(run([SECTIONS[0]!, { key: "", title: "offer DETAILS" }])).toEqual({
      ok: false,
      code: "section_duplicate",
      reason: "There are two sections called offer DETAILS.",
    });
  });
});

describe("the sections editor: validateRequiredSections, removeSectionRefusal, describeSectionsChange", () => {
  const describe_ = (next: RequiredSection[]) => describeSectionsChange({ contentTypeName: "Disclosure", current: SECTIONS, next });
  const SCOPE = "Applies to new Disclosure templates only. Existing templates keep their sections.";

  it("validateRequiredSections is the reason updateRequiredSections refuses with", () => {
    const lists: RequiredSection[][] = [[], [{ key: "", title: " " }], [{ key: "", title: "x".repeat(61) }], [SECTIONS[0]!, { key: "n", title: "offer details" }]];
    for (const next of lists) {
      const problem = validateRequiredSections(next);
      expect(problem).not.toBeNull();
      expect(updateRequiredSections({ contentType: disclosure, next, actor: riley, now: NOW })).toEqual({ ok: false, ...problem });
    }
    expect(validateRequiredSections(SECTIONS)).toBeNull();
  });

  it("removeSectionRefusal keeps the last section", () => {
    expect(removeSectionRefusal(1)).toBe(PLATFORM_REFUSALS.oneSection);
    expect(removeSectionRefusal(2)).toBeNull();
  });

  it("says the scope from the start; nothing to save until something changes", () => {
    expect(describe_(SECTIONS)).toEqual({ problem: null, changed: false, lines: [SCOPE] });
    expect(describe_(SECTIONS.map((s) => ({ ...s, title: ` ${s.title} ` })))).toEqual({ problem: null, changed: false, lines: [SCOPE] });
  });

  it("names what new templates gain and what becomes an ordinary heading", () => {
    expect(describe_([SECTIONS[0]!, SECTIONS[2]!, { key: "new-1", title: " Privacy " }, { key: "new-2", title: "Contact" }])).toEqual({
      problem: null,
      changed: true,
      lines: [SCOPE, "New templates start with Privacy and Contact added.", "Rates and fees becomes an ordinary heading in new templates."],
    });
    // A rename or a move changes something but adds no line.
    expect(describe_([SECTIONS[1]!, SECTIONS[0]!, SECTIONS[2]!])).toEqual({ problem: null, changed: true, lines: [SCOPE] });
  });

  it("a draft that can't be saved says why, and only the scope", () => {
    expect(describe_([...SECTIONS, { key: "new-1", title: "" }])).toEqual({
      problem: PLATFORM_REFUSALS.sectionTitle,
      changed: true,
      lines: [SCOPE],
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

describe("channelRuleRefusal (whether a switch may flip)", () => {
  const type = (...allowedChannels: Channel[]) => ({ name: "Disclosure", allowedChannels });

  it("refuses turning off the last channel on", () => {
    expect(channelRuleRefusal(type("email"), "email", false)).toBe(PLATFORM_REFUSALS.oneChannel);
    expect(channelRuleRefusal(type("web", "email"), "email", false)).toBeNull();
    expect(channelRuleRefusal(type("email"), "pdf", true)).toBeNull();
    expect(channelRuleRefusal(type("email"), "fax" as never, true)).toBe(PLATFORM_REFUSALS.oneChannel);
    const ct = { id: "ct_disclosure", name: "Disclosure", allowedChannels: ["email" as const] };
    expect(setChannelRule({ contentType: ct, channel: "email", allowed: false, activeUsing: 0, contentTypes: [], actor: riley, now: NOW })).toEqual({
      ok: false,
      ...channelRuleRefusal(type("email"), "email", false),
    });
  });

  describe("families never mix (decision 0034)", () => {
    const disclosure = { name: "Disclosure", allowedChannels: ["pdf", "web"] as Channel[] };
    const notice = { name: "Notice", allowedChannels: ["pdf"] as Channel[] };
    const alert = { name: "Alert", allowedChannels: ["push", "sms"] as Channel[] };
    const all = [disclosure, notice, alert];

    it("refuses a message channel on a document type, naming the types it goes on", () => {
      for (const channel of ["push", "sms"] as const) {
        const refusal = channelRuleRefusal(disclosure, channel, true, all);
        expect(refusal).toEqual({ code: "channel_family", reason: "Disclosures are documents. Push and SMS go on Alert templates." });
      }
    });

    it("refuses a document channel on a message type, naming the types it goes on", () => {
      expect(channelRuleRefusal(alert, "email", true, all)).toEqual({
        code: "channel_family",
        reason: "Alerts are messages. PDF, Web and Email go on Disclosure or Notice templates.",
      });
    });

    it("names the family when no content type of it exists", () => {
      expect(channelRuleRefusal(disclosure, "sms", true, [disclosure])?.reason).toBe(
        "Disclosures are documents. Push and SMS go on message templates.",
      );
    });

    it("lets a type turn on its own family's channels, and turn any channel off", () => {
      expect(channelRuleRefusal(disclosure, "email", true, all)).toBeNull();
      expect(channelRuleRefusal(alert, "sms", false, all)).toBeNull();
      expect(channelRuleRefusal({ name: "Alert", allowedChannels: ["push"] }, "sms", true, all)).toBeNull();
    });

    it("setChannelRule refuses it too, and writes nothing", () => {
      const ct = { id: "ct_alert", name: "Alert", allowedChannels: ["push", "sms"] as Channel[] };
      expect(setChannelRule({ contentType: ct, channel: "pdf", allowed: true, activeUsing: 0, contentTypes: all, actor: riley, now: NOW })).toEqual({
        ok: false,
        code: "channel_family",
        reason: "Alerts are messages. PDF, Web and Email go on Disclosure or Notice templates.",
      });
    });
  });
});

describe("setChannelRule", () => {
  const ct = { id: "ct_disclosure", name: "Disclosure", allowedChannels: ["pdf", "web", "email"] as const };
  const run = (over: Partial<Parameters<typeof setChannelRule>[0]> = {}) =>
    setChannelRule({
      contentType: { ...ct, allowedChannels: [...ct.allowedChannels] },
      channel: "email",
      allowed: false,
      activeUsing: 2,
      contentTypes: [],
      actor: riley,
      now: NOW,
      ...over,
    });

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
    expect(run({ contentType: { ...ct, allowedChannels: ["email"] } })).toEqual({ ok: false, ...PLATFORM_REFUSALS.oneChannel });
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
      { stage: 2, field: "reviewer", code: "person_on_two_stages", reason: "Dana Park already reviews stage 2." },
    ]);
  });

  it("refuses every team role but Approver: none of them can decide", () => {
    for (const [role, label] of [
      ["viewer", "Viewer"],
      ["author", "Author"],
      ["team_admin", "Team Admin"],
    ] as const) {
      expect(check([team, { name: "Second look", rule: { kind: "team_role", role } }])).toEqual([
        { stage: 1, field: "reviewer", code: "role_cant_approve", reason: `The ${label} role can't approve.` },
      ]);
    }
    expect(check([{ name: "Boss", rule: { kind: "team_role", role: "boss" as never } }])).toEqual([
      { stage: 0, field: "reviewer", ...PLATFORM_REFUSALS.pickRole },
    ]);
  });

  it("refuses the admin naming themselves", () => {
    expect(check([team, naming("riley")])).toEqual([{ stage: 1, field: "reviewer", code: "names_yourself", reason: "You can't name yourself as an approver." }]);
    expect(check([team, naming("riley")], "pat")).toEqual([
      { stage: 1, field: "reviewer", code: "admin_without_team_role", reason: "Riley Brooks is a Platform Admin with no team role and can't approve." },
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
        { stage: 2, field: "reviewer", code: "names_yourself", reason: "You can't name yourself as an approver." },
      ]);
    });

    it("can't swap a stage's reviewer to themselves after someone else held it", () => {
      expect(check([{ id: "stage_team", ...naming("casey", "Team approver") }], "casey", saved)).toEqual([
        { stage: 0, field: "reviewer", code: "names_yourself", reason: "You can't name yourself as an approver." },
      ]);
    });

    it("still can't keep a stage that would stall: the other checks apply to stages the actor kept", () => {
      const lapsed = [{ id: "stage_casey", rule: { kind: "user" as const, userId: "pat" } }];
      expect(check([{ id: "stage_casey", ...naming("pat") }], "pat", lapsed)).toEqual([
        { stage: 0, field: "reviewer", code: "admin_without_team_role", reason: "Pat Admin is a Platform Admin with no team role and can't approve." },
      ]);
    });
  });

  it("refuses an Auditor", () => {
    expect(check([team, naming("taylor")])).toEqual([{ stage: 1, field: "reviewer", code: "auditor_cant_approve", reason: "Taylor Nguyen is an Auditor and can't approve." }]);
  });

  it("refuses someone who can't approve: no active team role, whatever their platform role", () => {
    expect(check([team, naming("morgan")])).toEqual([{ stage: 1, field: "reviewer", code: "no_active_access", reason: "Morgan Lee has no active access." }]);
    expect(check([team, naming("pat")])).toEqual([
      { stage: 1, field: "reviewer", code: "admin_without_team_role", reason: "Pat Admin is a Platform Admin with no team role and can't approve." },
    ]);
    expect(check([team, naming("nobody")])).toEqual([{ stage: 1, field: "reviewer", ...PLATFORM_REFUSALS.pickPerson }]);
  });

  it("checks every stage, names too, in stage order with the name first", () => {
    expect(check([{ name: " ", rule: { kind: "team_role", role: "author" } }, naming("taylor", "team APPROVER"), naming("morgan", "Team approver")])).toEqual([
      { stage: 0, field: "name", ...PLATFORM_REFUSALS.stageName },
      { stage: 0, field: "reviewer", code: "role_cant_approve", reason: "The Author role can't approve." },
      { stage: 1, field: "reviewer", code: "auditor_cant_approve", reason: "Taylor Nguyen is an Auditor and can't approve." },
      { stage: 2, field: "name", code: "stage_duplicate", reason: "There are two stages called Team approver." },
      { stage: 2, field: "reviewer", code: "no_active_access", reason: "Morgan Lee has no active access." },
    ]);
    expect(check([{ ...team, name: "x".repeat(41) }])).toEqual([{ stage: 0, field: "name", ...PLATFORM_REFUSALS.stageNameTooLong }]);
  });

  it("offers in the picker only the people approverProblem allows", () => {
    expect(approvers.filter((p) => !approverProblem(p, "riley")).map((p) => p.id)).toEqual(["alex", "dana", "jordan", "casey"]);
    expect(approvers.filter((p) => !approverProblem(p, "casey")).map((p) => p.id)).toEqual(["alex", "dana", "jordan"]);
  });
});

describe("removeStageRefusal (the chain editor's Remove)", () => {
  it("keeps the last stage, and a stage a version in review still needs", () => {
    expect(removeStageRefusal({ name: "Team approver", waiting: 0 }, 0)).toBe(PLATFORM_REFUSALS.oneStage);
    expect(removeStageRefusal({ name: "Legal reviewer", waiting: 2 }, 1)).toEqual({
      code: "stage_in_use",
      reason: "2 versions in review still need Legal reviewer.",
    });
    expect(removeStageRefusal({ name: "Legal reviewer", waiting: 0 }, 1)).toBeNull();
  });

  it("is the reason saveApprovalChain refuses a removal with", () => {
    const legal: ApprovalStage = { id: "stage_legal", position: 1, name: "Legal reviewer", rule: LEGAL.rule };
    const both = [
      { id: "stage_team", name: "Team approver" },
      { id: "stage_legal", name: "Legal reviewer" },
    ];
    const saved = saveApprovalChain({
      contentType: { id: "ct_disclosure", name: "Disclosure" },
      current: [TEAM, legal],
      next: [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }],
      inReview: [{ versionId: "v3", stages: both, currentStage: 1 }],
      people: approvers,
      actor: riley,
      now: NOW,
    });
    expect(saved).toEqual({ ok: false, ...removeStageRefusal({ name: "Legal reviewer", waiting: 1 }, 1) });
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
      expect(run({ current, next, inReview: waiting })).toEqual({ ok: false, code: "stage_in_use", reason: "2 versions in review still need Legal reviewer." });
      expect(run({ current, next, inReview: [waiting[0]!] })).toEqual({ ok: false, code: "stage_in_use", reason: "1 version in review still needs Legal reviewer." });
    });

    it("refuses while it is ahead of a version in that version's own stages", () => {
      // v3 waits on the Team approver stage and goes to Legal next; v4 recorded Legal first and passed it.
      const legalFirst = [both[1]!, both[0]!];
      expect(run({ current, next, inReview: [{ versionId: "v3", stages: both, currentStage: 0 }] })).toEqual({
        ok: false,
        code: "stage_in_use",
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
    expect(run({ next: [] })).toEqual({ ok: false, ...PLATFORM_REFUSALS.oneStage });
    expect(run({ next: [{ ...LEGAL, name: " " }] })).toEqual({ ok: false, ...PLATFORM_REFUSALS.stageName });
    expect(run({ next: [{ ...LEGAL, name: "x".repeat(41) }] })).toEqual({ ok: false, ...PLATFORM_REFUSALS.stageNameTooLong });
    expect(run({ next: [LEGAL, { ...LEGAL, name: "legal REVIEWER" }] })).toEqual({
      ok: false,
      code: "stage_duplicate",
      reason: "There are two stages called legal REVIEWER.",
    });
    expect(run({ next: [{ name: "Legal", rule: { kind: "user", userId: "nobody" } }] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.pickPerson,
    });
    expect(run({ next: [{ name: "Boss", rule: { kind: "team_role", role: "boss" as never } }] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.pickRole,
    });
    expect(run({ next: [{ id: "stage_gone", ...LEGAL }] })).toEqual({ ok: false, ...PLATFORM_REFUSALS.stageGone });
    expect(run({ next: [{ id: "stage_team", ...LEGAL }, { id: "stage_team", name: "Again", rule: TEAM.rule }] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.stageGone,
    });
  });

  it("writes nothing when the chain is unchanged", () => {
    const same = run({ next: [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }] });
    expect(same.ok && same.effects).toEqual([]);
  });

  it("refuses a chain nobody can approve with validateChain's first problem, and writes nothing", () => {
    const team = { id: "stage_team", name: "Team approver", rule: TEAM.rule };
    expect(run({ next: [team, LEGAL, naming("dana", "Final sign-off")] })).toEqual({ ok: false, code: "person_on_two_stages", reason: "Dana Park already reviews stage 2." });
    expect(run({ next: [{ ...team, rule: { kind: "team_role", role: "viewer" } }] })).toEqual({ ok: false, code: "role_cant_approve", reason: "The Viewer role can't approve." });
    expect(run({ next: [team, naming("riley")] })).toEqual({ ok: false, ...PLATFORM_REFUSALS.nameYourself });
    expect(run({ next: [team, naming("taylor")] })).toEqual({ ok: false, code: "auditor_cant_approve", reason: "Taylor Nguyen is an Auditor and can't approve." });
    expect(run({ next: [team, naming("morgan")] })).toEqual({ ok: false, code: "no_active_access", reason: "Morgan Lee has no active access." });
  });

  it("lets an admin save a chain another admin named them on, but not swap a stage to themselves", () => {
    const casey = { id: "casey", name: "Casey Admin" };
    const caseyStage = { id: "stage_casey", position: 1, name: "Admin sign-off", rule: { kind: "user" as const, userId: "casey" } };
    const current = [TEAM, caseyStage];
    const kept = { id: "stage_casey", name: caseyStage.name, rule: caseyStage.rule };
    expect(run({ actor: casey, current, next: [{ id: "stage_team", name: "Team sign-off", rule: TEAM.rule }, kept] }).ok).toBe(true);
    expect(run({ actor: casey, current, next: [{ id: "stage_team", name: "Team approver", rule: caseyStage.rule }, kept] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.nameYourself,
    });
  });

  it("refuses re-saving a stage whose person has lost access since they were named", () => {
    const legal = { id: "stage_legal", position: 1, ...LEGAL };
    const lapsed = approvers.map((p) => (p.id === "dana" ? { ...p, activeTeamRole: false } : p));
    const renamed = [{ id: "stage_team", name: "Team sign-off", rule: TEAM.rule }, { id: "stage_legal", ...LEGAL }];
    expect(run({ current: [TEAM, legal], next: renamed, people: lapsed })).toEqual({ ok: false, code: "no_active_access", reason: "Dana Park has no active access." });
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

describe("the business time zone (decision 0017)", () => {
  const riley = { id: "riley", name: "Riley Brooks" };
  const NOW = new Date("2026-10-04T12:00:00.000Z");

  it("describes the zone picked, as the admin picks it: nothing until it differs, a refusal off the list", () => {
    expect(describeZoneChange({ current: "America/New_York", next: "America/New_York" })).toEqual({ problem: null, changed: false, lines: [] });
    expect(describeZoneChange({ current: "America/New_York", next: "UTC" })).toEqual({
      problem: null,
      changed: true,
      lines: ["New sunset dates end at 00:00 UTC."],
    });
    expect(describeZoneChange({ current: "America/New_York", next: "Europe/London" })).toEqual({
      problem: PLATFORM_REFUSALS.pickZone,
      changed: true,
      lines: [],
    });
  });

  it("says what stays put: the sunsets already set, in the singular and the plural, and nothing with none", () => {
    expect(zoneChangeConsequences(0)).toEqual([]);
    expect(zoneChangeConsequences(1)).toEqual(["1 sunset already set doesn't move: its consumers have been told when it ends."]);
    expect(zoneChangeConsequences(3)).toEqual(["3 sunsets already set don't move: their consumers have been told when they end."]);
  });

  it("sets a zone on the list with one audit row, records nothing for the same zone, and refuses as the screen does", () => {
    expect(setBusinessZone({ current: "America/New_York", next: "America/Chicago", pendingSunsets: 2, actor: riley, now: NOW })).toEqual({
      ok: true,
      zone: "America/Chicago",
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: null,
          details: {
            area: "business_zone",
            summary: "Set the business time zone to Central (America/Chicago)",
            from: "America/New_York",
            to: "America/Chicago",
            pendingSunsets: 2,
          },
        },
      ],
    });
    expect(setBusinessZone({ current: "UTC", next: "UTC", pendingSunsets: 0, actor: riley, now: NOW })).toEqual({ ok: true, zone: "UTC", effects: [] });
    expect(setBusinessZone({ current: "UTC", next: "Mars/Olympus", pendingSunsets: 0, actor: riley, now: NOW })).toEqual({
      ok: false,
      ...describeZoneChange({ current: "UTC", next: "Mars/Olympus" }).problem,
    });
  });
});
