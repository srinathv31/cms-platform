import { describe, vi } from "vitest";
import { localContractHarness } from "../local/contract-harness";
import { reviewReadsContract } from "./review-reads";

// The review reads' contract (./review-reads.ts) against the local implementation, on a seeded database per test.
// The fake serves a read only where a contract case observes a command through it (decision 0072), and none does
// through the queue or the screen yet; the Java API runs these cases too.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-review-reads-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("local", () => {
  reviewReadsContract(localContractHarness({ base: BASE }), BASE);
});
