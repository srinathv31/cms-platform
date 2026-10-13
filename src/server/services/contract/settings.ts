import { describe, expect, it } from "vitest";
import { ACCESS_REFUSALS } from "@/domain/access/refusals";
import { REASONS } from "@/domain/permissions";
import { PLATFORM_REFUSALS } from "@/domain/platform-config/refusals";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ContractHarness } from "./harness";

// The settings screens' reads, as every implementation must answer them (AccessService and PlatformService in
// src/server/services/access.ts and platform.ts), from the seed with the backend's clock at its base instant: a
// case that needs another sets it. The facts only: the rows as stored, what the viewer may do on each (`can`,
// compared by code), and what time decides, at the `asOf` the read names; the BFF words the rest. The seed:
//   - Coral Offers: Alex its Team Admin; Dana, Devon, Jordan, Maya, Priya and Sam members; Chris's request for
//     Author waiting; Devon 95 days without a sign-in; a review open (Q4 2026), due in 30 days, 0 of 6 confirmed;
//   - Deposits (Naomi) and Card Statements (Hana) as the other two teams; Morgan on no team;
//   - Riley the Platform Admin, Taylor the Auditor.
// A team's id is never its slug (decision 0053): `t_coral`.
//
// These reads run on the local implementation only: the fake doesn't implement them (decision 0072: a read in
// the fake only where a case must observe a command), and the access and platform commands aren't behind the
// seam yet (plan P2), so no case here changes anything.

const CORAL = "t_coral";
const DEPOSITS = "t_deposits";
const OK = { ok: true };
const DAY = 86_400_000;

export function settingsContract(h: ContractHarness, base: Date) {
  const days = (n: number) => new Date(base.getTime() + n * DAY);

  /** A read as `asking` makes it. */
  const read = async <T>(
    asking: string,
    call: (
      services: ReturnType<ContractHarness["services"]>,
      ctx: Awaited<ReturnType<ContractHarness["as"]>>,
    ) => Promise<T>,
  ): Promise<T> => call(h.services(), await h.as(asking));

  /** A Team section of `teamId` (Coral Offers unless said) as `asking` reads it. */
  const membersOf = (asking: string, teamId = CORAL) =>
    read(asking, (s, ctx) => s.access.members(ctx, { teamId }));
  const requestsOf = (asking: string, teamId = CORAL) =>
    read(asking, (s, ctx) => s.access.requests(ctx, { teamId }));
  const recertOf = (asking: string, teamId = CORAL) =>
    read(asking, (s, ctx) => s.access.recertification(ctx, { teamId }));
  const idleOf = (asking: string, teamId = CORAL) =>
    read(asking, (s, ctx) => s.access.inactivity(ctx, { teamId }));
  const SECTIONS = {
    members: membersOf,
    requests: requestsOf,
    recertification: recertOf,
    inactivity: idleOf,
  };

  describe("access.requestAccessData", () => {
    it("lists every team by name with its Team Admins and the viewer's roles there, for anyone signed in", async () => {
      const morgan = await read("morgan", (s, ctx) =>
        s.access.requestAccessData(ctx),
      );
      if (!morgan.ok) throw new Error(morgan.code);
      expect(
        morgan.teams.map((t) => [t.id, t.slug, t.adminIds, t.myRoles]),
      ).toEqual([
        ["t_cards", "card-statements", ["hana"], []],
        [CORAL, "coral-offers", ["alex"], []],
        [DEPOSITS, "deposits", ["naomi"], []],
      ]);
      expect(morgan.requests).toEqual([]);
      expect(morgan.ended).toEqual([]);
      expect(morgan.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(["alex", "hana", "naomi"]),
      );

      const maya = await read("maya", (s, ctx) =>
        s.access.requestAccessData(ctx),
      );
      if (!maya.ok) throw new Error(maya.code);
      expect(maya.teams.find((t) => t.id === CORAL)!.myRoles).toEqual([
        "author",
      ]);
    });

    it("lists the viewer's latest request to a team, with the decision on it", async () => {
      const chris = await read("chris", (s, ctx) =>
        s.access.requestAccessData(ctx),
      );
      if (!chris.ok) throw new Error(chris.code);
      expect(chris.requests).toEqual([
        expect.objectContaining({
          teamId: CORAL,
          role: "author",
          status: "pending",
          decidedBy: null,
          decidedAt: null,
          note: null,
        }),
      ]);
    });
  });

  describe("access.homeCard and access.sidebarCards", () => {
    it("the home card is the viewer's newest pending request, with who decides it; none without one", async () => {
      const chris = await read("chris", (s, ctx) => s.access.homeCard(ctx));
      if (!chris.ok) throw new Error(chris.code);
      expect(chris.request).toMatchObject({
        teamName: "Coral Offers",
        role: "author",
        adminId: "alex",
      });
      expect(chris.people.map((p) => p.id)).toEqual(["alex"]);

      const morgan = await read("morgan", (s, ctx) => s.access.homeCard(ctx));
      expect(morgan).toEqual({ ok: true, request: null, people: [] });
    });

    it("a Team Admin's card counts the requests they may decide; nobody else has one", async () => {
      h.setClock(days(1));
      const alex = await read("alex", (s, ctx) => s.access.sidebarCards(ctx));
      if (!alex.ok) throw new Error(alex.code);
      expect(alex.asOf).toBe(days(1).toISOString());
      expect(alex.cards).toEqual([
        {
          kind: "access_requests",
          teamId: CORAL,
          teamSlug: "coral-offers",
          newestRequestId: expect.any(String),
          count: 1,
          requesterId: "chris",
          role: "author",
        },
      ]);
      expect(alex.people.map((p) => p.id)).toEqual(["chris"]);

      for (const who of ["jordan", "riley", "taylor", "morgan"]) {
        const none = await read(who, (s, ctx) => s.access.sidebarCards(ctx));
        expect(none, who).toMatchObject({ ok: true, cards: [] });
      }
    });
  });

  describe("access.members", () => {
    it("lists the team's memberships, active first and by name, with what the viewer may do on each", async () => {
      const members = await membersOf("alex");
      if (!members.ok) throw new Error(members.code);
      expect(members.asOf).toBe(base.toISOString());
      expect(members.team).toEqual({
        id: CORAL,
        slug: "coral-offers",
        name: "Coral Offers",
      });
      expect(members.rows.map((r) => r.userId)).toEqual([
        "alex",
        "dana",
        "devon",
        "jordan",
        "maya",
        "priya",
        "sam",
      ]);
      // Nobody changes their own access; the reason is the permission's.
      const own = { ok: false, code: REASONS.ownAccess.code };
      const alex = members.rows[0]!;
      expect(alex.can).toMatchObject({
        editRoles: own,
        remove: own,
        reinstate: own,
      });
      const maya = members.rows.find((r) => r.userId === "maya")!;
      expect(maya).toMatchObject({
        roles: ["author"],
        status: "active",
        statusReason: null,
        title: expect.any(String),
        email: expect.stringContaining("@"),
        addedAt: expect.stringMatching(/Z$/),
      });
      expect(maya.can).toMatchObject({
        editRoles: OK,
        remove: OK,
        reinstate: {
          ok: false,
          code: ACCESS_REFUSALS.alreadyActive.code,
        },
      });
      expect(members.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(members.rows.map((r) => r.userId)),
      );
    });

    it("answers as of the backend's clock: it names the instant it decided at", async () => {
      h.setClock(days(10));
      const members = await membersOf("alex");
      if (!members.ok) throw new Error(members.code);
      expect(members.asOf).toBe(days(10).toISOString());
    });
  });

  describe("access.requests", () => {
    it("lists the pending requests oldest first, each with whether the viewer may decide it", async () => {
      const requests = await requestsOf("alex");
      if (!requests.ok) throw new Error(requests.code);
      expect(requests.asOf).toBe(base.toISOString());
      expect(requests.pending.map((r) => [r.userId, r.role, r.can])).toEqual([
        ["chris", "author", { decide: OK }],
      ]);
      expect(requests.decided).toEqual([]);
      expect(requests.people.map((p) => p.id)).toContain("chris");
    });
  });

  describe("access.recertification", () => {
    it("shows the open review with its phase at the backend's clock, its progress and who may be decided", async () => {
      const recert = await recertOf("alex");
      if (!recert.ok) throw new Error(recert.code);
      const current = recert.current!;
      expect(current).toMatchObject({
        phase: "open",
        completedAt: null,
        progress: { total: 6, decided: 0, kept: 0, removed: 0, pending: 6 },
        lapsedIds: [],
      });
      expect(current.dueAt).toBe(days(30).toISOString());
      expect(current.items.map((i) => [i.userId, i.membership, i.can])).toEqual(
        ["dana", "devon", "jordan", "maya", "priya", "sam"].map((id) => [
          id,
          "active",
          { decide: OK },
        ]),
      );
      // A review is open: starting another is refused for that reason.
      expect(recert.can.start).toEqual({
        ok: false,
        code: ACCESS_REFUSALS.reviewOpen.code,
        reason: expect.any(String),
      });
    });

    it("closes the review when the deadline has come, whatever the sweep has written yet", async () => {
      h.setClock(days(31));
      const recert = await recertOf("alex");
      if (!recert.ok) throw new Error(recert.code);
      expect(recert.current).toMatchObject({ phase: "closed" });
      // Nobody can be decided in a closed review.
      expect(recert.current!.items.every((i) => !i.can.decide.ok)).toBe(true);
    });
  });

  describe("access.inactivity", () => {
    it("flags the member past 90 days with the day the suspension comes", async () => {
      const idle = await idleOf("alex");
      if (!idle.ok) throw new Error(idle.code);
      expect(idle.flagged).toHaveLength(1);
      const devon = idle.flagged[0]!;
      expect(devon).toMatchObject({
        userId: "devon",
        daysInactive: 95,
        heldAsLastAdmin: false,
        status: "active",
        can: {
          suspend: OK,
          keep: OK,
          reinstate: { ok: false, code: ACCESS_REFUSALS.alreadyActive.code },
        },
      });
      expect(devon.suspendsAt).toBe(days(25).toISOString());
      expect(idle.suspended).toEqual([]);
    });

    it("counts the days from the backend's clock", async () => {
      h.setClock(days(10));
      const idle = await idleOf("alex");
      if (!idle.ok) throw new Error(idle.code);
      expect(idle.asOf).toBe(days(10).toISOString());
      expect(idle.flagged[0]).toMatchObject({
        userId: "devon",
        daysInactive: 105,
      });
    });
  });

  describe("a Team section the viewer may not read", () => {
    const sections = Object.entries(SECTIONS);

    it("is refused 403 `generic` to anyone who isn't the team's Team Admin", async () => {
      for (const [name, section] of sections) {
        for (const who of ["maya", "jordan", "riley", "taylor"]) {
          expect(await section(who), `${who} ${name}`).toEqual({
            ok: false,
            status: 403,
            code: REASONS.generic.code,
            reason: REASONS.generic.reason,
          });
        }
        // Another team's Team Admin has no say here.
        expect(await section("alex", DEPOSITS), name).toMatchObject({
          ok: false,
          status: 403,
          code: REASONS.generic.code,
        });
      }
    });

    it("is refused 404 for a team that doesn't exist, and for a slug taken for an id", async () => {
      for (const [name, section] of sections) {
        for (const teamId of ["t_nowhere", "coral-offers"]) {
          expect(
            await section("alex", teamId),
            `${teamId} ${name}`,
          ).toMatchObject({
            ok: false,
            status: 404,
            code: REQUEST_REFUSALS.spaceUnavailable.code,
          });
        }
      }
    });
  });

  describe("platform.teams", () => {
    it("lists every team by name with its admins, its size and who its messages come from", async () => {
      const teams = await read("riley", (s, ctx) => s.platform.teams(ctx));
      if (!teams.ok) throw new Error(teams.code);
      expect(teams.teams.map((t) => [t.id, t.slug, t.adminIds])).toEqual([
        ["t_cards", "card-statements", ["hana"]],
        [CORAL, "coral-offers", ["alex"]],
        [DEPOSITS, "deposits", ["naomi"]],
      ]);
      const coral = teams.teams.find((t) => t.id === CORAL)!;
      expect(coral).toMatchObject({
        appName: "Coral",
        smsSender: "26725",
        members: 7,
        createdAt: expect.stringMatching(/Z$/),
      });
      expect(coral.templates).toBeGreaterThan(0);
      expect(teams.teams.find((t) => t.id === DEPOSITS)).toMatchObject({
        appName: "Deposits Online",
        smsSender: "33767",
      });
    });

    it("offers everyone but an Auditor as a new team's first Team Admin", async () => {
      const teams = await read("riley", (s, ctx) => s.platform.teams(ctx));
      if (!teams.ok) throw new Error(teams.code);
      const ids = teams.firstAdminCandidates.map((c) => c.id);
      expect(ids).toContain("alex");
      expect(ids).toContain("morgan");
      expect(ids).not.toContain("taylor");
      expect(teams.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(ids),
      );
    });
  });

  describe("platform.contentTypes", () => {
    it("lists each type's channels, sections and SMS settings, and why a message type's sections can't be edited", async () => {
      const result = await read("riley", (s, ctx) =>
        s.platform.contentTypes(ctx),
      );
      if (!result.ok) throw new Error(result.code);
      const alert = result.types.find((t) => t.key === "alert")!;
      expect(alert).toMatchObject({
        allowedChannels: ["push", "sms"],
        requiredSections: [],
        smsFooter: "Coral: Reply STOP to opt out, HELP for help.",
        smsMaxParts: 3,
        can: {
          editSections: {
            ok: false,
            code: PLATFORM_REFUSALS.noSections("Alert").code,
          },
        },
      });
      expect(result.types.find((t) => t.key === "disclosure")).toMatchObject({
        allowedChannels: ["pdf", "web", "email"],
        smsFooter: null,
        can: { editSections: OK },
      });
      const names = result.types.map((t) => t.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });
  });

  describe("platform.channelRules", () => {
    it("shows each switch decided: a channel of the other family can't go on", async () => {
      const result = await read("riley", (s, ctx) =>
        s.platform.channelRules(ctx),
      );
      if (!result.ok) throw new Error(result.code);
      const otherFamily = {
        ok: false,
        code: PLATFORM_REFUSALS.otherFamily("x", "document", []).code,
      };
      const disclosure = result.rows.find(
        (r) => r.contentTypeId === "ct_disclosure",
      )!;
      expect(disclosure.allowed).toEqual({
        pdf: true,
        web: true,
        email: true,
        push: false,
        sms: false,
      });
      expect(disclosure.can.toggle).toMatchObject({
        pdf: OK,
        web: OK,
        email: OK,
        push: otherFamily,
        sms: otherFamily,
      });
      expect(disclosure.activeUsing.push).toBe(0);
      expect(disclosure.activeUsing.pdf).toBeGreaterThan(0);

      const alert = result.rows.find((r) => r.contentTypeId === "ct_alert")!;
      expect(alert.allowed).toEqual({
        pdf: false,
        web: false,
        email: false,
        push: true,
        sms: true,
      });
      expect(alert.can.toggle).toMatchObject({
        pdf: otherFamily,
        web: otherFamily,
        email: otherFamily,
        push: OK,
        sms: OK,
      });
    });
  });

  describe("platform.approvalChains", () => {
    it("lists each content type's stages in order with the versions in review that still need each", async () => {
      const result = await read("riley", (s, ctx) =>
        s.platform.approvalChains(ctx),
      );
      if (!result.ok) throw new Error(result.code);
      const disclosure = result.chains.find(
        (c) => c.contentTypeId === "ct_disclosure",
      )!;
      expect(disclosure.stages.length).toBeGreaterThan(0);
      expect(disclosure.stages.map((s) => s.position)).toEqual(
        disclosure.stages.map((_, i) => i),
      );
      for (const s of disclosure.stages) {
        expect(s.waiting).toBeGreaterThanOrEqual(0);
        expect(s.rule).toMatchObject({ kind: expect.any(String) });
      }
    });

    it("offers the people a stage may name, never the admin choosing or an Auditor, and the facts to validate a chain", async () => {
      const result = await read("riley", (s, ctx) =>
        s.platform.approvalChains(ctx),
      );
      if (!result.ok) throw new Error(result.code);
      const choices = result.choices.map((c) => c.id);
      expect(choices).toContain("alex");
      expect(choices).not.toContain("riley");
      expect(choices).not.toContain("taylor");
      for (const c of result.choices)
        expect(c.teamNames, c.id).toEqual([...c.teamNames].sort());
      // Everyone a stage names now is in the facts, so the editor can validate the chain as it stands.
      const named = result.chains.flatMap((c) =>
        c.stages.flatMap((s) =>
          s.rule.kind === "user" ? [s.rule.userId] : [],
        ),
      );
      expect(result.approvers.map((a) => a.id)).toEqual(
        expect.arrayContaining([...choices, ...named]),
      );
      expect(result.approvers.find((a) => a.id === "riley")).toBeUndefined();
      expect(result.people.map((p) => p.id)).toEqual(
        expect.arrayContaining(choices),
      );
    });
  });

  describe("platform.businessZone", () => {
    it("names the zone in force and counts the sunsets already set that haven't passed, at the backend's clock", async () => {
      const zone = await read("riley", (s, ctx) =>
        s.platform.businessZone(ctx),
      );
      if (!zone.ok) throw new Error(zone.code);
      expect(zone).toMatchObject({
        asOf: base.toISOString(),
        zone: "America/New_York",
        can: { change: OK },
      });
      // Balance Transfer v1's sunset is set for October 25: still to come.
      expect(zone.pendingSunsets).toBeGreaterThanOrEqual(1);

      h.setClock(days(60));
      const later = await read("riley", (s, ctx) =>
        s.platform.businessZone(ctx),
      );
      if (!later.ok) throw new Error(later.code);
      expect(later.asOf).toBe(days(60).toISOString());
      expect(later.pendingSunsets).toBe(0);
    });
  });

  describe("a Platform section the viewer may not read", () => {
    it("is refused 403 `generic` to anyone but the Platform Admin", async () => {
      for (const who of ["alex", "taylor", "maya", "morgan"]) {
        const ctx = await h.as(who);
        const s = h.services().platform;
        for (const [name, answer] of [
          ["teams", await s.teams(ctx)],
          ["contentTypes", await s.contentTypes(ctx)],
          ["channelRules", await s.channelRules(ctx)],
          ["approvalChains", await s.approvalChains(ctx)],
          ["businessZone", await s.businessZone(ctx)],
        ] as const) {
          expect(answer, `${who} ${name}`).toEqual({
            ok: false,
            status: 403,
            code: REASONS.generic.code,
            reason: REASONS.generic.reason,
          });
        }
      }
    });
  });
}
