import { describe, vi } from "vitest";
import { localContractHarness } from "../local/contract-harness";
import { settingsContract } from "./settings";

// The settings reads' contract (./settings.ts) against the local implementation, on a seeded database per test.
// The fake doesn't implement these reads (decision 0072: a read in the fake only where a case must observe a
// command), so there is no fake run; add one when a command's case needs to observe a change through them.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-settings-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("local", () => {
  const h = localContractHarness({ base: BASE });
  settingsContract(h, BASE);
});
