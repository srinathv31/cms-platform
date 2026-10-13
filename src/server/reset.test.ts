import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemo } from "./reset";

// `resetDemo()` drops every table, so it refuses a database that isn't a local SQLite file, with the demo
// flag or without (decision 0051). A local file is reset by `npm run db:reset` and the e2e suite.

const database = vi.hoisted(() => ({
  url: "libsql://stencil-prod.turso.io",
  execute: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  get DATABASE_URL() {
    return database.url;
  },
  // A reset that got past the refusal would run its first statement here.
  libsql: { execute: database.execute },
  db: {},
}));

beforeEach(() => {
  database.execute.mockReset();
});

describe("resetDemo", () => {
  it.each([
    "libsql://stencil-prod.turso.io",
    "https://stencil-prod.turso.io",
    "wss://stencil-prod.turso.io",
    ":memory:",
  ])("refuses %s before it touches the database", async (url) => {
    database.url = url;
    expect(await resetDemo()).toEqual({
      ok: false,
      code: "reset_needs_local_file",
      reason: "The demo reset only runs on a local database file.",
    });
    expect(database.execute).not.toHaveBeenCalled();
  });

  it("goes ahead on a local file", async () => {
    database.url = "file:./data/ucomp.db";
    // The stand-in database fails at its first statement: the reset got past the refusal and started.
    database.execute.mockRejectedValue(new Error("reached the database"));
    await expect(resetDemo()).rejects.toThrow("reached the database");
  });
});
