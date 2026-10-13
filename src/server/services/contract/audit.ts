import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_LIMIT,
  NO_AUDIT_SEARCH,
  SYSTEM_PERSON,
} from "@/domain/audit";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { AuditSearch } from "../audit";
import type { ContractHarness } from "./harness";

// The Audit page and its export's rows, as every implementation must answer them (AuditService in
// src/server/services/audit.ts), from the seed with the backend's clock at its base instant: three teams (Coral
// Offers, Deposits, Card Statements), their memberships granted by Riley and the Team Admins, platform-wide
// configuration events (no team), Chris's pending request and Devon's inactivity flag. Facts only: the events as
// recorded, the filters narrowed to what the space knows, and the counts the menus list under every OTHER
// filter, all by team id (decision 0053); the BFF words the rest. Alex is Coral's Team Admin, Taylor the
// Auditor, Riley the Platform Admin, Maya an Author on Coral.
//
// These reads run on the local implementation only (the fake doesn't implement them: decision 0072), and the
// commands that write the log aren't all behind the seam yet, so no case here writes.

const CORAL = "t_coral";
const DEPOSITS = "t_deposits";

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
}
