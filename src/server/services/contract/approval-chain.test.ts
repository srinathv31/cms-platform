import { describe, vi } from "vitest";
import { fakeContractHarness } from "../fake/contract-harness";
import { localContractHarness } from "../local/contract-harness";
import {
  approvalChainContract,
  approvalChainReadsContract,
} from "./approval-chain";

// The approval chain's contract (./approval-chain.ts) against each implementation: the fake, and the local one on
// a seeded database per test. The cases that read the chain as the settings show it, the review screen, the queue
// or the badge run against the local one only: the fake serves a read only where a contract case observes a
// command through it (decision 0072).

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-approval-chain-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("fake", () => {
  approvalChainContract(fakeContractHarness({ base: BASE }), BASE);
});

describe("local", () => {
  const harness = localContractHarness({ base: BASE });
  approvalChainContract(harness, BASE);
  approvalChainReadsContract(harness, BASE);
});
