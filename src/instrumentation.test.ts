import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

// The server's start-up check: loading the configuration when the server starts, so a setting that
// isn't valid stops it at boot. `parseConfig`'s own rules are tested in `server/config.test.ts`.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Starts the server's way: the Node.js runtime, with `DEMO_MODE` as given (undefined is unset). */
async function startWith(demoMode: string | undefined, runtime = "nodejs") {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => {
    // A test must not end the run.
  }) as never);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_RUNTIME", runtime);
  vi.stubEnv("DEMO_MODE", demoMode);
  vi.resetModules();
  await register();
  return { exit, log };
}

describe("register", () => {
  it("stops the server with a message naming the variable when DEMO_MODE isn't valid", async () => {
    const { exit, log } = await startWith("banana");
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(
      "Stencil did not start. Invalid configuration. DEMO_MODE must be 1, true, 0 or false, or left unset.",
    );
  });

  it.each([undefined, "", "0", "false", "1", "true"])(
    "starts with DEMO_MODE=%j",
    async (value) => {
      const { exit, log } = await startWith(value);
      expect(exit).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("checks nothing outside the Node.js runtime", async () => {
    const { exit } = await startWith("banana", "edge");
    expect(exit).not.toHaveBeenCalled();
  });
});
