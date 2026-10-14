import { afterEach, describe, expect, it, vi } from "vitest";
import { WRITE_TURN_WAIT_MS } from "@/lib/serialized-writes";
import type { Db } from "@/server/db/client";
import { standaloneDatabasePerTest } from "@/server/testing/review-fixtures";
import { inTransaction } from "./transaction";

// The local backend's write transaction against a temporary database filled by the real seed: it runs once,
// and a busy database is the answer, not a reason to try again.

const { db, libsql } = standaloneDatabasePerTest({
  base: new Date("2026-10-04T12:00:00.000Z"),
});

describe("inTransaction", () => {
  const busy = Object.assign(new Error("database is locked"), {
    code: "SQLITE_BUSY",
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs the transaction once: a busy failure is the answer, not a reason to try again", async () => {
    const transaction = vi.fn().mockRejectedValue(busy);
    await expect(
      inTransaction({ transaction } as unknown as Db, async () => 0),
    ).rejects.toBe(busy);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("passes any other error straight through", async () => {
    const transaction = vi
      .fn()
      .mockRejectedValue(new Error("constraint failed"));
    await expect(
      inTransaction({ transaction } as unknown as Db, async () => 0),
    ).rejects.toThrow("constraint failed");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  // The worst case a server action, an autosave or a sweep can wait (src/lib/serialized-writes.ts): stuck
  // behind a write that never ends, it fails once the client's turn wait is over, and tries nothing more.
  it("behind a write that never ends, fails after the client's 5 s wait and never tries again", async () => {
    const attempts = vi.spyOn(db, "transaction");
    const run = vi.fn(async () => "written");
    const held = await libsql.transaction("write");
    try {
      vi.useFakeTimers();
      const outcome = vi.fn();
      inTransaction(db, run).then(
        () => outcome("written"),
        (error: { code?: string }) => outcome(error.code),
      );
      await vi.advanceTimersByTimeAsync(WRITE_TURN_WAIT_MS - 1);
      expect(outcome, "a moment before the limit").not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toHaveBeenCalledWith("SQLITE_BUSY");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(attempts).toHaveBeenCalledTimes(1);
      expect(run, "the transaction never opened").not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await held.rollback();
    }
  });
});
