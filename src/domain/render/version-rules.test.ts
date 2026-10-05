import { describe, expect, it } from "vitest";
import type { VersionState } from "../types";
import { checkVersion, type VersionFacts } from "./version-rules";

const NOW = new Date("2027-03-10T12:00:00.000Z");
const MARCH_1 = new Date("2027-03-01T00:00:00.000Z");

const facts = (state: VersionState, more: Partial<VersionFacts> = {}): VersionFacts => ({
  number: 1,
  state,
  sunsetAt: null,
  revokedAt: null,
  ...more,
});

describe("checkVersion", () => {
  it("renders the active version", () => {
    expect(checkVersion({ version: facts("active"), activeNumber: 1, now: NOW })).toEqual({ ok: true, newerVersion: null });
  });

  it("renders a superseded version with no sunset, naming the newer one", () => {
    expect(checkVersion({ version: facts("superseded"), activeNumber: 2, now: NOW })).toEqual({ ok: true, newerVersion: 2 });
  });

  it("renders a superseded version until its sunset", () => {
    const future = new Date("2027-04-01T00:00:00.000Z");
    expect(checkVersion({ version: facts("superseded", { sunsetAt: future }), activeNumber: 2, now: NOW })).toEqual({
      ok: true,
      newerVersion: 2,
    });
  });

  it("stops at the sunset moment itself", () => {
    expect(checkVersion({ version: facts("superseded", { sunsetAt: NOW }), activeNumber: 2, now: NOW })).toMatchObject({
      ok: false,
      error: { code: "version_sunset" },
    });
  });

  it("refuses a superseded version past its sunset", () => {
    expect(checkVersion({ version: facts("superseded", { sunsetAt: MARCH_1 }), activeNumber: 2, now: NOW })).toEqual({
      ok: false,
      error: {
        code: "version_sunset",
        message: "Version 1 was sunset on March 1, 2027. Version 2 is active.",
        details: { version: 1, activeVersion: 2, at: MARCH_1.toISOString() },
      },
    });
  });

  it("says when no version is active after a sunset", () => {
    const result = checkVersion({ version: facts("superseded", { sunsetAt: MARCH_1 }), activeNumber: null, now: NOW });
    expect(result).toMatchObject({ ok: false, error: { message: "Version 1 was sunset on March 1, 2027. No version is active." } });
  });

  it("refuses a revoked version", () => {
    expect(checkVersion({ version: facts("revoked", { revokedAt: MARCH_1 }), activeNumber: 2, now: NOW })).toEqual({
      ok: false,
      error: {
        code: "version_revoked",
        message: "Version 1 was revoked on March 1, 2027. Version 2 is active.",
        details: { version: 1, activeVersion: 2, at: MARCH_1.toISOString() },
      },
    });
  });

  it("refuses a revoked version without a date, and with nothing active", () => {
    expect(checkVersion({ version: facts("revoked"), activeNumber: 2, now: NOW })).toMatchObject({
      ok: false,
      error: { code: "version_revoked", message: "Version 1 was revoked. Version 2 is active." },
    });
    expect(checkVersion({ version: facts("revoked", { revokedAt: MARCH_1 }), activeNumber: null, now: NOW })).toMatchObject({
      ok: false,
      error: { message: "Version 1 was revoked on March 1, 2027. No version is active." },
    });
  });

  it("refuses a revoked version even if a sunset date is still in the future", () => {
    const future = new Date("2027-04-01T00:00:00.000Z");
    expect(checkVersion({ version: facts("revoked", { sunsetAt: future, revokedAt: MARCH_1 }), activeNumber: 2, now: NOW }))
      .toMatchObject({ ok: false, error: { code: "version_revoked" } });
  });

  it.each([
    ["in_review", 2, "Version 3 is in review. Version 2 is active."],
    ["changes_requested", 2, "Version 3 was sent back for changes. Version 2 is active."],
    ["draft", 2, "Version 3 is a draft. Version 2 is active."],
    ["in_review", null, "Version 3 is in review. No version is active yet."],
    ["changes_requested", null, "Version 3 was sent back for changes. No version is active yet."],
  ] as const)("refuses %s (active %s)", (state, activeNumber, message) => {
    expect(checkVersion({ version: facts(state, { number: 3 }), activeNumber, now: NOW })).toEqual({
      ok: false,
      error: { code: "version_not_released", message, details: { version: 3, activeVersion: activeNumber } },
    });
  });
});
