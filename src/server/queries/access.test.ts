import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_REFUSALS } from "@/domain/access/refusals";
import { REASONS } from "@/domain/permissions";
import type { Person } from "@/domain/review-types";
import type {
  HomeCardFacts,
  InactiveMemberFacts,
  InactivityFacts,
  MemberFacts,
  MembersFacts,
  RecertificationFacts,
  RecertMemberFacts,
  RequestAccessFacts,
  RequestFacts,
  RequestsFacts,
  SidebarCardsFacts,
  TeamFacts,
} from "@/server/services/access";
import {
  accessRequestsSection,
  getAccessRequestsSection,
  getInactivitySection,
  getMembersSection,
  getRecertificationSection,
  getSidebarCards,
  homeCard,
  inactivitySection,
  membersSection,
  recertificationSection,
  requestAccessData,
  sidebarCards,
} from "./access";

// The access read models as the BFF builds them: facts in (what the access service answers), the screens'
// view models out. The shaping functions are pure, so these tests hand them facts directly; what the service
// decides (who may do what, who is flagged, which review is current, the 30-day window) is the contract suite's
// (src/server/services/contract/settings.ts). `getXSection` is checked for what it adds: the space, Not found
// for a refusal, and sign-in.

const env = vi.hoisted(() => ({
  signedIn: true,
  facts: undefined as unknown,
  asked: [] as unknown[],
}));
vi.mock("@/server/context/request", async () => {
  const { signInRequired } = await import("@/server/context/sign-in");
  return {
    requireRequestContext: async () =>
      env.signedIn
        ? {
            viewer: { userId: "alex", name: "Alex Kim" },
            correlationId: "req_test",
          }
        : signInRequired(),
  };
});
vi.mock("@/server/services", () => {
  const read = (name: string) => async (_ctx: unknown, input: unknown) => {
    env.asked.push([name, input]);
    return env.facts;
  };
  return {
    services: () => ({
      access: {
        members: read("members"),
        requests: read("requests"),
        recertification: read("recertification"),
        inactivity: read("inactivity"),
        sidebarCards: read("sidebarCards"),
      },
    }),
  };
});
vi.mock("./spaces", () => ({
  requireSpace: async (slug: string) => ({
    slug,
    isAll: slug === "all",
    teamId: slug === "all" ? null : `t_${slug}`,
    name: slug,
  }),
}));

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const ASOF = "2026-10-04T12:00:00.000Z";
const TEAM: TeamFacts = {
  id: "t_coral",
  slug: "coral-offers",
  name: "Coral Offers",
};
const person = (id: string, name: string): Person => ({
  id,
  name,
  initials: name
    .split(" ")
    .map((w) => w[0])
    .join(""),
  hue: 10,
});
const PEOPLE: Person[] = [
  person("alex", "Alex Kim"),
  person("chris", "Chris Morales"),
  person("dana", "Dana Park"),
  person("devon", "Devon Lin"),
  person("jordan", "Jordan Ellis"),
  person("maya", "Maya Chen"),
  person("morgan", "Morgan Lee"),
  person("priya", "Priya Raman"),
  person("sam", "Sam Ortiz"),
];
const OK = { ok: true } as const;
const DAY = 86_400_000;
const daysFromAsOf = (days: number) =>
  new Date(Date.parse(ASOF) + days * DAY).toISOString();

function member(over: Partial<MemberFacts> & { userId: string }): MemberFacts {
  return {
    membershipId: `m_${over.userId}`,
    title: "Author",
    email: `${over.userId}@example.com`,
    roles: ["author"],
    status: "active",
    statusReason: null,
    statusChangedAt: null,
    lastActiveAt: daysFromAsOf(-1),
    addedAt: daysFromAsOf(-300),
    can: {
      editRoles: OK,
      remove: OK,
      reinstate: { ok: false, ...ACCESS_REFUSALS.alreadyActive },
    },
    ...over,
  };
}

describe("requestAccessData", () => {
  const facts: RequestAccessFacts = {
    teams: [
      {
        ...TEAM,
        description: "Offers.",
        icon: "tag",
        adminIds: ["alex"],
        myRoles: [],
      },
    ],
    requests: [
      {
        id: "ar_1",
        teamId: "t_coral",
        role: "author",
        reason: "Spring offers.",
        status: "denied",
        createdAt: daysFromAsOf(-3),
        decidedBy: "alex",
        decidedAt: daysFromAsOf(-2),
        note: "Not now.",
      },
    ],
    ended: [
      {
        teamId: "t_coral",
        status: "lapsed",
        reason: "recert_unconfirmed",
        at: daysFromAsOf(-1),
      },
    ],
    people: PEOPLE,
  };

  it("names each team's admins, and each request and ended access by its team", () => {
    const data = requestAccessData(facts);
    expect(data.teams[0]).toMatchObject({
      slug: "coral-offers",
      admins: [{ id: "alex", name: "Alex Kim" }],
      myRoles: [],
    });
    expect(data.requests[0]).toMatchObject({
      teamName: "Coral Offers",
      decidedBy: { id: "alex" },
      decidedAt: daysFromAsOf(-2),
      note: "Not now.",
    });
    expect(data.ended).toEqual([
      {
        teamId: "t_coral",
        teamName: "Coral Offers",
        status: "lapsed",
        reason: "recert_unconfirmed",
        at: daysFromAsOf(-1),
      },
    ]);
    expect(data.roles).toEqual(["viewer", "author", "approver"]);
  });

  it("leaves out who decided a request nobody has decided", () => {
    const data = requestAccessData({
      ...facts,
      requests: [
        {
          ...facts.requests[0]!,
          status: "pending",
          decidedBy: null,
          decidedAt: null,
          note: null,
        },
      ],
    });
    expect(data.requests[0]!.decidedBy).toBeUndefined();
    expect(data.requests[0]!.decidedAt).toBeUndefined();
  });
});

describe("sidebar cards", () => {
  const facts: SidebarCardsFacts = {
    asOf: ASOF,
    cards: [
      {
        kind: "access_requests",
        teamId: "t_coral",
        teamSlug: "coral-offers",
        newestRequestId: "ar_2",
        count: 2,
        requesterId: "morgan",
        role: "author",
      },
      {
        kind: "recert_due",
        teamId: "t_deposits",
        teamSlug: "deposits",
        recertId: "rc_1",
        label: "Q4 2026",
        dueAt: daysFromAsOf(30),
        progress: { total: 6, decided: 0, kept: 0, removed: 0, pending: 6 },
      },
    ],
    people: PEOPLE,
  };

  it("words each card and keys its dismissal on the content, by team id", () => {
    expect(sidebarCards(facts)).toEqual({
      t_coral: {
        kind: "access_requests",
        id: "access-requests:t_coral:ar_2:2",
        teamSlug: "coral-offers",
        count: 2,
        firstName: "Morgan",
        role: "author",
      },
      t_deposits: {
        kind: "recert_due",
        id: "recert:rc_1",
        teamSlug: "deposits",
        label: "Q4 2026",
        dueAt: daysFromAsOf(30),
        progressLabel: "0 of 6 confirmed",
      },
    });
  });

  it("a team with nothing to say has no card", () => {
    expect(sidebarCards({ ...facts, cards: [] })).toEqual({});
  });

  it("the home card names who decides the viewer's request, when someone does", () => {
    const request = {
      id: "ar_9",
      teamName: "Coral Offers",
      role: "author" as const,
      createdAt: daysFromAsOf(-1),
      adminId: "alex",
    };
    const withRequest: HomeCardFacts = { request, people: PEOPLE };
    expect(homeCard(withRequest)).toEqual({
      kind: "my_request",
      id: "my-request:ar_9",
      teamName: "Coral Offers",
      role: "author",
      createdAt: daysFromAsOf(-1),
      adminName: "Alex Kim",
    });
    expect(
      homeCard({ request: { ...request, adminId: null }, people: [] }),
    ).not.toHaveProperty("adminName");
    expect(homeCard({ request: null, people: [] })).toBeNull();
  });
});

describe("membersSection", () => {
  const facts: MembersFacts = {
    asOf: ASOF,
    team: TEAM,
    rows: [
      member({
        userId: "alex",
        roles: ["team_admin", "approver"],
        can: {
          editRoles: { ok: false, ...REASONS.ownAccess },
          remove: { ok: false, ...REASONS.ownAccess },
          reinstate: { ok: false, ...REASONS.ownAccess },
        },
      }),
      member({ userId: "maya" }),
      member({
        userId: "sam",
        roles: ["viewer"],
        status: "lapsed",
        statusReason: "recert_unconfirmed",
        statusChangedAt: daysFromAsOf(-1),
        can: {
          editRoles: { ok: false, ...ACCESS_REFUSALS.notActive },
          remove: OK,
          reinstate: OK,
        },
      }),
    ],
    people: PEOPLE,
  };

  it("keeps the service's order and decisions, and marks the viewer's own row", () => {
    const section = membersSection(facts, "alex");
    expect(section.rows.map((r) => [r.person.id, r.isYou])).toEqual([
      ["alex", true],
      ["maya", false],
      ["sam", false],
    ]);
    expect(section.rows[0]!.can.remove).toEqual({
      ok: false,
      ...REASONS.ownAccess,
    });
    expect(section.rows[1]!.can).toEqual(facts.rows[1]!.can);
    expect(section.team).toEqual(TEAM);
    expect(section.today).toBe("2026-10-04");
  });

  it("words each strip from the row's facts", () => {
    const maya = membersSection(facts, "alex").rows[1]!;
    expect(maya.consequences).toEqual({
      remove:
        "Maya Chen loses access to Coral Offers and drops off this list. They can ask for access again.",
      reinstate:
        "Maya signs in to Coral Offers again as Author. The inactivity count restarts today.",
    });
    expect(membersSection(facts, "alex").rows[2]!.consequences.reinstate).toBe(
      "Sam signs in to Coral Offers again as Viewer. The inactivity count restarts today.",
    );
  });
});

describe("accessRequestsSection", () => {
  const request = (
    over: Partial<RequestFacts> & { id: string },
  ): RequestFacts => ({
    userId: "chris",
    title: "Content strategist",
    role: "author",
    reason: "Spring offers.",
    status: "pending",
    createdAt: daysFromAsOf(-5),
    decidedBy: null,
    decidedAt: null,
    note: null,
    can: { decide: OK },
    ...over,
  });
  const facts: RequestsFacts = {
    asOf: ASOF,
    team: TEAM,
    pending: [request({ id: "ar_1" })],
    decided: [
      request({
        id: "ar_0",
        userId: "morgan",
        status: "denied",
        decidedBy: "alex",
        decidedAt: daysFromAsOf(-2),
        note: "Not now.",
        can: { decide: { ok: false, ...ACCESS_REFUSALS.decided } },
      }),
    ],
    people: PEOPLE,
  };

  it("words the Approve and Deny strips and counts its dates from asOf", () => {
    const section = accessRequestsSection(facts);
    expect(section.pending[0]!.consequences).toEqual({
      approve:
        "Chris Morales gets Author access to Coral Offers and sees its Library the next time they open Stencil.",
      deny: "Chris sees your note and can ask again.",
    });
    expect(section.today).toBe("2026-10-04");
  });

  it("names who decided a decided request, with the reason a decided one can't be decided again", () => {
    const [decided] = accessRequestsSection(facts).decided;
    expect(decided).toMatchObject({
      person: { id: "morgan" },
      decidedBy: { id: "alex", name: "Alex Kim" },
      decidedAt: daysFromAsOf(-2),
      note: "Not now.",
      can: { decide: { ok: false, ...ACCESS_REFUSALS.decided } },
    });
    expect(accessRequestsSection(facts).pending[0]!.decidedBy).toBeUndefined();
  });
});

describe("recertificationSection", () => {
  const item = (
    userId: string,
    over: Partial<RecertMemberFacts> = {},
  ): RecertMemberFacts => ({
    userId,
    title: "Author",
    roles: ["author"],
    lastActiveAt: daysFromAsOf(-1),
    decision: null,
    decidedBy: null,
    decidedAt: null,
    membership: "active",
    can: { decide: OK },
    ...over,
  });
  const open: RecertificationFacts = {
    asOf: ASOF,
    team: TEAM,
    current: {
      id: "rc_1",
      label: "Q4 2026",
      startsAt: ASOF,
      dueAt: daysFromAsOf(30),
      completedAt: null,
      phase: "open",
      progress: { total: 2, decided: 1, kept: 1, removed: 0, pending: 1 },
      items: [
        item("maya", {
          decision: "keep",
          decidedBy: "alex",
          decidedAt: daysFromAsOf(0),
        }),
        item("sam"),
      ],
      lapsedIds: [],
    },
    can: { start: { ok: false, ...ACCESS_REFUSALS.reviewOpen } },
    people: PEOPLE,
  };

  it("words an open review: the footnote, what a settled row says, the strips", () => {
    const section = recertificationSection(open);
    expect(section.current!.footnote).toBe(
      "Anyone not confirmed by Nov 3 loses access to Coral Offers.",
    );
    expect(section.current!.items.map((i) => i.outcome)).toEqual([
      "Kept · Alex Kim, Oct 4",
      null,
    ]);
    expect(section.current!.items[1]!.consequences).toEqual({
      remove:
        "Sam Ortiz loses access to Coral Offers now, not at the deadline.",
    });
    expect(section.consequences.start).toBe(
      "Every member except Team Admins is asked to be kept or removed by Nov 3, 30 days from today. Anyone not confirmed by then loses access to Coral Offers.",
    );
    expect(section.can.start).toEqual({
      ok: false,
      ...ACCESS_REFUSALS.reviewOpen,
    });
    expect(section.current!.progress).toEqual(open.current!.progress);
    expect(section.today).toBe("2026-10-04");
  });

  it("words a closed review: who lapsed, and each row's outcome", () => {
    const closedAt = "2026-11-04T12:00:00.000Z";
    const closed: RecertificationFacts = {
      ...open,
      asOf: closedAt,
      current: {
        ...open.current!,
        phase: "closed",
        lapsedIds: ["dana", "maya", "sam"],
        items: [
          item("dana", { membership: "lapsed" }),
          item("devon", { membership: "suspended" }),
          item("maya", { membership: "lapsed" }),
          item("sam", { membership: "lapsed" }),
          item("priya", { membership: "removed" }),
        ],
      },
    };
    const { current } = recertificationSection(closed);
    expect(current!.lapsed.map((p) => p.id)).toEqual(["dana", "maya", "sam"]);
    expect(current!.footnote).toBe(
      "Access lapsed on Nov 3 for Dana Park, Maya Chen and Sam Ortiz.",
    );
    expect(current!.items.map((i) => [i.userId, i.outcome])).toEqual([
      ["dana", "Access lapsed Nov 3"],
      ["devon", "Suspended for inactivity"],
      ["maya", "Access lapsed Nov 3"],
      ["sam", "Access lapsed Nov 3"],
      ["priya", "Removed"],
    ]);
  });

  it("has no review before the first", () => {
    const section = recertificationSection({ ...open, current: null });
    expect(section.current).toBeNull();
    expect(section.consequences.start).toContain("30 days from today");
  });
});

describe("inactivitySection", () => {
  const row = (over: Partial<InactiveMemberFacts> & { userId: string }) =>
    ({
      membershipId: `m_${over.userId}`,
      title: "Viewer",
      roles: ["viewer"],
      status: "active",
      statusReason: null,
      lastActiveAt: daysFromAsOf(-95),
      addedAt: daysFromAsOf(-300),
      daysInactive: 95,
      suspendsAt: daysFromAsOf(25),
      heldAsLastAdmin: false,
      can: {
        suspend: OK,
        keep: OK,
        reinstate: { ok: false, ...ACCESS_REFUSALS.alreadyActive },
      },
      ...over,
    }) satisfies InactiveMemberFacts;
  const facts: InactivityFacts = {
    asOf: ASOF,
    team: TEAM,
    flagged: [row({ userId: "devon" })],
    suspended: [],
    people: PEOPLE,
  };

  it("words the Suspend, Keep and Restore strips; Keep names the day they are flagged again", () => {
    const section = inactivitySection(facts);
    expect(section.flagged[0]).toMatchObject({
      person: { id: "devon" },
      daysInactive: 95,
      suspendsAt: daysFromAsOf(25),
      heldAsLastAdmin: false,
    });
    expect(section.flagged[0]!.consequences).toEqual({
      suspend: "Devon can't sign in to Coral Offers until you restore them.",
      keep: "Devon stays on Coral Offers. The count restarts today, so they're flagged again on Jan 2, 2027 if they still haven't signed in.",
      reinstate:
        "Devon signs in to Coral Offers again as Viewer. The inactivity count restarts today.",
    });
    expect(section.thresholds).toEqual({ flagDays: 90, suspendDays: 120 });
    expect(section.today).toBe("2026-10-04");
  });

  it("passes the service's decisions through", () => {
    const section = inactivitySection({
      ...facts,
      flagged: [row({ userId: "alex", heldAsLastAdmin: true })],
      suspended: [
        row({
          userId: "sam",
          status: "suspended",
          statusReason: "inactivity_auto",
        }),
      ],
    });
    expect(section.flagged[0]!.heldAsLastAdmin).toBe(true);
    expect(section.suspended[0]).toMatchObject({
      status: "suspended",
      statusReason: "inactivity_auto",
    });
  });
});

describe("the section read models", () => {
  /** Facts every section's read accepts (the shaping ignores what a section doesn't use). */
  const answer = () => ({
    ok: true,
    asOf: ASOF,
    team: TEAM,
    rows: [],
    pending: [],
    decided: [],
    flagged: [],
    suspended: [],
    current: null,
    can: { start: OK },
    cards: [],
    people: [],
  });

  beforeEach(() => {
    env.signedIn = true;
    env.asked = [];
    env.facts = answer();
  });

  it("ask the service for the team of the URL's slug, by id", async () => {
    await getMembersSection("coral-offers");
    await getAccessRequestsSection("coral-offers");
    await getRecertificationSection("coral-offers");
    await getInactivitySection("coral-offers");
    expect(env.asked).toEqual(
      ["members", "requests", "recertification", "inactivity"].map((name) => [
        name,
        { teamId: "t_coral-offers" },
      ]),
    );
  });

  it("are Not found for All teams, and when the service refuses the viewer", async () => {
    for (const read of [
      getMembersSection,
      getAccessRequestsSection,
      getRecertificationSection,
      getInactivitySection,
    ]) {
      await expect(read("all"), read.name).rejects.toThrow(NOT_FOUND);
      env.facts = { ok: false, status: 403, ...REASONS.generic };
      await expect(read("coral-offers"), read.name).rejects.toThrow(NOT_FOUND);
      env.facts = answer();
    }
  });

  it("send a signed-out person to sign in", async () => {
    env.signedIn = false;
    await expect(getMembersSection("coral-offers")).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    await expect(getSidebarCards()).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
