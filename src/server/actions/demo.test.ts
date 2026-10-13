import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { DEMO_REFUSALS } from "@/domain/demo";
import { runAccessSweep } from "@/server/access-sweep";
import { advanceClock } from "@/server/clock";
import { resetDemo } from "@/server/reset";
import { runSunsetSweep } from "@/server/sunset-sweep";
import { getPersonas } from "@/server/viewer";
import { advanceClockAction, resetDemoAction } from "./demo";
import { switchPersona } from "./persona";

// The demo tools (reset, Advance clock, the persona switcher) answer `demo_mode_off` unless the server runs
// in demo mode, and touch nothing when they do (decision 0051). Everything they call is swapped for a spy,
// so the test shows what was and wasn't reached.

const env = vi.hoisted(() => ({
  demoMode: false,
  setCookie: vi.fn(),
}));

vi.mock("@/server/config", () => ({
  get DEMO_MODE() {
    return env.demoMode;
  },
}));
vi.mock("@/server/db/client", () => ({ db: {}, libsql: {} }));
vi.mock("@/server/access-sweep", () => ({ runAccessSweep: vi.fn() }));
vi.mock("@/server/sunset-sweep", () => ({ runSunsetSweep: vi.fn() }));
vi.mock("@/server/clock", () => ({ advanceClock: vi.fn(), now: vi.fn() }));
vi.mock("@/server/reset", () => ({ resetDemo: vi.fn() }));
vi.mock("@/server/viewer", () => ({
  DEFAULT_PERSONA: "maya",
  PERSONA_COOKIE: "ucomp_persona",
  getPersonas: vi.fn(async () => [{ id: "jordan" }]),
  getViewer: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: env.setCookie }),
}));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

/** Everything a demo tool could reach: a refused call must reach none of it. */
const reached = () =>
  [
    advanceClock,
    runAccessSweep,
    runSunsetSweep,
    resetDemo,
    getPersonas,
    env.setCookie,
    redirect,
  ].filter((spy) => vi.mocked(spy).mock.calls.length > 0);

beforeEach(() => {
  vi.clearAllMocks();
  env.demoMode = false;
});

describe("with the demo flag off", () => {
  it("refuses the data reset and resets nothing", async () => {
    expect(await resetDemoAction()).toEqual({
      ok: false,
      code: "demo_mode_off",
      reason: DEMO_REFUSALS.off.reason,
    });
    expect(reached()).toEqual([]);
  });

  it("refuses the clock advance, even for valid input, and moves nothing", async () => {
    expect(await advanceClockAction(15)).toMatchObject({
      ok: false,
      code: "demo_mode_off",
    });
    expect(reached()).toEqual([]);
  });

  it("refuses the persona switcher, even for a real persona, and sets no cookie", async () => {
    expect(
      await switchPersona("jordan", "/coral-offers/library"),
    ).toMatchObject({ ok: false, code: "demo_mode_off" });
    expect(reached()).toEqual([]);
  });
});

describe("with the demo flag on", () => {
  beforeEach(() => {
    env.demoMode = true;
  });

  it("advances the clock and runs the sweeps", async () => {
    expect(await advanceClockAction(15)).toEqual({ ok: true });
    expect(advanceClock).toHaveBeenCalledWith(15);
    expect(runAccessSweep).toHaveBeenCalledOnce();
    expect(runSunsetSweep).toHaveBeenCalledOnce();
  });

  it("still refuses days that aren't 1 to 3,650", async () => {
    expect(await advanceClockAction(0)).toMatchObject({
      code: REQUEST_REFUSALS.invalidInput.code,
    });
    expect(advanceClock).not.toHaveBeenCalled();
  });

  it("resets, returns to Maya and lands on the library", async () => {
    vi.mocked(resetDemo).mockResolvedValue({ ok: true, counts: {} });
    await resetDemoAction();
    expect(resetDemo).toHaveBeenCalledOnce();
    expect(env.setCookie).toHaveBeenCalledWith(
      "ucomp_persona",
      "maya",
      expect.anything(),
    );
    expect(redirect).toHaveBeenCalledWith("/coral-offers/library");
  });

  it("answers the reset's refusal and goes no further", async () => {
    vi.mocked(resetDemo).mockResolvedValue({
      ok: false,
      code: DEMO_REFUSALS.notLocalFile.code,
      reason: DEMO_REFUSALS.notLocalFile.reason,
    });
    expect(await resetDemoAction()).toMatchObject({
      ok: false,
      code: "reset_needs_local_file",
    });
    expect(env.setCookie).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still refuses a persona that isn't one", async () => {
    expect(await switchPersona("nobody", "/")).toMatchObject({
      ok: false,
      code: REQUEST_REFUSALS.invalidInput.code,
    });
    expect(env.setCookie).not.toHaveBeenCalled();
  });
});
