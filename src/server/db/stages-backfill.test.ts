import { readFileSync, readdirSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { OUTPUT_KEYS } from "@/domain/review-outputs";
import type { ApproverRule } from "@/domain/types";
import type { Db } from "@/server/db/client";
import {
  approvalStages,
  approvals,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import { localServices } from "@/server/services/local";
import type { RequestContext } from "@/server/services/types";
import {
  createTemplateWithDraft,
  draftRev,
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";

// The SQL that filled `versions.stages` and `approvals.stage_id` for rows that existed before the columns did
// (decision 0015): every submitted version gets its content type's chain as it is today, by position, and each
// decision the stage at its recorded position. Run again over versions the app wrote, then the review commands
// read what it filled.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-stages-backfill-");
});

const MIGRATIONS = "./src/server/db/migrations";
const BASE = new Date("2026-10-04T12:00:00.000Z");
const CT = "ct_disclosure";
const TEAM_STAGE = "stage_disclosure_0";
const TEAM_RULE: ApproverRule = { kind: "team_role", role: "approver" };

let db: Db;
let libsql: Client;
seededDatabasePerTest({ base: BASE });
let clock = BASE;
const { platform, review } = localServices({ clock: async () => clock });

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
});

/** The migration's backfill: its statements after the two that add the columns. */
const backfill = (() => {
  const file = readdirSync(MIGRATIONS).find((name) =>
    name.endsWith("_version_stages.sql"),
  )!;
  const [, , ...statements] = readFileSync(
    `${MIGRATIONS}/${file}`,
    "utf8",
  ).split("--> statement-breakpoint");
  return statements;
})();
async function runBackfill() {
  for (const statement of backfill) await libsql.execute(statement);
}

// Every step a minute after the last.
let minute = 0;
async function as(userId: string): Promise<RequestContext> {
  minute += 1;
  clock = new Date(BASE.getTime() + minute * 60_000);
  return {
    viewer: await loadPersona(db, userId),
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

const chain = () =>
  db
    .select()
    .from(approvalStages)
    .where(eq(approvalStages.contentTypeId, CT))
    .orderBy(asc(approvalStages.position));
const versionOf = (templateId: string) =>
  db.query.versions.findFirst({
    where: and(eq(versions.templateId, templateId), eq(versions.number, 1)),
  });
const approve = async (userId: string, templateId: string) =>
  review.approve(await as(userId), {
    templateId,
    versionNumber: 1,
    round: 1,
    outputsViewed: OUTPUT_KEYS,
    sampleSetsSeen: ["typical"],
  });

describe("the stages backfill", () => {
  it("gives every submitted version today's chain, and each decision the stage at its position", async () => {
    expect(
      await platform.saveApprovalChain(await as("riley"), {
        contentTypeId: CT,
        stages: [
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
          { name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
        ],
      }),
    ).toEqual({ ok: true, changed: true });
    const today = (await chain()).map((s) => ({ id: s.id, name: s.name }));

    await libsql.execute("UPDATE versions SET stages = NULL");
    await libsql.execute("UPDATE approvals SET stage_id = NULL");
    await libsql.execute(
      "UPDATE versions SET current_stage = 7 WHERE state = 'in_review'",
    ); // past the end
    await runBackfill();

    // Each version gets its own content type's chain: Disclosure's as edited above, Alert's untouched.
    const alertChain = [{ id: "stage_alert_0", name: "Team approver" }];
    const onAlert = new Set(
      (
        await db
          .select({ id: templates.id })
          .from(templates)
          .where(eq(templates.contentTypeId, "ct_alert"))
      ).map((t) => t.id),
    );
    expect(onAlert.size).toBeGreaterThan(0);
    const chainOf = (v: { templateId: string }) =>
      onAlert.has(v.templateId) ? alertChain : today;

    const rows = await db.select().from(versions);
    expect(rows.some((v) => v.number === null)).toBe(true);
    for (const v of rows) {
      expect(v.stages).toEqual(v.number === null ? null : chainOf(v));
      if (v.state === "in_review")
        expect(v.currentStage, "read as the last stage, as before").toBe(
          chainOf(v).length - 1,
        );
    }
    const decisions = await db.select().from(approvals);
    expect(decisions.length).toBeGreaterThan(0);
    const versionById = new Map(rows.map((v) => [v.id, v]));
    for (const d of decisions)
      expect(d.stageId).toBe(
        chainOf(versionById.get(d.versionId)!)[d.stagePosition]?.id ?? null,
      );
  });

  it("leaves someone who approved before the migration unable to approve the stage their approval was matched to", async () => {
    const { templateId } = await createTemplateWithDraft(db, {
      teamId: "t_coral",
      createdBy: "maya",
      at: BASE,
    });
    expect(
      await review.submit(await as("maya"), {
        templateId,
        rev: await draftRev(db, templateId),
      }),
    ).toEqual({ ok: true, number: 1, round: 1 });
    const version = (await versionOf(templateId))!;
    // The data as it stood before stage ids: under [First approver, Team approver] Jordan approved the
    // first stage; an admin then removed it and the version moved to position 0, the Team approver stage.
    await db.insert(approvals).values({
      id: "ap_before_stage_ids",
      versionId: version.id,
      stageId: null,
      stagePosition: 0,
      stageName: "First approver",
      actorId: "jordan",
      decision: "approved",
      reason: null,
      sampleSetsSeen: ["typical"],
      decidedAt: clock,
    });
    await db
      .update(versions)
      .set({ stages: null, currentStage: 0 })
      .where(eq(versions.id, version.id));
    await runBackfill();
    expect(await versionOf(templateId)).toMatchObject({
      stages: [{ id: TEAM_STAGE, name: "Team approver" }],
      currentStage: 0,
    });
    expect(
      (
        await db.query.approvals.findFirst({
          where: eq(approvals.id, "ap_before_stage_ids"),
        })
      )?.stageId,
    ).toBe(TEAM_STAGE);

    // Matched to the stage the version waits on, his approval still counts: two stages need two people.
    const screen = await review.screen(await as("jordan"), {
      teamId: "t_coral",
      templateId,
      versionNumber: 1,
      round: null,
    });
    expect(screen.ok && screen.can.approve).toEqual({
      ok: false,
      ...REFUSALS.approvedEarlierStage,
    });
    expect(await approve("jordan", templateId)).toEqual({
      ok: false,
      ...REFUSALS.approvedEarlierStage,
    });
    expect(await approve("alex", templateId)).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
      round: 1,
    });
  });
});
