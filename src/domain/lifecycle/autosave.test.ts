import { describe, expect, it } from "vitest";
import { REASONS } from "../permissions";
import { REQUEST_REFUSALS } from "../refusals";
import type { DraftPatch, JSONContent, VersionState, Viewer } from "../types";
import {
  changedFields,
  draftChanged,
  draftSaveAccess,
  draftSaveChanges,
  draftSaveRefusal,
  mergeDraftEdit,
  recordedRev,
  recordedSave,
  sessionOwnsRev,
} from "./autosave";
import { REFUSALS } from "./refusals";

const t0 = new Date("2026-10-04T10:00:00.000Z");
const t1 = new Date("2026-10-04T10:00:05.000Z");
const t2 = new Date("2026-10-04T10:00:09.000Z");

const line = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const member = (
  userId: string,
  roles: ("author" | "approver" | "viewer")[],
): Viewer => ({
  userId,
  name: userId,
  initials: userId.slice(0, 2).toUpperCase(),
  title: "",
  platformRole: null,
  memberships: [
    {
      teamId: "t_coral",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      roles,
      status: "active",
    },
  ],
});

describe("draftSaveAccess", () => {
  it("lets an author of the team save", () => {
    expect(draftSaveAccess(member("maya", ["author"]), "t_coral")).toEqual({
      ok: true,
    });
  });

  it("refuses someone who sees the team but may not edit its drafts the permission's refusal", () => {
    expect(draftSaveAccess(member("sam", ["viewer"]), "t_coral")).toMatchObject(
      { ok: false, code: REASONS.generic.code },
    );
    expect(
      draftSaveAccess(member("jordan", ["approver"]), "t_coral"),
    ).toMatchObject({ ok: false, code: REASONS.generic.code });
  });

  it("reads a version that isn't there, and one on a team the viewer may not see, alike: version_gone", () => {
    const gone = { ok: false, ...REQUEST_REFUSALS.versionGone };
    expect(draftSaveAccess(member("maya", ["author"]), null)).toEqual(gone);
    expect(draftSaveAccess(member("maya", ["author"]), "t_deposits")).toEqual(
      gone,
    );
  });
});

describe("sessionOwnsRev", () => {
  const last = (rev: number | null, seq: number | null) => ({ rev, seq });

  it("is true when the save is behind, the session's last save produced the current rev, and this one was sent after it", () => {
    expect(sessionOwnsRev(last(7, 3), 7, { rev: 6, seq: 4 })).toBe(true);
    expect(sessionOwnsRev(last(7, 3), 7, { rev: 0, seq: 9 })).toBe(true);
  });

  it("is false for a save sent before the session's last one: a request given up on, arriving after its retry", () => {
    expect(sessionOwnsRev(last(7, 3), 7, { rev: 6, seq: 2 })).toBe(false);
    expect(sessionOwnsRev(last(7, 3), 7, { rev: 6, seq: 3 })).toBe(false);
  });

  it("is false when someone else wrote since", () => {
    expect(sessionOwnsRev(last(6, 3), 7, { rev: 5, seq: 4 })).toBe(false);
  });

  it("is false when the save is current or ahead", () => {
    expect(sessionOwnsRev(last(7, 3), 7, { rev: 7, seq: 4 })).toBe(false);
    expect(sessionOwnsRev(last(7, 3), 7, { rev: 8, seq: 4 })).toBe(false);
  });

  it("is false for a session that has saved nothing, or whose record says no rev or no seq", () => {
    expect(sessionOwnsRev(null, 7, { rev: 6, seq: 4 })).toBe(false);
    expect(sessionOwnsRev(last(null, 3), 7, { rev: 6, seq: 4 })).toBe(false);
    expect(sessionOwnsRev(last(7, null), 7, { rev: 6, seq: 4 })).toBe(false);
  });
});

describe("recordedSave", () => {
  it("is the rev and the seq a session's row recorded, each null when it says none", () => {
    expect(recordedSave({ saves: 2, rev: 7, seq: 4 })).toEqual({
      rev: 7,
      seq: 4,
    });
    expect(recordedSave({ rev: 7 })).toEqual({ rev: 7, seq: null });
    expect(recordedSave(null)).toEqual({ rev: null, seq: null });
    expect(recordedSave({ rev: 7, seq: "4" })).toEqual({ rev: 7, seq: null });
  });
});

describe("recordedRev", () => {
  it("is the rev a session's row recorded", () => {
    expect(recordedRev({ saves: 2, rev: 7 })).toBe(7);
    expect(recordedRev({ rev: 0 })).toBe(0);
  });

  it("is null for a row with no rev (written before it was recorded), or details that aren't a record", () => {
    for (const details of [
      null,
      undefined,
      "x",
      7,
      [],
      { saves: 15 },
      { rev: "7" },
      { rev: null },
    ])
      expect(recordedRev(details)).toBeNull();
  });
});

describe("draftSaveRefusal", () => {
  const draft = (over: Partial<{ state: VersionState; rev: number }> = {}) => ({
    state: "draft" as VersionState,
    rev: 5,
    allowedChannels: ["pdf", "web"] as const,
    ...over,
  });

  it("lets a save at the current rev land", () => {
    expect(draftSaveRefusal(draft(), { rev: 5, seq: 5 }, null)).toBeNull();
    expect(
      draftSaveRefusal(draft(), { rev: 5, seq: 5, channels: ["web"] }, null),
    ).toBeNull();
  });

  it("refuses version_not_draft once the version has left draft, before anything else", () => {
    for (const state of [
      "in_review",
      "changes_requested",
      "active",
      "superseded",
      "revoked",
    ] as const)
      expect(
        draftSaveRefusal(
          draft({ state }),
          { rev: 0, seq: 5, channels: ["email"] },
          null,
        ),
      ).toEqual({ ok: false, ...REQUEST_REFUSALS.versionNotDraft });
  });

  it("refuses draft_changed with the current rev for a rev behind or ahead", () => {
    for (const rev of [4, 0, 6, 99])
      expect(draftSaveRefusal(draft(), { rev, seq: 5 }, null)).toEqual({
        ok: false,
        ...REQUEST_REFUSALS.draftChanged,
        rev: 5,
      });
  });

  it("lets a save that is behind land when the session's own last save produced the current rev and this one was sent after it (a lost response)", () => {
    expect(
      draftSaveRefusal(draft(), { rev: 3, seq: 5 }, { rev: 5, seq: 4 }),
    ).toBeNull();
    // Someone wrote after the session's last save, or the save is ahead: a conflict all the same.
    expect(
      draftSaveRefusal(draft(), { rev: 3, seq: 5 }, { rev: 4, seq: 4 }),
    ).toMatchObject({
      code: "draft_changed",
      rev: 5,
    });
    expect(
      draftSaveRefusal(draft(), { rev: 6, seq: 5 }, { rev: 5, seq: 4 }),
    ).toMatchObject({
      code: "draft_changed",
      rev: 5,
    });
    // Sent before the session's last save: a request the client gave up on, arriving after the retry that replaced it.
    expect(
      draftSaveRefusal(draft(), { rev: 3, seq: 3 }, { rev: 5, seq: 4 }),
    ).toMatchObject({
      code: "draft_changed",
      rev: 5,
    });
  });

  it("checks the rev before the channels, and the channels last, a lost response's included", () => {
    expect(
      draftSaveRefusal(draft(), { rev: 4, seq: 5, channels: ["email"] }, null),
    ).toMatchObject({ code: "draft_changed" });
    expect(
      draftSaveRefusal(
        draft(),
        { rev: 4, seq: 5, channels: ["email"] },
        { rev: 5, seq: 4 },
      ),
    ).toEqual({ ok: false, ...REFUSALS.channelNotAllowed });
    expect(
      draftSaveRefusal(draft(), { rev: 5, seq: 5, channels: [] }, null),
    ).toEqual({
      ok: false,
      ...REFUSALS.noChannels,
    });
  });

  it("draftChanged carries the rev it is given", () => {
    expect(draftChanged(12)).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.draftChanged,
      rev: 12,
    });
  });
});

describe("draftSaveChanges", () => {
  const stored = {
    channelFields: {
      email: { subject: line("Hi"), preheader: line("Pre") },
    },
    writers: ["maya"],
  };
  const patch = (over: Partial<DraftPatch>): DraftPatch => ({
    rev: 5,
    sessionKey: "session-1",
    seq: 1,
    ...over,
  });

  it("writes only the fields the patch names, and the saver among the writers", () => {
    expect(draftSaveChanges(stored, patch({ name: "Renamed" }), "dee")).toEqual(
      { writers: ["maya", "dee"], name: "Renamed" },
    );
    expect(
      draftSaveChanges(
        stored,
        patch({
          body: line("B"),
          variables: [],
          channels: ["pdf"],
          sampleSets: [],
        }),
        "maya",
      ),
    ).toEqual({
      writers: ["maya"],
      body: line("B"),
      variables: [],
      channels: ["pdf"],
      sampleSets: [],
    });
  });

  it("lays the channel fields the patch names over the stored ones: the others are kept, null clears one", () => {
    expect(
      draftSaveChanges(stored, patch({ "email.subject": line("New") }), "maya")
        .channelFields,
    ).toEqual({ email: { subject: line("New"), preheader: line("Pre") } });
    expect(
      draftSaveChanges(stored, patch({ "email.subject": null }), "maya")
        .channelFields,
    ).toEqual({ email: { preheader: line("Pre") } });
    expect(
      draftSaveChanges(stored, patch({ body: line("B") }), "maya"),
    ).not.toHaveProperty("channelFields");
  });

  it("doesn't change what it was given", () => {
    const snapshot = JSON.stringify(stored);
    draftSaveChanges(stored, patch({ "email.subject": null }), "dee");
    expect(JSON.stringify(stored)).toBe(snapshot);
  });
});

describe("changedFields", () => {
  it("lists the provided fields in a fixed order", () => {
    expect(changedFields({ sampleSets: [], body: {}, name: "A" })).toEqual([
      "body",
      "name",
      "sampleSets",
    ]);
  });

  it("counts null (it clears a channel field) but not undefined", () => {
    expect(
      changedFields({ "email.subject": null, "email.preheader": undefined }),
    ).toEqual(["email.subject"]);
  });

  it("ignores everything that is not a draft field", () => {
    expect(changedFields({ rev: 3, sessionKey: "abc" } as never)).toEqual([]);
  });
});

describe("mergeDraftEdit", () => {
  it("starts a row at one save", () => {
    expect(mergeDraftEdit(null, ["body"], t0, 6, 60)).toEqual({
      at: t0,
      details: {
        saves: 1,
        fields: ["body"],
        since: t0.toISOString(),
        rev: 6,
        seq: 60,
      },
    });
  });

  it("adds a save and unions the fields, in canonical order", () => {
    const first = mergeDraftEdit(null, ["variables", "body"], t0, 6, 60);
    const second = mergeDraftEdit(first, ["name", "body"], t1, 7, 70);
    expect(second.details).toEqual({
      saves: 2,
      fields: ["body", "variables", "name"],
      since: t0.toISOString(),
      rev: 7,
      seq: 70,
    });
    expect(second.at).toBe(t1);

    const third = mergeDraftEdit(second, ["body"], t2, 8, 80);
    expect(third.details).toMatchObject({
      saves: 3,
      fields: ["body", "variables", "name"],
      since: t0.toISOString(),
      rev: 8,
      seq: 80,
    });
    expect(third.at).toBe(t2);
  });

  it("does not repeat a field", () => {
    const first = mergeDraftEdit(null, ["body"], t0, 6, 60);
    expect(mergeDraftEdit(first, ["body"], t1, 7, 70).details.fields).toEqual([
      "body",
    ]);
  });

  it("does not change the row it was given", () => {
    const first = mergeDraftEdit(null, ["body"], t0, 6, 60);
    const snapshot = JSON.stringify(first);
    mergeDraftEdit(first, ["name"], t1, 7, 70);
    expect(JSON.stringify(first)).toBe(snapshot);
  });

  it("picks up rows written before fields and since existed", () => {
    const legacy = { at: t0, details: { saves: 15, basedOn: 1 } };
    const merged = mergeDraftEdit(legacy, ["body"], t1, 12, 120);
    expect(merged.details).toEqual({
      saves: 16,
      basedOn: 1,
      fields: ["body"],
      since: t0.toISOString(),
      rev: 12,
      seq: 120,
    });
  });

  it("copes with a row whose details are null or garbage", () => {
    for (const details of [
      null,
      "text",
      7,
      [],
      { saves: "many", fields: "all", since: "never" },
    ]) {
      const merged = mergeDraftEdit({ at: t0, details }, ["name"], t1, 3, 30);
      expect(merged.details).toEqual({
        saves: 2,
        fields: ["name"],
        since: t0.toISOString(),
        rev: 3,
        seq: 30,
      });
    }
  });

  it("drops field names it does not know", () => {
    const merged = mergeDraftEdit(
      { at: t0, details: { saves: 1, fields: ["body", "rev", 5] } },
      ["name"],
      t1,
      3,
      30,
    );
    expect(merged.details.fields).toEqual(["body", "name"]);
  });
});
