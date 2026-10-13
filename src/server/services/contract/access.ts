import { describe, expect, it } from "vitest";
import type { TeamRole, ViewerMembership } from "@/domain/types";
import { buildFixture } from "@/server/seed/fixture";
import type { StoredNotification } from "../notifications";
import type { ContractHarness } from "./harness";

// Team access, as every implementation must show it (AccessService in src/server/services/access.ts), from the
// seed: Alex is Coral Offers' only Team Admin (and an approver); Jordan approves there; Maya and Priya write; Sam,
// Devon and Dana view. Devon last signed in 95 days ago and is flagged for inactivity. Chris has a pending Author
// request on Coral Offers. Coral's quarterly review is open: Dana, Devon, Jordan, Maya, Priya and Sam, nobody
// decided. Naomi is the Deposits Team Admin; Morgan is on no team; Taylor is the Auditor.
//
// Each case sets the backend's clock and compares what the reads show before and after: the people's memberships
// (`identity.viewer`) and the bell (`notifications.list`). A refusal is checked by its code. The access commands'
// own sweep, the local implementation's lazy trigger, finds nothing to do minutes after the seed, so no case
// depends on it.

const CORAL = "t_coral";
const DEPOSITS = "t_deposits";

/** The seed's access ids a case names, read from the fixture every implementation loads (the Java API's too). */
export interface SeededAccess {
  /** The membership of `userId` on the team. */
  membership(userId: string, teamId?: string): string;
  /** The team's open recertification. */
  recert(teamId?: string): string;
  /** The pending request of `userId` on the team. */
  request(userId: string, teamId?: string): string;
}

let seeded: SeededAccess | undefined;

/** The ids are the fixture's: the same whatever moment it is loaded at. */
export function seededAccess(): SeededAccess {
  if (seeded) return seeded;
  const fixture = buildFixture();
  const rows = (name: string) =>
    fixture.tables.find((t) => t.name === name)?.rows ?? [];
  const find = (name: string, match: Record<string, unknown>): string => {
    const row = rows(name).find((r) =>
      Object.entries(match).every(([key, value]) => r[key] === value),
    );
    if (!row)
      throw new Error(`No seeded ${name} row ${JSON.stringify(match)}.`);
    return row.id as string;
  };
  seeded = {
    membership: (userId, teamId = CORAL) =>
      find("memberships", { user_id: userId, team_id: teamId }),
    recert: (teamId = CORAL) =>
      find("recertifications", { team_id: teamId, completed_at: null }),
    request: (userId, teamId = CORAL) =>
      find("access_requests", {
        user_id: userId,
        team_id: teamId,
        status: "pending",
      }),
  };
  return seeded;
}

/** The notifications in `after` that `before` didn't have (the bell lists newest first). */
export const told = (
  before: readonly StoredNotification[],
  after: readonly StoredNotification[],
) => after.filter((n) => !before.some((b) => b.id === n.id));

/** What a notification says, without its id, body and read state. */
export const gist = ({ kind, facts, link, createdAt }: StoredNotification) => ({
  kind,
  facts,
  link,
  createdAt,
});

export function accessContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);
  const ids = () => seededAccess();
  const access = () => h.services().access;

  /** Every notification `userId` has, newest first. */
  async function bell(userId: string): Promise<StoredNotification[]> {
    const list = await h
      .services()
      .notifications.list(await h.as(userId), { limit: 100 });
    if (!list.ok) throw new Error(list.code);
    return list.items;
  }

  /** The bells of these people, to compare before and after a command. */
  async function bells(...userIds: string[]) {
    return Object.fromEntries(
      await Promise.all(userIds.map(async (id) => [id, await bell(id)])),
    ) as Record<string, StoredNotification[]>;
  }

  /** `userId`'s membership on the team, as who they are says (undefined: none). */
  async function membershipOf(
    userId: string,
    teamId = CORAL,
  ): Promise<ViewerMembership | undefined> {
    return (await h.as(userId)).viewer.memberships.find(
      (m) => m.teamId === teamId,
    );
  }

  /** Who holds which roles on the team, by user id, as each of them reads it (active memberships only). */
  async function roles(teamId: string, userIds: string[]) {
    return Object.fromEntries(
      await Promise.all(
        userIds.map(async (id) => {
          const m = await membershipOf(id, teamId);
          return [id, m && m.status === "active" ? m.roles : null] as const;
        }),
      ),
    ) as Record<string, TeamRole[] | null>;
  }

  const nameOf = async (userId: string) => (await h.as(userId)).viewer.name;

  describe("access.requestAccess", () => {
    it("records Morgan's request for Author on Coral Offers and tells Alex, its Team Admin, with Morgan's reason", async () => {
      const before = await bells("alex", "morgan");
      h.setClock(minute(1));
      expect(
        await access().requestAccess(await h.as("morgan"), {
          teamId: CORAL,
          role: "author",
          reason: "  Drafting the spring offers.  ",
        }),
      ).toEqual({ ok: true, requestId: expect.any(String) });

      expect(told(before.alex!, await bell("alex"))).toEqual([
        {
          id: expect.any(String),
          kind: "access_requested",
          facts: {
            actorName: await nameOf("morgan"),
            teamName: "Coral Offers",
            role: "author",
          },
          link: { to: "settings", teamId: CORAL, section: "access-requests" },
          body: "Drafting the spring offers.",
          createdAt: minute(1).toISOString(),
          readAt: null,
        },
      ]);
      expect(await bell("morgan")).toEqual(before.morgan);
      // Asked, not granted.
      expect(await membershipOf("morgan")).toBeUndefined();
    });

    it("holds one pending request per person and team", async () => {
      h.setClock(minute(1));
      const morgan = await h.as("morgan");
      const ask = { teamId: CORAL, role: "viewer" as const, reason: "Read." };
      expect((await access().requestAccess(morgan, ask)).ok).toBe(true);
      h.setClock(minute(2));
      expect(await access().requestAccess(morgan, ask)).toMatchObject({
        ok: false,
        code: "request_pending",
      });
      // Another team is another request.
      expect(
        (await access().requestAccess(morgan, { ...ask, teamId: DEPOSITS })).ok,
      ).toBe(true);
    });

    it("refuses with the codes the interface lists, in its order, and writes nothing", async () => {
      const before = await bells("alex", "naomi");
      h.setClock(minute(1));
      const ask = async (
        userId: string,
        input: Partial<{ teamId: string; role: TeamRole; reason: string }>,
      ) => {
        const result = await access().requestAccess(await h.as(userId), {
          teamId: CORAL,
          role: "author",
          reason: "A reason.",
          ...input,
        });
        return result.ok ? "ok" : result.code;
      };
      // An Auditor holds no team role, so none can be asked for.
      expect(await ask("taylor", { role: "viewer" })).toBe("auditor_read_only");
      expect(await ask("morgan", { teamId: "t_nowhere" })).toBe("team_gone");
      expect(await ask("morgan", { role: "team_admin" })).toBe(
        "pick_requestable_role",
      );
      expect(await ask("morgan", { reason: "   " })).toBe(
        "request_reason_missing",
      );
      expect(await ask("morgan", { reason: "x".repeat(501) })).toBe(
        "request_reason_too_long",
      );
      expect(await ask("chris", {})).toBe("request_pending");
      expect(await ask("maya", {})).toBe("has_role");
      expect(await bells("alex", "naomi")).toEqual(before);
    });
  });

  describe("access.decideRequest", () => {
    it("approves Chris's request: Chris is an Author on Coral Offers, and is told; a second decision is refused", async () => {
      const requestId = ids().request("chris");
      const before = await bells("chris");
      h.setClock(minute(1));
      const alex = await h.as("alex");
      expect(
        await access().decideRequest(alex, { requestId, decision: "approve" }),
      ).toEqual({ ok: true });

      expect(await membershipOf("chris")).toMatchObject({
        status: "active",
        roles: ["author"],
      });
      expect(told(before.chris!, await bell("chris")).map(gist)).toEqual([
        {
          kind: "access_granted",
          facts: {
            actorName: alex.viewer.name,
            teamName: "Coral Offers",
            role: "author",
          },
          link: { to: "library", teamId: CORAL },
          createdAt: minute(1).toISOString(),
        },
      ]);

      h.setClock(minute(2));
      expect(
        await access().decideRequest(await h.as("alex"), {
          requestId,
          decision: "deny",
          note: "Changed my mind.",
        }),
      ).toMatchObject({ ok: false, code: "request_decided" });
      expect(await membershipOf("chris")).toMatchObject({ roles: ["author"] });
    });

    it("needs a note to deny, which Chris reads", async () => {
      const requestId = ids().request("chris");
      const before = await bells("chris");
      h.setClock(minute(1));
      const alex = await h.as("alex");
      expect(
        await access().decideRequest(alex, {
          requestId,
          decision: "deny",
          note: "  ",
        }),
      ).toMatchObject({ ok: false, code: "deny_note_missing" });
      expect(
        await access().decideRequest(alex, {
          requestId,
          decision: "deny",
          note: "Ask again in January.",
        }),
      ).toEqual({ ok: true });
      expect(told(before.chris!, await bell("chris"))).toEqual([
        expect.objectContaining({
          kind: "access_denied",
          facts: {
            actorName: alex.viewer.name,
            teamName: "Coral Offers",
            role: "author",
          },
          body: "Ask again in January.",
          link: { to: "request-access" },
        }),
      ]);
      expect(await membershipOf("chris")).toBeUndefined();
    });

    it("refuses a request that's gone, anyone but the team's Team Admin, and their own request; and writes nothing", async () => {
      const requestId = ids().request("chris");
      h.setClock(minute(1));
      const decide = async (userId: string, id = requestId) =>
        access().decideRequest(await h.as(userId), {
          requestId: id,
          decision: "approve",
        });
      expect(await decide("alex", "ar_nowhere")).toMatchObject({
        code: "request_gone",
      });
      expect(await decide("jordan")).toMatchObject({ code: "generic" });
      expect(await decide("naomi")).toMatchObject({ code: "generic" });
      expect(await decide("riley")).toMatchObject({ code: "generic" });

      // Alex asks Coral Offers for Author himself: another Team Admin would have to decide it.
      const own = await access().requestAccess(await h.as("alex"), {
        teamId: CORAL,
        role: "author",
        reason: "Drafting too.",
      });
      if (!own.ok) throw new Error(own.code);
      expect(await decide("alex", own.requestId)).toMatchObject({
        code: "own_request",
      });
      expect(await membershipOf("chris")).toBeUndefined();
      expect(await membershipOf("alex")).toMatchObject({
        roles: ["approver", "team_admin"],
      });
    });

    it("refuses request_decided, and writes nothing, when another Team Admin decides it between the command's read and its write", async () => {
      const requestId = ids().request("chris");
      const before = await bells("chris");
      h.setClock(minute(1));
      h.hooks({
        beforeCompareAndSet: (target) =>
          target.table === "access_requests" && target.id === requestId
            ? "competing_write"
            : undefined,
      });
      expect(
        await access().decideRequest(await h.as("alex"), {
          requestId,
          decision: "approve",
        }),
      ).toMatchObject({ ok: false, code: "request_decided" });
      h.hooks({});
      expect(await membershipOf("chris")).toBeUndefined();
      expect(await bells("chris")).toEqual(before);
      // The competing write was undone with the command: the request still waits.
      expect(
        await access().decideRequest(await h.as("alex"), {
          requestId,
          decision: "approve",
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("access.changeRoles", () => {
    it("changes Maya's roles and tells her; the roles she has change nothing", async () => {
      const membershipId = ids().membership("maya");
      const before = await bells("maya");
      h.setClock(minute(1));
      const alex = await h.as("alex");
      expect(
        await access().changeRoles(alex, {
          membershipId,
          roles: ["approver", "author"],
        }),
      ).toEqual({ ok: true, changed: true });
      expect(await membershipOf("maya")).toMatchObject({
        status: "active",
        roles: ["approver", "author"],
      });
      const after = await bell("maya");
      expect(told(before.maya!, after).map(gist)).toEqual([
        {
          kind: "roles_changed",
          facts: {
            actorName: alex.viewer.name,
            teamName: "Coral Offers",
            roles: ["author", "approver"],
          },
          link: { to: "library", teamId: CORAL },
          createdAt: minute(1).toISOString(),
        },
      ]);

      h.setClock(minute(2));
      expect(
        await access().changeRoles(await h.as("alex"), {
          membershipId,
          roles: ["author", "approver"],
        }),
      ).toEqual({ ok: true, changed: false });
      expect(await bell("maya")).toEqual(after);
    });

    it("refuses a membership that's gone, your own access, another team's Team Admin and no roles; and writes nothing", async () => {
      h.setClock(minute(1));
      const change = async (
        userId: string,
        membershipId: string,
        next: TeamRole[] = ["viewer"],
      ) =>
        access().changeRoles(await h.as(userId), {
          membershipId,
          roles: next,
        });
      expect(await change("alex", "m_nowhere")).toMatchObject({
        code: "no_longer_member",
      });
      expect(await change("alex", ids().membership("alex"))).toMatchObject({
        code: "own_access",
      });
      expect(await change("naomi", ids().membership("maya"))).toMatchObject({
        code: "generic",
      });
      expect(await change("jordan", ids().membership("maya"))).toMatchObject({
        code: "generic",
      });
      expect(await change("alex", ids().membership("maya"), [])).toMatchObject({
        code: "no_roles",
      });
      expect(await roles(CORAL, ["alex", "maya"])).toEqual({
        alex: ["approver", "team_admin"],
        maya: ["author"],
      });
    });
  });

  describe("the last Team Admin", () => {
    /** Alex has made Jordan a Team Admin too. */
    async function twoAdmins() {
      h.setClock(minute(1));
      expect(
        await access().changeRoles(await h.as("alex"), {
          membershipId: ids().membership("jordan"),
          roles: ["approver", "team_admin"],
        }),
      ).toEqual({ ok: true, changed: true });
    }

    /** Alex demoting Jordan commits between Jordan's read of the team and Jordan's write. */
    const alexDemotesJordanMeanwhile = () =>
      h.hooks({
        beforeCompareAndSet: (target) =>
          target.table === "memberships" &&
          target.id === ids().membership("alex")
            ? "competing_write"
            : undefined,
      });

    it("lets one of two Team Admins demote the other", async () => {
      await twoAdmins();
      h.setClock(minute(2));
      expect(
        await access().changeRoles(await h.as("jordan"), {
          membershipId: ids().membership("alex"),
          roles: ["approver"],
        }),
      ).toEqual({ ok: true, changed: true });
      expect(await roles(CORAL, ["alex", "jordan"])).toEqual({
        alex: ["approver"],
        jordan: ["approver", "team_admin"],
      });
    });

    it("refuses last_admin, and writes nothing, when two Team Admins demote each other at once", async () => {
      await twoAdmins();
      const before = await bells("alex", "jordan");
      h.setClock(minute(2));
      alexDemotesJordanMeanwhile();
      const jordan = await h.as("jordan");
      expect(
        await access().changeRoles(jordan, {
          membershipId: ids().membership("alex"),
          roles: ["approver"],
        }),
      ).toMatchObject({ ok: false, code: "last_admin" });
      expect(
        await access().removeMember(jordan, {
          membershipId: ids().membership("alex"),
        }),
      ).toMatchObject({ ok: false, code: "last_admin" });
      h.hooks({});
      // Both are Team Admins still: the refused command undid the competing write with its own.
      expect(await roles(CORAL, ["alex", "jordan"])).toEqual({
        alex: ["approver", "team_admin"],
        jordan: ["approver", "team_admin"],
      });
      expect(await bells("alex", "jordan")).toEqual(before);
    });
  });

  describe("access.removeMember", () => {
    it("removes Sam: the membership is gone, and Sam is told; removing him again is refused", async () => {
      const membershipId = ids().membership("sam");
      const before = await bells("sam");
      h.setClock(minute(1));
      const alex = await h.as("alex");
      expect(await access().removeMember(alex, { membershipId })).toEqual({
        ok: true,
      });
      expect(await membershipOf("sam")).toBeUndefined();
      expect(told(before.sam!, await bell("sam")).map(gist)).toEqual([
        {
          kind: "access_removed",
          facts: { actorName: alex.viewer.name, teamName: "Coral Offers" },
          link: { to: "request-access" },
          createdAt: minute(1).toISOString(),
        },
      ]);
      h.setClock(minute(2));
      expect(
        await access().removeMember(await h.as("alex"), { membershipId }),
      ).toMatchObject({ ok: false, code: "no_longer_member" });
    });
  });

  describe("inactivity", () => {
    it("suspends flagged Devon and tells him, then reinstates him with his roles", async () => {
      const membershipId = ids().membership("devon");
      const before = await bells("devon");
      h.setClock(minute(1));
      expect(
        await access().suspendInactive(await h.as("alex"), { membershipId }),
      ).toEqual({ ok: true });
      expect(await membershipOf("devon")).toMatchObject({
        status: "suspended",
        roles: ["viewer"],
      });
      expect(
        told(before.devon!, await bell("devon")).map((n) => n.kind),
      ).toEqual(["access_suspended"]);

      h.setClock(minute(2));
      expect(
        await access().reinstateMember(await h.as("alex"), { membershipId }),
      ).toEqual({ ok: true });
      expect(await membershipOf("devon")).toMatchObject({
        status: "active",
        roles: ["viewer"],
      });
      expect(
        await access().reinstateMember(await h.as("alex"), { membershipId }),
      ).toMatchObject({ ok: false, code: "membership_already_active" });
      // A fresh inactivity clock: he can't be suspended for inactivity now.
      expect(
        await access().suspendInactive(await h.as("alex"), { membershipId }),
      ).toMatchObject({ ok: false, code: "not_inactive" });
    });

    it("keeps flagged Devon: his inactivity clock restarts, so he can't be suspended now", async () => {
      const membershipId = ids().membership("devon");
      h.setClock(minute(1));
      const alex = await h.as("alex");
      expect(await access().keepInactive(alex, { membershipId })).toEqual({
        ok: true,
      });
      expect(
        await access().suspendInactive(alex, { membershipId }),
      ).toMatchObject({ ok: false, code: "not_inactive" });
      expect(await membershipOf("devon")).toMatchObject({ status: "active" });
    });

    it("refuses to suspend or keep someone who signed in recently", async () => {
      const membershipId = ids().membership("maya");
      h.setClock(minute(1));
      const alex = await h.as("alex");
      expect(
        await access().suspendInactive(alex, { membershipId }),
      ).toMatchObject({ ok: false, code: "not_inactive" });
      expect(await access().keepInactive(alex, { membershipId })).toMatchObject(
        { ok: false, code: "not_inactive" },
      );
    });
  });

  describe("recertification", () => {
    const decide = async (
      userId: string,
      decision: "keep" | "remove",
      by = "alex",
    ) =>
      access().decideRecertItem(await h.as(by), {
        recertId: ids().recert(),
        userId,
        decision,
      });

    it("keeps Jordan, removes Priya (her access ends at once, and she's told), and refuses a second decision", async () => {
      const before = await bells("priya");
      h.setClock(minute(1));
      expect(await decide("jordan", "keep")).toEqual({ ok: true });
      expect(await decide("priya", "remove")).toEqual({ ok: true });
      expect(await membershipOf("jordan")).toMatchObject({ status: "active" });
      expect(await membershipOf("priya")).toBeUndefined();
      // Her Deposits access is another team's.
      expect(await membershipOf("priya", DEPOSITS)).toMatchObject({
        status: "active",
      });
      expect(
        told(before.priya!, await bell("priya")).map((n) => n.kind),
      ).toEqual(["access_removed"]);
      h.setClock(minute(2));
      expect(await decide("jordan", "remove")).toMatchObject({
        ok: false,
        code: "already_recertified",
      });
      expect(await membershipOf("jordan")).toMatchObject({ status: "active" });
    });

    it("refuses a review that's gone, your own item, someone outside the review, and anyone but its team's Team Admin", async () => {
      h.setClock(minute(1));
      expect(
        await access().decideRecertItem(await h.as("alex"), {
          recertId: "rc_nowhere",
          userId: "sam",
          decision: "keep",
        }),
      ).toMatchObject({ code: "review_gone" });
      expect(await decide("alex", "keep")).toMatchObject({
        code: "own_access",
      });
      expect(await decide("morgan", "keep")).toMatchObject({
        code: "not_in_recert",
      });
      expect(await decide("sam", "keep", "jordan")).toMatchObject({
        code: "generic",
      });
      expect(await decide("sam", "keep", "naomi")).toMatchObject({
        code: "generic",
      });
    });

    it("refuses already_recertified, and writes nothing, when another decision on the item lands between the command's read and its write", async () => {
      h.setClock(minute(1));
      const item = `${ids().recert()}:priya`;
      h.hooks({
        beforeCompareAndSet: (target) =>
          target.table === "recert_items" && target.id === item
            ? "competing_write"
            : undefined,
      });
      expect(await decide("priya", "remove")).toMatchObject({
        ok: false,
        code: "already_recertified",
      });
      h.hooks({});
      expect(await membershipOf("priya")).toMatchObject({ status: "active" });
      // The item still waits for its decision.
      expect(await decide("priya", "keep")).toEqual({ ok: true });
    });

    it("starts one review at a time; the last decision closes the open one, and a new one covers the members left", async () => {
      h.setClock(minute(1));
      expect(
        await access().startRecertification(await h.as("alex"), {
          teamId: CORAL,
        }),
      ).toMatchObject({ ok: false, code: "recert_open" });
      for (const userId of ["dana", "devon", "jordan", "maya", "sam"])
        expect(await decide(userId, "keep")).toEqual({ ok: true });
      expect(await decide("priya", "remove")).toEqual({ ok: true });
      // Closed early: nothing more to decide.
      expect(await decide("sam", "remove")).toMatchObject({
        code: "recert_closed",
      });

      h.setClock(minute(2));
      const before = await bells("jordan");
      const started = await access().startRecertification(await h.as("alex"), {
        teamId: CORAL,
      });
      expect(started).toEqual({ ok: true, recertId: expect.any(String) });
      if (!started.ok) return;
      expect(started.recertId).not.toBe(ids().recert());
      // Priya left the team, so the new review doesn't cover her; Jordan is in it.
      expect(
        await access().decideRecertItem(await h.as("alex"), {
          recertId: started.recertId,
          userId: "priya",
          decision: "keep",
        }),
      ).toMatchObject({ code: "not_in_recert" });
      expect(
        await access().decideRecertItem(await h.as("alex"), {
          recertId: started.recertId,
          userId: "jordan",
          decision: "keep",
        }),
      ).toEqual({ ok: true });
      // Only the other Team Admins are told a review started: Coral has none but Alex.
      expect(await bell("jordan")).toEqual(before.jordan);
    });

    it("refuses anyone but the team's Team Admin a new review, a Platform Admin included", async () => {
      h.setClock(minute(1));
      expect(
        await access().startRecertification(await h.as("naomi"), {
          teamId: CORAL,
        }),
      ).toMatchObject({ code: "generic" });
      expect(
        await access().startRecertification(await h.as("riley"), {
          teamId: CORAL,
        }),
      ).toMatchObject({ code: "generic" });
    });
  });
}
