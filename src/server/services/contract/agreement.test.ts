import { expect, it, vi } from "vitest";
import { fakeContractHarness } from "../fake/contract-harness";
import { localContractHarness } from "../local/contract-harness";

// The fake and the local implementation read the whole seeded world alike: every template's history, activity,
// threads, workspace document, its versions in Compare, its Library and palette rows, for a person on each team and
// a platform role, and everyone's notifications, field for field. Where the contract cases pick examples, this
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

it("answers who everyone is, and every space and shell, alike", async () => {
  const slugs = ["all", "coral-offers", "deposits", "card-statements", "nope"];
  for (const userId of [
    "maya",
    "priya",
    "alex",
    "eli",
    "riley",
    "taylor",
    "morgan",
  ]) {
    const credential = { kind: "in_process" as const, userId };
    expect(await fake.services().identity.viewer(credential), userId).toEqual(
      await local.services().identity.viewer(credential),
    );
    const [inFake, inLocal] = [await fake.as(userId), await local.as(userId)];
    expect(await fake.services().identity.shell(inFake), userId).toEqual(
      await local.services().identity.shell(inLocal),
    );
    for (const slug of slugs)
      expect(
        await fake.services().identity.space(inFake, { slug }),
        `${userId} in ${slug}`,
      ).toEqual(await local.services().identity.space(inLocal, { slug }));
  }
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

it("lists everyone's notifications alike: the same facts, links and read times", async () => {
  for (const userId of ["maya", "priya", "jordan", "alex", "riley", "morgan"]) {
    const [fromFake, fromLocal] = await Promise.all([
      fake.services().notifications.list(await fake.as(userId), { limit: 100 }),
      local
        .services()
        .notifications.list(await local.as(userId), { limit: 100 }),
    ]);
    expect(fromFake, userId).toEqual(fromLocal);
  }
});

it.each(["maya", "jordan", "eli", "riley"])(
  "answers every template's activity, and its threads against each of its versions, alike for %s",
  async (userId) => {
    fake.setClock(BASE);
    local.setClock(BASE);
    const [asFake, asLocal] = [await fake.as(userId), await local.as(userId)];
    for (const templateId of Object.values(local.templates)) {
      expect(
        await fake.services().audit.activity(asFake, { templateId }),
        `${templateId}'s activity`,
      ).toEqual(await local.services().audit.activity(asLocal, { templateId }));
      const history = await local
        .services()
        .versions.history(asLocal, { templateId });
      const versionIds = history.ok ? history.versions.map((v) => v.id) : [];
      for (const versionId of [undefined, ...versionIds])
        expect(
          await fake.services().comments.threads(asFake, {
            templateId,
            versionId,
          }),
          `${templateId}'s threads on ${versionId ?? "the workspace's"}`,
        ).toEqual(
          await local
            .services()
            .comments.threads(asLocal, { templateId, versionId }),
        );
    }
  },
);
it("lists every space's Library and palette alike, whether or not the person may enter it", async () => {
  const spaces = [null, "t_coral", "t_deposits", "t_cards", "t_nope"];
  for (const userId of ["maya", "jordan", "eli", "riley", "taylor", "morgan"])
    for (const teamId of spaces) {
      const [inFake, inLocal] = [await fake.as(userId), await local.as(userId)];
      const where = `${userId} in ${teamId}`;
      expect(
        await fake.services().templates.library(inFake, { teamId }),
        where,
      ).toEqual(await local.services().templates.library(inLocal, { teamId }));
      for (const q of [null, "terms", "in review", "statement insert"])
        expect(
          await fake
            .services()
            .templates.palette(inFake, { teamId, q, templateId: null }),
          `${where} for ${q}`,
        ).toEqual(
          await local
            .services()
            .templates.palette(inLocal, { teamId, q, templateId: null }),
        );
    }
});

it.each(["maya", "jordan", "eli", "riley"])(
  "answers every template's workspace document, and every version's content in Compare, alike for %s",
  async (userId) => {
    fake.setClock(BASE);
    local.setClock(BASE);
    const [asFake, asLocal] = [await fake.as(userId), await local.as(userId)];
    for (const templateId of Object.values(local.templates)) {
      expect(
        await fake.services().templates.workspaceDocument(asFake, {
          templateId,
        }),
        `${templateId}'s document`,
      ).toEqual(
        await local.services().templates.workspaceDocument(asLocal, {
          templateId,
        }),
      );
      const history = await local
        .services()
        .versions.history(asLocal, { templateId });
      const ids = history.ok ? history.versions.map((v) => v.id) : [];
      for (const [from, to] of ids.flatMap((id, i) => [
        [id, id],
        [ids[i + 1] ?? id, id],
      ]))
        expect(
          await fake
            .services()
            .versions.compare(asFake, { templateId, from, to }),
          `${templateId} ${from} → ${to}`,
        ).toEqual(
          await local
            .services()
            .versions.compare(asLocal, { templateId, from, to }),
        );
    }
  },
);
