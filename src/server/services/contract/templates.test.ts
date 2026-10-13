import { describe, vi } from "vitest";
import { fakeContractHarness } from "../fake/contract-harness";
import { localContractHarness } from "../local/contract-harness";
import { templatesContract } from "./templates";

// The templates contract (./templates.ts) against each implementation: the fake, and the local one on a seeded
// database per test. The Java API's run joins here once its test environment exists.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-templates-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("fake", () => {
  templatesContract(fakeContractHarness({ base: BASE }), BASE);
});

describe("local", () => {
  templatesContract(localContractHarness({ base: BASE }), BASE);
});
