import { beforeEach, describe, expect, it, vi } from "vitest";

// The Demo pill is mounted in the product's frame and in Coral's, and it is there only when the server runs in
// demo mode (decision 0051). The gate reads the flag at request time, after `connection()`, so the static shell
// holds an empty fallback whichever way the build ran.

const env = vi.hoisted(() => ({ demoMode: false }));

vi.mock("@/server/config", () => ({
  get DEMO_MODE() {
    return env.demoMode;
  },
}));
const connection = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("next/server", () => ({ connection }));
// The pill itself, the clock readout (which reads the database) and the server actions are not under test.
vi.mock("./demo-pill", () => ({ DemoPill: () => null }));
vi.mock("./clock-readout", () => ({
  ClockReadout: () => null,
  ClockReadoutSkeleton: () => null,
}));

const { DemoTools } = await import("./demo-pill-hole");
const { DemoPill } = await import("./demo-pill");

beforeEach(() => {
  connection.mockClear();
  env.demoMode = false;
});

describe("DemoTools", () => {
  it("renders nothing with the flag off", async () => {
    expect(await DemoTools()).toBeNull();
  });

  it("renders the pill with the flag on", async () => {
    env.demoMode = true;
    const tools = await DemoTools();
    expect(tools?.type).toBe(DemoPill);
  });

  it("waits for the request before it reads the flag, either way", async () => {
    await DemoTools();
    env.demoMode = true;
    await DemoTools();
    expect(connection).toHaveBeenCalledTimes(2);
  });
});
