import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RevokeRecord } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { contentTypes, versions } from "@/server/db/schema/ucomp";
import { localContractHarness } from "./contract-harness";

// The local implementation's review and workspace reads in states the seed doesn't have and no command makes,
// written as rows: a version whose based-on version is missing, a released version whose variables or channels
// changed, a content type's SMS footer changed. Every state the commands can make is a contract case instead
// (../contract/review-reads.ts, ../contract/workspace.ts, ../contract/threads.ts); these are the local
// implementation's own tests, each on a database of its own.
//
// The seed: Cash Back v1 Superseded (it still renders), v2 Active, v3 in review on round 2, based on round 1 (sent
// back), based on v2; Card Used Abroad (an alert) v1 in review.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-review-screen-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const CORAL = "t_coral";
const DAY = 86_400_000;

const h = localContractHarness({ base: BASE });
let db: Db;
beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

/** One round's screen, from Coral Offers. */
async function screen(
  userId: string,
  templateKey: string,
  versionNumber: number,
  round: number | null = null,
) {
  const read = await h.services().review.screen(await h.as(userId), {
    teamId: CORAL,
    templateId: h.templates[templateKey]!,
    versionNumber,
    round,
  });
  if (!read.ok) throw new Error(read.code);
  return read;
}

const versionOf = (templateKey: string, number: number, round = 1) =>
  and(
    eq(versions.templateId, h.templates[templateKey]!),
    eq(versions.number, number),
    eq(versions.round, round),
  );

const row = (templateKey: string, number: number, round = 1) =>
  db.query.versions
    .findFirst({ where: versionOf(templateKey, number, round) })
    .then((v) => v!);

const REVOKED: RevokeRecord = {
  reason: "Test",
  startedBy: "jordan",
  startedAt: BASE.toISOString(),
  confirmedBy: "alex",
  confirmedAt: BASE.toISOString(),
};

/** Cash Back v2, its Active version, revoked (its effects aside). */
const revokeCashBackV2 = () =>
  db
    .update(versions)
    .set({ state: "revoked", revoke: REVOKED })
    .where(versionOf("cash-back", 2));

// The walk goes back through the round sent back to the revoked version (decision 0031).
describe("the review screen's baselines when nothing is Active", () => {
  it("finds nothing for the consumers of the version that still renders to map when it already has the round's variables", async () => {
    const v3 = await row("cash-back", 3, 2);
    await revokeCashBackV2();
    await db
      .update(versions)
      .set({ variables: v3.variables })
      .where(versionOf("cash-back", 1));
    expect((await screen("jordan", "cash-back", 3)).stillRenders).toEqual({
      number: 1,
      sunsetDay: null,
      contractChanges: [],
    });
  });

  it("falls back to the newest version that still renders when the based-on version is missing, then to none", async () => {
    const v1 = await row("cash-back", 1);
    await revokeCashBackV2();
    await db
      .update(versions)
      .set({ basedOnVersionId: null })
      .where(versionOf("cash-back", 3, 2));
    expect((await screen("jordan", "cash-back", 3)).baseline).toMatchObject({
      id: v1.id,
      number: 1,
      state: "superseded",
    });

    await db
      .update(versions)
      .set({ sunsetAt: new Date(BASE.getTime() + 40 * DAY) })
      .where(versionOf("cash-back", 1));
    expect(
      (await screen("jordan", "cash-back", 3)).stillRenders,
      "with its own sunset day",
    ).toMatchObject({
      number: 1,
      sunsetDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });

    // v1's sunset passes too: nothing renders, so nothing to compare with, as for a first version.
    await db
      .update(versions)
      .set({ sunsetAt: new Date(BASE.getTime() - 1000) })
      .where(versionOf("cash-back", 1));
    const read = await screen("jordan", "cash-back", 3);
    expect(read.baseline).toBeNull();
    expect(read.stillRenders).toBeNull();
  });
});

describe("an alert", () => {
  it("takes its family from its content type, even when its version's channels were emptied", async () => {
    await db
      .update(versions)
      .set({ channels: [] })
      .where(versionOf("card-used-abroad", 1));
    expect(
      (await screen("jordan", "card-used-abroad", 1)).template.family,
    ).toBe("message");
  });

  it("prints the SMS footer frozen into the version at submit, whatever the content type's is now; its draft, the content type's", async () => {
    const frozen = "Coral: Reply STOP to opt out, HELP for help.";
    const now = "Coral: Text STOP to end.";
    await db
      .update(contentTypes)
      .set({ smsFooter: now })
      .where(eq(contentTypes.id, "ct_alert"));
    const read = await screen("jordan", "card-used-abroad", 1);
    expect(read.version.smsFooter).toBe(frozen);
    expect(read.messageRules.smsFooter).toBe(frozen);

    // Compare: a draft after it prints the content type's footer as it stands.
    const v1 = await row("card-used-abroad", 1);
    await db.insert(versions).values({
      ...v1,
      id: "v_alert_draft",
      number: null,
      round: null,
      state: "draft",
      smsFooter: null,
    });
    expect(
      await h.services().versions.compare(await h.as("maya"), {
        templateId: h.templates["card-used-abroad"]!,
        from: v1.id,
        to: "v_alert_draft",
      }),
    ).toMatchObject({
      ok: true,
      family: "message",
      from: { smsFooter: frozen },
      to: { smsFooter: now },
    });
  });
});
