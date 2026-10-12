import { describe, expect, it } from "vitest";
import type { ApproverFacts } from "../access-types";
import { PLATFORM_REFUSALS } from "./refusals";
import {
  approverProblem,
  describeChainChange,
  removeStageRefusal,
  ruleLabel,
  saveApprovalChain,
  validateChain,
} from "./approval-chains";
import type { ApprovalStage } from "../review-types";
import type { ApproverRule } from "../types";
import { NOW, riley, alex } from "./fixtures";

const dana = { id: "dana", name: "Dana Park" };

const people = [riley, alex, dana, { id: "jordan", name: "Jordan Ellis" }];

const TEAM: ApprovalStage = {
  id: "stage_team",
  position: 0,
  name: "Team approver",
  rule: { kind: "team_role", role: "approver" },
};
const LEGAL = {
  name: "Legal reviewer",
  rule: { kind: "user" as const, userId: "dana" },
};

/**
 * Everyone a chain test may name. Riley is the Platform Admin saving; Alex, Dana and Jordan hold active
 * team roles; Taylor is the Auditor; Morgan has no active access; Pat is a Platform Admin with no team
 * role; Casey is a Platform Admin who also holds a team role, so another admin may name them.
 */
const approvers: ApproverFacts[] = [
  { ...riley, platformRole: "platform_admin", activeTeamRole: false },
  { ...alex, platformRole: null, activeTeamRole: true },
  { ...dana, platformRole: null, activeTeamRole: true },
  {
    id: "jordan",
    name: "Jordan Ellis",
    platformRole: null,
    activeTeamRole: true,
  },
  {
    id: "taylor",
    name: "Taylor Nguyen",
    platformRole: "auditor",
    activeTeamRole: false,
  },
  {
    id: "morgan",
    name: "Morgan Lee",
    platformRole: null,
    activeTeamRole: false,
  },
  {
    id: "pat",
    name: "Pat Admin",
    platformRole: "platform_admin",
    activeTeamRole: false,
  },
  {
    id: "casey",
    name: "Casey Admin",
    platformRole: "platform_admin",
    activeTeamRole: true,
  },
];
const naming = (userId: string, name = "Sign-off") => ({
  name,
  rule: { kind: "user" as const, userId },
});

describe("validateChain", () => {
  const check = (
    stages: { id?: string; name: string; rule: ApproverRule }[],
    actorId = "riley",
    current: { id: string; rule: ApproverRule }[] = [],
  ) => validateChain({ stages, current, actorId, people: approvers });
  const team = { name: "Team approver", rule: TEAM.rule };

  it("passes a chain somebody can approve: the Approver role, then different people", () => {
    expect(check([team, LEGAL, naming("alex", "Final sign-off")])).toEqual([]);
    expect(check([team, { name: "Second approver", rule: TEAM.rule }])).toEqual(
      [],
    ); // two people with the role
  });

  it("refuses one person on two stages, at the later stage", () => {
    expect(check([team, LEGAL, naming("dana", "Final sign-off")])).toEqual([
      {
        stage: 2,
        field: "reviewer",
        code: "person_on_two_stages",
        reason: "Dana Park already reviews stage 2.",
      },
    ]);
  });

  it("refuses every team role but Approver: none of them can decide", () => {
    for (const [role, label] of [
      ["viewer", "Viewer"],
      ["author", "Author"],
      ["team_admin", "Team Admin"],
    ] as const) {
      expect(
        check([
          team,
          { name: "Second look", rule: { kind: "team_role", role } },
        ]),
      ).toEqual([
        {
          stage: 1,
          field: "reviewer",
          code: "role_cant_approve",
          reason: `The ${label} role can't approve.`,
        },
      ]);
    }
    expect(
      check([
        { name: "Boss", rule: { kind: "team_role", role: "boss" as never } },
      ]),
    ).toEqual([{ stage: 0, field: "reviewer", ...PLATFORM_REFUSALS.pickRole }]);
  });

  it("refuses the admin naming themselves", () => {
    expect(check([team, naming("riley")])).toEqual([
      {
        stage: 1,
        field: "reviewer",
        code: "names_yourself",
        reason: "You can't name yourself as an approver.",
      },
    ]);
    expect(check([team, naming("riley")], "pat")).toEqual([
      {
        stage: 1,
        field: "reviewer",
        code: "admin_without_team_role",
        reason:
          "Riley Brooks is a Platform Admin with no team role and can't approve.",
      },
    ]);
  });

  describe("naming yourself is about the act: Casey, named on stage 1 by Riley, saves the chain", () => {
    const saved = [
      { id: "stage_casey", rule: { kind: "user" as const, userId: "casey" } },
      { id: "stage_team", rule: TEAM.rule },
    ];
    const caseyStage = {
      id: "stage_casey",
      name: "Admin sign-off",
      rule: saved[0]!.rule,
    };

    it("can rename stage 2 and save: the stage Riley named them on stays theirs", () => {
      expect(
        check(
          [
            caseyStage,
            { id: "stage_team", name: "Team sign-off", rule: TEAM.rule },
          ],
          "casey",
          saved,
        ),
      ).toEqual([]);
      expect(
        check([{ id: "stage_team", ...team }, caseyStage], "casey", saved),
      ).toEqual([]); // moved, same stage id
    });

    it("can't newly name themselves on another stage", () => {
      expect(
        check(
          [
            caseyStage,
            { id: "stage_team", ...team },
            naming("casey", "Final sign-off"),
          ],
          "casey",
          saved,
        ),
      ).toEqual([
        {
          stage: 2,
          field: "reviewer",
          code: "names_yourself",
          reason: "You can't name yourself as an approver.",
        },
      ]);
    });

    it("can't swap a stage's reviewer to themselves after someone else held it", () => {
      expect(
        check(
          [{ id: "stage_team", ...naming("casey", "Team approver") }],
          "casey",
          saved,
        ),
      ).toEqual([
        {
          stage: 0,
          field: "reviewer",
          code: "names_yourself",
          reason: "You can't name yourself as an approver.",
        },
      ]);
    });

    it("still can't keep a stage that would stall: the other checks apply to stages the actor kept", () => {
      const lapsed = [
        { id: "stage_casey", rule: { kind: "user" as const, userId: "pat" } },
      ];
      expect(
        check([{ id: "stage_casey", ...naming("pat") }], "pat", lapsed),
      ).toEqual([
        {
          stage: 0,
          field: "reviewer",
          code: "admin_without_team_role",
          reason:
            "Pat Admin is a Platform Admin with no team role and can't approve.",
        },
      ]);
    });
  });

  it("refuses an Auditor", () => {
    expect(check([team, naming("taylor")])).toEqual([
      {
        stage: 1,
        field: "reviewer",
        code: "auditor_cant_approve",
        reason: "Taylor Nguyen is an Auditor and can't approve.",
      },
    ]);
  });

  it("refuses someone who can't approve: no active team role, whatever their platform role", () => {
    expect(check([team, naming("morgan")])).toEqual([
      {
        stage: 1,
        field: "reviewer",
        code: "no_active_access",
        reason: "Morgan Lee has no active access.",
      },
    ]);
    expect(check([team, naming("pat")])).toEqual([
      {
        stage: 1,
        field: "reviewer",
        code: "admin_without_team_role",
        reason:
          "Pat Admin is a Platform Admin with no team role and can't approve.",
      },
    ]);
    expect(check([team, naming("nobody")])).toEqual([
      { stage: 1, field: "reviewer", ...PLATFORM_REFUSALS.pickPerson },
    ]);
  });

  it("checks every stage, names too, in stage order with the name first", () => {
    expect(
      check([
        { name: " ", rule: { kind: "team_role", role: "author" } },
        naming("taylor", "team APPROVER"),
        naming("morgan", "Team approver"),
      ]),
    ).toEqual([
      { stage: 0, field: "name", ...PLATFORM_REFUSALS.stageName },
      {
        stage: 0,
        field: "reviewer",
        code: "role_cant_approve",
        reason: "The Author role can't approve.",
      },
      {
        stage: 1,
        field: "reviewer",
        code: "auditor_cant_approve",
        reason: "Taylor Nguyen is an Auditor and can't approve.",
      },
      {
        stage: 2,
        field: "name",
        code: "stage_duplicate",
        reason: "There are two stages called Team approver.",
      },
      {
        stage: 2,
        field: "reviewer",
        code: "no_active_access",
        reason: "Morgan Lee has no active access.",
      },
    ]);
    expect(check([{ ...team, name: "x".repeat(41) }])).toEqual([
      { stage: 0, field: "name", ...PLATFORM_REFUSALS.stageNameTooLong },
    ]);
  });

  it("offers in the picker only the people approverProblem allows", () => {
    expect(
      approvers.filter((p) => !approverProblem(p, "riley")).map((p) => p.id),
    ).toEqual(["alex", "dana", "jordan", "casey"]);
    expect(
      approvers.filter((p) => !approverProblem(p, "casey")).map((p) => p.id),
    ).toEqual(["alex", "dana", "jordan"]);
  });
});

describe("removeStageRefusal (the chain editor's Remove)", () => {
  it("keeps the last stage, and a stage a version in review still needs", () => {
    expect(removeStageRefusal({ name: "Team approver", waiting: 0 }, 0)).toBe(
      PLATFORM_REFUSALS.oneStage,
    );
    expect(
      removeStageRefusal({ name: "Legal reviewer", waiting: 2 }, 1),
    ).toEqual({
      code: "stage_in_use",
      reason: "2 versions in review still need Legal reviewer.",
    });
    expect(
      removeStageRefusal({ name: "Legal reviewer", waiting: 0 }, 1),
    ).toBeNull();
  });

  it("is the reason saveApprovalChain refuses a removal with", () => {
    const legal: ApprovalStage = {
      id: "stage_legal",
      position: 1,
      name: "Legal reviewer",
      rule: LEGAL.rule,
    };
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
    expect(saved).toEqual({
      ok: false,
      ...removeStageRefusal({ name: "Legal reviewer", waiting: 1 }, 1),
    });
  });
});

describe("saveApprovalChain", () => {
  const run = (over: Partial<Parameters<typeof saveApprovalChain>[0]> = {}) =>
    saveApprovalChain({
      contentType: { id: "ct_disclosure", name: "Disclosure" },
      current: [TEAM],
      next: [
        { id: "stage_team", name: "Team approver", rule: TEAM.rule },
        LEGAL,
      ],
      inReview: [],
      people: approvers,
      actor: riley,
      now: NOW,
      ...over,
    });

  it("adds Dana Park's Legal reviewer stage after the team's approvers", () => {
    expect(
      run({
        inReview: [
          {
            versionId: "v3",
            stages: [{ id: "stage_team", name: "Team approver" }],
            currentStage: 0,
          },
        ],
      }),
    ).toEqual({
      ok: true,
      stages: [
        {
          id: "stage_team",
          position: 0,
          name: "Team approver",
          rule: { kind: "team_role", role: "approver" },
        },
        {
          id: null,
          position: 1,
          name: "Legal reviewer",
          rule: { kind: "user", userId: "dana" },
        },
      ],
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: null,
          details: {
            area: "approval_chains",
            summary:
              "Set Disclosure approval chain: Team approver (Approver role) → Legal reviewer (Dana Park)",
            contentTypeId: "ct_disclosure",
            contentTypeName: "Disclosure",
            before: ["Team approver"],
            after: ["Team approver", "Legal reviewer"],
            stages: [
              {
                name: "Team approver",
                rule: { kind: "team_role", role: "approver" },
              },
              {
                name: "Legal reviewer",
                rule: { kind: "user", userId: "dana" },
              },
            ],
          },
        },
      ],
    });
  });

  it("reorders and renames stages, keeping their ids; versions in review are left as they are", () => {
    const result = run({
      next: [
        LEGAL,
        { id: "stage_team", name: "Team approval", rule: TEAM.rule },
      ],
      inReview: [
        {
          versionId: "v3",
          stages: [{ id: "stage_team", name: "Team approver" }],
          currentStage: 0,
        },
      ],
    });
    expect(result.ok && result.stages.map((s) => [s.id, s.name])).toEqual([
      [null, "Legal reviewer"],
      ["stage_team", "Team approval"],
    ]);
    expect(result.ok && Object.keys(result)).toEqual([
      "ok",
      "stages",
      "effects",
    ]);
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
      expect(run({ current, next, inReview: waiting })).toEqual({
        ok: false,
        code: "stage_in_use",
        reason: "2 versions in review still need Legal reviewer.",
      });
      expect(run({ current, next, inReview: [waiting[0]!] })).toEqual({
        ok: false,
        code: "stage_in_use",
        reason: "1 version in review still needs Legal reviewer.",
      });
    });

    it("refuses while it is ahead of a version in that version's own stages", () => {
      // v3 waits on the Team approver stage and goes to Legal next; v4 recorded Legal first and passed it.
      const legalFirst = [both[1]!, both[0]!];
      expect(
        run({
          current,
          next,
          inReview: [{ versionId: "v3", stages: both, currentStage: 0 }],
        }),
      ).toEqual({
        ok: false,
        code: "stage_in_use",
        reason: "1 version in review still needs Legal reviewer.",
      });
      expect(
        run({
          current,
          next,
          inReview: [{ versionId: "v4", stages: legalFirst, currentStage: 1 }],
        }).ok,
      ).toBe(true);
    });

    it("allows it once no version in review needs it, whatever the chain looked like at their submit", () => {
      const before = [{ id: "stage_team", name: "Team approver" }];
      const removed = run({
        current,
        next,
        inReview: [{ versionId: "v5", stages: before, currentStage: 0 }],
      });
      expect(removed.ok && removed.stages.length).toBe(1);
    });
  });

  it("refuses no stages, blank, long or duplicate names, an unknown person or role, and a stale stage id", () => {
    expect(run({ next: [] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.oneStage,
    });
    expect(run({ next: [{ ...LEGAL, name: " " }] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.stageName,
    });
    expect(run({ next: [{ ...LEGAL, name: "x".repeat(41) }] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.stageNameTooLong,
    });
    expect(
      run({ next: [LEGAL, { ...LEGAL, name: "legal REVIEWER" }] }),
    ).toEqual({
      ok: false,
      code: "stage_duplicate",
      reason: "There are two stages called legal REVIEWER.",
    });
    expect(
      run({
        next: [{ name: "Legal", rule: { kind: "user", userId: "nobody" } }],
      }),
    ).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.pickPerson,
    });
    expect(
      run({
        next: [
          { name: "Boss", rule: { kind: "team_role", role: "boss" as never } },
        ],
      }),
    ).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.pickRole,
    });
    expect(run({ next: [{ id: "stage_gone", ...LEGAL }] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.stageGone,
    });
    expect(
      run({
        next: [
          { id: "stage_team", ...LEGAL },
          { id: "stage_team", name: "Again", rule: TEAM.rule },
        ],
      }),
    ).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.stageGone,
    });
  });

  it("writes nothing when the chain is unchanged", () => {
    const same = run({
      next: [{ id: "stage_team", name: "Team approver", rule: TEAM.rule }],
    });
    expect(same.ok && same.effects).toEqual([]);
  });

  it("refuses a chain nobody can approve with validateChain's first problem, and writes nothing", () => {
    const team = { id: "stage_team", name: "Team approver", rule: TEAM.rule };
    expect(
      run({ next: [team, LEGAL, naming("dana", "Final sign-off")] }),
    ).toEqual({
      ok: false,
      code: "person_on_two_stages",
      reason: "Dana Park already reviews stage 2.",
    });
    expect(
      run({ next: [{ ...team, rule: { kind: "team_role", role: "viewer" } }] }),
    ).toEqual({
      ok: false,
      code: "role_cant_approve",
      reason: "The Viewer role can't approve.",
    });
    expect(run({ next: [team, naming("riley")] })).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.nameYourself,
    });
    expect(run({ next: [team, naming("taylor")] })).toEqual({
      ok: false,
      code: "auditor_cant_approve",
      reason: "Taylor Nguyen is an Auditor and can't approve.",
    });
    expect(run({ next: [team, naming("morgan")] })).toEqual({
      ok: false,
      code: "no_active_access",
      reason: "Morgan Lee has no active access.",
    });
  });

  it("lets an admin save a chain another admin named them on, but not swap a stage to themselves", () => {
    const casey = { id: "casey", name: "Casey Admin" };
    const caseyStage = {
      id: "stage_casey",
      position: 1,
      name: "Admin sign-off",
      rule: { kind: "user" as const, userId: "casey" },
    };
    const current = [TEAM, caseyStage];
    const kept = {
      id: "stage_casey",
      name: caseyStage.name,
      rule: caseyStage.rule,
    };
    expect(
      run({
        actor: casey,
        current,
        next: [
          { id: "stage_team", name: "Team sign-off", rule: TEAM.rule },
          kept,
        ],
      }).ok,
    ).toBe(true);
    expect(
      run({
        actor: casey,
        current,
        next: [
          { id: "stage_team", name: "Team approver", rule: caseyStage.rule },
          kept,
        ],
      }),
    ).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.nameYourself,
    });
  });

  it("refuses re-saving a stage whose person has lost access since they were named", () => {
    const legal = { id: "stage_legal", position: 1, ...LEGAL };
    const lapsed = approvers.map((p) =>
      p.id === "dana" ? { ...p, activeTeamRole: false } : p,
    );
    const renamed = [
      { id: "stage_team", name: "Team sign-off", rule: TEAM.rule },
      { id: "stage_legal", ...LEGAL },
    ];
    expect(
      run({ current: [TEAM, legal], next: renamed, people: lapsed }),
    ).toEqual({
      ok: false,
      code: "no_active_access",
      reason: "Dana Park has no active access.",
    });
    expect(run({ current: [TEAM, legal], next: renamed }).ok).toBe(true);
  });
});

describe("describeChainChange (the Now / After cards)", () => {
  it("shows the Legal stage added, and says Dana reviews every team's submissions", () => {
    expect(
      describeChainChange({
        contentTypeName: "Disclosure",
        current: [TEAM],
        next: [
          { id: "stage_team", name: "Team approver", rule: TEAM.rule },
          LEGAL,
        ],
        people,
      }),
    ).toEqual({
      now: [
        {
          id: "stage_team",
          name: "Team approver",
          ruleLabel: "Approver role",
          change: null,
        },
      ],
      after: [
        {
          id: "stage_team",
          name: "Team approver",
          ruleLabel: "Approver role",
          change: null,
        },
        {
          id: null,
          name: "Legal reviewer",
          ruleLabel: "Dana Park",
          change: "added",
        },
      ],
      lines: [
        "Disclosure submissions will also wait on Legal reviewer (Dana Park).",
        "Dana Park will review Disclosure submissions from every team, including teams they aren't a member of.",
      ],
      changed: true,
    });
  });

  it("says a person reviews every team once, though two new stages name them", () => {
    const lines = describeChainChange({
      contentTypeName: "Disclosure",
      current: [TEAM],
      next: [
        { id: "stage_team", name: "Team approver", rule: TEAM.rule },
        LEGAL,
        { name: "Final sign-off", rule: LEGAL.rule },
      ],
      people,
    }).lines;
    const everyTeam = lines.filter((line) => line.includes("from every team"));
    expect(everyTeam).toEqual([
      "Dana Park will review Disclosure submissions from every team, including teams they aren't a member of.",
    ]);
    // The stages themselves are still each described.
    expect(
      lines.filter((line) => line.includes("will also wait on")),
    ).toHaveLength(2);

    // Two different people newly named each get their own line.
    const two = describeChainChange({
      contentTypeName: "Disclosure",
      current: [TEAM],
      next: [
        LEGAL,
        { name: "Final sign-off", rule: { kind: "user", userId: "alex" } },
      ],
      people,
    }).lines.filter((line) => line.includes("from every team"));
    expect(two.map((line) => line.split(" will review")[0])).toEqual([
      "Dana Park",
      "Alex Kim",
    ]);
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
    expect(change.lines).toEqual([
      "2 versions in review still need Legal reviewer.",
    ]);

    const swapped = describeChainChange({
      contentTypeName: "Disclosure",
      current: [TEAM, legal],
      next: [
        { id: "stage_legal", ...LEGAL },
        { id: "stage_team", name: "Team approver", rule: TEAM.rule },
      ],
      people,
    });
    expect(swapped.after.map((s) => s.change)).toEqual(["moved", "moved"]);
    expect(swapped.changed).toBe(true);
  });

  it("labels rules", () => {
    expect(ruleLabel({ kind: "team_role", role: "approver" }, people)).toBe(
      "Approver role",
    );
    expect(ruleLabel({ kind: "user", userId: "dana" }, people)).toBe(
      "Dana Park",
    );
  });
});
