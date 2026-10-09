import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_REFUSALS } from "./access";
import { STAGE_REFUSALS } from "./approval-chain";
import { COMMENT_REFUSALS } from "./comments";
import { REFUSALS } from "./lifecycle";
import { REASONS } from "./permissions";
import { PLATFORM_REFUSALS } from "./platform-config";
import { REQUEST_REFUSALS, refusal, refuse, type RefusalCode } from "./refusals";

// Every refusal people read carries a stable code, and the code is what code branches on
// (handoff review I11). These tests hold the tables to that: every entry has a code, no two entries
// share one, and nothing outside the domain compares a refusal's sentence.

const TABLES = {
  REASONS,
  REFUSALS,
  STAGE_REFUSALS,
  COMMENT_REFUSALS,
  ACCESS_REFUSALS,
  PLATFORM_REFUSALS,
  REQUEST_REFUSALS,
} as const;

const entries = Object.entries(TABLES).flatMap(([table, entries]) =>
  Object.entries(entries as Record<string, { code: string; reason?: unknown }>).map(([key, entry]) => ({
    name: `${table}.${key}`,
    entry,
  })),
);

describe("refusal codes", () => {
  it("covers every table", () => {
    expect(entries.length).toBeGreaterThan(90);
  });

  it("gives every refusal a code: a short snake_case identifier", () => {
    for (const { name, entry } of entries) expect(entry.code, name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it("gives no two refusals the same code", () => {
    const byCode = new Map<string, string[]>();
    for (const { name, entry } of entries) byCode.set(entry.code, [...(byCode.get(entry.code) ?? []), name]);
    const shared = [...byCode].filter(([, names]) => names.length > 1);
    expect(shared).toEqual([]);
  });

  it("keeps `failed`, the code a refusal made in the browser carries, for the browser", () => {
    expect(entries.map((e) => e.entry.code)).not.toContain("failed" satisfies RefusalCode);
  });

  it("words every fixed refusal as one plain sentence or two", () => {
    for (const { name, entry } of entries) {
      if (typeof entry === "function") continue;
      expect(entry.reason, name).toMatch(/^[A-Z"].*[.]$/);
    }
  });
});

describe("refusal and refuse", () => {
  it("builds a fixed refusal", () => {
    expect(refusal("generic", "You don't have access to do this.")).toEqual({
      code: "generic",
      reason: "You don't have access to do this.",
    });
  });

  it("builds a worded refusal whose code is readable without calling it", () => {
    const lastAdmin = refusal("last_admin", (team: string) => `${team} needs at least one Team Admin.`);
    expect(lastAdmin.code).toBe("last_admin");
    expect(lastAdmin("Coral Offers")).toEqual({ code: "last_admin", reason: "Coral Offers needs at least one Team Admin." });
    expect(ACCESS_REFUSALS.lastAdmin.code).toBe(ACCESS_REFUSALS.lastAdmin("Deposits").code);
    expect(STAGE_REFUSALS.waitingOn("Legal reviewer")).toEqual({ code: "waiting_on_stage", reason: "Waiting on Legal reviewer." });
  });

  it("refuse gives the result rules, read models and actions return", () => {
    expect(refuse(REASONS.ownRevoke)).toEqual({
      ok: false,
      code: "own_revoke",
      reason: "You started this revoke. Another approver must confirm it.",
    });
    expect(refuse(REQUEST_REFUSALS.noteTooLong(2000))).toEqual({
      ok: false,
      code: "note_too_long",
      reason: "Keep the note under 2,000 characters.",
    });
  });
});

describe("nothing branches on a refusal's sentence", () => {
  const root = join(process.cwd(), "src");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(join(dir, e.name))
        : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
    );
  const sources = ["components", "server", "app", "lib"].flatMap((dir) => files(join(root, dir)));
  const TABLE = Object.keys(TABLES).join("|");
  const COMPARES = [
    // `x === REASONS.generic`, `REFUSALS.summaryStale.reason !== y`
    new RegExp(`[!=]==\\s*(${TABLE})\\.|\\b(${TABLE})\\.[A-Za-z]+(\\.reason)?\\s*[!=]==`),
    // `result.reason === "You submitted…"` (a sentence; codes are lower case), `reason.startsWith(…)`
    /\breason\s*[!=]==\s*["'`][A-Z]|\breason\??\.(startsWith|endsWith|includes|match)\(/,
  ];

  it("reads the files", () => {
    expect(sources.length).toBeGreaterThan(200);
  });

  it.each(COMPARES.map((pattern) => [pattern.source, pattern] as const))("none matches %s", (_, pattern) => {
    const hits = sources.filter((path) => pattern.test(readFileSync(path, "utf8"))).map((path) => path.slice(root.length + 1));
    expect(hits).toEqual([]);
  });
});
