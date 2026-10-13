import { describe, vi } from "vitest";
import { fakeContractHarness } from "../fake/contract-harness";
import { localContractHarness } from "../local/contract-harness";
import { sweepsContract } from "./sweeps";

// The scheduled jobs' contract (./sweeps.ts) against each implementation: the fake, and the local one on a seeded
// database per test.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-sweeps-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("fake", () => {
  sweepsContract(fakeContractHarness({ base: BASE }), BASE);
});

describe("local", () => {
  sweepsContract(localContractHarness({ base: BASE }), BASE);
});
