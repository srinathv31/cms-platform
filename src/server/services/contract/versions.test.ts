import { describe, vi } from "vitest";
import { fakeContractHarness } from "../fake/contract-harness";
import { localContractHarness } from "../local/contract-harness";
import { versionContentContract, versionsContract } from "./versions";

// The versions contract (./versions.ts) against each implementation: the fake, and the local one on a seeded
// database per test. Compare and the base version run against the local one only: the fake serves a read only
// where a contract case observes a command through it (decision 0072).

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-versions-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("fake", () => {
  versionsContract(fakeContractHarness({ base: BASE }), BASE);
});

describe("local", () => {
  const harness = localContractHarness({ base: BASE });
  versionsContract(harness, BASE);
  versionContentContract(harness);
});
