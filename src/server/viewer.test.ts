import { beforeEach, describe, expect, it, vi } from "vitest";
import { seededDatabasePerTest } from "@/server/testing/review-fixtures";
import { getViewer, PERSONA_COOKIE } from "./viewer";

// The sign-in stand-in fails closed: a missing or unknown persona cookie is nobody, unless the demo tools are on
// (handoff review S2, decision 0051). Against the seeded database, with the cookie and the flag swapped.

const env = vi.hoisted(() => ({
  demoMode: false,
  cookie: undefined as string | undefined,
}));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-viewer-");
});
vi.mock("@/server/config", () => ({
  get DEMO_MODE() {
    return env.demoMode;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === PERSONA_COOKIE && env.cookie !== undefined
        ? { name, value: env.cookie }
        : undefined,
  }),
}));

seededDatabasePerTest({ base: new Date("2026-10-04T12:00:00.000Z") });

beforeEach(() => {
  env.demoMode = false;
  env.cookie = undefined;
});

describe("getViewer", () => {
  it("is the person the cookie names, flag or no flag", async () => {
    env.cookie = "jordan";
    expect(await getViewer()).toMatchObject({ userId: "jordan" });
    env.demoMode = true;
    expect(await getViewer()).toMatchObject({ userId: "jordan" });
  });

  it("is nobody without a cookie, or with one naming no user, when the demo tools are off", async () => {
    expect(await getViewer()).toBeNull();
    env.cookie = "nobody";
    expect(await getViewer()).toBeNull();
  });

  it("is Maya without a cookie, or with one naming no user, when the demo tools are on", async () => {
    env.demoMode = true;
    expect(await getViewer()).toMatchObject({ userId: "maya" });
    env.cookie = "nobody";
    expect(await getViewer()).toMatchObject({ userId: "maya" });
  });
});
