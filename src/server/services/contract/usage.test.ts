import { describe, vi } from "vitest";
import { localContractHarness } from "../local/contract-harness";
import { usageContract } from "./usage";

// The Usage contract (./usage.ts) against the local implementation, on a seeded database per test. The fake
// doesn't serve the Usage counts (no command changes a render count, so no case needs it to: decision 0072's
// slim fake); the Java run provides a harness that can record renders.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-usage-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("local", () => {
  usageContract(localContractHarness({ base: BASE }), BASE);
});
