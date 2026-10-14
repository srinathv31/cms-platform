import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_REFUSALS } from "@/domain/demo";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import { advanceClockAction, resetDemoAction } from "./demo";
import { switchPersona } from "./persona";

// The demo tools (reset, Advance clock, the persona switcher) as the BFF runs them, against the in-memory fake: they
// answer `demo_mode_off` unless the server runs in demo mode, and then ask nothing of the backend (decision 0051);
// in demo mode the BFF parses the input, sets the persona cookie, and refreshes or redirects. What the demo service
// does is the contract suite's (src/server/services/contract/demo.ts).

const env = vi.hoisted(() => ({ demoMode: false, setCookie: vi.fn() }));

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("@/server/config", () => ({
  get DEMO_MODE() {
    return env.demoMode;
  },
}));
vi.mock("@/server/viewer", () => ({
  DEFAULT_PERSONA: "maya",
  PERSONA_COOKIE: "ucomp_persona",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: env.setCookie }),
}));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
// As Next's does: `redirect` ends the action by throwing.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });

beforeEach(() => {
  vi.clearAllMocks();
  env.demoMode = false;
  backend.as("maya");
});

/** The demo service's calls, spied on. */
function spyOnDemo() {
  const demo = services().demo;
  return [
    vi.spyOn(demo, "reset"),
    vi.spyOn(demo, "advanceClock"),
    vi.spyOn(demo, "switchPersona"),
  ];
}

describe("with the demo flag off", () => {
  it("refuses every tool, asks the backend nothing, and sets no cookie", async () => {
    const spies = spyOnDemo();
    const off = { ok: false, ...DEMO_REFUSALS.off };
    expect(await resetDemoAction()).toEqual(off);
    expect(await advanceClockAction(15)).toEqual(off);
    expect(await switchPersona("jordan", "/coral-offers/library")).toEqual(off);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(env.setCookie).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("with the demo flag on", () => {
  beforeEach(() => {
    env.demoMode = true;
  });

  describe("Advance clock", () => {
    it("moves the backend's clock and refreshes every page", async () => {
      expect(await advanceClockAction(15)).toEqual({ ok: true });
      const readout = await services().demo.clockReadout(backend.as("maya"));
      expect(readout).toMatchObject({ ok: true, offsetDays: 15 });
      expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("refuses days that aren't 1 to 3,650 before asking the backend", async () => {
      const advance = vi.spyOn(services().demo, "advanceClock");
      for (const days of [0, 1.5, 3651])
        expect(await advanceClockAction(days)).toEqual({
          ok: false,
          ...REQUEST_REFUSALS.invalidInput("Enter 1 to 3,650 days."),
        });
      expect(advance).not.toHaveBeenCalled();
    });
  });

  describe("the reset", () => {
    it("resets, returns to Maya and lands on the Coral Offers library", async () => {
      const reset = vi.spyOn(services().demo, "reset");
      await expect(resetDemoAction()).rejects.toThrow(
        "NEXT_REDIRECT /coral-offers/library",
      );
      expect(reset).toHaveBeenCalledOnce();
      expect(env.setCookie).toHaveBeenCalledWith(
        "ucomp_persona",
        "maya",
        expect.objectContaining({ path: "/" }),
      );
    });

    it("answers the backend's refusal and goes no further", async () => {
      const reset = vi.spyOn(services().demo, "reset");
      reset.mockResolvedValue({ ok: false, ...DEMO_REFUSALS.notLocalFile });
      expect(await resetDemoAction()).toEqual({
        ok: false,
        ...DEMO_REFUSALS.notLocalFile,
      });
      expect(env.setCookie).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("the persona switcher", () => {
    it("asks the backend about the space the URL names, never one of the app's own routes", async () => {
      const switched = vi.spyOn(services().demo, "switchPersona");
      const slugs: (string | null)[] = [];
      switched.mockImplementation(async (_ctx, { slug }) => {
        slugs.push(slug);
        return { ok: true, space: null, homeSlug: null };
      });
      for (const path of [
        "/coral-offers/templates/UC-1/versions",
        "/all/audit?team=deposits",
        "/request-access",
        "/",
        "not a path",
      ])
        await switchPersona("jordan", path).catch(() => undefined);
      expect(slugs).toEqual(["coral-offers", "all", null, null, null]);
    });

    it("stays on a URL the new persona may see: the cookie, and the page refreshes", async () => {
      expect(await switchPersona("jordan", "/coral-offers/library")).toEqual({
        ok: true,
      });
      expect(env.setCookie).toHaveBeenCalledWith(
        "ucomp_persona",
        "jordan",
        expect.objectContaining({ path: "/" }),
      );
      expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
      expect(refresh).toHaveBeenCalledOnce();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("goes to the new persona's first space from a space they may not see", async () => {
      await expect(
        switchPersona("jordan", "/deposits/library"),
      ).rejects.toThrow("NEXT_REDIRECT /coral-offers/library");
      expect(env.setCookie).toHaveBeenCalledWith(
        "ucomp_persona",
        "jordan",
        expect.anything(),
      );
    });

    it("sends someone with no team yet to ask for access, and lets them stay there", async () => {
      await expect(
        switchPersona("morgan", "/coral-offers/library"),
      ).rejects.toThrow("NEXT_REDIRECT /request-access");
      vi.mocked(refresh).mockClear();
      expect(await switchPersona("morgan", "/request-access")).toEqual({
        ok: true,
      });
      expect(refresh).toHaveBeenCalledOnce();
    });

    it("takes someone who has a team from Request access to it", async () => {
      await expect(switchPersona("maya", "/request-access")).rejects.toThrow(
        "NEXT_REDIRECT /coral-offers/library",
      );
    });

    it("keeps a platform role in All teams, and stays put on a path that names no space", async () => {
      expect(await switchPersona("riley", "/all/library")).toEqual({
        ok: true,
      });
      expect(await switchPersona("jordan", "/")).toEqual({ ok: true });
      expect(redirect).not.toHaveBeenCalled();
    });

    it("refuses a persona that isn't one, and sets no cookie", async () => {
      expect(await switchPersona("nobody", "/")).toEqual({
        ok: false,
        ...REQUEST_REFUSALS.invalidInput(),
      });
      expect(await switchPersona("", "/")).toMatchObject({
        ok: false,
        code: "invalid_input",
      });
      expect(env.setCookie).not.toHaveBeenCalled();
    });
  });
});
