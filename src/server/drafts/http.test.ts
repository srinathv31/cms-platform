import { describe, expect, it } from "vitest";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS, refuse } from "@/domain/refusals";
import { REFUSALS } from "@/domain/lifecycle";
import { DRAFT_SAVE_STATUS, statusOf } from "./http";

describe("statusOf", () => {
  it("is 200 for a save", () => {
    expect(statusOf({ ok: true, rev: 2, savedAt: "2026-10-04T10:00:00.000Z" })).toBe(200);
  });

  it.each([
    [REASONS.generic, 403],
    [REQUEST_REFUSALS.versionGone, 404],
    [REQUEST_REFUSALS.versionNotDraft, 409],
    [REQUEST_REFUSALS.draftChanged, 409],
    [REQUEST_REFUSALS.draftTooLarge, 413],
  ] as const)("maps %j to its HTTP status", (entry, status) => {
    expect(statusOf(refuse(entry))).toBe(status);
    expect(DRAFT_SAVE_STATUS[entry.code]).toBe(status);
  });

  it.each([
    REQUEST_REFUSALS.invalidInput("rev is not a number"),
    REFUSALS.noChannels,
    REFUSALS.channelNotAllowed,
  ])("answers a refusal of the patch itself (%j) with 400", (entry) => {
    expect(statusOf(refuse(entry))).toBe(400);
  });

  it("keeps the current rev on the answer that carries it, without changing its status", () => {
    expect(statusOf({ ...refuse(REQUEST_REFUSALS.draftChanged), rev: 9 })).toBe(409);
  });
});
