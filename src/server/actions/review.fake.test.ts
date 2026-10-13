import { refresh, revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import { setSunset } from "./review";

// The review actions as the BFF runs them, against the in-memory fake (decision 0068): what an action adds
// to its service is the input's parse, the answer's shape, and which pages refresh. What the service decides
// (the refusals, the writes, the notices) is the contract suite's (src/server/services/contract/review.ts),
// which holds the fake and the database to the same cases.

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

describe("setSunset", () => {
  const sunset = (sunsetAt: string, versionNumber = 1) =>
    setSunset({
      templateId: backend.templates["balance-transfer"]!,
      versionNumber,
      sunsetAt,
    });

  it("answers { ok: true } and refreshes the pages that show the version", async () => {
    backend.as("alex");
    expect(await sunset("2026-11-20")).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/[team]/library", "page");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/[team]/templates/[templateId]",
      "layout",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/[team]/review", "layout");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("sends the day picked as the sunset's day", async () => {
    const ctx = backend.as("alex");
    await sunset("2026-11-20");
    const history = await services().versions.history(ctx, {
      templateId: backend.templates["balance-transfer"]!,
    });
    expect(
      history.ok && history.versions.find((v) => v.number === 1)?.sunsetDay,
    ).toBe("2026-11-20");
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
    expect(
      await setSunset({
        templateId: backend.templates["balance-transfer"]!,
        versionNumber: 0,
        sunsetAt: "2026-11-20",
      }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.invalidInput() });
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
