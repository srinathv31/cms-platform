import { beforeEach, describe, expect, it, vi } from "vitest";
import { REASONS } from "@/domain/permissions";
import { TEAM_ICONS } from "@/domain/platform-config/limits";
import { PLATFORM_REFUSALS } from "@/domain/platform-config/refusals";
import type { Person } from "@/domain/review-types";
import type {
  ApprovalChainsFacts,
  BusinessZoneFacts,
  ChannelRulesFacts,
  ContentTypesFacts,
  TeamsFacts,
} from "@/server/services/platform";
import {
  approvalChainsSection,
  businessZoneSection,
  channelRulesSection,
  contentTypesSection,
  getApprovalChainsSection,
  getBusinessZoneSection,
  getChannelRulesSection,
  getContentTypesSection,
  getTeamsSection,
  teamsSection,
} from "./platform";

// The Platform read models as the BFF builds them: facts in (what the platform service answers), the
// screens' view models out. The shaping functions are pure, so these tests hand them facts directly; what the
// service decides (which switch may flip, who may be named, what a change of zone leaves in place) is the
// contract suite's (src/server/services/contract/settings.ts). `getXSection` is checked for what it adds: Not
// found for a refusal, and sign-in.

const env = vi.hoisted(() => ({ signedIn: true, facts: undefined as unknown }));
vi.mock("@/server/context/request", async () => {
  const { signInRequired } = await import("@/server/context/sign-in");
  return {
    requireRequestContext: async () =>
      env.signedIn
        ? {
            viewer: { userId: "riley", name: "Riley Brooks" },
            correlationId: "req_test",
          }
        : signInRequired(),
  };
});
vi.mock("@/server/services", () => {
  const read = async () => env.facts;
  return {
    services: () => ({
      platform: {
        teams: read,
        contentTypes: read,
        channelRules: read,
        approvalChains: read,
        businessZone: read,
      },
    }),
  };
});

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ASOF = "2026-10-04T12:00:00.000Z";
const OK = { ok: true } as const;
const person = (id: string, name: string): Person => ({
  id,
  name,
  initials: name
    .split(" ")
    .map((w) => w[0])
    .join(""),
  hue: 10,
});
const PEOPLE = [
  person("alex", "Alex Kim"),
  person("dana", "Dana Park"),
  person("riley", "Riley Brooks"),
  person("taylor", "Taylor Quinn"),
];

describe("teamsSection", () => {
  const facts: TeamsFacts = {
    teams: [
      {
        id: "t_coral",
        slug: "coral-offers",
        name: "Coral Offers",
        description: "Offers.",
        icon: TEAM_ICONS[0],
        adminIds: ["alex"],
        members: 7,
        templates: 12,
        createdAt: "2026-01-02T00:00:00.000Z",
        appName: "Coral",
        smsSender: "26725",
      },
    ],
    firstAdminCandidates: [
      { id: "alex", title: "Team Admin" },
      { id: "dana", title: "Legal reviewer" },
    ],
    people: PEOPLE,
  };

  it("names each team's admins and who it messages as, and offers the candidates with their titles", () => {
    const section = teamsSection(facts);
    expect(section.teams).toEqual([
      {
        id: "t_coral",
        slug: "coral-offers",
        name: "Coral Offers",
        description: "Offers.",
        icon: TEAM_ICONS[0],
        admins: [person("alex", "Alex Kim")],
        members: 7,
        templates: 12,
        createdAt: "2026-01-02T00:00:00.000Z",
        appName: "Coral",
        smsSender: "26725",
      },
    ]);
    expect(section.people.map((p) => [p.id, p.name, p.title])).toEqual([
      ["alex", "Alex Kim", "Team Admin"],
      ["dana", "Dana Park", "Legal reviewer"],
    ]);
    expect(section.icons).toEqual(TEAM_ICONS);
  });
});

describe("contentTypesSection", () => {
  it("classes a type by its channels and keeps what the service decided", () => {
    const sections = [{ key: "terms", title: "Terms" }];
    const facts: ContentTypesFacts = {
      types: [
        {
          id: "ct_alert",
          key: "alert",
          name: "Alert",
          allowedChannels: ["push", "sms"],
          requiredSections: [],
          smsFooter: "Coral: Reply STOP to opt out, HELP for help.",
          smsMaxParts: 3,
          templates: 2,
          can: {
            editSections: {
              ok: false,
              ...PLATFORM_REFUSALS.noSections("Alert"),
            },
          },
        },
        {
          id: "ct_disclosure",
          key: "disclosure",
          name: "Disclosure",
          allowedChannels: ["pdf", "web", "email"],
          requiredSections: sections,
          smsFooter: null,
          smsMaxParts: 3,
          templates: 5,
          can: { editSections: OK },
        },
      ],
    };
    const { types } = contentTypesSection(facts);
    expect(types[0]).toMatchObject({
      family: "message",
      allowedChannels: ["push", "sms"],
      smsFooter: "Coral: Reply STOP to opt out, HELP for help.",
      can: {
        editSections: { ok: false, ...PLATFORM_REFUSALS.noSections("Alert") },
      },
    });
    expect(types[1]).toMatchObject({
      family: "document",
      smsFooter: null,
      requiredSections: sections,
      can: { editSections: OK },
    });
  });
});

describe("channelRulesSection", () => {
  it("lists every channel and carries each switch decided", () => {
    const toMessages = {
      ok: false as const,
      ...PLATFORM_REFUSALS.otherFamily("Disclosure", "document", ["Alert"]),
    };
    const facts: ChannelRulesFacts = {
      rows: [
        {
          contentTypeId: "ct_disclosure",
          name: "Disclosure",
          allowed: {
            pdf: true,
            web: true,
            email: true,
            push: false,
            sms: false,
          },
          activeUsing: { pdf: 3, web: 2, email: 2, push: 0, sms: 0 },
          can: {
            toggle: {
              pdf: OK,
              web: OK,
              email: OK,
              push: toMessages,
              sms: toMessages,
            },
          },
        },
      ],
    };
    const section = channelRulesSection(facts);
    expect(section.channels).toEqual(["pdf", "web", "email", "push", "sms"]);
    expect(section.rows).toEqual(facts.rows);
    expect(section.rows[0]!.can.toggle.push.ok).toBe(false);
  });
});

describe("approvalChainsSection", () => {
  const facts: ApprovalChainsFacts = {
    chains: [
      {
        contentTypeId: "ct_disclosure",
        name: "Disclosure",
        stages: [
          {
            id: "st_1",
            position: 0,
            name: "Team approver",
            rule: { kind: "team_role", role: "approver" },
            waiting: 2,
          },
          {
            id: "st_2",
            position: 1,
            name: "Legal reviewer",
            rule: { kind: "user", userId: "dana" },
            waiting: 0,
          },
        ],
      },
    ],
    choices: [
      { id: "alex", title: "Team Admin", teamNames: ["Coral Offers"] },
      { id: "riley", title: "Platform Admin", teamNames: [] },
    ],
    approvers: [
      {
        id: "alex",
        name: "Alex Kim",
        platformRole: null,
        activeTeamRole: true,
      },
      {
        id: "dana",
        name: "Dana Park",
        platformRole: null,
        activeTeamRole: true,
      },
      {
        id: "riley",
        name: "Riley Brooks",
        platformRole: "platform_admin",
        activeTeamRole: true,
      },
    ],
    people: PEOPLE,
  };

  it("words each stage's rule: the role, or the person's name", () => {
    const [chain] = approvalChainsSection(facts, "taylor").chains;
    expect(chain!.stages.map((s) => [s.name, s.ruleLabel, s.waiting])).toEqual([
      ["Team approver", "Approver role", 2],
      ["Legal reviewer", "Dana Park", 0],
    ]);
  });

  it("shows beside a name the teams they see, and All teams for a platform role", () => {
    const section = approvalChainsSection(facts, "taylor");
    expect(section.people.map((p) => [p.id, p.title, p.teams])).toEqual([
      ["alex", "Team Admin", ["Coral Offers"]],
      ["riley", "Platform Admin", ["All teams"]],
    ]);
    expect(section.approvers).toEqual(facts.approvers);
    expect(section.viewerId).toBe("taylor");
  });
});

describe("businessZoneSection", () => {
  const facts = (pendingSunsets: number): BusinessZoneFacts => ({
    asOf: ASOF,
    zone: "America/New_York",
    pendingSunsets,
    can: { change: OK },
  });

  it("labels the zones on offer and says what a change leaves in place", () => {
    const section = businessZoneSection(facts(2));
    expect(section.zone).toBe("America/New_York");
    expect(section.zones).toContainEqual({
      id: "America/New_York",
      label: "Eastern (America/New_York)",
    });
    expect(section.consequences).toEqual([
      "2 sunsets already set don't move: their consumers have been told when they end.",
    ]);
    expect(section.can).toEqual({ change: OK });
  });

  it("says nothing when no sunset is set, and the singular for one", () => {
    expect(businessZoneSection(facts(0)).consequences).toEqual([]);
    expect(businessZoneSection(facts(1)).consequences).toEqual([
      "1 sunset already set doesn't move: its consumers have been told when it ends.",
    ]);
  });
});

describe("the section read models", () => {
  beforeEach(() => {
    env.signedIn = true;
    env.facts = {
      ok: true,
      teams: [],
      firstAdminCandidates: [],
      people: [],
      types: [],
      rows: [],
      chains: [],
      choices: [],
      approvers: [],
      asOf: ASOF,
      zone: "America/New_York",
      pendingSunsets: 0,
      can: { change: OK },
    };
  });

  const reads = [
    getTeamsSection,
    getContentTypesSection,
    getChannelRulesSection,
    getApprovalChainsSection,
    getBusinessZoneSection,
  ];

  it("read the service as the signed-in viewer", async () => {
    for (const read of reads)
      await expect(read(), read.name).resolves.toBeTruthy();
  });

  it("are Not found when the service refuses the viewer: the Platform group isn't theirs", async () => {
    env.facts = { ok: false, status: 403, ...REASONS.generic };
    for (const read of reads)
      await expect(read(), read.name).rejects.toThrow(NOT_FOUND);
  });

  it("send a signed-out person to sign in", async () => {
    env.signedIn = false;
    for (const read of reads)
      await expect(read(), read.name).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
