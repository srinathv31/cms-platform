import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_LIMIT,
  NO_AUDIT_SEARCH,
  SYSTEM_PERSON,
} from "@/domain/audit";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ApproverRule } from "@/domain/types";
import type { AuditEventFacts, AuditSearch } from "../audit";
import type { ActionResult } from "../types";
import { seededAccess } from "./access";
import type { ContractHarness } from "./harness";

// The Audit page and its export's rows, as every implementation must answer them (AuditService in
// src/server/services/audit.ts), from the seed with the backend's clock at its base instant: three teams (Coral
// Offers, Deposits, Card Statements), their memberships granted by Riley and the Team Admins, platform-wide
// configuration events (no team), Chris's pending request and Devon's inactivity flag. Facts only: the events as
// recorded, the filters narrowed to what the space knows, and the counts the menus list under every OTHER
// filter, all by team id (decision 0053); the BFF words the rest. Alex is Coral's Team Admin, Taylor the
// Auditor, Riley the Platform Admin, Maya an Author on Coral.
//
// These reads run on the local implementation only (the fake doesn't implement them: decision 0072). The last
// cases run the access and platform commands and diff the All teams log before and after each: the rows a command
// adds (what, by whom, on which team, with the details' facts), and none for a refused command or a setting saved
// as it is. A template's rows are the Activity tab's (`audit.activity`), held to both implementations by the review
// and comments contracts.

const CORAL = "t_coral";
const DEPOSITS = "t_deposits";
const DISCLOSURE = "ct_disclosure";
const TEAM_RULE: ApproverRule = { kind: "team_role", role: "approver" };
const DAY = 86_400_000;

/** An event as a case compares it: what it recorded, without its id. */
type Recorded = Pick<
  AuditEventFacts,
  "action" | "at" | "actorId" | "teamId" | "templateId" | "details"
>;

/** A command's answer as its code, or "ok". */
const codeOf = (result: ActionResult<object>) =>
  result.ok ? "ok" : result.code;

export function auditContract(h: ContractHarness, base: Date) {
  const search = (over: Partial<AuditSearch> = {}): AuditSearch => ({
    ...NO_AUDIT_SEARCH,
    ...over,
  });

  /** The page of a space as `asking` reads it. */
  async function page(
    asking: string,
    teamId: string | null,
    over: Partial<AuditSearch> = {},
  ) {
    const result = await h
      .services()
      .audit.page(await h.as(asking), { teamId, search: search(over) });
    if (!result.ok) throw new Error(`${result.status} ${result.code}`);
    return result;
  }

  describe("audit.page: who sees what", () => {
    it("shows the Auditor every team's events and the platform-wide ones in All teams, newest first", async () => {
      const all = await page("taylor", null);
      expect(all.asOf).toBe(base.toISOString());
      expect(all.teams.map((t) => [t.id, t.slug])).toEqual([
        ["t_cards", "card-statements"],
        [CORAL, "coral-offers"],
        [DEPOSITS, "deposits"],
      ]);
      expect(new Set(all.events.map((e) => e.teamId))).toEqual(
        new Set([CORAL, DEPOSITS, "t_cards", null]),
      );
      expect(all.total).toBe(all.events.length);
      expect(all.events.length).toBeLessThanOrEqual(AUDIT_PAGE_LIMIT);
      const times = all.events.map((e) => e.at);
      expect(times).toEqual([...times].sort().reverse());
      expect(all.applied).toEqual(NO_AUDIT_SEARCH);
      // The menus list every team, the three categories, and the system among the people.
      expect(all.options.teams.map((t) => t.id)).toEqual(
        all.teams.map((t) => t.id),
      );
      expect(all.options.categories.map((c) => c.category)).toEqual([
        "templates",
        "access",
        "platform",
      ]);
      expect(all.options.people.map((p) => p.id)).toContain(SYSTEM_PERSON);
      expect(all.people.map((p) => p.id)).not.toContain(SYSTEM_PERSON);
    });

    it("records an event as it happened: who did it (the system for a sweep), to what, with its details", async () => {
      const all = await page("taylor", null);
      const flagged = all.events.find(
        (e) => e.action === "access.flagged_inactive",
      )!;
      expect(flagged).toMatchObject({
        actorId: null,
        teamId: CORAL,
        details: expect.objectContaining({ userId: "devon" }),
        version: null,
      });
      const config = all.events.find(
        (e) => e.action === "platform.config_changed" && e.teamId === null,
      )!;
      expect(config.details).toMatchObject({ area: expect.any(String) });
      const submitted = all.events.find(
        (e) => e.action === "version.submitted",
      )!;
      expect(submitted).toMatchObject({
        templateId: expect.stringMatching(/^UC-/),
        templateName: expect.any(String),
        version: {
          number: expect.any(Number),
          round: expect.any(Number),
          state: expect.any(String),
        },
      });
      expect(submitted.at).toMatch(/Z$/);
    });

    it("pins a team space to its team, for the Auditor and for its Team Admin", async () => {
      for (const who of ["taylor", "alex"]) {
        const coral = await page(who, CORAL, { teamIds: [DEPOSITS] });
        expect(coral.events.length, who).toBeGreaterThan(0);
        expect(
          coral.events.every((e) => e.teamId === CORAL),
          who,
        ).toBe(true);
        expect(coral.applied.teamIds, who).toEqual([]);
        expect(coral.options.teams, who).toEqual([]);
        expect(
          coral.teams.map((t) => t.id),
          who,
        ).toEqual([CORAL]);
      }
    });

    it("refuses the viewer who may not read the log: 403 where the team is theirs to enter, 404 for a team that isn't there", async () => {
      const forbidden = {
        ok: false,
        status: 403,
        code: REASONS.generic.code,
      };
      const audit = h.services().audit;
      const asks: [string, string | null][] = [
        ["maya", CORAL], // an Author: no audit.view
        ["alex", null], // a Team Admin has no All teams
        ["alex", DEPOSITS], // another team's log
        ["morgan", CORAL],
      ];
      for (const [who, teamId] of asks) {
        const ctx = await h.as(who);
        expect(
          await audit.page(ctx, { teamId, search: search() }),
          `${who} ${teamId}`,
        ).toMatchObject(forbidden);
        expect(
          await audit.exportRows(ctx, { teamId, search: search() }),
          `${who} ${teamId}`,
        ).toMatchObject(forbidden);
      }
      const taylor = await h.as("taylor");
      for (const teamId of ["t_nowhere", "coral-offers"]) {
        const missing = {
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.spaceUnavailable.code,
        };
        expect(
          await audit.page(taylor, { teamId, search: search() }),
          teamId,
        ).toMatchObject(missing);
        expect(
          await audit.exportRows(taylor, { teamId, search: search() }),
          teamId,
        ).toMatchObject(missing);
      }
    });
  });

  describe("audit.page: filters and counts", () => {
    it("filters by team, person and category together, with counts under the other filters", async () => {
      const all = await page("taylor", null);
      const filtered = await page("taylor", null, {
        teamIds: [CORAL],
        personIds: ["alex"],
        actions: ["access"],
      });
      expect(filtered.events.length).toBeGreaterThan(0);
      for (const e of filtered.events) {
        expect(e.teamId).toBe(CORAL);
        expect(e.action).toMatch(/^(access|recert)\./);
        expect([
          e.actorId,
          (e.details as { userId?: string })?.userId,
        ]).toContain("alex");
      }
      expect(filtered.applied).toEqual(
        search({
          teamIds: [CORAL],
          personIds: ["alex"],
          actions: ["access"],
        }),
      );
      expect(filtered.total).toBeLessThan(all.total);
      // The person and category counts keep every other filter, so Alex and Access both count what is listed.
      expect(filtered.options.people.find((p) => p.id === "alex")!.count).toBe(
        filtered.total,
      );
      expect(
        filtered.options.categories.find((c) => c.category === "access")!.count,
      ).toBe(filtered.total);
      // The team counts ignore the team pick: Deposits still shows its own.
      const deposits = filtered.options.teams.find((t) => t.id === DEPOSITS)!;
      const depositsOnly = await page("taylor", null, {
        teamIds: [DEPOSITS],
        personIds: ["alex"],
        actions: ["access"],
      });
      expect(deposits.count).toBe(depositsOnly.total);
    });

    it("filters by template and by UTC day", async () => {
      const all = await page("taylor", null);
      const template = all.options.templates[0]!;
      const byTemplate = await page("taylor", null, {
        templateIds: [template.id],
      });
      expect(byTemplate.total).toBe(template.count);
      expect(byTemplate.events.every((e) => e.templateId === template.id)).toBe(
        true,
      );

      const today = base.toISOString().slice(0, 10);
      const onToday = await page("taylor", null, { from: today, to: today });
      expect(onToday.events.every((e) => e.at.startsWith(today))).toBe(true);
      const week = new Date(base.getTime() - 6 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const lastWeek = await page("taylor", null, { from: week, to: today });
      expect(lastWeek.total).toBeGreaterThanOrEqual(onToday.total);
      expect(lastWeek.total).toBeLessThan(all.total);
    });

    it("lists each template once by the name it has now, with its team", async () => {
      const all = await page("taylor", null);
      const ids = all.options.templates.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      const cashBack = all.options.templates.find(
        (t) => t.id === h.templates["cash-back"],
      )!;
      expect(cashBack).toMatchObject({
        name: expect.stringContaining("Cash Back"),
        teamId: CORAL,
        count: expect.any(Number),
      });
    });

    it("drops what the space doesn't know, so a chip never matches nothing", async () => {
      const dropped = await page("taylor", null, {
        teamIds: ["t_nowhere", DEPOSITS],
        personIds: ["nobody", "alex"],
        templateIds: ["UC-ZZZZZZ"],
      });
      expect(dropped.applied).toEqual(
        search({ teamIds: [DEPOSITS], personIds: ["alex"] }),
      );
    });

    it("answers as of the backend's clock", async () => {
      h.setClock(new Date(base.getTime() + 3_600_000));
      expect((await page("taylor", null)).asOf).toBe(
        new Date(base.getTime() + 3_600_000).toISOString(),
      );
    });
  });

  describe("audit.exportRows", () => {
    it("exports every event the search matches, the same as the page lists, with the people they name", async () => {
      const filter = { actions: ["access"] };
      const listed = await page("taylor", null, filter);
      const exported = await h
        .services()
        .audit.exportRows(await h.as("taylor"), {
          teamId: null,
          search: search(filter),
        });
      if (!exported.ok) throw new Error(exported.code);
      expect(exported.asOf).toBe(base.toISOString());
      expect(exported.events).toEqual(listed.events);
      expect(exported.events.length).toBe(listed.total);
      expect(exported.teams).toEqual(listed.teams);
      const named = new Set(
        exported.events.flatMap((e) => (e.actorId ? [e.actorId] : [])),
      );
      expect(exported.people.map((p) => p.id)).toEqual(
        expect.arrayContaining([...named]),
      );
    });

    it("lets a team's Team Admin export the team's log, and the Platform Admin any team's", async () => {
      const own = await h.services().audit.exportRows(await h.as("alex"), {
        teamId: CORAL,
        search: search(),
      });
      expect(own.ok).toBe(true);
      const riley = await h.services().audit.exportRows(await h.as("riley"), {
        teamId: DEPOSITS,
        search: search(),
      });
      expect(riley.ok).toBe(true);
    });
  });

  // ── The rows the access and platform commands write ──

  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  /**
   * Runs `command` with the backend's clock at `at`, and answers it with the rows it added to the All teams log
   * (the Auditor's): every row listed after that wasn't before, and the total grew by as many. Oldest first; rows
   * written at one instant by action.
   */
  async function recording<T>(
    at: Date,
    command: () => Promise<T>,
  ): Promise<{ answer: T; rows: Recorded[] }> {
    const before = await page("taylor", null);
    h.setClock(at);
    const answer = await command();
    const after = await page("taylor", null);
    const seen = new Set(before.events.map((e) => e.id));
    const rows = after.events
      .filter((e) => !seen.has(e.id))
      .map(({ action, at, actorId, teamId, templateId, details }) => ({
        action,
        at,
        actorId,
        teamId,
        templateId,
        details,
      }))
      .sort(
        (a, b) => a.at.localeCompare(b.at) || a.action.localeCompare(b.action),
      );
    expect(after.total - before.total, "every row written is listed").toBe(
      rows.length,
    );
    return { answer, rows };
  }

  /** A row a person's command wrote at `at`, about a team (null: platform-wide). */
  const row = (
    at: Date,
    actorId: string,
    teamId: string | null,
    action: string,
    details: Record<string, unknown>,
  ): Recorded => ({
    action,
    at: at.toISOString(),
    actorId,
    teamId,
    templateId: null,
    details,
  });

  describe("audit.page: the rows the access commands write", () => {
    const ids = () => seededAccess();
    const access = () => h.services().access;
    const nameOf = async (userId: string) => (await h.as(userId)).viewer.name;

    it("records a request, its approval and a denial on the team, with the request's facts; a refused decision or request records nothing", async () => {
      const chris = ids().request("chris");
      const asked = await recording(minute(1), async () =>
        access().requestAccess(await h.as("morgan"), {
          teamId: CORAL,
          role: "viewer",
          reason: "  Reading the offers.  ",
        }),
      );
      if (!asked.answer.ok) throw new Error(asked.answer.code);
      const requestId = asked.answer.requestId;
      const morgan = await nameOf("morgan");
      expect(asked.rows).toEqual([
        row(minute(1), "morgan", CORAL, "access.requested", {
          userId: "morgan",
          userName: morgan,
          role: "viewer",
          reason: "Reading the offers.",
        }),
      ]);

      const granted = await recording(minute(2), async () =>
        access().decideRequest(await h.as("alex"), {
          requestId: chris,
          decision: "approve",
        }),
      );
      expect(granted.rows).toEqual([
        row(minute(2), "alex", CORAL, "access.granted", {
          requestId: chris,
          userId: "chris",
          userName: await nameOf("chris"),
          role: "author",
          roles: ["author"],
          note: null,
        }),
      ]);

      const denied = await recording(minute(3), async () =>
        access().decideRequest(await h.as("alex"), {
          requestId,
          decision: "deny",
          note: "Ask your manager first.",
        }),
      );
      expect(denied.rows).toEqual([
        row(minute(3), "alex", CORAL, "access.denied", {
          requestId,
          userId: "morgan",
          userName: morgan,
          role: "viewer",
          note: "Ask your manager first.",
        }),
      ]);

      const refused = await recording(minute(4), async () => [
        await access().decideRequest(await h.as("alex"), {
          requestId: chris,
          decision: "deny",
          note: "Changed my mind.",
        }),
        await access().requestAccess(await h.as("maya"), {
          teamId: CORAL,
          role: "author",
          reason: "Again.",
        }),
      ]);
      expect(refused.answer.map(codeOf)).toEqual([
        "request_decided",
        "has_role",
      ]);
      expect(refused.rows).toEqual([]);
    });

    it("records a role change and a removal on the team, with the roles before; the same roles again, or a refused change, record nothing", async () => {
      const changed = await recording(minute(1), async () =>
        access().changeRoles(await h.as("alex"), {
          membershipId: ids().membership("maya"),
          roles: ["approver", "author"],
        }),
      );
      expect(changed.rows).toEqual([
        row(minute(1), "alex", CORAL, "access.role_changed", {
          userId: "maya",
          userName: await nameOf("maya"),
          from: ["author"],
          to: ["author", "approver"],
        }),
      ]);

      const removed = await recording(minute(2), async () =>
        access().removeMember(await h.as("alex"), {
          membershipId: ids().membership("sam"),
        }),
      );
      expect(removed.rows).toEqual([
        row(minute(2), "alex", CORAL, "access.removed", {
          userId: "sam",
          userName: await nameOf("sam"),
          roles: ["viewer"],
          status: "active",
        }),
      ]);

      const nothing = await recording(minute(3), async () => [
        await access().changeRoles(await h.as("alex"), {
          membershipId: ids().membership("maya"),
          roles: ["author", "approver"],
        }),
        await access().changeRoles(await h.as("alex"), {
          membershipId: ids().membership("alex"),
          roles: ["viewer"],
        }),
      ]);
      expect(nothing.answer[0]).toEqual({ ok: true, changed: false });
      expect(codeOf(nothing.answer[1]!)).toBe(REASONS.ownAccess.code);
      expect(nothing.rows).toEqual([]);
    });

    it("records Devon's suspension for inactivity, with his days away, and his reinstatement, with what he had", async () => {
      const devon = ids().membership("devon");
      const suspended = await recording(minute(1), async () =>
        access().suspendInactive(await h.as("alex"), { membershipId: devon }),
      );
      const devonName = await nameOf("devon");
      expect(suspended.rows).toEqual([
        row(minute(1), "alex", CORAL, "access.suspended", {
          userId: "devon",
          userName: devonName,
          reason: "inactivity",
          daysInactive: 95,
        }),
      ]);
      const reinstated = await recording(minute(2), async () =>
        access().reinstateMember(await h.as("alex"), { membershipId: devon }),
      );
      expect(reinstated.rows).toEqual([
        row(minute(2), "alex", CORAL, "access.reinstated", {
          userId: "devon",
          userName: devonName,
          from: "suspended",
          reason: "inactivity",
          roles: ["viewer"],
        }),
      ]);
    });

    it("records keeping Devon; suspending him then is refused and records nothing", async () => {
      const devon = ids().membership("devon");
      const kept = await recording(minute(1), async () =>
        access().keepInactive(await h.as("alex"), { membershipId: devon }),
      );
      expect(kept.rows).toEqual([
        row(minute(1), "alex", CORAL, "access.kept", {
          userId: "devon",
          userName: await nameOf("devon"),
          daysInactive: 95,
        }),
      ]);
      const refused = await recording(minute(2), async () =>
        access().suspendInactive(await h.as("alex"), { membershipId: devon }),
      );
      expect(codeOf(refused.answer)).toBe("not_inactive");
      expect(refused.rows).toEqual([]);
    });

    it("records each recertification decision, the review closing with the last, and the next review starting; a refused start records nothing", async () => {
      const recertId = ids().recert();
      const label = "Q4 2026";
      const decide = (userId: string, decision: "keep" | "remove", at: Date) =>
        recording(at, async () =>
          access().decideRecertItem(await h.as("alex"), {
            recertId,
            userId,
            decision,
          }),
        );
      const item = async (userId: string, roles: string[]) => ({
        recertId,
        label,
        userId,
        userName: await nameOf(userId),
        roles,
      });

      expect((await decide("jordan", "keep", minute(1))).rows).toEqual([
        row(
          minute(1),
          "alex",
          CORAL,
          "recert.kept",
          await item("jordan", ["approver"]),
        ),
      ]);
      expect((await decide("priya", "remove", minute(2))).rows).toEqual([
        row(
          minute(2),
          "alex",
          CORAL,
          "recert.removed",
          await item("priya", ["author"]),
        ),
      ]);
      for (const userId of ["dana", "devon", "maya"])
        expect((await decide(userId, "keep", minute(3))).rows).toHaveLength(1);
      // The last decision closes the review.
      expect((await decide("sam", "keep", minute(4))).rows).toEqual([
        row(minute(4), "alex", CORAL, "recert.closed", {
          recertId,
          label,
          kept: 5,
          removed: 1,
          lapsed: 0,
        }),
        row(
          minute(4),
          "alex",
          CORAL,
          "recert.kept",
          await item("sam", ["viewer"]),
        ),
      ]);

      const start = () =>
        recording(minute(5), async () =>
          access().startRecertification(await h.as("alex"), { teamId: CORAL }),
        );
      const started = await start();
      expect(started.answer.ok).toBe(true);
      // Priya left in the last one; Alex, a Team Admin, isn't reviewed.
      expect(started.rows).toEqual([
        row(minute(5), "alex", CORAL, "recert.started", {
          label,
          dueAt: new Date(minute(5).getTime() + 30 * DAY).toISOString(),
          members: 5,
        }),
      ]);
      const again = await start();
      expect(codeOf(again.answer)).toBe("recert_open");
      expect(again.rows).toEqual([]);
    });
  });

  describe("audit.page: the rows the platform commands write", () => {
    const platform = () => h.services().platform;
    const dana: ApproverRule = { kind: "user", userId: "dana" };

    it("records a change to a platform setting as one platform-wide row of what changed; saved again as it is, nothing", async () => {
      const riley = await h.as("riley");
      // What the settings show now, which the rows record as it was.
      const rules = await platform().channelRules(riley);
      const zone = await platform().businessZone(riley);
      if (!rules.ok || !zone.ok) throw new Error("settings unreadable");
      /** Disclosure's chain as it is now, by the stages' ids, saved again. */
      const chainAsItIs = async () => {
        const chains = await platform().approvalChains(riley);
        if (!chains.ok) throw new Error(chains.code);
        const { stages } = chains.chains.find(
          (c) => c.contentTypeId === DISCLOSURE,
        )!;
        return platform().saveApprovalChain(riley, {
          contentTypeId: DISCLOSURE,
          stages: stages.map(({ id, name, rule }) => ({ id, name, rule })),
        });
      };
      // [area, the change, the row's details, the setting saved again as it is (the change, unless said)]
      const settings: [
        string,
        () => Promise<ActionResult<object>>,
        Record<string, unknown>,
        (() => Promise<ActionResult<object>>)?,
      ][] = [
        [
          "content_types",
          () =>
            platform().updateContentType(riley, {
              contentTypeId: DISCLOSURE,
              requiredSections: [
                { key: "offer_details", title: "Offer summary" },
                { key: "legal_notices", title: "Legal notices" },
                // A new section, by the key its title makes: saved again, it is the same list.
                { key: "privacy", title: "Privacy" },
              ],
            }),
          {
            contentTypeId: DISCLOSURE,
            contentTypeName: "Disclosure",
            added: ["Privacy"],
            removed: ["Rates and fees"],
            renamed: [{ from: "Offer details", to: "Offer summary" }],
            reordered: false,
            sections: ["Offer summary", "Legal notices", "Privacy"],
          },
        ],
        [
          "channel_rules",
          () =>
            platform().setChannelRule(riley, {
              contentTypeId: DISCLOSURE,
              channel: "email",
              allowed: false,
            }),
          {
            contentTypeId: DISCLOSURE,
            contentTypeName: "Disclosure",
            channel: "email",
            allowed: false,
            activeUsing: rules.rows.find((r) => r.contentTypeId === DISCLOSURE)!
              .activeUsing.email,
          },
        ],
        [
          "approval_chains",
          () =>
            platform().saveApprovalChain(riley, {
              contentTypeId: DISCLOSURE,
              stages: [
                {
                  id: "stage_disclosure_0",
                  name: "Team approver",
                  rule: TEAM_RULE,
                },
                { name: "Legal reviewer", rule: dana },
              ],
            }),
          {
            contentTypeId: DISCLOSURE,
            contentTypeName: "Disclosure",
            before: ["Team approver"],
            after: ["Team approver", "Legal reviewer"],
            // A person's stage keeps the name they had.
            stages: [
              { name: "Team approver", rule: TEAM_RULE },
              { name: "Legal reviewer", rule: dana, userName: "Dana Park" },
            ],
          },
          chainAsItIs,
        ],
        [
          "business_zone",
          () =>
            platform().setBusinessZone(riley, { zone: "America/Los_Angeles" }),
          {
            from: "America/New_York",
            to: "America/Los_Angeles",
            pendingSunsets: zone.pendingSunsets,
          },
        ],
      ];
      let n = 0;
      for (const [area, save, details, asItIs = save] of settings) {
        const at = minute(++n);
        const saved = await recording(at, save);
        expect(saved.answer, area).toEqual({ ok: true, changed: true });
        expect(saved.rows, area).toEqual([
          row(at, "riley", null, "platform.config_changed", {
            area,
            ...details,
          }),
        ]);
        const again = await recording(minute(++n), asItIs);
        expect(again.answer, area).toEqual({ ok: true, changed: false });
        expect(again.rows, area).toEqual([]);
      }
    });

    it("records a new team on that team: its creation, and its first Team Admin's access", async () => {
      const created = await recording(minute(1), async () =>
        platform().createTeam(await h.as("riley"), {
          name: "Home Loans",
          description: "",
          icon: "home",
          adminUserId: "alex",
        }),
      );
      if (!created.answer.ok) throw new Error(created.answer.code);
      const { teamId } = created.answer;
      const alex = (await h.as("alex")).viewer.name;
      expect(created.rows).toEqual([
        row(minute(1), "riley", teamId, "access.granted", {
          userId: "alex",
          userName: alex,
          role: "team_admin",
          roles: ["team_admin"],
          appointed: true,
        }),
        row(minute(1), "riley", teamId, "platform.config_changed", {
          area: "teams",
          teamName: "Home Loans",
          slug: "home-loans",
          userId: "alex",
          userName: alex,
        }),
      ]);
    });

    it("records nothing for a refused platform command", async () => {
      const refused = await recording(minute(1), async () => {
        const riley = await h.as("riley");
        return [
          await platform().createTeam(await h.as("alex"), {
            name: "Home Loans",
            description: "",
            icon: "home",
            adminUserId: "alex",
          }),
          await platform().updateContentType(riley, {
            contentTypeId: DISCLOSURE,
            requiredSections: [],
          }),
          await platform().setChannelRule(riley, {
            contentTypeId: DISCLOSURE,
            channel: "push",
            allowed: true,
          }),
          await platform().saveApprovalChain(riley, {
            contentTypeId: DISCLOSURE,
            stages: [
              {
                id: "stage_disclosure_0",
                name: "Team approver",
                rule: TEAM_RULE,
              },
              { name: "Sign-off", rule: { kind: "user", userId: "riley" } },
            ],
          }),
          await platform().setBusinessZone(riley, { zone: "Europe/London" }),
        ];
      });
      expect(refused.answer.map(codeOf)).toEqual([
        REASONS.generic.code,
        "last_section",
        "channel_family",
        "names_yourself",
        "pick_zone",
      ]);
      expect(refused.rows).toEqual([]);
    });
  });
}
