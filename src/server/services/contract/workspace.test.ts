import { describe, vi } from "vitest";
import { localContractHarness } from "../local/contract-harness";
import { workspaceContract } from "./workspace";

// The workspace's contract (./workspace.ts) against the local implementation, on a seeded database per test. The
// fake serves a read only where a contract case observes a command through it (decision 0072), and none does
// through the workspace yet; the Java API runs these cases too.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-workspace-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("local", () => {
  workspaceContract(localContractHarness({ base: BASE }), BASE);
});
