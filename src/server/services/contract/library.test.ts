import { describe, vi } from "vitest";
import { fakeContractHarness } from "../fake/contract-harness";
import { localContractHarness } from "../local/contract-harness";
import { libraryContract } from "./library";

// The Library and palette contract (./library.ts) against each implementation: the fake, and the local one on a
// seeded database per test.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-library-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("fake", () => {
  libraryContract(fakeContractHarness({ base: BASE }), BASE);
});

describe("local", () => {
  libraryContract(localContractHarness({ base: BASE }), BASE);
});
