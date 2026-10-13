import { expect, it, vi } from "vitest";
import { fakeContractHarness } from "../fake/contract-harness";
import { localContractHarness } from "../local/contract-harness";

// The fake and the local implementation read the whole seeded world alike: every template's history, for a
// person on each team and a platform role, field for field. Where the contract cases pick examples, this
// compares everything the seed holds, so a difference in a read the cases don't name still fails.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-agreement-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const fake = fakeContractHarness({ base: BASE });
const local = localContractHarness({ base: BASE });

it("seeds the same templates under the same ids", () => {
  expect(fake.templates).toEqual(local.templates);
  expect(Object.keys(local.templates).length).toBeGreaterThan(10);
});

it.each(["maya", "jordan", "eli", "riley"])(
  "answers every template's history alike for %s, now and after the sunsets pass",
  async (userId) => {
    for (const at of [BASE, new Date(BASE.getTime() + 60 * 86_400_000)])
      for (const templateId of Object.values(local.templates)) {
        fake.setClock(at);
        local.setClock(at);
        const [fromFake, fromLocal] = await Promise.all([
          fake.services().versions.history(await fake.as(userId), {
            templateId,
          }),
          local.services().versions.history(await local.as(userId), {
            templateId,
          }),
        ]);
        expect(fromFake, `${templateId} at ${at.toISOString()}`).toEqual(
          fromLocal,
        );
      }
  },
);
