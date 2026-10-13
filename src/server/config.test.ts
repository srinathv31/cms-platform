import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";

// The server's configuration, read from an environment once: `DEMO_MODE` and `STENCIL_BACKEND`.

describe("DEMO_MODE", () => {
  it("is off when unset, so a deployment with no environment has no demo tools", () => {
    expect(parseConfig({}).demoMode).toBe(false);
    expect(parseConfig({ DEMO_MODE: undefined }).demoMode).toBe(false);
  });

  it.each(["", "  ", "0", "false", "FALSE"])("is off for %j", (value) => {
    expect(parseConfig({ DEMO_MODE: value }).demoMode).toBe(false);
  });

  it.each(["1", "true", "TRUE", " 1 "])("is on for %j", (value) => {
    expect(parseConfig({ DEMO_MODE: value }).demoMode).toBe(true);
  });

  it.each(["yes", "on", "2", "enabled"])(
    "is a mistake for %j, which is not guessed at",
    (value) => {
      expect(() => parseConfig({ DEMO_MODE: value })).toThrow(
        "DEMO_MODE must be 1, true, 0 or false, or left unset.",
      );
    },
  );
});

describe("STENCIL_BACKEND", () => {
  it("is local when unset or empty", () => {
    expect(parseConfig({}).backend).toBe("local");
    expect(parseConfig({ STENCIL_BACKEND: " " }).backend).toBe("local");
    expect(parseConfig({ STENCIL_BACKEND: "Local" }).backend).toBe("local");
  });

  it.each(["http", "java", "fake"])(
    "refuses %j: no other backend is built",
    (value) => {
      expect(() => parseConfig({ STENCIL_BACKEND: value })).toThrow(
        "STENCIL_BACKEND must be local, or left unset (the HTTP backend isn't built yet).",
      );
    },
  );

  it("names every variable that is wrong in one error", () => {
    expect(() =>
      parseConfig({ DEMO_MODE: "yes", STENCIL_BACKEND: "http" }),
    ).toThrow(/DEMO_MODE must be .* STENCIL_BACKEND must be local/);
  });
});
