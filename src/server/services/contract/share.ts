import { describe, expect, it } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { UsageHarness } from "./harness";

// The SHARE panel's facts and the Copilot prompt's, as every implementation must answer them
// (TemplateService.integration and .copilotPrompt in src/server/services/templates.ts), read from the seed. The
// seed: Balance Transfer is v2 Active (PDF and web) over a Superseded v1 whose sunset is October 25, and Coral
// renders it; High-Yield Savings (Deposits) is rendered by Deposits Online; Cash Back's latest version is v3 in
// review under an Active v2; Annual Fee Waiver has an open draft and no released version; Rate Change Heads-up
// is an alert with an open draft. Maya is an Author on Coral Offers, Sam a Viewer there, Alex approves, Morgan has
// no team, Taylor is the Auditor. Refusals are compared by code.
//
// The fake doesn't serve these two reads (no case needs it to observe a command beyond a sunset, which the local
// run covers), so only the harnesses that serve the Usage counts run them.

const DAY = 86_400_000;

export function shareContract(h: UsageHarness, base: Date) {
  function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  }
  async function integration(userId: string, templateId: string) {
    return h
      .services()
      .templates.integration(await h.as(userId), { templateId });
  }
  async function copilot(userId: string, templateId: string) {
    return h
      .services()
      .templates.copilotPrompt(await h.as(userId), { templateId });
  }
  const refused = (
    status: number,
    refusal: { code: string; reason: string },
  ) => ({
    ok: false,
    status,
    code: refusal.code,
    reason: refusal.reason,
  });

  describe("templates.integration", () => {
    it("gives the Active version's contract and the channels a consumer can render, for anyone who can see the template", async () => {
      const templateId = h.templates["balance-transfer"]!;
      // A Viewer on the team reads it too.
      const facts = ok(await integration("sam", templateId));
      expect(facts.asOf).toBe(base.toISOString());
      expect(facts.template).toEqual({
        id: templateId,
        teamSlug: "coral-offers",
        teamName: "Coral Offers",
        name: "Balance Transfer Intro — Terms",
      });
      expect(facts.active).toMatchObject({
        number: 2,
        activatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        channels: ["pdf", "web"],
      });
      expect(facts.active.variables.map((v) => v.key)).toEqual([
        "first_name",
        "last_name",
        "purchase_apr",
        "home_state",
        "offer_end_date",
      ]);
    });

    it("lists the older released versions, newest first, with the day each stops rendering", async () => {
      const facts = ok(
        await integration("maya", h.templates["balance-transfer"]!),
      );
      expect(facts.older).toEqual([
        {
          number: 1,
          state: "superseded",
          sunsetDay: "2026-10-25",
          sunsetPassed: false,
          variables: expect.any(Array),
        },
      ]);
      // v2 added an optional offer_end_date.
      expect(facts.older[0]!.variables.map((v) => v.key)).not.toContain(
        "offer_end_date",
      );
      expect(
        ok(await integration("maya", h.templates["rate-change-notice"]!)).older,
      ).toEqual([]);
    });

    it("answers a sunset's day and whether it has passed at the backend's instant, following the review commands", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const day = new Date(base.getTime() + 8 * DAY).toISOString().slice(0, 10);
      h.setClock(new Date(base.getTime() + 60_000));
      expect(
        await h.services().review.setSunset(await h.as("alex"), {
          templateId,
          versionNumber: 1,
          sunsetDay: day,
        }),
      ).toEqual({ ok: true, changed: true });
      const [v1] = ok(await integration("maya", templateId)).older;
      expect(v1).toMatchObject({
        number: 1,
        sunsetDay: day,
        sunsetPassed: false,
      });

      // Eastern midnight at the end of that day is behind a clock 10 days on.
      h.setClock(new Date(base.getTime() + 10 * DAY));
      const later = ok(await integration("maya", templateId));
      expect(later.asOf).toBe(
        new Date(base.getTime() + 10 * DAY).toISOString(),
      );
      expect(later.older[0]).toMatchObject({
        sunsetDay: day,
        sunsetPassed: true,
      });
    });

    it("does not count a version in review: Cash Back's contract is v2's", async () => {
      const facts = ok(await integration("maya", h.templates["cash-back"]!));
      expect(facts.active.number).toBe(2);
      expect(facts.active.variables.map((v) => v.key)).not.toContain(
        "annual_fee",
      );
    });

    it("names the consumer the examples are written for: the one that renders the template, else the first registered", async () => {
      expect(
        ok(await integration("maya", h.templates["balance-transfer"]!))
          .sampleConsumerId,
      ).toBe("coral");
      expect(
        ok(await integration("eli", h.templates["high-yield-savings"]!))
          .sampleConsumerId,
      ).toBe("deposits-online");
    });

    it("names the latest consumer to render it, and the later write when two renders share an instant", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const at = new Date(base.getTime() + 5 * 60_000);
      h.setClock(new Date(base.getTime() + 10 * 60_000));
      await h.renders.record([
        {
          at: at.toISOString(),
          templateId,
          versionNumber: 2,
          consumerId: "coral",
          channel: "web",
        },
        {
          at: at.toISOString(),
          templateId,
          versionNumber: 2,
          consumerId: "deposits-online",
          channel: "web",
        },
      ]);
      expect(ok(await integration("maya", templateId)).sampleConsumerId).toBe(
        "deposits-online",
      );
    });

    it("refuses, in order: a template that doesn't exist or the viewer may not see, a template with nothing Active", async () => {
      expect(await integration("riley", "UC-ZZZZZZ")).toEqual(
        refused(404, REQUEST_REFUSALS.templateGone),
      );
      // Morgan, on no team, may not see it: it reads as not there.
      expect(
        await integration("morgan", h.templates["balance-transfer"]!),
      ).toEqual(refused(404, REQUEST_REFUSALS.templateGone));
      expect(
        await integration("maya", h.templates["annual-fee-waiver"]!),
      ).toEqual(refused(409, REQUEST_REFUSALS.noActiveVersion));
    });
  });

  describe("templates.copilotPrompt", () => {
    it("gives the saved draft with its team and content type, for someone who may edit it", async () => {
      const facts = ok(
        await copilot("maya", h.templates["annual-fee-waiver"]!),
      );
      expect(facts).toMatchObject({
        templateName: "Annual Fee Waiver — Terms",
        teamName: "Coral Offers",
        contentTypeName: "Disclosure",
        channels: expect.arrayContaining(["pdf"]),
      });
      expect(facts.requiredSections.map((s) => s.title)).toEqual([
        "Offer details",
        "Rates and fees",
        "Legal notices",
      ]);
      expect(facts.variables.length).toBeGreaterThan(0);
      expect(facts.body.type).toBe("doc");
    });

    it("refuses, in order: a template that doesn't exist, someone who may not edit its draft, no open draft, an alert", async () => {
      expect(await copilot("maya", "UC-ZZZZZZ")).toEqual(
        refused(404, REQUEST_REFUSALS.templateUnavailable),
      );
      // The Auditor can see it but not edit it.
      expect(
        await copilot("taylor", h.templates["annual-fee-waiver"]!),
      ).toMatchObject({ ok: false, status: 403 });
      expect(await copilot("maya", h.templates["cash-back"]!)).toEqual(
        refused(409, REQUEST_REFUSALS.noDraftToWrite),
      );
      // Copilot writes a document's body, and an alert has none: the content type says so, not the draft.
      expect(
        await copilot("maya", h.templates["rate-change-heads-up"]!),
      ).toEqual(refused(409, REQUEST_REFUSALS.copilotDocumentsOnly));
    });
  });
}
