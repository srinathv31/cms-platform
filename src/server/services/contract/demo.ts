import { describe, expect, it } from "vitest";
import { seededAccess } from "./access";
import type { ContractHarness } from "./harness";

// The demo tools, as every implementation with demo support must show them (DemoService in
// src/server/services/demo.ts; the local implementation's runner turns its demo flag on). From the seed: nine
// personas; the clock at offset 0; Coral Offers' review due in 30 days, nobody decided; Dana last signed in 9 days
// ago. The reset drops and reseeds the data, so it is the local implementation's own test, not a case here.
//
// Each case sets the backend's clock, acts through the services, and compares what the reads show before and
// after. A refusal is checked by its code.

const DAY = 86_400_000;
const PERSONAS = [
  "maya",
  "jordan",
  "alex",
  "priya",
  "sam",
  "riley",
  "taylor",
  "morgan",
  "dana",
];

export function demoContract(h: ContractHarness, base: Date) {
  const day = (n: number) => new Date(base.getTime() + n * DAY);
  const demo = () => h.services().demo;

  async function readout() {
    const result = await demo().clockReadout(await h.as("maya"));
    if (!result.ok) throw new Error(result.code);
    return { offsetDays: result.offsetDays, asOf: result.asOf };
  }

  describe("demo.personas", () => {
    it("lists the switcher's personas in the seed's order, each with the teams they're active on and their roles", async () => {
      const result = await demo().personas(await h.as("maya"));
      if (!result.ok) throw new Error(result.code);
      expect(result.personas.map((p) => p.id)).toEqual(PERSONAS);
      const by = (id: string) => result.personas.find((p) => p.id === id)!;
      expect(by("maya")).toEqual({
        id: "maya",
        name: (await h.as("maya")).viewer.name,
        initials: (await h.as("maya")).viewer.initials,
        hue: expect.any(Number),
        platformRole: null,
        teams: [
          { teamId: "t_coral", teamName: "Coral Offers", roles: ["author"] },
        ],
      });
      // By team name; roles from least to most authority.
      expect(by("priya").teams).toEqual([
        { teamId: "t_coral", teamName: "Coral Offers", roles: ["author"] },
        { teamId: "t_deposits", teamName: "Deposits", roles: ["viewer"] },
      ]);
      expect(by("alex").teams).toEqual([
        {
          teamId: "t_coral",
          teamName: "Coral Offers",
          roles: ["approver", "team_admin"],
        },
      ]);
      expect(by("riley")).toMatchObject({
        platformRole: "platform_admin",
        teams: [],
      });
      expect(by("morgan")).toMatchObject({ platformRole: null, teams: [] });
    });

    it("leaves out a team whose access ended", async () => {
      h.setClock(day(0));
      expect(
        await h.services().access.removeMember(await h.as("alex"), {
          membershipId: seededAccess().membership("priya"),
        }),
      ).toEqual({ ok: true });
      const result = await demo().personas(await h.as("maya"));
      if (!result.ok) throw new Error(result.code);
      expect(result.personas.find((p) => p.id === "priya")!.teams).toEqual([
        { teamId: "t_deposits", teamName: "Deposits", roles: ["viewer"] },
      ]);
    });
  });

  describe("demo.advanceClock", () => {
    it("moves the clock by whole days, as the readout shows, and refuses days it can't use", async () => {
      h.setClock(base);
      expect(await readout()).toEqual({
        offsetDays: 0,
        asOf: base.toISOString(),
      });
      const maya = await h.as("maya");
      expect(await demo().advanceClock(maya, { days: 7 })).toEqual({
        ok: true,
        offsetDays: 7,
      });
      expect(await demo().advanceClock(maya, { days: 3 })).toEqual({
        ok: true,
        offsetDays: 10,
      });
      for (const days of [0, -1, 1.5, 3651])
        expect(await demo().advanceClock(maya, { days })).toMatchObject({
          ok: false,
          code: "invalid_input",
        });
      expect((await readout()).offsetDays).toBe(10);
    });

    it("runs the scheduled jobs at the clock it moved to: a deadline the move crossed takes effect", async () => {
      // The backend's clock, past the review's deadline (in the demo, the move puts it there).
      h.setClock(day(31));
      expect(
        (await demo().advanceClock(await h.as("riley"), { days: 31 })).ok,
      ).toBe(true);
      const sam = await h.as("sam");
      expect(
        sam.viewer.memberships.find((m) => m.teamId === "t_coral"),
      ).toMatchObject({ status: "lapsed" });
    });
  });

  describe("demo.switchPersona", () => {
    const land = async (userId: string, slug: string | null) =>
      demo().switchPersona(await h.as("maya"), { userId, slug });

    it("lands a persona in the space the URL names when they may enter it, else names their first space", async () => {
      h.setClock(day(0));
      expect(await land("jordan", "coral-offers")).toMatchObject({
        ok: true,
        space: { teamId: "t_coral", slug: "coral-offers" },
        homeSlug: "coral-offers",
      });
      expect(await land("jordan", "deposits")).toEqual({
        ok: true,
        space: null,
        homeSlug: "coral-offers",
      });
      expect(await land("jordan", "nowhere")).toEqual({
        ok: true,
        space: null,
        homeSlug: "coral-offers",
      });
      expect(await land("jordan", null)).toEqual({
        ok: true,
        space: null,
        homeSlug: "coral-offers",
      });
      // A platform role enters every team, and All teams first.
      expect(await land("riley", "deposits")).toMatchObject({
        space: { teamId: "t_deposits" },
        homeSlug: "all",
      });
      // No team yet: nowhere to land, so they ask for access.
      expect(await land("morgan", "coral-offers")).toEqual({
        ok: true,
        space: null,
        homeSlug: null,
      });
    });

    it("refuses anyone who isn't a persona, and stamps no sign-in", async () => {
      h.setClock(day(0));
      for (const userId of ["chris", "naomi", "nobody"])
        expect(await land(userId, null)).toMatchObject({
          ok: false,
          code: "invalid_input",
        });
    });

    it("runs the scheduled jobs first: a member past a deadline lands without that team", async () => {
      h.setClock(day(31));
      // Nobody confirmed Sam by the review's deadline (day 30).
      expect(await land("sam", "coral-offers")).toEqual({
        ok: true,
        space: null,
        homeSlug: null,
      });
      expect(
        (await h.as("sam")).viewer.memberships.find(
          (m) => m.teamId === "t_coral",
        ),
      ).toMatchObject({ status: "lapsed" });
    });

    it("stamps the persona's sign-in: their inactivity clock restarts", async () => {
      // Alex keeps Dana in the review, so the deadline leaves her active.
      h.setClock(day(0));
      expect(
        await h.services().access.decideRecertItem(await h.as("alex"), {
          recertId: seededAccess().recert(),
          userId: "dana",
          decision: "keep",
        }),
      ).toEqual({ ok: true });
      // Day 85: 94 days since Dana last signed in.
      h.setClock(day(85));
      expect((await land("dana", "coral-offers")).ok).toBe(true);
      expect(
        await h.services().access.suspendInactive(await h.as("alex"), {
          membershipId: seededAccess().membership("dana"),
        }),
      ).toMatchObject({ ok: false, code: "not_inactive" });
    });

    it("without the switch, the same idle persona is flagged and can be suspended", async () => {
      h.setClock(day(0));
      expect(
        await h.services().access.decideRecertItem(await h.as("alex"), {
          recertId: seededAccess().recert(),
          userId: "dana",
          decision: "keep",
        }),
      ).toEqual({ ok: true });
      h.setClock(day(85));
      await h.runScheduledJobs(day(85));
      expect(
        await h.services().access.suspendInactive(await h.as("alex"), {
          membershipId: seededAccess().membership("dana"),
        }),
      ).toEqual({ ok: true });
    });
  });
}
