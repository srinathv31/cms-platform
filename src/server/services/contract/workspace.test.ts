import { describe, vi } from "vitest";
import { localContractHarness } from "../local/contract-harness";
import { workspaceContract } from "./workspace";

// The workspace's contract (./workspace.ts) against the local implementation, on a seeded database per test. The
// fake serves a read only where a contract case observes a command through it (decision 0072): the workspace's
// document, the read other areas' cases see a draft through, but not the header these cases read too. The Java API
// runs these cases as well.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-workspace-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("local", () => {
  workspaceContract(localContractHarness({ base: BASE }), BASE);
});
