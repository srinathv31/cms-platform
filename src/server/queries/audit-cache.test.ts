import { afterEach, describe, expect, it, vi } from "vitest";

// The Audit page reads once per request: its header (Export count) and its table each parse their
// own filters object, and React's `cache` keys an argument by identity. Outside a server request
// React's `cache` doesn't memoize, so this stands in a per-request cache with React's keying.

const calls = vi.hoisted(() => ({ requireSpace: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  /** React's semantics: one entry per argument list, objects compared by identity. */
  function identityCache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const entries: { args: A; result: R }[] = [];
    return (...args: A) => {
      const hit = entries.find((entry) => entry.args.length === args.length && entry.args.every((arg, i) => Object.is(arg, args[i])));
      if (hit) return hit.result;
      const result = fn(...args);
      entries.push({ args, result });
      return result;
    };
  }
  return { ...actual, cache: identityCache };
});
vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("./spaces", () => ({
  requireSpace: vi.fn(async () => {
    calls.requireSpace += 1;
    throw new Error("stop after the first step");
  }),
}));

afterEach(() => {
  calls.requireSpace = 0;
});

describe("getAuditPage", () => {
  it("two equal filter objects share one read", async () => {
    const { getAuditPage } = await import("./audit");
    const header = getAuditPage("all", { team: "deposits", action: "access" });
    const table = getAuditPage("all", { action: "access", team: "deposits" });
    expect(table).toBe(header);
    await expect(header).rejects.toThrow("stop after the first step");
    expect(calls.requireSpace).toBe(1);
  });

  it("different filters or spaces are different reads", async () => {
    const { getAuditPage } = await import("./audit");
    const a = getAuditPage("all", { team: "deposits" });
    const b = getAuditPage("all", { team: "coral-offers" });
    const c = getAuditPage("deposits", { team: "deposits" });
    await Promise.allSettled([a, b, c]);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(calls.requireSpace).toBe(3);
  });
});
