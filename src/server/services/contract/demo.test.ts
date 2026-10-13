import { describe, vi } from "vitest";
import { fakeContractHarness } from "../fake/contract-harness";
import { localContractHarness } from "../local/contract-harness";
import { demoContract } from "./demo";

// The demo contract (./demo.ts) against each implementation: the fake, and the local one on a seeded database per
// test, with its demo flag on (the flag is its configuration: off, every demo command answers `demo_mode_off`).

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-demo-");
});
vi.mock("@/server/config", () => ({ DEMO_MODE: true, BACKEND: "local" }));
// Moving the demo clock marks a request as dynamic (`connection()`); there is no request here.
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("fake", () => {
  demoContract(fakeContractHarness({ base: BASE }), BASE);
});

describe("local", () => {
  demoContract(localContractHarness({ base: BASE }), BASE);
});
