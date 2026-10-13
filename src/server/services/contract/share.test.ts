import { describe, vi } from "vitest";
import { localContractHarness } from "../local/contract-harness";
import { shareContract } from "./share";

// The SHARE panel and Copilot contract (./share.ts) against the local implementation, on a seeded database per
// test. The fake doesn't serve these reads (see the top of ./share.ts).

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-share-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("local", () => {
  shareContract(localContractHarness({ base: BASE }), BASE);
});
