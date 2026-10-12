import { describe, expect, it } from "vitest";
import {
  DEMO_REFUSALS,
  demoToolsRefusal,
  isLocalDatabaseFile,
  resetRefusal,
} from "./demo";

describe("demoToolsRefusal", () => {
  it("lets the tools run in demo mode", () => {
    expect(demoToolsRefusal(true)).toBeNull();
  });

  it("refuses them otherwise, with a code of its own", () => {
    expect(demoToolsRefusal(false)).toEqual({
      ok: false,
      code: "demo_mode_off",
      reason: "The demo tools are turned off.",
    });
    expect(DEMO_REFUSALS.off.code).toBe("demo_mode_off");
  });
});

describe("isLocalDatabaseFile", () => {
  it.each([
    "file:./data/ucomp.db",
    "file:/Users/someone/stencil/data/ucomp.db",
    "file:///tmp/ucomp.db",
    "FILE:./data/ucomp.db",
    "  file:./data/e2e-0.db ",
  ])("accepts %s", (url) => {
    expect(isLocalDatabaseFile(url)).toBe(true);
  });

  it.each([
    "libsql://stencil-prod.turso.io",
    "libsql://localhost:8080",
    "https://stencil-prod.turso.io",
    "http://127.0.0.1:8080",
    "wss://stencil-prod.turso.io",
    "ws://127.0.0.1:8080",
    ":memory:",
    "./data/ucomp.db",
    "",
  ])("rejects %s", (url) => {
    expect(isLocalDatabaseFile(url)).toBe(false);
  });
});

describe("resetRefusal", () => {
  it("lets a local file be reset", () => {
    expect(resetRefusal("file:./data/ucomp.db")).toBeNull();
  });

  it("refuses a remote database, with a code of its own", () => {
    expect(resetRefusal("libsql://stencil-prod.turso.io")).toEqual({
      ok: false,
      code: "reset_needs_local_file",
      reason: "The demo reset only runs on a local database file.",
    });
    expect(DEMO_REFUSALS.notLocalFile.code).toBe("reset_needs_local_file");
  });
});
