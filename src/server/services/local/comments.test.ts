import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMENT_REFUSALS } from "@/domain/comments";
import { editLatest } from "@/domain/lifecycle/drafts";
import { REASONS } from "@/domain/permissions";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { VersionState } from "@/domain/types";
import type { RequestContext } from "@/server/context/request";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { Services } from "../types";
import { draftRow } from "./draft-row";
import { localServices } from "./index";

// The comment commands that need a state only the database can be put in: a stage that names someone from another
// team, a thread written by a reviewer the template's team doesn't hold. The seed can't reach them through the
// services, so they are arranged with SQL. What every implementation must show is the contract suite's
// (src/server/services/contract/comments.ts).

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-comments-");
});

const { approvalStages, commentThreads, comments, versions } = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");

let db: Db;
let services: Services;
let clock = BASE;
let minute = 0;
const ids = seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

beforeEach(() => {
  clock = BASE;
  minute = 0;
  services = localServices({ clock: async () => clock });
});

async function as(userId: string): Promise<RequestContext> {
  minute += 1;
  clock = new Date(BASE.getTime() + minute * 60_000);
  return {
    viewer: await loadPersona(db, userId),
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

const threadRow = (id: string) =>
  db.query.commentThreads.findFirst({ where: eq(commentThreads.id, id) });
const commentsIn = (threadId: string) =>
  db.select().from(comments).where(eq(comments.threadId, threadId));

/** The version of a template in a state. */
const versionIn = async (template: string, state: VersionState) =>
  (await db.query.versions.findFirst({
    where: and(
      eq(versions.templateId, ids[template]!),
      eq(versions.state, state),
    ),
  }))!;

/** An open draft of the template, made from its Active version as Edit makes it. */
async function openDraftOf(template: string, createdBy: string, id: string) {
  const live = await versionIn(template, "active");
  const { changes } = editLatest({ from: live, createdBy, now: BASE });
  await db
    .insert(versions)
    .values(draftRow(changes.draft, { id, templateId: ids[template]! }));
  return id;
}

async function threadsOn(
  template: string,
  origins: Record<string, string>,
  author = "maya",
) {
  const entries = Object.entries(origins);
  await db.insert(commentThreads).values(
    entries.map(([id, originVersionId]) => ({
      id,
      originVersionId,
      templateId: ids[template]!,
      blockId: DOCUMENT_THREAD,
      createdAt: BASE,
    })),
  );
  await db.insert(comments).values(
    entries.map(([id]) => ({
      id: `cm_${id}`,
      threadId: id,
      authorId: author,
      body: "A note.",
      createdAt: BASE,
    })),
  );
}

describe("reply notifications outside the team", () => {
  it("a stage reviewer from another team who wrote in a decided version's thread gets its review screen in their own space", async () => {
    // Balance Transfer v2 is Active (no longer in review), and Maya has started its next draft, whose margin
    // shows v2's threads. Naomi (Deposits only) commented on v2 as a named stage reviewer.
    await openDraftOf("balance-transfer", "maya", "v_test_bt_draft");
    const v2 = await versionIn("balance-transfer", "active");
    await threadsOn("balance-transfer", { th_outside_reply: v2.id }, "naomi");

    const maya = await as("maya");
    const at = clock.toISOString();
    expect(
      await services.comments.reply(maya, {
        threadId: "th_outside_reply",
        body: "Thanks, fixed in the draft.",
      }),
    ).toEqual({ ok: true });

    const bell = async (userId: string) => {
      const list = await services.notifications.list(await as(userId), {
        limit: 100,
      });
      if (!list.ok) throw new Error(list.code);
      return list.items.filter((n) => n.createdAt === at);
    };
    // The stored link names Naomi's own team by id; the slug is the BFF's to add.
    const naomi = (await bell("naomi")).map((n) => n.link);
    expect(naomi).toEqual([
      {
        to: "review",
        teamId: "t_deposits",
        templateId: ids["balance-transfer"],
        versionNumber: 2,
      },
    ]);
  });
});

describe("which versions take comments", () => {
  it("refuses a comment once the version has been decided, though it was in review when the page loaded", async () => {
    const v3 = await versionIn("cash-back", "in_review");
    await db
      .update(versions)
      .set({ state: "changes_requested" })
      .where(eq(versions.id, v3.id));
    expect(
      await services.comments.add(await as("jordan"), {
        templateId: ids["cash-back"]!,
        versionId: v3.id,
        blockId: DOCUMENT_THREAD,
        body: "Late.",
      }),
    ).toMatchObject({ ok: false, code: COMMENT_REFUSALS.closed.code });
  });
});

// S9: a stage reviewer from another team acts on the version in review only.
describe("a stage reviewer from another team", () => {
  // Cash Back v3 waits on a second stage that names Naomi, who is on Deposits only. To give her something she
  // can't see, the template also has an open draft (made from v2) with a thread begun in it.
  const DRAFT = "v_test_cb_draft";
  const ON_DRAFT = "th_test_draft_only";
  const ON_V3 = "th_test_on_v3";
  const ON_V2 = "th_test_on_v2";

  beforeEach(async () => {
    await db.insert(approvalStages).values({
      id: "stage_test_outside",
      contentTypeId: "ct_disclosure",
      position: 1,
      name: "Legal reviewer",
      approverRule: { kind: "user", userId: "naomi" },
    });
    // As if v3 had been submitted under the two-stage chain and passed its first stage.
    const v3 = await versionIn("cash-back", "in_review");
    await db
      .update(versions)
      .set({
        stages: [
          ...(v3.stages ?? []),
          { id: "stage_test_outside", name: "Legal reviewer" },
        ],
        currentStage: 1,
      })
      .where(eq(versions.id, v3.id));
    await openDraftOf("cash-back", "maya", DRAFT);
    const v2 = await versionIn("cash-back", "active");
    await threadsOn("cash-back", {
      [ON_DRAFT]: DRAFT,
      [ON_V3]: v3.id,
      [ON_V2]: v2.id,
    });
  });

  it("can't reply to, resolve or reopen a thread begun in the open draft, and nothing is written", async () => {
    const naomi = await as("naomi");
    expect(
      await services.comments.reply(naomi, {
        threadId: ON_DRAFT,
        body: "Seen.",
      }),
    ).toMatchObject({ ok: false, code: REASONS.generic.code });
    expect(
      await services.comments.resolve(naomi, { threadId: ON_DRAFT }),
    ).toMatchObject({ ok: false, code: REASONS.generic.code });
    expect(await threadRow(ON_DRAFT)).toMatchObject({
      status: "open",
      resolvedBy: null,
    });
    await db
      .update(commentThreads)
      .set({ status: "resolved", resolvedBy: "maya", resolvedAt: BASE })
      .where(eq(commentThreads.id, ON_DRAFT));
    expect(
      await services.comments.reopen(naomi, { threadId: ON_DRAFT }),
    ).toMatchObject({ ok: false, code: REASONS.generic.code });
    expect(await threadRow(ON_DRAFT)).toMatchObject({
      status: "resolved",
      resolvedBy: "maya",
    });
    expect(await commentsIn(ON_DRAFT)).toHaveLength(1);
  });

  it("can't start a thread on the open draft", async () => {
    expect(
      await services.comments.add(await as("naomi"), {
        templateId: ids["cash-back"]!,
        versionId: DRAFT,
        blockId: DOCUMENT_THREAD,
        body: "x",
      }),
    ).toMatchObject({ ok: false, code: REASONS.generic.code });
  });

  it("still comments on the version in review, and replies to and resolves and reopens its threads, from any team", async () => {
    const v3 = await versionIn("cash-back", "in_review");
    expect(
      await services.comments.add(await as("naomi"), {
        templateId: ids["cash-back"]!,
        versionId: v3.id,
        blockId: DOCUMENT_THREAD,
        body: "Legal: fine.",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await services.comments.reply(await as("naomi"), {
        threadId: ON_V3,
        body: "Agreed.",
      }),
    ).toEqual({ ok: true });
    expect(
      await services.comments.resolve(await as("naomi"), { threadId: ON_V3 }),
    ).toEqual({ ok: true, changed: true });
    expect(await threadRow(ON_V3)).toMatchObject({
      status: "resolved",
      resolvedBy: "naomi",
    });
    expect(
      await services.comments.reopen(await as("naomi"), { threadId: ON_V3 }),
    ).toEqual({ ok: true, changed: true });
    expect(await threadRow(ON_V3)).toMatchObject({
      status: "open",
      resolvedBy: null,
    });
  });

  it("acts on an earlier version's thread, which the version in review shows", async () => {
    expect(
      await services.comments.resolve(await as("naomi"), { threadId: ON_V2 }),
    ).toEqual({ ok: true, changed: true });
    expect(await threadRow(ON_V2)).toMatchObject({
      status: "resolved",
      resolvedBy: "naomi",
    });
  });

  it("leaves a team author able to act on the draft's thread", async () => {
    expect(
      await services.comments.reply(await as("maya"), {
        threadId: ON_DRAFT,
        body: "Mine.",
      }),
    ).toEqual({ ok: true });
  });
});
