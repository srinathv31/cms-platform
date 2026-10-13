import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { diffVariables } from "@/domain/contract";
import { REASONS } from "@/domain/permissions";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { RevokeRecord } from "@/domain/types";
import type { Db } from "@/server/db/client";
import {
  commentThreads,
  contentTypes,
  versions,
} from "@/server/db/schema/ucomp";
import { localContractHarness } from "./contract-harness";
import { findRound } from "./find-round";

// The local implementation's review and workspace reads in states the seed doesn't have, made by writing rows the
// way no command does (a revoke without its effects, a thread on a chosen version, a content type's footer
// changed). The cases from the seed itself are the contract suite's (../contract/review-reads.ts,
// ../contract/workspace.ts, ../contract/threads.ts); these are the local implementation's own tests, each on a
// database of its own.
//
// The seed: Cash Back v1 Superseded (it still renders), v2 Active, v3 in review on round 2, based on round 1 (sent
// back), based on v2; High-Yield Savings v1 Superseded, v2 approved on round 3 after two send-backs; Annual Fee
// Waiver v1 sent back and an open draft; Card Used Abroad (an alert) v1 in review.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-review-screen-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const CORAL = "t_coral";
const DEPOSITS = "t_deposits";
const DAY = 86_400_000;

const h = localContractHarness({ base: BASE });
let db: Db;
beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

/** One round's screen, from Coral Offers unless another space is named. */
async function screen(
  userId: string,
  templateKey: string,
  versionNumber: number,
  round: number | null = null,
  teamId: string | null = CORAL,
) {
  const read = await h.services().review.screen(await h.as(userId), {
    teamId,
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

describe("the decisions on the review screen", () => {
  it("blocks Approve and Request changes, with why, for an approver who wrote part of the version, and leaves it out of their queue", async () => {
    // Priya, given Approver beside Author on Coral Offers (an access request can add the role), edited Maya's
    // Cash Back v3 before Maya submitted it.
    const priya = await h.as("priya");
    const approver = {
      ...priya,
      viewer: {
        ...priya.viewer,
        memberships: priya.viewer.memberships.map((m) =>
          m.teamId === CORAL ? { ...m, roles: ["author", "approver"] } : m,
        ),
      },
    } as typeof priya;
    const queue = async () => {
      const read = await h.services().review.queue(approver, { teamId: CORAL });
      if (!read.ok) throw new Error(read.code);
      return read;
    };
    expect(
      (await queue()).waiting.map((r) => r.round.number),
      "an approver who wrote none of it",
    ).toEqual([3]);

    await db
      .update(versions)
      .set({ writers: ["maya", "priya"] })
      .where(versionOf("cash-back", 3, 2));
    const read = await h.services().review.screen(approver, {
      teamId: CORAL,
      templateId: h.templates["cash-back"]!,
      versionNumber: 3,
      round: null,
    });
    if (!read.ok) throw new Error(read.code);
    expect(read.can).toEqual({
      approve: { ok: false, ...REASONS.wroteVersion },
      requestChanges: { ok: false, ...REASONS.wroteVersion },
      comment: { ok: true },
    });
    const after = await queue();
    expect(after.waiting).toEqual([]);
    // What Priya submitted herself is hers to watch, not to decide: the Card Used Abroad alert.
    expect(after.submitted.map((r) => r.templateId)).toEqual([
      h.templates["card-used-abroad"],
    ]);
    expect((await screen("jordan", "cash-back", 3)).can.approve).toEqual({
      ok: true,
    });
  });
});

describe("the review screen's baselines", () => {
  it("compares a round sent back before its number went live with the version it was drafted from, and shows a rename against it", async () => {
    await db
      .update(versions)
      .set({ name: "High-Yield Savings — 2025 Rates" })
      .where(versionOf("high-yield-savings", 1));
    const v1 = await row("high-yield-savings", 1);
    for (const round of [1, 2]) {
      const read = await screen(
        "eli",
        "high-yield-savings",
        2,
        round,
        DEPOSITS,
      );
      expect(read.baseline, `round ${round}: vs v1`).toMatchObject({
        id: v1.id,
        number: 1,
        state: "superseded",
      });
      expect(read.previousNumber).toBeNull();
      expect(read.liveName, "renamed from what it was drafted from").toBe(
        "High-Yield Savings — 2025 Rates",
      );
    }
  });

  it("shows a rename against what still renders once the Active version is revoked, and none on the live version itself", async () => {
    expect(
      (await screen("jordan", "cash-back", 2)).liveName,
      "v2 is the live one",
    ).toBeNull();
    await db
      .update(versions)
      .set({ name: "Cash Back Welcome Bonus — 2025 Terms" })
      .where(versionOf("cash-back", 1));
    await revokeCashBackV2();
    expect(
      (await screen("jordan", "cash-back", 3)).liveName,
      "v1 still renders",
    ).toBe("Cash Back Welcome Bonus — 2025 Terms");
  });

  // The walk goes back through the round sent back to the revoked version (decision 0031).
  describe("when nothing is Active", () => {
    it("is the revoked version the correction started from, with its state; Approve replaces nothing, and v1's consumers move", async () => {
      const v2 = await row("cash-back", 2);
      await revokeCashBackV2();
      const read = await screen("jordan", "cash-back", 3);
      expect(read.baseline).toEqual({
        id: v2.id,
        number: 2,
        state: "revoked",
        body: v2.body,
        variables: v2.variables,
        channels: v2.channels,
        channelFields: v2.channelFields,
        smsFooter: null,
      });
      expect(read.previousNumber).toBeNull();
      // N3: what consumers move from is the newest version that still renders. Against v1, which also lacks the
      // optional offer_end_date that v2 added (submit compared with v2).
      expect(read.stillRenders).toEqual({
        number: 1,
        sunsetDay: null,
        contractChanges: [
          expect.objectContaining({ kind: "added", key: "offer_end_date" }),
          expect.objectContaining({ kind: "added", key: "annual_fee" }),
        ],
      });
    });

    // v3 was submitted while v2 was Active, so the changes stored on it are against v2. v2 was revoked during
    // review, so what v1's consumers (who keep rendering) have to map is v3 against v1.
    it("works out the contract changes against the version that still renders, not the one Active at submit", async () => {
      const [v1, v3] = [
        await row("cash-back", 1),
        await row("cash-back", 3, 2),
      ];
      const stored = v3.contractChanges;
      await revokeCashBackV2();
      const read = await screen("jordan", "cash-back", 3);
      expect(read.stillRenders?.contractChanges).toEqual(
        diffVariables(v1.variables, v3.variables),
      );
      expect(read.version.contractChanges, "the submit record").toEqual(stored);

      // v1 already had v3's variables: its consumers have nothing new to map.
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
});

describe("threads", () => {
  /** Adds open threads about the whole version, `seconds` apart, begun on the given versions. */
  async function addThreads(
    templateKey: string,
    rows: { id: string; origin: string; blockId?: string }[],
  ) {
    await db.insert(commentThreads).values(
      rows.map((r, i) => ({
        id: r.id,
        templateId: h.templates[templateKey]!,
        originVersionId: r.origin,
        blockId: r.blockId ?? DOCUMENT_THREAD,
        quote: null,
        status: "open" as const,
        createdAt: new Date(BASE.getTime() - i * 1000),
      })),
    );
  }
  const ours = (threads: { id: string }[], prefix: string) =>
    threads
      .map((t) => t.id)
      .filter((id) => id.startsWith(prefix))
      .sort();

  it("lists the document threads first and orphaned threads last", async () => {
    const v1 = await row("annual-fee-waiver", 1);
    await db.insert(commentThreads).values([
      {
        id: "th_test_gone",
        templateId: h.templates["annual-fee-waiver"]!,
        originVersionId: v1.id,
        blockId: "b_gone00",
        quote: null,
        status: "open" as const,
        createdAt: new Date(BASE.getTime() - 1000),
      },
      {
        id: "th_test_doc",
        templateId: h.templates["annual-fee-waiver"]!,
        originVersionId: v1.id,
        blockId: DOCUMENT_THREAD,
        quote: null,
        status: "open" as const,
        createdAt: BASE,
      },
    ]);
    const read = await h.services().comments.threads(await h.as("jordan"), {
      templateId: h.templates["annual-fee-waiver"]!,
      versionId: v1.id,
    });
    if (!read.ok) throw new Error(read.code);
    // Document threads oldest first (the seeded change request, then this one), then by block.
    expect(
      read.threads.map((t) => [
        t.id.startsWith("th_test")
          ? t.id
          : t.blockId === DOCUMENT_THREAD
            ? "seeded doc"
            : "seeded",
        t.orphaned,
      ]),
    ).toEqual([
      ["seeded doc", false],
      ["th_test_doc", false],
      ["seeded", false],
      ["th_test_gone", true],
    ]);
  });

  it("v2's record leaves out a thread that began in v3's review, and v3's screen has both", async () => {
    const [v1, v3] = [await row("cash-back", 1), await row("cash-back", 3, 2)];
    await addThreads("cash-back", [
      { id: "th_f3a_v1", origin: v1.id },
      { id: "th_f3a_v3", origin: v3.id },
    ]);
    for (const [number, expected] of [
      [1, ["th_f3a_v1"]],
      [2, ["th_f3a_v1"]],
      [3, ["th_f3a_v1", "th_f3a_v3"]],
    ] as const)
      expect(
        ours((await screen("jordan", "cash-back", number)).threads, "th_f3a"),
        `v${number}`,
      ).toEqual(expected);
  });

  it("counts a thread begun in the open draft as the next round: not on round 1's record, but in the draft's margin", async () => {
    const draft = (await db.query.versions.findFirst({
      where: and(
        eq(versions.templateId, h.templates["annual-fee-waiver"]!),
        eq(versions.state, "draft"),
      ),
    }))!;
    const v1 = await row("annual-fee-waiver", 1);
    await addThreads("annual-fee-waiver", [
      { id: "th_f3a_draft", origin: draft.id },
      { id: "th_f3a_v1", origin: v1.id },
    ]);
    expect(
      ours((await screen("jordan", "annual-fee-waiver", 1)).threads, "th_f3a"),
    ).toEqual(["th_f3a_v1"]);
    const margin = await h
      .services()
      .templates.workspaceDocument(await h.as("maya"), {
        templateId: h.templates["annual-fee-waiver"]!,
      });
    if (!margin.ok) throw new Error(margin.code);
    expect(ours(margin.threads, "th_f3a")).toEqual([
      "th_f3a_draft",
      "th_f3a_v1",
    ]);
  });

  it("shows round 1's threads on round 2's screen, and leaves round 2's off round 1's record", async () => {
    const templateId = h.templates["cash-back"]!;
    const [round1, round2] = [
      (await findRound(db, templateId, 3, 1))!,
      (await findRound(db, templateId, 3, 2))!,
    ];
    await addThreads("cash-back", [
      { id: "th_rounds_r1", origin: round1.id },
      { id: "th_rounds_r2", origin: round2.id },
    ]);
    expect(
      ours((await screen("jordan", "cash-back", 3, 1)).threads, "th_rounds"),
    ).toEqual(["th_rounds_r1"]);
    const onRound2 = (await screen("jordan", "cash-back", 3, 2)).threads;
    expect(ours(onRound2, "th_rounds")).toEqual([
      "th_rounds_r1",
      "th_rounds_r2",
    ]);
    expect(
      onRound2.filter((t) => t.id.startsWith("th_rounds")).map((t) => t.origin),
    ).toEqual(
      expect.arrayContaining([
        { number: 3, round: 1, state: "changes_requested" },
        { number: 3, round: 2, state: "in_review" },
      ]),
    );
  });

  it("lists an alert's threads on its fields in the fields' order, not as orphaned, on the review screen and in the workspace", async () => {
    const v1 = await row("card-used-abroad", 1);
    await addThreads("card-used-abroad", [
      { id: "th_alert_sms", origin: v1.id, blockId: "sms.text" },
      { id: "th_alert_title", origin: v1.id, blockId: "push.title" },
    ]);
    const alertThreads = (threads: { id: string; orphaned: boolean }[]) =>
      threads
        .filter((t) => t.id.startsWith("th_alert"))
        .map((t) => [t.id, t.orphaned]);
    expect(
      alertThreads((await screen("jordan", "card-used-abroad", 1)).threads),
    ).toEqual([
      ["th_alert_title", false],
      ["th_alert_sms", false],
    ]);
    const margin = await h
      .services()
      .templates.workspaceDocument(await h.as("priya"), {
        templateId: h.templates["card-used-abroad"]!,
      });
    if (!margin.ok) throw new Error(margin.code);
    expect(alertThreads(margin.threads)).toEqual([
      ["th_alert_title", false],
      ["th_alert_sms", false],
    ]);
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
