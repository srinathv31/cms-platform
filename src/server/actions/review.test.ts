import { refresh, revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { OUTPUT_KEYS } from "@/domain/review-outputs";
import type { ActionResult } from "@/domain/review-types";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import {
  approveVersion,
  cancelRevoke,
  confirmRevoke,
  requestChanges,
  setSunset,
  startRevoke,
  submitVersion,
} from "./review";

// The review actions as the BFF runs them, against the in-memory fake (decision 0068): what an action adds
// to its service is the input's parse, the answer's shape, and which pages refresh. What the service decides
// (the refusals, the writes, the notices) is the contract suite's (src/server/services/contract/review.ts),
// which holds the fake and the database to the same cases. The seed: Cash Back v3 round 2 is in review
// (Maya's), Annual Fee Waiver has Maya's open draft, Balance Transfer v1 is Superseded under an Active v2.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

const id = (key: string) => backend.templates[key]!;

/** The pages a lifecycle change shows on, refreshed once. */
function expectRefreshed() {
  expect(revalidatePath).toHaveBeenCalledWith("/[team]/library", "page");
  expect(revalidatePath).toHaveBeenCalledWith(
    "/[team]/templates/[templateId]",
    "layout",
  );
  expect(revalidatePath).toHaveBeenCalledWith("/[team]/review", "layout");
  expect(refresh).toHaveBeenCalledTimes(1);
}

/** A version's row as the Versions read shows it to `userId`. */
async function rowOf(
  userId: string,
  templateId: string,
  number: number,
  round?: number,
) {
  const history = await services().versions.history(backend.as(userId), {
    templateId,
  });
  if (!history.ok) throw new Error(history.code);
  return history.versions.find(
    (v) =>
      v.number === number && (round === undefined ? v.head : v.round === round),
  );
}

/** The draft's rev, from the submit summary Maya reads. */
async function draftRev(templateId: string) {
  const summary = await services().review.submitSummary(backend.as("maya"), {
    templateId,
  });
  if (!summary.ok) throw new Error(summary.code);
  return summary.rev;
}

// Every action, called the way its page calls it: what it answers on success, and its input the parser refuses.
const ACTIONS: {
  name: string;
  as: string;
  call: () => Promise<ActionResult<object>>;
  answer: object;
  unparsable: () => Promise<ActionResult<object>>;
}[] = [
  {
    name: "submitVersion",
    as: "maya",
    call: async () =>
      submitVersion({
        templateId: id("annual-fee-waiver"),
        rev: await draftRev(id("annual-fee-waiver")),
      }),
    answer: { ok: true, number: 1, round: 2 },
    unparsable: () =>
      submitVersion({ templateId: id("annual-fee-waiver"), rev: -1 }),
  },
  {
    name: "requestChanges",
    as: "jordan",
    call: () =>
      requestChanges({
        templateId: id("cash-back"),
        versionNumber: 3,
        round: 2,
        reason: "Spell out the fee.",
      }),
    answer: { ok: true },
    unparsable: () =>
      requestChanges({
        templateId: id("cash-back"),
        versionNumber: 3,
        round: 0,
        reason: "Spell out the fee.",
      }),
  },
  {
    name: "approveVersion",
    as: "jordan",
    call: () =>
      approveVersion({
        templateId: id("cash-back"),
        versionNumber: 3,
        round: 2,
        sampleSetsSeen: ["typical"],
        outputsViewed: ["pdf", "web"],
      }),
    answer: { ok: true, wentLive: true, number: 3, round: 2 },
    unparsable: () =>
      approveVersion({
        templateId: id("cash-back"),
        versionNumber: 3,
        round: 2,
        sampleSetsSeen: [],
        outputsViewed: ["push"] as unknown as typeof OUTPUT_KEYS,
      }),
  },
  {
    name: "startRevoke",
    as: "jordan",
    call: () =>
      startRevoke({
        templateId: id("balance-transfer"),
        versionNumber: 2,
        reason: "Wrong APR.",
      }),
    answer: { ok: true },
    unparsable: () =>
      startRevoke({
        templateId: id("balance-transfer"),
        versionNumber: 2,
        reason: 7 as unknown as string,
      }),
  },
  {
    name: "confirmRevoke",
    as: "alex",
    call: async () => {
      await services().review.startRevoke(backend.as("jordan"), {
        templateId: id("balance-transfer"),
        versionNumber: 2,
        reason: "Wrong APR.",
      });
      backend.as("alex");
      return confirmRevoke({
        templateId: id("balance-transfer"),
        versionNumber: 2,
      });
    },
    answer: { ok: true },
    unparsable: () => confirmRevoke({ templateId: "", versionNumber: 2 }),
  },
  {
    name: "cancelRevoke",
    as: "alex",
    call: async () => {
      await services().review.startRevoke(backend.as("jordan"), {
        templateId: id("balance-transfer"),
        versionNumber: 2,
        reason: "Wrong APR.",
      });
      backend.as("alex");
      return cancelRevoke({
        templateId: id("balance-transfer"),
        versionNumber: 2,
      });
    },
    answer: { ok: true },
    unparsable: () =>
      cancelRevoke({ templateId: id("balance-transfer"), versionNumber: 1.5 }),
  },
];

describe.each(ACTIONS)("$name", ({ as, call, answer, unparsable }) => {
  it("answers the service's result and refreshes the pages that show the version", async () => {
    backend.as(as);
    expect(await call()).toEqual(answer);
    expectRefreshed();
  });

  it("refuses input that doesn't parse before asking the service, and refreshes nothing", async () => {
    backend.as(as);
    expect(await unparsable()).toMatchObject({
      ok: false,
      code: REQUEST_REFUSALS.invalidInput().code,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in, before anything else", async () => {
    backend.signOut();
    expect(await unparsable()).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.signedOut,
    });
  });
});

describe("the actions pass the service what the page sent", () => {
  it("submitVersion: the note and the summary's rev; a stale rev is the service's refusal, sentence and all", async () => {
    const templateId = id("annual-fee-waiver");
    backend.as("maya");
    const rev = await draftRev(templateId);
    expect(await submitVersion({ templateId, rev: rev + 1 })).toEqual({
      ok: false,
      ...REFUSALS.summaryStale,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(
      await submitVersion({ templateId, rev, note: "  Ready for a look. " }),
    ).toEqual({ ok: true, number: 1, round: 2 });
    expect((await rowOf("maya", templateId, 1, 2))?.submitNote).toBe(
      "Ready for a look.",
    );
  });

  it("submitVersion: a call without a rev doesn't parse", async () => {
    backend.as("maya");
    const unchecked = submitVersion as (input: {
      templateId: string;
    }) => ReturnType<typeof submitVersion>;
    expect(
      await unchecked({ templateId: id("annual-fee-waiver") }),
    ).toMatchObject({ ok: false, code: REQUEST_REFUSALS.invalidInput().code });
  });

  it("requestChanges: the round and the reason", async () => {
    const templateId = id("cash-back");
    backend.as("jordan");
    expect(
      await requestChanges({
        templateId,
        versionNumber: 3,
        round: 1,
        reason: "x",
      }),
    ).toEqual({ ok: false, ...REFUSALS.notInReview });
    expect(
      await requestChanges({
        templateId,
        versionNumber: 3,
        round: 2,
        reason: "  Spell out the fee. ",
      }),
    ).toEqual({ ok: true });
    expect((await rowOf("jordan", templateId, 3, 2))?.decisions).toEqual([
      expect.objectContaining({
        kind: "changes_requested",
        by: "jordan",
        reason: "Spell out the fee.",
      }),
    ]);
  });

  it("approveVersion: the outputs viewed and the sunset day for the version it supersedes", async () => {
    const templateId = id("cash-back");
    backend.as("jordan");
    expect(
      await approveVersion({
        templateId,
        versionNumber: 3,
        round: 2,
        sampleSetsSeen: [],
        outputsViewed: ["pdf"],
      }),
    ).toMatchObject({ ok: false, code: "output_not_viewed" });
    expect(
      await approveVersion({
        templateId,
        versionNumber: 3,
        round: 2,
        sunsetPrevious: "2026-11-20",
        sampleSetsSeen: ["typical"],
        outputsViewed: ["pdf", "web"],
      }),
    ).toMatchObject({ ok: true, wentLive: true });
    expect((await rowOf("jordan", templateId, 2))?.sunsetDay).toBe(
      "2026-11-20",
    );
  });

  it("startRevoke, confirmRevoke: the version and the reason; the starter can't confirm", async () => {
    const templateId = id("balance-transfer");
    backend.as("jordan");
    expect(
      await startRevoke({ templateId, versionNumber: 1, reason: "Wrong APR." }),
    ).toEqual({ ok: true });
    expect((await rowOf("jordan", templateId, 1))?.revoke).toMatchObject({
      reason: "Wrong APR.",
      startedBy: "jordan",
    });
    vi.mocked(refresh).mockClear();
    expect(await confirmRevoke({ templateId, versionNumber: 1 })).toEqual({
      ok: false,
      ...REASONS.ownRevoke,
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("setSunset", () => {
  const sunset = (sunsetAt: string, versionNumber = 1) =>
    setSunset({
      templateId: id("balance-transfer"),
      versionNumber,
      sunsetAt,
    });

  it("answers { ok: true } and refreshes the pages that show the version", async () => {
    backend.as("alex");
    expect(await sunset("2026-11-20")).toEqual({ ok: true });
    expectRefreshed();
  });

  it("sends the day picked as the sunset's day", async () => {
    backend.as("alex");
    await sunset("2026-11-20");
    expect((await rowOf("alex", id("balance-transfer"), 1))?.sunsetDay).toBe(
      "2026-11-20",
    );
  });

  it("refreshes nothing when the service had nothing to write (the same day again)", async () => {
    backend.as("alex");
    await sunset("2026-11-20");
    vi.mocked(refresh).mockClear();
    expect(await sunset("2026-11-20")).toEqual({ ok: true });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("answers the service's refusal as it is, its sentence included, and refreshes nothing", async () => {
    backend.as("alex");
    expect(await sunset("2026-11-20", 2)).toEqual({
      ok: false,
      ...REFUSALS.sunsetNotSuperseded,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses input that doesn't parse before asking the service", async () => {
    backend.as("alex");
    const spy = vi.spyOn(services().review, "setSunset");
    expect(await sunset("2026-11-20", 0)).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in, before anything else", async () => {
    backend.signOut();
    expect(await sunset("not a day")).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.signedOut,
    });
  });
});
