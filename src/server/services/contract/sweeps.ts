import { describe, expect, it } from "vitest";
import type { MembershipStatus } from "@/domain/types";
import type { StoredNotification } from "../notifications";
import { seededAccess, told } from "./access";
import type { ContractHarness } from "./harness";

// The backend's scheduled jobs, as every implementation must run them (`runScheduledJobs`: the access sweep, then
// the sunset sweep; the sunset's cases are with the review contract). From the seed: Coral Offers' review started 4
// days ago and is due in 30 days; it covers Dana, Devon, Jordan, Maya, Priya and Sam, nobody decided yet. Devon last
// signed in 95 days ago (flagged 5 days ago), so his 120-day suspension falls 25 days after the seed; Dana last
// signed in 9 days ago. Alex, Naomi and Hana are their teams' only Team Admins.
//
// A job applies every deadline its instant has crossed since the last run, dated when the deadline fell due, and
// a second run writes nothing. The cases see what it did through the people's memberships (`identity.viewer`) and
// the bell (`notifications.list`), whose notifications carry the deadline as their time.

const CORAL = "t_coral";
const DAY = 86_400_000;

export function sweepsContract(h: ContractHarness, base: Date) {
  const day = (n: number) => new Date(base.getTime() + n * DAY);

  async function bell(userId: string): Promise<StoredNotification[]> {
    const list = await h
      .services()
      .notifications.list(await h.as(userId), { limit: 100 });
    if (!list.ok) throw new Error(list.code);
    return list.items;
  }

  /** Each person's membership status on the team (null: none). */
  async function statuses(teamId: string, userIds: string[]) {
    return Object.fromEntries(
      await Promise.all(
        userIds.map(async (id) => [
          id,
          (await h.as(id)).viewer.memberships.find((m) => m.teamId === teamId)
            ?.status ?? null,
        ]),
      ),
    ) as Record<string, MembershipStatus | null>;
  }

  /** What everyone the jobs can reach sees: memberships and bells. */
  async function world() {
    const people = ["alex", "dana", "devon", "jordan", "maya", "priya", "sam"];
    return {
      coral: await statuses(CORAL, people),
      bells: await Promise.all([...people, "riley", "naomi", "hana"].map(bell)),
    };
  }

  /** Alex confirms everyone in the review but Sam, on day 16. */
  async function alexKeepsAllButSam() {
    h.setClock(day(16));
    const alex = await h.as("alex");
    for (const userId of ["dana", "devon", "jordan", "maya", "priya"])
      expect(
        await h.services().access.decideRecertItem(alex, {
          recertId: seededAccess().recert(),
          userId,
          decision: "keep",
        }),
      ).toEqual({ ok: true });
  }

  describe("the access deadlines", () => {
    it("find nothing to do at the seed's moment, nor 15 days on before any deadline", async () => {
      const before = await world();
      await h.runScheduledJobs(base);
      expect(await world()).toEqual(before);
      await h.runScheduledJobs(day(15));
      expect(await world()).toEqual(before);
    });

    it("31 days on: Devon suspended at day 25, Sam lapsed at the review's deadline, each told then, and the review closed", async () => {
      await alexKeepsAllButSam();
      const before = {
        alex: await bell("alex"),
        devon: await bell("devon"),
        sam: await bell("sam"),
      };
      await h.runScheduledJobs(day(31));

      expect(
        await statuses(CORAL, [
          "alex",
          "dana",
          "devon",
          "jordan",
          "maya",
          "priya",
          "sam",
        ]),
      ).toEqual({
        alex: "active",
        dana: "active",
        devon: "suspended",
        jordan: "active",
        maya: "active",
        priya: "active",
        sam: "lapsed",
      });
      const suspendAt = day(25).toISOString(); // 95 days idle at the seed + 25 = 120
      const dueAt = day(30).toISOString();
      const gist = (n: StoredNotification) => [n.kind, n.link, n.createdAt];
      expect(told(before.devon, await bell("devon")).map(gist)).toEqual([
        ["access_suspended", { to: "request-access" }, suspendAt],
      ]);
      expect(told(before.sam, await bell("sam")).map(gist)).toEqual([
        ["access_lapsed", { to: "request-access" }, dueAt],
      ]);
      // The Team Admin is told too, with a link to the team's settings by its id; newest first.
      expect(told(before.alex, await bell("alex")).map(gist)).toEqual([
        [
          "access_lapsed",
          { to: "settings", teamId: CORAL, section: "recertification" },
          dueAt,
        ],
        [
          "access_suspended",
          { to: "settings", teamId: CORAL, section: "inactivity" },
          suspendAt,
        ],
      ]);
      // The review closed at its deadline: a new one may start.
      expect(
        await h
          .services()
          .access.startRecertification(await h.as("alex"), { teamId: CORAL }),
      ).toEqual({ ok: true, recertId: expect.any(String) });
    });

    it("apply each deadline once: a second run, then or later, writes nothing", async () => {
      await alexKeepsAllButSam();
      await h.runScheduledJobs(day(31));
      const after = await world();
      await h.runScheduledJobs(day(31));
      expect(await world()).toEqual(after);
      await h.runScheduledJobs(day(32));
      expect(await world()).toEqual(after);
    });

    it("flag a newly idle member once, at their 90th day, and tell the Team Admins", async () => {
      await alexKeepsAllButSam();
      await h.runScheduledJobs(day(31));
      const before = await bell("alex");
      // Dana last signed in 9 days before the seed: day 81 is her 90th day.
      await h.runScheduledJobs(day(82));
      const flagged = told(before, await bell("alex")).filter(
        (n) => n.kind === "inactivity_flagged",
      );
      expect(flagged.map((n) => [n.facts.userId, n.createdAt])).toEqual([
        ["dana", day(81).toISOString()],
      ]);
      expect((await statuses(CORAL, ["dana"])).dana).toBe("active");
      const once = await bell("alex");
      await h.runScheduledJobs(day(83));
      expect(await bell("alex")).toEqual(once);
    });

    it("in one 31-day jump with nobody confirmed: everyone in the review lapses at its deadline, but Devon's earlier suspension wins", async () => {
      await h.runScheduledJobs(day(31));
      expect(
        await statuses(CORAL, [
          "alex",
          "dana",
          "devon",
          "jordan",
          "maya",
          "priya",
          "sam",
        ]),
      ).toEqual({
        alex: "active",
        dana: "lapsed",
        devon: "suspended",
        jordan: "lapsed",
        maya: "lapsed",
        priya: "lapsed",
        sam: "lapsed",
      });
      expect(
        (await bell("jordan"))
          .filter((n) => n.kind === "access_lapsed")
          .map((n) => n.createdAt),
      ).toEqual([day(30).toISOString()]);
    });

    it("never leave a team without a Team Admin: 130 days on with nobody signing in, each team's only one stays and Riley is told", async () => {
      const before = await bell("riley");
      await h.runScheduledJobs(day(130));
      for (const [admin, teamId] of [
        ["alex", "t_coral"],
        ["naomi", "t_deposits"],
        ["hana", "t_cards"],
      ] as const)
        expect((await statuses(teamId, [admin]))[admin]).toBe("active");
      expect((await statuses(CORAL, ["jordan"])).jordan).not.toBe("active");
      const kept = told(before, await bell("riley")).filter(
        (n) => n.link.to === "platform",
      );
      expect(new Set(kept.map((n) => n.facts.teamName))).toEqual(
        new Set(["Card Statements", "Coral Offers", "Deposits"]),
      );
      expect(kept).toHaveLength(3);
      for (const n of kept)
        expect(n).toMatchObject({
          link: { to: "platform", section: "teams" },
          facts: { keptLastAdmin: true },
        });
      const after = await world();
      await h.runScheduledJobs(day(130));
      expect(await world()).toEqual(after);
    });
  });

  // Balance Transfer v1 is Superseded under an Active v2, with the seed's one sunset 21 days after the seed, at
  // 00:00 Eastern; Coral renders the template. (Recording it once, dated at the sunset, is the review contract's.)
  describe("the passed sunsets", () => {
    const templateId = () => h.templates["balance-transfer"]!;

    /** Balance Transfer's versions, as the Versions read shows them at the seed's moment. */
    async function history() {
      h.setClock(base);
      const read = await h
        .services()
        .versions.history(await h.as("jordan"), { templateId: templateId() });
      if (!read.ok) throw new Error(read.code);
      return read;
    }

    async function sunsetOf() {
      const v1 = (await history()).versions.find(
        (v) => v.number === 1 && v.head,
      )!;
      return new Date(v1.sunsetAt!);
    }

    const passedNotices = async () =>
      (await h.consumerNotices("coral", templateId())).filter(
        (n) => n.kind === "sunset_passed",
      );

    it("find nothing before the sunset, up to the millisecond before it", async () => {
      const sunset = await sunsetOf();
      await h.runScheduledJobs(base);
      await h.runScheduledJobs(new Date(sunset.getTime() - 1));
      expect(await passedNotices()).toEqual([]);
      await h.runScheduledJobs(sunset);
      expect(await passedNotices()).toHaveLength(1);
    });

    it("run long after the sunset: Coral is told then, and the notice says when renders stopped", async () => {
      const sunset = await sunsetOf();
      await h.runScheduledJobs(day(200));
      expect(await passedNotices()).toEqual([
        expect.objectContaining({
          kind: "sunset_passed",
          createdAt: day(200).toISOString(),
          sunsetAt: sunset.toISOString(),
          versionNumber: 1,
          activeVersion: 2,
        }),
      ]);
    });

    it("run twice at once: Coral is told once", async () => {
      const sunset = await sunsetOf();
      const at = new Date(sunset.getTime() + DAY);
      await Promise.all([h.runScheduledJobs(at), h.runScheduledJobs(at)]);
      expect(await passedNotices()).toHaveLength(1);
    });

    it("change nothing on the version: whether it renders is the render rule's, swept or not", async () => {
      const before = await history();
      await h.runScheduledJobs(day(22));
      expect(await history()).toEqual(before);
    });
  });
}
