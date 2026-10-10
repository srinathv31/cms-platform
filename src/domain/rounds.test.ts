import { describe, expect, it } from "vitest";
import {
  approvedOnRound,
  asNumbered,
  compareRounds,
  headOf,
  isReleased,
  nextRound,
  parseRoundParam,
  reviewHistoryLabel,
  reviewHistoryName,
  reviewLink,
  reviewPath,
  roundLabel,
  roundsOf,
  showsRound,
  versionLabel,
  type NumberedRound,
  type RoundRow,
} from "./rounds";
import { VERSION_STATES, type VersionState } from "./types";

const row = (number: number | null, round: number | null, state: VersionState): RoundRow => ({ number, round, state });
const v = (number: number, round: number, state: VersionState): NumberedRound => ({ number, round, state });
const DRAFT = row(null, null, "draft");

describe("labels", () => {
  it.each<[string, NumberedRound, { style?: "chrome" | "sentence"; history?: boolean }, string]>([
    ["round 1 in review: no round yet", v(2, 1, "in_review"), {}, "v2"],
    ["round 1 sent back", v(2, 1, "changes_requested"), {}, "v2 · Round 1"],
    ["round 1 sent back, in a sentence", v(2, 1, "changes_requested"), { style: "sentence" }, "v2, round 1"],
    ["round 2 in review", v(2, 2, "in_review"), {}, "v2 · Round 2"],
    ["round 2 in review, in a sentence", v(2, 2, "in_review"), { style: "sentence" }, "v2, round 2"],
    ["released on round 1", v(2, 1, "active"), {}, "v2"],
    ["released on round 3: the version consumers know", v(2, 3, "active"), {}, "v2"],
    ["released on round 3, in the review history", v(2, 3, "active"), { history: true }, "v2 · Round 3"],
    ["released on round 3, in a history sentence", v(2, 3, "superseded"), { history: true, style: "sentence" }, "v2, round 3"],
    ["released on round 1, in the review history", v(2, 1, "revoked"), { history: true }, "v2"],
    ["unreleased, history changes nothing", v(3, 1, "in_review"), { history: true }, "v3"],
  ])("%s: %s", (_, version, options, label) => {
    expect(versionLabel(version, options)).toBe(label);
  });

  it("shows the round only once a number was sent back", () => {
    expect(showsRound(v(1, 1, "in_review"))).toBe(false);
    expect(showsRound(v(1, 1, "changes_requested"))).toBe(true);
    expect(showsRound(v(1, 2, "in_review"))).toBe(true);
    expect(showsRound(v(1, 2, "active"))).toBe(false);
    expect(showsRound(v(1, 2, "active"), { history: true })).toBe(true);
  });

  it("names a round, the round a version was approved on, and the review history", () => {
    expect(roundLabel(2)).toBe("Round 2");
    expect(approvedOnRound(v(2, 3, "active"))).toBe("Approved on round 3");
    expect(approvedOnRound(v(2, 3, "superseded"))).toBe("Approved on round 3");
    expect(approvedOnRound(v(2, 1, "active")), "the first round goes without saying").toBeNull();
    expect(approvedOnRound(v(2, 2, "in_review")), "not approved yet").toBeNull();
    expect(reviewHistoryLabel(3)).toBe("Review history (3 rounds)");
    expect(reviewHistoryLabel(1)).toBe("Review history (1 round)");
    // Its accessible name says whose history it is.
    expect(reviewHistoryName(2, 3)).toBe("v2 review history (3 rounds)");
  });
});

describe("nextRound", () => {
  it("a first submit is v1, round 1", () => {
    expect(nextRound([])).toEqual({ number: 1, round: 1 });
    expect(nextRound([DRAFT])).toEqual({ number: 1, round: 1 });
  });

  it("after a send-back, the same number's next round", () => {
    expect(nextRound([row(1, 1, "changes_requested"), DRAFT])).toEqual({ number: 1, round: 2 });
    expect(nextRound([row(1, 1, "changes_requested"), row(1, 2, "changes_requested"), DRAFT])).toEqual({ number: 1, round: 3 });
  });

  it("after a release, the next number's round 1", () => {
    expect(nextRound([row(1, 1, "active"), DRAFT])).toEqual({ number: 2, round: 1 });
    expect(nextRound([row(1, 1, "changes_requested"), row(1, 2, "superseded"), row(2, 1, "active")])).toEqual({ number: 3, round: 1 });
  });

  it("counts a revoked latest version as released", () => {
    expect(nextRound([row(1, 1, "superseded"), row(2, 1, "revoked"), DRAFT])).toEqual({ number: 3, round: 1 });
  });

  it("continues a number sent back even when the draft that answers it is gone (Edit started from Active)", () => {
    expect(nextRound([row(1, 1, "active"), row(2, 1, "changes_requested"), DRAFT])).toEqual({ number: 2, round: 2 });
  });

  it("continues the highest unreleased number of a database numbered before rounds (v1 sent back, then v2)", () => {
    expect(nextRound([row(1, 1, "changes_requested"), row(2, 1, "changes_requested"), DRAFT])).toEqual({ number: 2, round: 2 });
  });
});

describe("lookups and order", () => {
  const rows = [
    { id: "v1", ...row(1, 1, "superseded") },
    { id: "v2r1", ...row(2, 1, "changes_requested") },
    { id: "v2r3", ...row(2, 3, "active") },
    { id: "v2r2", ...row(2, 2, "changes_requested") },
    { id: "v3r1", ...row(3, 1, "changes_requested") },
    { id: "v3r2", ...row(3, 2, "in_review") },
    { id: "d", ...DRAFT },
  ];

  it("a number's head is its released row, else its highest round", () => {
    expect(headOf(rows, 2)?.id).toBe("v2r3");
    expect(headOf(rows, 3)?.id).toBe("v3r2");
    expect(headOf(rows, 1)?.id).toBe("v1");
    expect(headOf(rows, 4)).toBeUndefined();
    // A released row wins over a higher round (a database numbered before rounds can't have one, but the rule holds).
    expect(headOf([{ id: "a", ...row(1, 1, "superseded") }, { id: "b", ...row(1, 2, "changes_requested") }], 1)?.id).toBe("a");
  });

  it("lists a number's rounds newest first", () => {
    expect(roundsOf(rows, 2).map((r) => r.id)).toEqual(["v2r3", "v2r2", "v2r1"]);
    expect(roundsOf(rows, 4)).toEqual([]);
  });

  it("orders by number, then round, with the draft last", () => {
    expect([...rows].sort(compareRounds).map((r) => r.id)).toEqual(["v1", "v2r1", "v2r2", "v2r3", "v3r1", "v3r2", "d"]);
    expect(compareRounds(DRAFT, DRAFT)).toBe(0);
    expect(compareRounds(row(2, 1, "active"), row(2, 1, "active"))).toBe(0);
  });

  it("knows the released states", () => {
    expect(VERSION_STATES.filter(isReleased)).toEqual(["active", "superseded", "revoked"]);
  });

  it("treats a numbered row without a round as a bug", () => {
    expect(asNumbered(row(2, 1, "in_review"))).toEqual({ number: 2, round: 1, state: "in_review" });
    expect(() => asNumbered(row(2, null, "in_review"))).toThrow();
    expect(() => asNumbered(DRAFT)).toThrow();
  });
});

describe("review links", () => {
  it("adds ?round= exactly when the label shows the round: otherwise the bare URL is that row", () => {
    expect(reviewPath("coral-offers", "UC-4F7K2Q", v(3, 1, "in_review"))).toBe("/coral-offers/review/UC-4F7K2Q/3");
    expect(reviewPath("coral-offers", "UC-4F7K2Q", v(3, 2, "in_review"))).toBe("/coral-offers/review/UC-4F7K2Q/3?round=2");
    expect(reviewPath("coral-offers", "UC-4F7K2Q", v(3, 1, "changes_requested"))).toBe("/coral-offers/review/UC-4F7K2Q/3?round=1");
    expect(reviewPath("all", "UC-4F7K2Q", v(2, 3, "active"))).toBe("/all/review/UC-4F7K2Q/2");
  });

  it("gives a notification the same link", () => {
    expect(reviewLink("UC-4F7K2Q", v(3, 1, "in_review"))).toEqual({ to: "review", templateId: "UC-4F7K2Q", versionNumber: 3 });
    expect(reviewLink("UC-4F7K2Q", v(3, 2, "in_review"))).toEqual({ to: "review", templateId: "UC-4F7K2Q", versionNumber: 3, round: 2 });
  });

  it("reads ?round=: absent is the head, a whole number from 1 is a round, anything else is a 404", () => {
    expect(parseRoundParam(undefined)).toBeNull();
    expect(parseRoundParam("2")).toBe(2);
    expect(parseRoundParam("12")).toBe(12);
    for (const raw of ["0", "x", "", "-1", "1.5", "02", " 2", "1e3"]) expect(parseRoundParam(raw), raw).toBe("invalid");
    expect(parseRoundParam(["1", "2"])).toBe("invalid");
  });
});
