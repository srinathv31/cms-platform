import { and, eq, max } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { RequestContext } from "../types";
import { localServices } from "./index";

// The SHARE panel's facts (`templates.integration`) and the Copilot prompt's (`templates.copilotPrompt`) against
// a temporary database filled by the real seed, for what depends on this database: which consumer the examples
// name, what a content type's channel rules leave of the Active version's channels, the older versions and
// their sunsets at the backend's clock, and the order of the refusals. Balance Transfer: v2 Active (pdf, web),
// v1 Superseded with a sunset. How the panel and the prompt are worded from the facts is tested on facts built
// by hand (src/server/queries).

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-integration-local-");
});

const { renderLog, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

/** The backend's clock: every test starts at the seed's base and may move it. */
let now = BASE;
const services = localServices({ clock: async () => now });

let db: Db;
const people: Record<string, Viewer> = {};

const ids = seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
  for (const id of ["maya", "sam", "morgan", "riley", "eli", "taylor"])
    people[id] = await loadPersona(db, id);
});

beforeEach(() => {
  now = BASE;
});

const id = (key: string) => ids[key]!;

function as(userId: string): RequestContext {
  return {
    viewer: people[userId]!,
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

/** The SHARE panel's facts for a viewer; they must have been answered. */
async function integration(userId: string, templateId: string) {
  const result = await services.templates.integration(as(userId), {
    templateId,
  });
  if (!result.ok) throw new Error(`${templateId}: ${result.reason}`);
  return result;
}

/** The Copilot prompt's facts for a viewer; they must have been answered. */
async function copilot(userId: string, templateId: string) {
  const result = await services.templates.copilotPrompt(as(userId), {
    templateId,
  });
  if (!result.ok) throw new Error(`${templateId}: ${result.reason}`);
  return result;
}

describe("templates.integration", () => {
  it("the Active version: the template, its channels and variables, and when it went live", async () => {
    const facts = await integration("maya", id("balance-transfer"));
    expect(facts.asOf).toBe(BASE.toISOString());
    expect(facts.template).toEqual({
      id: id("balance-transfer"),
      name: "Balance Transfer Intro — Terms",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
    });
    expect(facts.active.number).toBe(2);
    expect(facts.active.channels).toEqual(["pdf", "web"]);
    expect(facts.active.variables.map((v) => v.key)).toEqual([
      "first_name",
      "last_name",
      "purchase_apr",
      "home_state",
      "offer_end_date",
    ]);
    const [v2] = await db
      .select({ activatedAt: versions.activatedAt })
      .from(versions)
      .where(
        and(
          eq(versions.templateId, id("balance-transfer")),
          eq(versions.number, 2),
        ),
      );
    expect(facts.active.activatedAt).toBe(v2!.activatedAt!.toISOString());
  });

  it("an author and a viewer on the team can read it", async () => {
    expect((await integration("maya", id("balance-transfer"))).ok).toBe(true);
    expect((await integration("sam", id("balance-transfer"))).ok).toBe(true);
  });

  describe("the consumer the examples name", () => {
    /** The newest render of a template, as ms: a new render must come after it. */
    async function latestRenderAt(templateId: string): Promise<number> {
      const [row] = await db
        .select({ at: max(renderLog.at) })
        .from(renderLog)
        .where(eq(renderLog.templateId, templateId));
      return row!.at!.getTime();
    }

    async function render(o: {
      key: string;
      templateId: string;
      at: number;
      consumerId: string | null;
      isPreview?: boolean;
    }) {
      const [v2] = await db
        .select({ id: versions.id })
        .from(versions)
        .where(
          and(eq(versions.templateId, o.templateId), eq(versions.number, 2)),
        );
      await db.insert(renderLog).values({
        id: `rl_sample_${o.key}`,
        at: new Date(o.at),
        templateId: o.templateId,
        versionId: v2!.id,
        versionNumber: 2,
        consumerId: o.consumerId,
        channel: "pdf",
        platform: null,
        isPreview: o.isPreview ?? false,
        correlationId: `req_${o.key}`,
        outcome: "ok",
        errorCode: null,
        durationMs: 100,
      });
    }

    it("is the template's latest renderer", async () => {
      expect(
        (await integration("maya", id("balance-transfer"))).sampleConsumerId,
      ).toBe("coral");
      expect(
        (await integration("eli", id("high-yield-savings"))).sampleConsumerId,
      ).toBe("deposits-online");
    });

    it("moves to whoever rendered last", async () => {
      const templateId = id("balance-transfer");
      await render({
        key: "newest",
        templateId,
        at: (await latestRenderAt(templateId)) + 1000,
        consumerId: "deposits-online",
      });
      expect((await integration("maya", templateId)).sampleConsumerId).toBe(
        "deposits-online",
      );
    });

    it.each([
      [["coral", "deposits-online"], "deposits-online"],
      [["deposits-online", "coral"], "coral"],
    ])(
      "with renders at one instant, the later write wins (%j)",
      async (order, expected) => {
        const templateId = id("balance-transfer");
        const at = (await latestRenderAt(templateId)) + 1000;
        for (const [i, consumerId] of order.entries())
          await render({ key: `tie_${i}`, templateId, at, consumerId });
        expect((await integration("maya", templateId)).sampleConsumerId).toBe(
          expected,
        );
      },
    );

    it("is never a preview's, a render with no consumer, or a caller that isn't registered", async () => {
      const templateId = id("balance-transfer");
      const at = (await latestRenderAt(templateId)) + 1000;
      await render({
        key: "preview",
        templateId,
        at,
        consumerId: "deposits-online",
        isPreview: true,
      });
      await render({ key: "none", templateId, at: at + 1, consumerId: null });
      await render({
        key: "typo",
        templateId,
        at: at + 2,
        consumerId: "corall",
      });
      expect((await integration("maya", templateId)).sampleConsumerId).toBe(
        "coral",
      );
    });

    it("with no renders yet, is the first registered consumer", async () => {
      const rateChange = id("rate-change-notice");
      await db.delete(renderLog).where(eq(renderLog.templateId, rateChange));
      expect((await integration("maya", rateChange)).sampleConsumerId).toBe(
        "coral",
      );
      // Deposits' own consumer isn't the answer for a template nobody has rendered.
      const savings = id("high-yield-savings");
      await db.delete(renderLog).where(eq(renderLog.templateId, savings));
      expect((await integration("eli", savings)).sampleConsumerId).toBe(
        "coral",
      );
    });
  });

  it("a channel Channel rules turned off is not in the Active version's channels", async () => {
    const [disclosure] = await db
      .select()
      .from(schema.contentTypes)
      .where(eq(schema.contentTypes.key, "disclosure"));
    await db
      .update(schema.contentTypes)
      .set({ allowedChannels: ["pdf", "email"] })
      .where(eq(schema.contentTypes.id, disclosure!.id));
    expect(
      (await integration("maya", id("balance-transfer"))).active.channels,
    ).toEqual(["pdf"]);
  });

  describe("older versions", () => {
    it("lists the older released versions, newest first, with the sunset's day", async () => {
      const bt = await integration("maya", id("balance-transfer"));
      expect(bt.older).toEqual([
        {
          number: 1,
          state: "superseded",
          // October 25, 00:00 in the business time zone (Eastern until changed).
          sunsetDay: "2026-10-25",
          sunsetPassed: false,
          variables: expect.any(Array),
        },
      ]);
      expect(bt.older[0]!.variables.map((v) => v.key)).toEqual([
        "first_name",
        "last_name",
        "purchase_apr",
        "home_state",
      ]);
      const holiday = await integration("maya", id("holiday-points"));
      expect(holiday.older.map((o) => [o.number, o.state])).toEqual([
        [1, "revoked"],
      ]);
      expect(
        (await integration("maya", id("rate-change-notice"))).older,
      ).toEqual([]);
    });

    it("keeps newest first across Superseded and Revoked, and counts none past the Active number", async () => {
      // Cash Back v3 (round 2) goes live over v2, and v1 is revoked.
      const cashBack = id("cash-back");
      const of = (number: number, round?: number) =>
        and(
          eq(versions.templateId, cashBack),
          eq(versions.number, number),
          round === undefined ? undefined : eq(versions.round, round),
        );
      await db.update(versions).set({ state: "superseded" }).where(of(2));
      await db.update(versions).set({ state: "revoked" }).where(of(1));
      await db.update(versions).set({ state: "active" }).where(of(3, 2));
      const facts = await integration("maya", cashBack);
      expect(facts.active.number).toBe(3);
      expect(facts.older.map((o) => [o.number, o.state])).toEqual([
        [2, "superseded"],
        [1, "revoked"],
      ]);
      expect(facts.older.map((o) => o.sunsetDay)).toEqual([null, null]);
    });

    it("says a sunset has passed once the clock is past it", async () => {
      const [v1] = (await integration("maya", id("balance-transfer"))).older;
      expect(v1).toMatchObject({ number: 1, sunsetPassed: false });
      // v1's sunset is Oct 25, 00:00 Eastern.
      now = new Date(BASE.getTime() + 22 * DAY);
      const later = await integration("maya", id("balance-transfer"));
      expect(later.asOf).toBe(now.toISOString());
      expect(later.older[0]).toMatchObject({
        number: 1,
        state: "superseded",
        sunsetDay: v1!.sunsetDay,
        sunsetPassed: true,
      });
    });
  });

  it("versions in review don't count: Cash Back's Active is v2", async () => {
    const facts = await integration("maya", id("cash-back"));
    expect(facts.active.number).toBe(2);
    expect(facts.active.variables.map((v) => v.key)).not.toContain(
      "annual_fee",
    );
    expect(facts.older.map((o) => o.number)).toEqual([1]);
  });

  describe("refusals", () => {
    it("404 template_gone for a template that doesn't exist", async () => {
      expect(
        await services.templates.integration(as("riley"), {
          templateId: "UC-ZZZZZZ",
        }),
      ).toEqual({
        ok: false,
        status: 404,
        code: "template_gone",
        reason: "This template no longer exists.",
      });
    });

    it("403 for someone without the team, with the permission's reason", async () => {
      const result = await services.templates.integration(as("morgan"), {
        templateId: id("balance-transfer"),
      });
      expect(result).toMatchObject({ ok: false, status: 403 });
      if (!result.ok) expect(result.reason).toMatch(/\S/);
    });

    it("409 no_active_version for a template with nothing Active", async () => {
      expect(
        await services.templates.integration(as("maya"), {
          templateId: id("annual-fee-waiver"),
        }),
      ).toEqual({
        ok: false,
        status: 409,
        code: "no_active_version",
        reason: "This template has no Active version yet.",
      });
    });

    it("409 no_active_version for a template whose only released version was revoked", async () => {
      await db
        .update(versions)
        .set({ state: "revoked" })
        .where(
          and(
            eq(versions.templateId, id("rate-change-notice")),
            eq(versions.number, 1),
          ),
        );
      expect(
        await services.templates.integration(as("maya"), {
          templateId: id("rate-change-notice"),
        }),
      ).toEqual({
        ok: false,
        status: 409,
        code: "no_active_version",
        reason: "This template has no Active version yet.",
      });
    });

    it("answers in order: no template (404), then who may (403), then nothing Active (409)", async () => {
      expect(
        await services.templates.integration(as("morgan"), {
          templateId: "UC-ZZZZZZ",
        }),
      ).toMatchObject({ ok: false, status: 404, code: "template_gone" });
      // Morgan may not read the integration of a template with nothing Active either: 403, not 409.
      expect(
        await services.templates.integration(as("morgan"), {
          templateId: id("annual-fee-waiver"),
        }),
      ).toMatchObject({ ok: false, status: 403 });
    });
  });
});

describe("templates.copilotPrompt", () => {
  it("the facts of the saved draft, for someone who may edit it", async () => {
    const templateId = id("annual-fee-waiver");
    const facts = await copilot("maya", templateId);
    const [draft] = await db
      .select()
      .from(versions)
      .where(
        and(eq(versions.templateId, templateId), eq(versions.state, "draft")),
      );
    expect(facts.templateName).toBe(draft!.name);
    expect(facts.templateName).toMatch(/\S/);
    expect(facts.teamName).toBe("Coral Offers");
    expect(facts.contentTypeName).toBe("Disclosure");
    expect(facts.requiredSections.map((s) => s.title)).toEqual([
      "Offer details",
      "Rates and fees",
      "Legal notices",
    ]);
    expect(facts.channels).toEqual(draft!.channels);
    expect(facts.variables).toEqual(draft!.variables);
    expect(facts.body).toEqual(draft!.body);
    expect(facts.body.content?.length).toBeGreaterThan(0);
  });

  it("reads the draft as it is saved now", async () => {
    const templateId = id("annual-fee-waiver");
    await db
      .update(versions)
      .set({ name: "Annual Fee Waiver, renamed" })
      .where(
        and(eq(versions.templateId, templateId), eq(versions.state, "draft")),
      );
    expect((await copilot("maya", templateId)).templateName).toBe(
      "Annual Fee Waiver, renamed",
    );
  });

  it("403 for a viewer who can't edit drafts on the team", async () => {
    const result = await services.templates.copilotPrompt(as("taylor"), {
      templateId: id("annual-fee-waiver"),
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
    if (!result.ok) expect(result.reason).toMatch(/\S/);
  });

  it("409 no_draft_to_write when there is no open draft, 404 template_unavailable when there is no such template", async () => {
    expect(
      await services.templates.copilotPrompt(as("maya"), {
        templateId: id("cash-back"),
      }),
    ).toEqual({
      ok: false,
      status: 409,
      code: "no_draft_to_write",
      reason: "There is no draft to write.",
    });
    expect(
      await services.templates.copilotPrompt(as("maya"), {
        templateId: "UC-NOPE00",
      }),
    ).toEqual({
      ok: false,
      status: 404,
      code: "template_unavailable",
      reason: "This template isn't available.",
    });
  });

  it("answers in order: no template (404), then who may edit (403), then no draft (409)", async () => {
    expect(
      await services.templates.copilotPrompt(as("taylor"), {
        templateId: "UC-NOPE00",
      }),
    ).toMatchObject({ ok: false, status: 404, code: "template_unavailable" });
    expect(
      await services.templates.copilotPrompt(as("taylor"), {
        templateId: id("cash-back"),
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("409 copilot_documents_only for an alert's draft: Copilot writes a document's body, and an alert has none", async () => {
    expect(
      await services.templates.copilotPrompt(as("maya"), {
        templateId: id("rate-change-heads-up"),
      }),
    ).toEqual({
      ok: false,
      status: 409,
      code: "copilot_documents_only",
      reason: "Copilot drafts documents only.",
    });
  });

  it("knows an alert by its content type, even when its draft's channels were emptied", async () => {
    await db
      .update(versions)
      .set({ channels: [] })
      .where(
        and(
          eq(versions.templateId, id("rate-change-heads-up")),
          eq(versions.state, "draft"),
        ),
      );
    expect(
      await services.templates.copilotPrompt(as("maya"), {
        templateId: id("rate-change-heads-up"),
      }),
    ).toMatchObject({ ok: false, code: "copilot_documents_only" });
  });
});
