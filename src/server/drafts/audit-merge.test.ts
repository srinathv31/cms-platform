import { describe, expect, it } from "vitest";
import { changedFields, mergeDraftEdit, sessionOwnsRev } from "./audit-merge";

const t0 = new Date("2026-10-04T10:00:00.000Z");
const t1 = new Date("2026-10-04T10:00:05.000Z");
const t2 = new Date("2026-10-04T10:00:09.000Z");

describe("changedFields", () => {
  it("lists the provided fields in a fixed order", () => {
    expect(changedFields({ sampleSets: [], body: {}, name: "A" })).toEqual(["body", "name", "sampleSets"]);
  });

  it("counts null (it clears a channel field) but not undefined", () => {
    expect(changedFields({ "email.subject": null, "email.preheader": undefined })).toEqual(["email.subject"]);
  });

  it("ignores everything that is not a draft field", () => {
    expect(changedFields({ rev: 3, sessionKey: "abc" } as never)).toEqual([]);
  });
});

describe("mergeDraftEdit", () => {
  it("starts a row at one save", () => {
    expect(mergeDraftEdit(null, ["body"], t0, 6)).toEqual({
      at: t0,
      details: { saves: 1, fields: ["body"], since: t0.toISOString(), rev: 6 },
    });
  });

  it("adds a save and unions the fields, in canonical order", () => {
    const first = mergeDraftEdit(null, ["variables", "body"], t0, 6);
    const second = mergeDraftEdit(first, ["name", "body"], t1, 7);
    expect(second.details).toEqual({
      saves: 2,
      fields: ["body", "variables", "name"],
      since: t0.toISOString(),
      rev: 7,
    });
    expect(second.at).toBe(t1);

    const third = mergeDraftEdit(second, ["body"], t2, 8);
    expect(third.details).toMatchObject({ saves: 3, fields: ["body", "variables", "name"], since: t0.toISOString(), rev: 8 });
    expect(third.at).toBe(t2);
  });

  it("does not repeat a field", () => {
    const first = mergeDraftEdit(null, ["body"], t0, 6);
    expect(mergeDraftEdit(first, ["body"], t1, 7).details.fields).toEqual(["body"]);
  });

  it("does not change the row it was given", () => {
    const first = mergeDraftEdit(null, ["body"], t0, 6);
    const snapshot = JSON.stringify(first);
    mergeDraftEdit(first, ["name"], t1, 7);
    expect(JSON.stringify(first)).toBe(snapshot);
  });

  it("picks up rows written before fields and since existed", () => {
    const legacy = { at: t0, details: { saves: 15, basedOn: 1 } };
    const merged = mergeDraftEdit(legacy, ["body"], t1, 12);
    expect(merged.details).toEqual({
      saves: 16,
      basedOn: 1,
      fields: ["body"],
      since: t0.toISOString(),
      rev: 12,
    });
  });

  it("copes with a row whose details are null or garbage", () => {
    for (const details of [null, "text", 7, [], { saves: "many", fields: "all", since: "never" }]) {
      const merged = mergeDraftEdit({ at: t0, details }, ["name"], t1, 3);
      expect(merged.details).toEqual({ saves: 2, fields: ["name"], since: t0.toISOString(), rev: 3 });
    }
  });

  it("drops field names it does not know", () => {
    const merged = mergeDraftEdit({ at: t0, details: { saves: 1, fields: ["body", "rev", 5] } }, ["name"], t1, 3);
    expect(merged.details.fields).toEqual(["body", "name"]);
  });
});

describe("sessionOwnsRev", () => {
  const row = (details: unknown) => ({ details });

  it("is true when the request is behind and the session wrote the current rev", () => {
    expect(sessionOwnsRev(row({ rev: 7 }), 7, 6)).toBe(true);
    expect(sessionOwnsRev(row({ rev: 7 }), 7, 0)).toBe(true);
  });

  it("is false when someone else wrote since", () => {
    expect(sessionOwnsRev(row({ rev: 6 }), 7, 5)).toBe(false);
  });

  it("is false when the request is current or ahead", () => {
    expect(sessionOwnsRev(row({ rev: 7 }), 7, 7)).toBe(false);
    expect(sessionOwnsRev(row({ rev: 7 }), 7, 8)).toBe(false);
  });

  it("is false for a session with no row, or a row with no rev (the seed's)", () => {
    expect(sessionOwnsRev(null, 7, 6)).toBe(false);
    expect(sessionOwnsRev(row({ saves: 15 }), 7, 6)).toBe(false);
    for (const details of [null, "x", 7, [], { rev: "7" }, { rev: null }]) {
      expect(sessionOwnsRev(row(details), 7, 6)).toBe(false);
    }
  });
});
