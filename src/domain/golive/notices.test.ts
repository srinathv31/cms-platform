import { describe, expect, it } from "vitest";
import type { NoticeRow } from "../golive-types";
import type { ContractChange } from "../types";
import { changeSummary, noticeView } from "./notices";

const AT = new Date("2026-10-05T12:00:00.000Z");
const ANNUAL_FEE: ContractChange = { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true };
const END_DATE: ContractChange = { kind: "added", key: "offer_end_date", breaking: false, type: "date", required: false };

const row = (kind: NoticeRow["kind"], payload: Record<string, unknown>): NoticeRow => ({
  id: "cn_1",
  consumerId: "coral",
  templateId: "UC-4F7K2Q",
  versionId: "v_1",
  kind,
  payload,
  createdAt: AT,
});

const NAME = "Spring Travel Rewards — Terms";

describe("noticeView: new_version", () => {
  it("live shape: activeVersion and contractChanges, worded for the new version", () => {
    const view = noticeView(
      row("new_version", {
        templateName: NAME,
        versionNumber: 3,
        activeVersion: 3,
        contractChanges: [ANNUAL_FEE],
        contractLines: ["v3 adds required `annual_fee` (Currency)."],
      }),
    );
    expect(view).toEqual({
      id: "cn_1",
      kind: "new_version",
      createdAt: "2026-10-05T12:00:00.000Z",
      template: { id: "UC-4F7K2Q", name: NAME },
      versionNumber: 3,
      activeVersion: 3,
      sunsetAt: null,
      sunsetDay: null,
      zone: null,
      reason: null,
      changes: [{ kind: "added", key: "annual_fee", breaking: true, text: "v3 adds required `annual_fee` (Currency)." }],
      message: `${NAME} v3 is available. It adds the required variable annual_fee.`,
    });
  });

  it("seeded shape: previousVersionNumber, no activeVersion (the new version is the Active one)", () => {
    const view = noticeView(row("new_version", { templateName: "Rate Change Notice", versionNumber: 2, previousVersionNumber: 1, contractChanges: [] }));
    expect(view).toMatchObject({ activeVersion: 2, changes: [], message: "Rate Change Notice v2 is available. No contract changes." });
  });

  it("an explicit null activeVersion stays null", () => {
    expect(noticeView(row("new_version", { templateName: NAME, versionNumber: 2, activeVersion: null })).activeVersion).toBeNull();
  });
});

describe("noticeView: sunset_scheduled", () => {
  it("live shape: activeVersion, sunsetAt and the changes moving to the Active one asks", () => {
    const view = noticeView(
      row("sunset_scheduled", {
        templateName: NAME,
        versionNumber: 2,
        activeVersion: 3,
        sunsetAt: "2027-03-01T00:00:00.000Z",
        contractChanges: [ANNUAL_FEE],
        contractLines: ["v3 adds required `annual_fee` (Currency)."],
      }),
    );
    expect(view).toMatchObject({
      kind: "sunset_scheduled",
      versionNumber: 2,
      activeVersion: 3,
      sunsetAt: "2027-03-01T00:00:00.000Z",
      reason: null,
      changes: [{ key: "annual_fee", text: "v3 adds required `annual_fee` (Currency)." }],
      message: `${NAME} v2 stops rendering on March 1, 2027. Move to v3.`,
    });
  });

  it("live shape without changes (set from the Versions tab)", () => {
    const view = noticeView(row("sunset_scheduled", { templateName: NAME, versionNumber: 1, activeVersion: 2, sunsetAt: "2026-10-26T16:05:07.984Z" }));
    expect(view).toMatchObject({ activeVersion: 2, changes: [], message: `${NAME} v1 stops rendering on October 26, 2026. Move to v2.` });
  });

  it("seeded shape: replacedByVersionNumber", () => {
    const view = noticeView(
      row("sunset_scheduled", {
        templateName: "Balance Transfer Intro — Terms",
        versionNumber: 1,
        sunsetAt: "2026-10-26T16:05:07.984Z",
        replacedByVersionNumber: 2,
        contractChanges: [END_DATE],
      }),
    );
    expect(view).toMatchObject({
      activeVersion: 2,
      sunsetAt: "2026-10-26T16:05:07.984Z",
      changes: [{ kind: "added", key: "offer_end_date", breaking: false, text: "v2 adds optional `offer_end_date` (Date)." }],
      message: "Balance Transfer Intro — Terms v1 stops rendering on October 26, 2026. Move to v2.",
    });
  });

  it("carries the day and the zone it was read in; a notice without them gives the UTC day and no zone", () => {
    const live = noticeView(
      row("sunset_scheduled", { templateName: NAME, versionNumber: 1, activeVersion: 2, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: "America/New_York" }),
    );
    expect(live).toMatchObject({ sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: "America/New_York" });
    const bare = noticeView(row("sunset_scheduled", { templateName: NAME, versionNumber: 1, activeVersion: 2, sunsetAt: "2026-10-26T16:05:07.984Z" }));
    expect(bare).toMatchObject({ sunsetDay: "2026-10-26", zone: null });
  });

  it("says the sunset's day as picked (sunsetDay), not its instant's UTC date", () => {
    // 00:00 Eastern on March 1 is 05:00 UTC; in a zone ahead of UTC it is still February 28 in UTC.
    const eastern = noticeView(
      row("sunset_scheduled", { templateName: NAME, versionNumber: 1, activeVersion: 2, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01" }),
    );
    expect(eastern).toMatchObject({ sunsetAt: "2027-03-01T05:00:00.000Z", message: `${NAME} v1 stops rendering on March 1, 2027. Move to v2.` });
    const ahead = noticeView(
      row("sunset_scheduled", { templateName: NAME, versionNumber: 1, activeVersion: 2, sunsetAt: "2027-02-28T18:30:00.000Z", sunsetDay: "2027-03-01" }),
    );
    expect(ahead.message).toBe(`${NAME} v1 stops rendering on March 1, 2027. Move to v2.`);
  });

  it("with nothing Active there's nothing to move to", () => {
    const view = noticeView(row("sunset_scheduled", { templateName: NAME, versionNumber: 1, activeVersion: null, sunsetAt: "2027-03-01T00:00:00.000Z", contractChanges: [ANNUAL_FEE] }));
    expect(view).toMatchObject({ activeVersion: null, changes: [], message: `${NAME} v1 stops rendering on March 1, 2027.` });
  });
});

describe("noticeView: sunset_passed", () => {
  const passed = {
    templateName: NAME,
    versionNumber: 2,
    activeVersion: 3,
    sunsetAt: "2027-03-01T05:00:00.000Z",
    sunsetDay: "2027-03-01",
    zone: "America/New_York",
  };

  it("the sweep's shape: the instant, the day in the zone, and the version to move to", () => {
    // Written by the sweep after the sunset: createdAt is when it was written, sunsetAt when renders stopped.
    expect(noticeView(row("sunset_passed", passed))).toEqual({
      id: "cn_1",
      kind: "sunset_passed",
      createdAt: "2026-10-05T12:00:00.000Z",
      template: { id: "UC-4F7K2Q", name: NAME },
      versionNumber: 2,
      activeVersion: 3,
      sunsetAt: "2027-03-01T05:00:00.000Z",
      sunsetDay: "2027-03-01",
      zone: "America/New_York",
      reason: null,
      changes: [],
      message: `${NAME} v2 stopped rendering: its sunset passed on March 1, 2027. Move to v3.`,
    });
  });

  it("names the day as recorded in the zone, not the instant's UTC date", () => {
    const pacific = noticeView(row("sunset_passed", { ...passed, sunsetAt: "2027-03-01T08:00:00.000Z", zone: "America/Los_Angeles" }));
    expect(pacific).toMatchObject({ sunsetDay: "2027-03-01", zone: "America/Los_Angeles" });
    const ahead = noticeView(row("sunset_passed", { ...passed, sunsetAt: "2027-02-28T18:30:00.000Z" }));
    expect(ahead.message).toBe(`${NAME} v2 stopped rendering: its sunset passed on March 1, 2027. Move to v3.`);
  });

  it("with nothing Active there's nothing to move to", () => {
    const view = noticeView(row("sunset_passed", { ...passed, activeVersion: null }));
    expect(view).toMatchObject({ activeVersion: null, message: `${NAME} v2 stopped rendering: its sunset passed on March 1, 2027.` });
  });

  it("a payload without a sunset still reads as one sentence", () => {
    const view = noticeView(row("sunset_passed", { templateName: NAME, versionNumber: 2, activeVersion: 3 }));
    expect(view).toMatchObject({ sunsetAt: null, sunsetDay: null, zone: null, message: `${NAME} v2 stopped rendering: its sunset passed. Move to v3.` });
  });
});

describe("noticeView: revoked", () => {
  it("both shapes: the reason, with its period", () => {
    const seeded = noticeView(row("revoked", { templateName: "Holiday Points Promo — Terms", versionNumber: 1, reason: "Wrong bonus amount" }));
    expect(seeded).toMatchObject({
      activeVersion: null,
      reason: "Wrong bonus amount",
      changes: [],
      sunsetAt: null,
      sunsetDay: null,
      zone: null,
      message: "Holiday Points Promo — Terms v1 was revoked: Wrong bonus amount.",
    });
    const live = noticeView(row("revoked", { templateName: "Balance Transfer Intro — Terms", versionNumber: 1, activeVersion: 2, reason: "Wrong intro APR in the legal notices." }));
    expect(live).toMatchObject({ activeVersion: 2, message: "Balance Transfer Intro — Terms v1 was revoked: Wrong intro APR in the legal notices." });
  });

  it("no reason", () => {
    expect(noticeView(row("revoked", { templateName: NAME, versionNumber: 4 })).message).toBe(`${NAME} v4 was revoked.`);
  });
});

describe("noticeView: odd payloads", () => {
  it("falls back to the template id, and ignores junk changes", () => {
    const view = noticeView(row("new_version", { versionNumber: 2, contractChanges: [null, "x", { kind: "added" }, END_DATE] }));
    expect(view.template).toEqual({ id: "UC-4F7K2Q", name: "UC-4F7K2Q" });
    expect(view.changes.map((c) => c.key)).toEqual(["offer_end_date"]);
  });
});

describe("changeSummary", () => {
  it("joins the kinds into one sentence", () => {
    expect(changeSummary([])).toBe("No contract changes.");
    expect(
      changeSummary([
        ANNUAL_FEE,
        { kind: "added", key: "late_fee", breaking: true, type: "currency", required: true },
        END_DATE,
        { kind: "key_renamed", key: "apr", breaking: true, from: "rate", to: "apr" },
        { kind: "made_optional", key: "promo_code", breaking: false },
        { kind: "removed", key: "old_key", breaking: true, type: "text", required: false },
      ]),
    ).toBe(
      "It adds the required variables annual_fee and late_fee, adds the optional variable offer_end_date, renames rate to apr, makes promo_code optional and removes the variable old_key.",
    );
    expect(changeSummary([{ kind: "type_changed", key: "fee", breaking: true, from: "text", to: "currency" }, { kind: "made_required", key: "x", breaking: true }])).toBe(
      "It changes the type of fee and makes x required.",
    );
  });
});
