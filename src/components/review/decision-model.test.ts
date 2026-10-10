import { describe, expect, it } from "vitest";
import { STAGE_REFUSALS } from "@/domain/approval-chain";
import { REASONS } from "@/domain/permissions";
import { refuse } from "@/domain/refusals";
import type { ConsumerUsage, StepView } from "@/domain/review-types";
import type { VersionState } from "@/domain/types";
import {
  REASON_MAX,
  approvalStage,
  approveLines,
  decisionAccess,
  decisionLine,
  reasonProblem,
  reasonReady,
  type ApproveLinesInput,
} from "./decision-model";

const NOW = "2026-10-05T02:29:00.000Z";

const step = (position: number, name: string, status: StepView["status"]): StepView => ({ position, name, status });
const ONE = [step(0, "Team approver", "current")];
const TWO_FIRST = [step(0, "Team approver", "current"), step(1, "Legal reviewer", "waiting")];
const TWO_SECOND = [step(0, "Team approver", "done"), step(1, "Legal reviewer", "current")];

const USAGE: ConsumerUsage[] = [
  { consumerId: "coral", consumerName: "Coral", versionNumber: 2, lastRenderAt: "2026-10-05T01:00:00.000Z", renders30d: 332 },
];

function lines(over: Partial<ApproveLinesInput> = {}) {
  return approveLines({
    version: { number: 3, round: 1, state: "in_review" },
    previousNumber: 2,
    stage: approvalStage(ONE),
    sunset: null,
    usage: USAGE,
    nowIso: NOW,
    ...over,
  });
}

describe("a change request's reason", () => {
  it("wants a reason, and says nothing about it when there is none", () => {
    expect(reasonReady("")).toBe(false);
    expect(reasonReady("  \n\t ")).toBe(false);
    expect(reasonProblem("")).toBeNull();
    expect(reasonProblem("  \n\t ")).toBeNull();
  });

  it("accepts any text with a word in it", () => {
    expect(reasonReady("The APR in Legal notices is wrong.")).toBe(true);
    expect(reasonProblem("The APR in Legal notices is wrong.")).toBeNull();
  });

  it("counts the trimmed length, up to the server's limit", () => {
    expect(reasonReady(`  ${"a".repeat(REASON_MAX)}  `)).toBe(true);
    expect(reasonProblem(`  ${"a".repeat(REASON_MAX)}  `)).toBeNull();
    expect(reasonReady("a".repeat(REASON_MAX + 1))).toBe(false);
    expect(reasonProblem("a".repeat(REASON_MAX + 1))).toBe("Keep the reason under 2,000 characters.");
  });
});

describe("decisionAccess", () => {
  const ok = { ok: true } as const;

  it("is open when the server says both decisions are the viewer's", () => {
    expect(decisionAccess(ok, ok)).toEqual({ kind: "open" });
  });

  it("is blocked, with the reason, for an approver who can't decide this one (maker-checker, another stage)", () => {
    const own = refuse(REASONS.ownVersion);
    expect(decisionAccess(own, own)).toEqual({ kind: "blocked", reason: "You submitted this version." });
    const stage = refuse(STAGE_REFUSALS.waitingOn("Legal reviewer"));
    expect(decisionAccess(stage, stage)).toEqual({ kind: "blocked", reason: "Waiting on Legal reviewer." });
  });

  it("is hidden for someone who isn't an approver on the team: no dead buttons", () => {
    const generic = refuse(REASONS.generic);
    expect(decisionAccess(generic, generic)).toEqual({ kind: "hidden" });
  });

  it("reads the refusal's code, never its sentence (handoff review I11)", () => {
    // Reworded copy changes nothing: `generic` still hides, with any wording.
    const reworded = { ok: false, code: "generic", reason: "Ask a Team Admin for the Approver role." } as const;
    expect(decisionAccess(reworded, reworded)).toEqual({ kind: "hidden" });
    // And a sentence that happens to read like `generic` doesn't hide a refusal coded otherwise.
    const lookalike = { ok: false, code: "submitted_version", reason: REASONS.generic.reason } as const;
    expect(decisionAccess(lookalike, lookalike)).toEqual({ kind: "blocked", reason: REASONS.generic.reason });
  });

  it("takes Approve's refusal first, then Request changes'", () => {
    const own = refuse(REASONS.ownVersion);
    expect(decisionAccess(ok, own)).toEqual({ kind: "blocked", reason: REASONS.ownVersion.reason });
    expect(decisionAccess(refuse(REASONS.generic), own)).toEqual({ kind: "hidden" });
  });
});

describe("approvalStage", () => {
  it("is final when the current stage is the only one, or the last", () => {
    expect(approvalStage(ONE)).toMatchObject({ final: true, next: null, current: { name: "Team approver" } });
    expect(approvalStage(TWO_SECOND)).toMatchObject({ final: true, current: { name: "Legal reviewer" } });
  });

  it("names the next stage when it is not the last", () => {
    expect(approvalStage(TWO_FIRST)).toMatchObject({ final: false, next: { name: "Legal reviewer" } });
  });

  it("has no stage to decide when nothing is current", () => {
    expect(approvalStage([step(0, "Team approver", "returned")])).toEqual({ current: null, next: null, final: false });
  });
});

describe("approveLines", () => {
  it("says what goes live and that the previous version keeps rendering until it relinks", () => {
    expect(lines()).toEqual(["v3 becomes Active. v2 becomes Superseded; Coral keeps rendering v2 until it relinks."]);
  });

  it("follows the sunset date as it changes", () => {
    const first = lines({ sunset: "2027-03-01" });
    expect(first[0]).toBe("v3 becomes Active. v2 becomes Superseded.");
    expect(first[1]).toBe("Coral still renders v2 (last render today). It will keep working until March 1, 2027.");

    const moved = lines({ sunset: "2027-04-15" });
    expect(moved[1]).toBe("Coral still renders v2 (last render today). It will keep working until April 15, 2027.");

    // Switched off again: back to the first answer.
    expect(lines({ sunset: null })).toEqual(lines());
  });

  it("adds what each consumer has to map when the version breaks the contract", () => {
    const changes = [
      { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
      { kind: "added", key: "bonus_points", breaking: false, type: "number", required: false },
    ] as const;
    expect(lines({ contractChanges: changes })).toEqual([
      "v3 becomes Active. v2 becomes Superseded; Coral keeps rendering v2 until it relinks.",
      "Coral has to map `annual_fee` before it moves to v3.",
    ]);
    // Nothing breaks: nothing to map. Removing a variable asks nothing of a consumer either.
    expect(lines({ contractChanges: [changes[1]] })).toEqual(lines());
    expect(lines({ contractChanges: [{ kind: "removed", key: "old", breaking: true, type: "text", required: false }] })).toEqual(lines());
  });

  it("is one line when nothing is Active yet, and a sunset date has nothing to apply to", () => {
    expect(lines({ previousNumber: null })).toEqual(["v3 becomes Active.", "Consumers can start using it right away."]);
    expect(lines({ previousNumber: null, sunset: "2027-03-01" })).toEqual(["v3 becomes Active.", "Consumers can start using it right away."]);
  });

  it("says nobody renders the previous version when the log has no one", () => {
    expect(lines({ usage: [] })).toEqual(["v3 becomes Active. v2 becomes Superseded.", "No consumer renders v2."]);
  });

  it("only moves the version along at an earlier stage: no go-live, no sunset", () => {
    const out = lines({ stage: approvalStage(TWO_FIRST), sunset: "2027-03-01" });
    expect(out).toEqual(["v3 moves to Legal reviewer for approval. It isn't Active until the last stage approves."]);
  });

  it("names the round at an earlier stage once the version was sent back, and only released numbers at the last", () => {
    const round2 = { number: 3, round: 2, state: "in_review" } as const;
    expect(lines({ version: round2, stage: approvalStage(TWO_FIRST) })).toEqual([
      "v3, round 2 moves to Legal reviewer for approval. It isn't Active until the last stage approves.",
    ]);
    // Consumers never see a round: what goes live is v3.
    expect(lines({ version: round2 })).toEqual(lines());
  });
});

describe("decisionLine", () => {
  const base = { authorName: "Maya Chen", local: null, canDecideAgain: false, steps: [], nowIso: "2026-10-04T12:00:00.000Z" } as const;
  const JORDAN = { id: "jordan", name: "Jordan Ellis", initials: "JE", hue: 200 };
  const at = (state: VersionState, round = 1) => ({ version: { number: 3, round, state } });

  it("leaves the buttons in place while the version is in review", () => {
    expect(decisionLine({ ...base, ...at("in_review") })).toBeNull();
  });

  it("tells the approver of an earlier stage who is next, unless they can decide it too", () => {
    const local = { kind: "approved", wentLive: false, nextStage: "Legal reviewer" } as const;
    expect(decisionLine({ ...base, ...at("in_review"), local })).toBe("You approved this stage. Legal reviewer is next.");
    expect(decisionLine({ ...base, ...at("in_review"), local, canDecideAgain: true })).toBeNull();
  });

  it("words the decision as the viewer's own right after they make it, and as a plain record otherwise", () => {
    expect(decisionLine({ ...base, ...at("active"), local: { kind: "approved", wentLive: true, nextStage: null } })).toBe(
      "You approved v3.",
    );
    expect(decisionLine({ ...base, ...at("active") })).toBe("v3 is Active.");
    expect(decisionLine({ ...base, ...at("changes_requested"), local: { kind: "returned" } })).toBe(
      "You returned v3, round 1 to Maya Chen.",
    );
    expect(decisionLine({ ...base, ...at("superseded") })).toBe("v3 is Superseded.");
    expect(decisionLine({ ...base, ...at("revoked") })).toBe("v3 is Revoked.");
  });

  it("says who sent a round back, and when, as a record (the reason stays in its thread)", () => {
    const returned: StepView[] = [
      { position: 0, name: "Team approver", status: "returned", decidedBy: JORDAN, decidedAt: "2026-10-01T09:00:00.000Z" },
    ];
    expect(decisionLine({ ...base, ...at("changes_requested"), steps: returned })).toBe("Jordan Ellis requested changes 3 days ago.");
    const yesterday = [{ ...returned[0]!, decidedAt: "2026-10-03T18:00:00.000Z" }];
    expect(decisionLine({ ...base, ...at("changes_requested", 2), steps: yesterday })).toBe("Jordan Ellis requested changes yesterday.");
    // Right after the viewer sent it back, it is theirs.
    expect(decisionLine({ ...base, ...at("changes_requested"), steps: returned, local: { kind: "returned" } })).toBe(
      "You returned v3, round 1 to Maya Chen.",
    );
  });

  it("names the round it returned (a sent-back round always shows it), and a released version by its number", () => {
    expect(decisionLine({ ...base, ...at("changes_requested", 2), local: { kind: "returned" } })).toBe(
      "You returned v3, round 2 to Maya Chen.",
    );
    expect(decisionLine({ ...base, ...at("active", 3), local: { kind: "approved", wentLive: true, nextStage: null } })).toBe(
      "You approved v3.",
    );
    expect(decisionLine({ ...base, ...at("superseded", 3) })).toBe("v3 is Superseded.");
  });
});
