import { describe, expect, it } from "vitest";
import { compareCodePoints } from "@/domain/golive/cursor";
import { PALETTE_RECENT_LIMIT, PALETTE_REST_LIMIT } from "@/domain/palette";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ContractHarness } from "./harness";

// The Library and the ⌘K palette, as every implementation must answer them (TemplateService.library and
// .palette in src/server/services/templates.ts), read from the seed with the backend's clock at the seed's base
// instant. The seed's templates, by team:
//   Coral Offers (t_coral): Annual Fee Waiver (v1 sent back, and an open draft), Balance Transfer (v2 Active, v1
//     Superseded), Cash Back (v3 in review, v2 Active), Holiday Points (v1 Revoked), Rate Change Notice (Active),
//     and three alerts (Payment Due Reminder, Card Used Abroad, Rate Change Heads-up);
//   Deposits (t_deposits): High-Yield Savings, Checking Fees, Overdraft Protection;
//   Card Statements (t_cards): three Statement Inserts.
// Maya is an Author on Coral Offers, Sam a Viewer there, Jordan and Alex approve there, Eli writes for Deposits,
// Morgan has no team, Riley is the platform admin and Taylor the Auditor (every team, through All teams).
//
// A case that needs a command sets the clock first, then compares what the reads show before and after. Refusals
// are compared by code. The names below are the seed's; the order of equal matches is the contract (decision 0059:
// name, then id, by code point).

const CORAL_KEYS = [
  "annual-fee-waiver",
  "balance-transfer",
  "card-used-abroad",
  "cash-back",
  "holiday-points",
  "payment-due-reminder",
  "rate-change-heads-up",
  "rate-change-notice",
];
const ALERT_KEYS = [
  "payment-due-reminder",
  "card-used-abroad",
  "rate-change-heads-up",
];
const DAY = 86_400_000;

/** YYYY-MM-DD, `days` after `at` in UTC. */
const dayAfter = (at: Date, days: number) =>
  new Date(at.getTime() + days * DAY).toISOString().slice(0, 10);

export function libraryContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);
  const ids = (keys: string[]) => keys.map((key) => h.templates[key]!).sort();

  async function library(userId: string, teamId: string | null) {
    return h.services().templates.library(await h.as(userId), { teamId });
  }
  async function palette(
    userId: string,
    teamId: string | null,
    q: string | null = null,
    templateId: string | null = null,
  ) {
    return h
      .services()
      .templates.palette(await h.as(userId), { teamId, q, templateId });
  }
  /** The ok answer, or a failed case naming the refusal. */
  function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  }

  describe("templates.library", () => {
    it("lists a team's templates by the version each is shown by, with the kind from its content type, and says when it read them", async () => {
      const { asOf, rows } = ok(await library("maya", "t_coral"));
      expect(asOf).toBe(base.toISOString());
      expect(rows.map((r) => r.id).sort()).toEqual(ids(CORAL_KEYS));
      for (const row of rows) {
        expect(row).toMatchObject({
          teamId: "t_coral",
          teamSlug: "coral-offers",
          teamName: "Coral Offers",
        });
        expect(row.family, row.name).toBe(
          ALERT_KEYS.some((key) => h.templates[key] === row.id)
            ? "message"
            : "document",
        );
        expect(row.owner.id).toEqual(expect.any(String));
      }
      const byKey = (key: string) =>
        rows.find((r) => r.id === h.templates[key])!;
      expect(byKey("balance-transfer")).toMatchObject({
        name: "Balance Transfer Intro — Terms",
        status: "active",
        activeNumber: 2,
        sunsetPassed: false,
      });
      // A draft counts as the latest version; the Active one is still named.
      expect(byKey("annual-fee-waiver")).toMatchObject({
        status: "draft",
        activeNumber: null,
      });
      expect(byKey("cash-back")).toMatchObject({
        status: "in_review",
        activeNumber: 2,
      });
      // v1 was revoked; v2 is the latest.
      expect(byKey("holiday-points")).toMatchObject({
        status: "active",
        activeNumber: 2,
      });
    });

    it("lists the newest edit first", async () => {
      const { rows } = ok(await library("maya", "t_coral"));
      const edited = rows.map((r) => r.lastEditedAt);
      expect(edited.every((at) => at !== null)).toBe(true);
      expect(edited).toEqual([...edited].sort().reverse());
    });

    it("counts a change to any of its versions as an edit: a sunset set moves the template to the top", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const before = ok(await library("maya", "t_coral"));
      expect(before.rows[0]!.id).not.toBe(templateId);
      h.setClock(minute(1));
      expect(
        await h.services().review.setSunset(await h.as("alex"), {
          templateId,
          versionNumber: 1,
          sunsetDay: dayAfter(base, 30),
        }),
      ).toEqual({ ok: true, changed: true });

      const after = ok(await library("maya", "t_coral"));
      expect(after.asOf).toBe(minute(1).toISOString());
      expect(after.rows.map((r) => r.id).sort()).toEqual(
        before.rows.map((r) => r.id).sort(),
      );
      expect(after.rows[0]).toMatchObject({
        id: templateId,
        lastEditedAt: minute(1).toISOString(),
      });
    });

    it("lists every team in All teams for the platform roles, and only a viewer's own teams otherwise", async () => {
      const all = ok(await library("taylor", null));
      expect(all.rows.map((r) => r.id).sort()).toEqual(
        Object.values(h.templates).sort(),
      );
      expect(new Set(all.rows.map((r) => r.teamId))).toEqual(
        new Set(["t_coral", "t_deposits", "t_cards"]),
      );
      expect(ok(await library("riley", null)).rows).toHaveLength(
        all.rows.length,
      );

      const deposits = ok(await library("eli", "t_deposits"));
      expect(deposits.rows.map((r) => r.id).sort()).toEqual(
        ids(["high-yield-savings", "checking-fees", "overdraft-protection"]),
      );
    });

    it("says what the viewer may create: an Author on the team, nobody in All teams", async () => {
      expect(ok(await library("maya", "t_coral")).can.create).toEqual({
        ok: true,
      });
      expect(ok(await library("sam", "t_coral")).can.create).toMatchObject({
        ok: false,
        code: expect.any(String),
      });
      // Not even the platform admin: All teams has no team to create in.
      for (const user of ["riley", "taylor"])
        expect(ok(await library(user, null)).can.create).toMatchObject({
          ok: false,
        });
    });

    it("refuses a space the viewer may not enter, and a team that doesn't exist, the same way", async () => {
      for (const [user, teamId] of [
        ["eli", "t_coral"],
        ["maya", "t_deposits"],
        ["maya", null],
        ["morgan", "t_coral"],
        ["eli", null],
      ] as const)
        expect(await library(user, teamId), `${user} in ${teamId}`).toEqual({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.spaceUnavailable.code,
          reason: REQUEST_REFUSALS.spaceUnavailable.reason,
        });
    });
  });

  describe("templates.palette", () => {
    it("at rest lists the viewer's recent templates (at most five, newest first), then the rest of the space by name", async () => {
      const result = ok(await palette("maya", "t_coral"));
      expect(result).toMatchObject({ query: "", current: false });
      expect(result.recent.length).toBe(PALETTE_RECENT_LIMIT);
      // Coral has eight templates: five in Recent, the other three on the first page, none twice.
      expect(
        [...result.recent, ...result.templates].map((r) => r.id).sort(),
      ).toEqual(ids(CORAL_KEYS));
      const names = result.templates.map((r) => r.name);
      expect(names).toEqual([...names].sort(compareCodePoints));
      expect(result.recent[0]).toEqual({
        id: expect.any(String),
        name: expect.any(String),
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        status: expect.any(String),
      });
    });

    it("lists a template by its latest version's name and state", async () => {
      const result = ok(await palette("taylor", null, "annual fee"));
      expect(result.templates).toEqual([
        {
          id: h.templates["annual-fee-waiver"],
          name: "Annual Fee Waiver — Terms",
          teamSlug: "coral-offers",
          teamName: "Coral Offers",
          status: "draft",
        },
      ]);
    });

    it("pages All teams at rest: the first eight by name, with no Recent for someone who has acted on nothing", async () => {
      const result = ok(await palette("taylor", null));
      expect(result.recent).toEqual([]);
      expect(result.templates).toHaveLength(PALETTE_REST_LIMIT);
      const names = result.templates.map((r) => r.name);
      expect(names).toEqual([...names].sort(compareCodePoints));
      // The rest are a search away.
      const next = ok(await palette("taylor", null, "statement insert"));
      expect(next.templates.map((r) => r.teamSlug)).toEqual([
        "card-statements",
        "card-statements",
        "card-statements",
      ]);
    });

    it("searches for every word, in the name, the team, the id or the status, best match first, then name, without Recent", async () => {
      // "terms" is in the em-dash tail of four Coral names; "coral" only in the team's name: equal matches, so
      // they come by name.
      const terms = ok(await palette("taylor", null, "  Terms   CORAL "));
      expect(terms.query).toBe("terms coral");
      expect(terms.recent).toEqual([]);
      expect(terms.templates.map((r) => r.name)).toEqual([
        "Annual Fee Waiver — Terms",
        "Balance Transfer Intro — Terms",
        "Cash Back Welcome Bonus — Terms",
        "Holiday Points Promo — Terms",
      ]);
      // A name that starts with the word beats one that merely contains it.
      const rate = ok(await palette("taylor", null, "rate"));
      expect(rate.templates[0]!.name).toMatch(/^Rate Change/);
      // The id, any case; the status label.
      const holiday = h.templates["holiday-points"]!;
      expect(
        ok(await palette("taylor", null, holiday.toLowerCase())).templates.map(
          (r) => r.id,
        ),
      ).toEqual([holiday]);
      // "review" is only in a status label: "In review".
      const inReview = ok(await palette("taylor", null, "in review")).templates;
      expect(inReview.length).toBeGreaterThan(0);
      expect(inReview.every((r) => r.status === "in_review")).toBe(true);
      expect(inReview.map((r) => r.id)).toContain(h.templates["cash-back"]);
      expect(ok(await palette("taylor", null, "zzz")).templates).toEqual([]);
    });

    it("lists the templates the viewer acted on first: recent ones win ties, and the later of two writes at one instant is more recent", async () => {
      const cashBack = h.templates["cash-back"]!;
      const transfer = h.templates["balance-transfer"]!;
      const jordan = await h.as("jordan");
      h.setClock(minute(5));
      for (const templateId of [cashBack, transfer])
        expect(
          await h.services().review.setSunset(jordan, {
            templateId,
            versionNumber: 1,
            sunsetDay: dayAfter(base, 20),
          }),
        ).toEqual({ ok: true, changed: true });

      // Both writes carry the same instant: the later one is first.
      const atRest = ok(await palette("jordan", "t_coral"));
      expect(atRest.recent.slice(0, 2).map((r) => r.id)).toEqual([
        transfer,
        cashBack,
      ]);

      // And in a search they win the ties among equal matches.
      const terms = ok(await palette("jordan", "t_coral", "terms"));
      expect(terms.recent).toEqual([]);
      expect(terms.templates.slice(0, 2).map((r) => r.id)).toEqual([
        transfer,
        cashBack,
      ]);
    });

    it("the other order of the same two writes gives the other order of Recent", async () => {
      const cashBack = h.templates["cash-back"]!;
      const transfer = h.templates["balance-transfer"]!;
      const jordan = await h.as("jordan");
      h.setClock(minute(5));
      for (const templateId of [transfer, cashBack])
        expect(
          await h.services().review.setSunset(jordan, {
            templateId,
            versionNumber: 1,
            sunsetDay: dayAfter(base, 20),
          }),
        ).toEqual({ ok: true, changed: true });
      const atRest = ok(await palette("jordan", "t_coral"));
      expect(atRest.recent.slice(0, 2).map((r) => r.id)).toEqual([
        cashBack,
        transfer,
      ]);
    });

    it("leaves the template being viewed out of Recent, and says whether it is the viewer's to see in this space", async () => {
      const cashBack = h.templates["cash-back"]!;
      const jordan = await h.as("jordan");
      h.setClock(minute(5));
      expect(
        await h.services().review.setSunset(jordan, {
          templateId: cashBack,
          versionNumber: 1,
          sunsetDay: dayAfter(base, 20),
        }),
      ).toEqual({ ok: true, changed: true });
      const on = ok(await palette("jordan", "t_coral", null, cashBack));
      expect(on.current).toBe(true);
      expect(on.recent.map((r) => r.id)).not.toContain(cashBack);
      expect(on.templates.map((r) => r.id)).toContain(cashBack);

      // A template of another space, or none at all, isn't theirs to see here.
      expect(
        ok(await palette("eli", "t_deposits", null, cashBack)).current,
      ).toBe(false);
      expect(
        ok(await palette("maya", "t_coral", null, "UC-ZZZZZZ")).current,
      ).toBe(false);
    });

    it("says whether the viewer may create from the palette: an Author on the team, nobody in All teams", async () => {
      expect(ok(await palette("maya", "t_coral")).can.create).toEqual({
        ok: true,
      });
      expect(ok(await palette("sam", "t_coral")).can.create.ok).toBe(false);
      expect(ok(await palette("taylor", null)).can.create.ok).toBe(false);
    });

    it("lists only the space's templates, and refuses a space the viewer may not enter", async () => {
      const eli = ok(await palette("eli", "t_deposits", "balance"));
      expect(eli.templates).toEqual([]);
      const atRest = ok(await palette("eli", "t_deposits"));
      expect(
        [...atRest.recent, ...atRest.templates].map((r) => r.id).sort(),
      ).toEqual(
        ids(["high-yield-savings", "checking-fees", "overdraft-protection"]),
      );
      for (const [user, teamId] of [
        ["eli", "t_coral"],
        ["eli", null],
        ["morgan", "t_coral"],
      ] as const)
        expect(await palette(user, teamId), `${user} in ${teamId}`).toEqual({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.spaceUnavailable.code,
          reason: REQUEST_REFUSALS.spaceUnavailable.reason,
        });
    });
  });
}
