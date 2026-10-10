import { readFileSync, readdirSync, rmSync } from "node:fs";
import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sunsetInstant } from "@/domain/business-zone";
import { describeChanges, diffVariables } from "@/domain/contract";
import { noticeView } from "@/domain/golive/notices";
import { REFUSALS } from "@/domain/lifecycle";
import { REASONS } from "@/domain/permissions";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import type { Variable, Viewer } from "@/domain/types";
import { createVariableStore } from "@/editor/state/variable-store";
import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema/ucomp";
import { parseDraftPatchText } from "@/server/drafts/parse-patch";
import { saveDraft } from "@/server/drafts/save-draft";
import { getSubmitSummary } from "@/server/queries/submit-summary";
import { getWorkspaceDocument, getWorkspaceHeader } from "@/server/queries/workspace";
import { seedDatabase } from "@/server/seed";
import { applyDraftPatch } from "@/server/drafts/apply-patch";
import { createTemplateWithDraft, draftRev, loadPersona } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { addComment } from "./comments";
import { startDraft, submitDraft } from "./templates";
import {
  approveVersion,
  cancelRevoke,
  confirmRevoke,
  requestChanges,
  setSunset,
  startRevoke,
  submitVersion,
} from "./review";

// The review actions end to end against a temporary database filled by the real seed. Only the
// database handle, the demo clock, the persona and Next's cache calls are swapped.

const env = vi.hoisted(() => ({ dir: "", now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  const temp = tempDatabase("ucomp-review-actions-");
  env.dir = temp.dir;
  return temp;
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
// startDraft (Edit) ends in a redirect; the queries keep the real notFound.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn(),
}));

const {
  approvals,
  approvalStages,
  auditEvents,
  commentThreads,
  comments,
  consumerNotices,
  membershipRoles,
  memberships,
  notifications,
  renderLog,
  settings,
  versions,
} = schema;
const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

let db: Db;
let libsql: Client;
let ids: Record<string, string>;
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db, libsql } = await import("@/server/db/client"));
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  ids = (await seedDatabase(db, { base: BASE })).templates;
  for (const id of ["maya", "jordan", "alex", "priya", "sam", "morgan"]) people[id] = await loadPersona(db, id);
}, 60_000);

afterAll(() => {
  libsql?.close();
  rmSync(env.dir, { recursive: true, force: true });
});

// Every step happens a minute after the last, so rows are easy to tell apart.
let minute = 0;
function as(userId: string) {
  minute += 1;
  env.now = new Date(BASE.getTime() + minute * 60_000);
  vi.mocked(getViewer).mockResolvedValue(people[userId]!);
  return env.now;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
});

const version = (templateId: string, number: number) =>
  db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.number, number)) });
const draftOf = (templateId: string) =>
  db.query.versions.findFirst({ where: and(eq(versions.templateId, templateId), eq(versions.state, "draft")) });
const auditAt = (at: Date) => db.select().from(auditEvents).where(eq(auditEvents.at, at));
const notificationsAt = (at: Date) =>
  db.select().from(notifications).where(eq(notifications.createdAt, at)).orderBy(notifications.userId);
const noticesAt = (at: Date) => db.select().from(consumerNotices).where(eq(consumerNotices.createdAt, at));

const blockIds = (doc: { content?: { attrs?: Record<string, unknown> }[] }) =>
  (doc.content ?? []).map((b) => b.attrs?.id);

/** Submits the draft as it stands: with the rev its submit summary shows, as the dialog sends it. */
const submitNow = async (templateId: string, note?: string) =>
  submitVersion({ templateId, note, rev: await draftRev(db, templateId) });

// ── Scenario 3: the review loop ───────────────────────────────

describe("the review loop (scenario 3)", () => {
  let templateId: string;

  beforeAll(async () => {
    ({ templateId } = await createTemplateWithDraft(db, {
      teamId: "coral-offers",
      createdBy: "maya",
      at: BASE,
      name: "Spring Travel Rewards — Terms",
    }));
  });

  it("Maya submits v1 with a note; the team's approvers are asked to review", async () => {
    const at = as("maya");
    const result = await submitNow(templateId, "  Ready for a look.  ");
    expect(result).toEqual({ ok: true, number: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);

    expect(await version(templateId, 1)).toMatchObject({
      state: "in_review",
      submittedBy: "maya",
      submittedAt: at,
      submitNote: "Ready for a look.",
      currentStage: 0,
      contractChanges: null,
    });
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["version.submitted"]);
    const sent = await notificationsAt(at);
    expect(sent.map((n) => n.userId)).toEqual(["alex", "jordan"]);
    expect(sent[0]).toMatchObject({
      kind: "review_requested",
      title: "Maya Chen submitted Spring Travel Rewards — Terms v1 for review.",
      body: "Ready for a look.",
      href: `/coral-offers/review/${templateId}/1`,
    });
  });

  it("a second submit is refused and writes nothing", async () => {
    const at = as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: false, code: "already_in_review", reason: "This version is already in review." });
    expect(await auditAt(at)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Maya can't approve or request changes on her own version", async () => {
    as("maya");
    expect(await approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: [] })).toEqual({
      ok: false,
      ...REASONS.ownVersion,
    });
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "x" })).toEqual({
      ok: false,
      ...REASONS.ownVersion,
    });
  });

  it("a change request needs a reason", async () => {
    as("jordan");
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "   " })).toEqual({
      ok: false,
      ...REFUSALS.giveReason,
    });
    expect((await version(templateId, 1))?.state).toBe("in_review");
  });

  it("Jordan requests changes: the decision, a new draft with the same block ids, and the reason as a thread", async () => {
    const at = as("jordan");
    const reason = "The intro APR period doesn't match the product sheet.";
    expect(await requestChanges({ templateId, versionNumber: 1, reason })).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);

    const v1 = (await version(templateId, 1))!;
    expect(v1.state).toBe("changes_requested");

    expect(await db.select().from(approvals).where(eq(approvals.versionId, v1.id))).toEqual([
      expect.objectContaining({
        stagePosition: 0,
        stageName: "Team approver",
        actorId: "jordan",
        decision: "changes_requested",
        reason,
        decidedAt: at,
      }),
    ]);

    const draft = (await draftOf(templateId))!;
    expect(draft).toMatchObject({ number: null, basedOnVersionId: v1.id, createdBy: "maya", rev: 0 });
    expect(blockIds(draft.body)).toEqual(blockIds(v1.body));

    const [thread] = await db.select().from(commentThreads).where(eq(commentThreads.originVersionId, v1.id));
    expect(thread).toMatchObject({ blockId: DOCUMENT_THREAD, quote: null, status: "open", templateId });
    expect(await db.select().from(comments).where(eq(comments.threadId, thread!.id))).toEqual([
      expect.objectContaining({ authorId: "jordan", body: reason, kind: "change_request" }),
    ]);

    expect((await auditAt(at)).map((r) => r.action)).toEqual(["version.changes_requested"]);
    expect(await notificationsAt(at)).toEqual([
      expect.objectContaining({
        userId: "maya",
        kind: "changes_requested",
        href: `/coral-offers/templates/${templateId}`,
      }),
    ]);
  });

  it("a second change request (a double click) is refused and writes nothing", async () => {
    const at = as("jordan");
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "Again" })).toEqual({
      ok: false,
      ...REFUSALS.notInReview,
    });
    expect(await auditAt(at)).toEqual([]);
    const v1 = (await version(templateId, 1))!;
    expect(await db.select().from(approvals).where(eq(approvals.versionId, v1.id))).toHaveLength(1);
  });

  it("Maya resubmits as v2 (through the Phase 3 name, submitDraft)", async () => {
    as("maya");
    expect(await submitDraft({ templateId, rev: await draftRev(db, templateId) })).toEqual({ ok: true, number: 2 });
    expect((await version(templateId, 2))?.state).toBe("in_review");
  });

  it("Jordan approves v2: it goes live and Maya hears about it", async () => {
    const at = as("jordan");
    const result = await approveVersion({ templateId, versionNumber: 2, sampleSetsSeen: ["typical", "long", "typical"] });
    expect(result).toEqual({ ok: true, wentLive: true, number: 2 });
    expect(refresh).toHaveBeenCalledTimes(1);

    const v2 = (await version(templateId, 2))!;
    expect(v2).toMatchObject({ state: "active", activatedAt: at, currentStage: 0 });
    expect(await db.select().from(approvals).where(eq(approvals.versionId, v2.id))).toEqual([
      expect.objectContaining({ decision: "approved", actorId: "jordan", sampleSetsSeen: ["typical", "long"] }),
    ]);
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["version.activated"]);
    expect(await notificationsAt(at)).toEqual([
      expect.objectContaining({ userId: "maya", kind: "version_live", title: "Spring Travel Rewards — Terms v2 is now Active." }),
    ]);
    // Nobody renders a brand-new template yet: no consumer notices.
    expect(await noticesAt(at)).toEqual([]);
  });

  it("a second approve is refused", async () => {
    as("alex");
    expect(await approveVersion({ templateId, versionNumber: 2, sampleSetsSeen: [] })).toEqual({
      ok: false,
      ...REFUSALS.notInReview,
    });
  });
});

// ── Resubmitting answers the change request ───────────────────

describe("resubmitting answers the change request", () => {
  let templateId: string;
  let v1Id: string;
  let blockThreadId: string;
  let firstRequestId: string;
  let resolvedAt: Date;

  const threadsOf = (id: string) => db.select().from(commentThreads).where(eq(commentThreads.templateId, id));
  const threadRow = (id: string) => db.query.commentThreads.findFirst({ where: eq(commentThreads.id, id) });
  const resolvedAudit = (at: Date) => auditAt(at).then((rows) => rows.filter((r) => r.action === "thread.resolved"));

  beforeAll(async () => {
    ({ templateId } = await createTemplateWithDraft(db, {
      teamId: "coral-offers",
      createdBy: "maya",
      at: BASE,
      name: "Summer Dining Rewards — Terms",
    }));
    as("maya");
    await submitNow(templateId);
    const v1 = (await version(templateId, 1))!;
    v1Id = v1.id;

    // Jordan leaves a block comment and then asks for changes on the whole version.
    as("jordan");
    const block = await addComment({
      templateId,
      versionId: v1Id,
      blockId: String(v1.body.content?.[1]?.attrs?.id),
      body: "Is this still the right threshold?",
    });
    if (!block.ok) throw new Error(block.reason);
    blockThreadId = block.threadId;
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "The intro APR doesn't match." })).toEqual({ ok: true });
    const request = (await threadsOf(templateId)).find((t) => t.blockId === DOCUMENT_THREAD)!;
    firstRequestId = request.id;
    expect(request).toMatchObject({ status: "open", resolvedBy: null, resolvedAt: null });
  });

  it("Maya resubmits: the change request resolves as hers, at the submit time", async () => {
    const at = as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 2 });
    resolvedAt = at;

    expect(await threadRow(firstRequestId)).toMatchObject({
      blockId: DOCUMENT_THREAD,
      status: "resolved",
      resolvedBy: "maya",
      resolvedAt: at,
      originVersionId: v1Id,
    });
  });

  it("writes a thread.resolved audit row about the version that asked, saying which version answered", async () => {
    expect(await resolvedAudit(resolvedAt)).toEqual([
      expect.objectContaining({
        actorId: "maya",
        teamId: "coral-offers",
        templateId,
        versionId: v1Id,
        action: "thread.resolved",
        details: { threadId: firstRequestId, blockId: DOCUMENT_THREAD, auto: true, resolvedWith: 2 },
      }),
    ]);
    // The submit's own audit row is still there beside it.
    expect((await auditAt(resolvedAt)).map((r) => r.action).sort()).toEqual(["thread.resolved", "version.submitted"]);
  });

  it("leaves the block comment open", async () => {
    expect(await threadRow(blockThreadId)).toMatchObject({
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      originVersionId: v1Id,
    });
  });

  it("a second cycle resolves only the new change request", async () => {
    as("jordan");
    expect(await requestChanges({ templateId, versionNumber: 2, reason: "One more fix, please." })).toEqual({ ok: true });
    const second = (await threadsOf(templateId)).find((t) => t.blockId === DOCUMENT_THREAD && t.status === "open")!;
    expect(second.id).not.toBe(firstRequestId);

    const at = as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 3 });

    expect(await threadRow(second.id)).toMatchObject({ status: "resolved", resolvedBy: "maya", resolvedAt: at });
    // The first request keeps the moment it was answered; the block comment is still open.
    expect(await threadRow(firstRequestId)).toMatchObject({ status: "resolved", resolvedBy: "maya", resolvedAt });
    expect(await threadRow(blockThreadId)).toMatchObject({ status: "open" });

    expect((await resolvedAudit(at)).map((r) => [r.versionId, r.details])).toEqual([
      [second.originVersionId, { threadId: second.id, blockId: DOCUMENT_THREAD, auto: true, resolvedWith: 3 }],
    ]);
    expect(await resolvedAudit(resolvedAt)).toHaveLength(1);
  });

  it("a submit with no open change request writes no thread.resolved row", async () => {
    const { templateId: fresh } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    const at = as("maya");
    expect(await submitNow(fresh)).toEqual({ ok: true, number: 1 });
    expect(await resolvedAudit(at)).toEqual([]);
  });
});

// ── Approve over an Active version ────────────────────────────

describe("approveVersion over an Active version", () => {
  it("supersedes the previous Active, sets its sunset (00:00 Eastern on the day), and tells Coral", async () => {
    const templateId = ids["cash-back"]!;
    const at = as("jordan");
    const sunset = new Date(at.getTime() + 14 * DAY).toISOString().slice(0, 10);

    const result = await approveVersion({ templateId, versionNumber: 3, sunsetPrevious: sunset, sampleSetsSeen: ["typical"] });
    expect(result).toEqual({ ok: true, wentLive: true, number: 3 });

    expect(await version(templateId, 3)).toMatchObject({ state: "active", activatedAt: at });
    expect(await version(templateId, 2)).toMatchObject({
      state: "superseded",
      supersededAt: at,
      sunsetAt: sunsetInstant(sunset, "America/New_York"),
      sunsetSetBy: "jordan",
    });
    expect((await auditAt(at)).map((r) => r.action).sort()).toEqual([
      "version.activated",
      "version.sunset_set",
      "version.superseded",
    ]);
    const notices = await noticesAt(at);
    expect(notices.map((n) => [n.consumerId, n.kind]).sort()).toEqual([
      ["coral", "new_version"],
      ["coral", "sunset_scheduled"],
    ]);
    const newVersion = notices.find((n) => n.kind === "new_version")!;
    expect(newVersion.payload).toMatchObject({
      templateName: "Cash Back Welcome Bonus — Terms",
      versionNumber: 3,
      contractLines: ["v3 adds required `annual_fee` (Currency)."],
    });
  });

  it("refuses a sunset date that isn't after today, and one that isn't a date", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    as("maya");
    await submitNow(templateId);
    const at = as("jordan");
    const today = at.toISOString().slice(0, 10);
    expect(await approveVersion({ templateId, versionNumber: 1, sunsetPrevious: "2026-02-30", sampleSetsSeen: [] })).toEqual({
      ok: false,
      code: "invalid_date",
      reason: "Pick a valid date.",
    });
    // No Active version to sunset here, but the date is still checked.
    expect(await approveVersion({ templateId, versionNumber: 1, sunsetPrevious: today, sampleSetsSeen: [] })).toEqual({
      ok: false,
      ...REFUSALS.sunsetAfterToday,
    });
    expect((await version(templateId, 1))?.state).toBe("in_review");
  });
});

// ── A two-stage chain ─────────────────────────────────────────

describe("a two-stage chain", () => {
  beforeAll(async () => {
    await db.insert(approvalStages).values({
      id: "stage_test_legal",
      contentTypeId: "ct_disclosure",
      position: 1,
      name: "Legal",
      approverRule: { kind: "user", userId: "alex" },
    });
  });
  afterAll(async () => {
    await db.delete(approvalStages).where(eq(approvalStages.id, "stage_test_legal"));
  });

  it("moves through the stages in order; only the named approver acts on Legal", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 1 });

    const first = as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: ["typical"] })).toEqual({
      ok: true,
      wentLive: false,
      number: 1,
    });
    expect(await version(templateId, 1)).toMatchObject({ state: "in_review", currentStage: 1, activatedAt: null });
    expect((await auditAt(first)).map((r) => r.action)).toEqual(["version.stage_approved"]);
    expect((await notificationsAt(first)).map((n) => [n.userId, n.kind])).toEqual([
      ["alex", "review_requested"],
      ["maya", "stage_approved"],
    ]);

    as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: [] })).toEqual({
      ok: false,
      code: "waiting_on_stage",
      reason: "Waiting on Legal.",
    });

    as("alex");
    expect(await approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: [] })).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
    });
    const v1 = (await version(templateId, 1))!;
    expect(v1.state).toBe("active");
    expect(
      (await db.select().from(approvals).where(eq(approvals.versionId, v1.id))).map((a) => [a.stageName, a.actorId]),
    ).toEqual([
      ["Team approver", "jordan"],
      ["Legal", "alex"],
    ]);
  });
});

// ── Maker-checker covers everyone who wrote the version ───────

// Holding Author and Approver on one team is normal (approving an access request can add the role).
// The seed gives nobody both, so Priya gets Approver on Coral Offers here, beside her Author role.
describe("maker-checker: nobody decides a version they wrote", () => {
  let priyaMembership: string;

  beforeAll(async () => {
    const [m] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, "priya"), eq(memberships.teamId, "coral-offers")));
    priyaMembership = m!.id;
    await db.insert(membershipRoles).values({ membershipId: priyaMembership, role: "approver" });
    people.priya = await loadPersona(db, "priya");
  });
  afterAll(async () => {
    await db
      .delete(membershipRoles)
      .where(and(eq(membershipRoles.membershipId, priyaMembership), eq(membershipRoles.role, "approver")));
    people.priya = await loadPersona(db, "priya");
  });

  /** An autosave by this person, as the workspace sends it. */
  async function edit(userId: string, templateId: string, text: string) {
    const at = as(userId);
    const draft = (await draftOf(templateId))!;
    const body = { ...draft.body, content: [...(draft.body.content ?? []), { type: "paragraph", content: [{ type: "text", text }] }] };
    const saved = await applyDraftPatch(db, {
      viewer: people[userId]!,
      versionId: draft.id,
      patch: { rev: draft.rev, sessionKey: `session-${userId}-${minute}`, body },
      at,
    });
    expect(saved.ok, `${userId}'s save lands`).toBe(true);
  }

  const wrote = { ok: false, ...REASONS.wroteVersion };
  const decisionsOn = async (templateId: string, number: number) =>
    db.select().from(approvals).where(eq(approvals.versionId, (await version(templateId, number))!.id));

  it("Priya edits Maya's draft and Maya submits it: Priya can neither approve nor send it back", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    await edit("priya", templateId, "Priya's sentence.");
    expect((await draftOf(templateId))?.writers).toEqual(["maya", "priya"]);

    const submittedAt = as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 1 });
    expect((await version(templateId, 1))?.writers).toEqual(["maya", "priya"]);
    // Priya holds Approver, but she isn't asked to review what she wrote.
    expect((await notificationsAt(submittedAt)).map((n) => [n.userId, n.kind])).toEqual([
      ["alex", "review_requested"],
      ["jordan", "review_requested"],
    ]);

    const at = as("priya");
    expect(await approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: [] })).toEqual(wrote);
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "Mine to fix." })).toEqual(wrote);
    expect(await version(templateId, 1)).toMatchObject({ state: "in_review" });
    expect(await decisionsOn(templateId, 1)).toEqual([]);
    expect(await auditAt(at)).toEqual([]);

    // Jordan wrote none of it.
    as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: [] })).toEqual({
      ok: true,
      wentLive: true,
      number: 1,
    });
  });

  it("writers carry across a change request; the approver who asked can approve the next round", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    await edit("priya", templateId, "Priya's sentence.");
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 1 });

    as("jordan");
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "Spell out the APR." })).toEqual({ ok: true });
    expect(await draftOf(templateId)).toMatchObject({ createdBy: "maya", writers: ["maya", "priya"] });

    // Maya fixes it alone and resubmits: Priya wrote round one, so round two isn't hers to decide either.
    await edit("maya", templateId, "The APR is 21.99%.");
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 2 });
    expect((await version(templateId, 2))?.writers).toEqual(["maya", "priya"]);

    as("priya");
    expect(await approveVersion({ templateId, versionNumber: 2, sampleSetsSeen: [] })).toEqual(wrote);
    expect(await requestChanges({ templateId, versionNumber: 2, reason: "x" })).toEqual(wrote);

    as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 2, sampleSetsSeen: [] })).toMatchObject({ ok: true, wentLive: true });
  });

  it("whoever submitted round one stays barred from round two, even without editing it", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    as("priya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 1 });
    expect((await version(templateId, 1))?.writers).toEqual(["maya", "priya"]);

    as("jordan");
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "Spell out the APR." })).toEqual({ ok: true });
    await edit("maya", templateId, "The APR is 21.99%.");
    const resubmitted = as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 2 });
    expect(await version(templateId, 2)).toMatchObject({ submittedBy: "maya", writers: ["maya", "priya"] });
    expect((await notificationsAt(resubmitted)).map((n) => n.userId)).toEqual(["alex", "jordan"]);

    as("priya");
    expect(await approveVersion({ templateId, versionNumber: 2, sampleSetsSeen: [] })).toEqual(wrote);
    expect(await requestChanges({ templateId, versionNumber: 2, reason: "x" })).toEqual(wrote);
  });

  it("a change request that finds a draft already open merges the version's writers into it", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    await edit("priya", templateId, "Priya's sentence.");
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 1 });
    // Nothing in the app opens a draft while a version is in review; put one there to check the guard.
    const v1 = (await version(templateId, 1))!;
    await db.insert(versions).values({
      ...v1,
      id: `v_open_${templateId}`,
      number: null,
      state: "draft",
      basedOnVersionId: v1.id,
      submittedBy: null,
      submittedAt: null,
      submitNote: null,
      writers: ["maya"],
    });

    as("jordan");
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "Spell out the APR." })).toEqual({ ok: true });
    const drafts = await db
      .select({ id: versions.id, writers: versions.writers })
      .from(versions)
      .where(and(eq(versions.templateId, templateId), eq(versions.state, "draft")));
    expect(drafts).toEqual([{ id: `v_open_${templateId}`, writers: ["maya", "priya"] }]);
  });

  it("an approver who only sent it back becomes a writer once they edit the next round", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 1 });
    as("priya");
    expect(await requestChanges({ templateId, versionNumber: 1, reason: "Too vague." })).toEqual({ ok: true });
    expect((await draftOf(templateId))?.writers).toEqual(["maya"]);

    await edit("priya", templateId, "Priya's fix.");
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 2 });
    as("priya");
    expect(await approveVersion({ templateId, versionNumber: 2, sampleSetsSeen: [] })).toEqual(wrote);
  });
});

// ── Sunset ────────────────────────────────────────────────────

describe("setSunset", () => {
  it("moves a Superseded version's sunset and tells Coral", async () => {
    const templateId = ids["balance-transfer"]!;
    const at = as("alex");
    const day = new Date(at.getTime() + 30 * DAY).toISOString().slice(0, 10);
    expect(await setSunset({ templateId, versionNumber: 1, sunsetAt: day })).toEqual({ ok: true });
    expect(await version(templateId, 1)).toMatchObject({
      sunsetAt: sunsetInstant(day, "America/New_York"),
      sunsetSetBy: "alex",
    });
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["version.sunset_set"]);
    expect((await noticesAt(at)).map((n) => [n.consumerId, n.kind])).toEqual([["coral", "sunset_scheduled"]]);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The same date again (a double click) writes nothing.
    const again = as("alex");
    expect(await setSunset({ templateId, versionNumber: 1, sunsetAt: day })).toEqual({ ok: true });
    expect(await auditAt(again)).toEqual([]);
    expect(await noticesAt(again)).toEqual([]);
  });

  // A sunset date ends at 00:00 on that day in the business time zone (decision 0017), Eastern until a
  // Platform Admin picks another: "Sunset on March 1" must not stop renders at 7 PM Eastern on February 28.
  describe("in the business time zone", () => {
    const templateId = () => ids["balance-transfer"]!;
    let before: Date | null = null;
    beforeAll(async () => {
      before = (await version(templateId(), 1))!.sunsetAt;
    });
    afterEach(async () => {
      await db.delete(settings).where(eq(settings.key, "business_zone"));
      await db.update(versions).set({ sunsetAt: before }).where(and(eq(versions.templateId, templateId()), eq(versions.number, 1)));
    });

    it("stores 00:00 Eastern on the day picked, and records the day and the zone", async () => {
      const at = as("alex");
      expect(await setSunset({ templateId: templateId(), versionNumber: 1, sunsetAt: "2027-03-01" })).toEqual({ ok: true });
      // 00:00 EST is 05:00 UTC; midnight UTC would be 7 PM Eastern on February 28.
      expect((await version(templateId(), 1))!.sunsetAt).toEqual(new Date("2027-03-01T05:00:00.000Z"));
      const [audit] = await auditAt(at);
      expect(audit!.details).toMatchObject({ sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: "America/New_York" });
      const [notice] = await noticesAt(at);
      expect(notice!.payload).toMatchObject({ sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01" });
    });

    it("stores 00:00 in the zone Platform settings name", async () => {
      await db.insert(settings).values({ key: "business_zone", value: "America/Los_Angeles" });
      as("alex");
      expect(await setSunset({ templateId: templateId(), versionNumber: 1, sunsetAt: "2027-03-01" })).toEqual({ ok: true });
      expect((await version(templateId(), 1))!.sunsetAt).toEqual(new Date("2027-03-01T08:00:00.000Z")); // 00:00 PST
    });

    it("reads 'after today' there: at 23:30 Eastern, the next day is still after today", async () => {
      as("alex");
      env.now = new Date("2026-10-05T03:30:00.000Z"); // 23:30 EDT on October 4; already the 5th in UTC
      expect(await setSunset({ templateId: templateId(), versionNumber: 1, sunsetAt: "2026-10-04" })).toEqual({
        ok: false,
        ...REFUSALS.sunsetAfterToday,
      });
      expect(await setSunset({ templateId: templateId(), versionNumber: 1, sunsetAt: "2026-10-05" })).toEqual({ ok: true });
      expect((await version(templateId(), 1))!.sunsetAt).toEqual(new Date("2026-10-05T04:00:00.000Z")); // in half an hour
    });
  });

  it("refuses an Active version, a past date, a bad date and a non-approver", async () => {
    const templateId = ids["balance-transfer"]!;
    const at = as("jordan");
    const later = new Date(at.getTime() + 40 * DAY).toISOString().slice(0, 10);
    expect(await setSunset({ templateId, versionNumber: 2, sunsetAt: later })).toEqual({
      ok: false,
      ...REFUSALS.sunsetNotSuperseded,
    });
    expect(await setSunset({ templateId, versionNumber: 1, sunsetAt: "2026-01-01" })).toEqual({
      ok: false,
      ...REFUSALS.sunsetAfterToday,
    });
    expect(await setSunset({ templateId, versionNumber: 1, sunsetAt: "soon" })).toEqual({
      ok: false,
      code: "invalid_date",
      reason: "Pick a valid date.",
    });
    as("maya");
    expect(await setSunset({ templateId, versionNumber: 1, sunsetAt: later })).toEqual({
      ok: false,
      ...REASONS.generic,
    });
  });

  it("refuses a new date once the sunset has passed, and writes nothing", async () => {
    const templateId = ids["balance-transfer"]!;
    const where = and(eq(versions.templateId, templateId), eq(versions.number, 1));
    const before = (await version(templateId, 1))!;
    const at = as("jordan");
    // Yesterday's midnight in the business time zone, as a date picked in the dialog is stored.
    const passed = sunsetInstant(new Date(at.getTime() - DAY).toISOString().slice(0, 10), "America/New_York");
    await db.update(versions).set({ sunsetAt: passed }).where(where);
    try {
      const { rev } = (await version(templateId, 1))!;
      // Any date, the one it already has included (that is no double click: the date is final).
      for (const day of [1, 40].map((n) => new Date(at.getTime() + n * DAY)).concat(passed)) {
        expect(await setSunset({ templateId, versionNumber: 1, sunsetAt: day.toISOString().slice(0, 10) })).toEqual({
          ok: false,
          ...REFUSALS.sunsetPassed,
        });
      }
      expect(await version(templateId, 1)).toMatchObject({ state: "superseded", sunsetAt: passed, rev });
      expect(await auditAt(at)).toEqual([]);
      expect(await noticesAt(at)).toEqual([]);
      expect(await notificationsAt(at)).toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await db.update(versions).set({ sunsetAt: before.sunsetAt }).where(where);
    }
  });
});

// ── Revoke (scenario 6) ───────────────────────────────────────

describe("the two-person revoke (scenario 6)", () => {
  const reason = "Wrong APR in legal notices.";

  it("Jordan starts a revoke on Balance Transfer v1 and can't confirm it himself", async () => {
    const templateId = ids["balance-transfer"]!;
    const at = as("jordan");
    expect(await startRevoke({ templateId, versionNumber: 1, reason })).toEqual({ ok: true });
    const v1 = (await version(templateId, 1))!;
    expect(v1.state).toBe("superseded");
    expect(v1.revoke).toEqual({ reason, startedBy: "jordan", startedAt: at.toISOString() });
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["version.revoke_started"]);
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind])).toEqual([["alex", "revoke_started"]]);

    as("jordan");
    expect(await startRevoke({ templateId, versionNumber: 1, reason })).toEqual({
      ok: false,
      ...REFUSALS.revokePending,
    });
    expect(await confirmRevoke({ templateId, versionNumber: 1 })).toEqual({ ok: false, ...REASONS.ownRevoke });
    expect((await version(templateId, 1))?.state).toBe("superseded");
  });

  it("Alex confirms: v1 is Revoked, Coral is told, and a second confirm is refused", async () => {
    const templateId = ids["balance-transfer"]!;
    const at = as("alex");
    expect(await confirmRevoke({ templateId, versionNumber: 1 })).toEqual({ ok: true });
    const v1 = (await version(templateId, 1))!;
    expect(v1.state).toBe("revoked");
    expect(v1.revoke).toMatchObject({ startedBy: "jordan", confirmedBy: "alex", confirmedAt: at.toISOString() });
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["version.revoked"]);
    expect((await noticesAt(at)).map((n) => [n.consumerId, n.kind])).toEqual([["coral", "revoked"]]);
    // Jordan (the starter) and Priya (who submitted v1) hear about it; Alex doesn't notify himself.
    expect((await notificationsAt(at)).map((n) => [n.userId, n.kind])).toEqual([
      ["jordan", "version_revoked"],
      ["priya", "version_revoked"],
    ]);

    as("jordan");
    expect(await confirmRevoke({ templateId, versionNumber: 1 })).toEqual({ ok: false, ...REFUSALS.alreadyRevoked });
    expect(await cancelRevoke({ templateId, versionNumber: 1 })).toEqual({ ok: false, ...REFUSALS.alreadyRevoked });
  });

  it("an author can't start, confirm or cancel a revoke", async () => {
    const templateId = ids["holiday-points"]!;
    as("maya");
    expect(await startRevoke({ templateId, versionNumber: 2, reason })).toEqual({ ok: false, ...REASONS.generic });
    expect(await confirmRevoke({ templateId, versionNumber: 2 })).toEqual({ ok: false, ...REASONS.generic });
    expect(await cancelRevoke({ templateId, versionNumber: 2 })).toEqual({ ok: false, ...REASONS.generic });
  });

  it("another approver may cancel a pending revoke; the version keeps its state", async () => {
    const templateId = ids["holiday-points"]!;
    as("alex");
    expect(await startRevoke({ templateId, versionNumber: 2, reason: "Wrong bonus" })).toEqual({ ok: true });
    const at = as("jordan");
    expect(await cancelRevoke({ templateId, versionNumber: 2 })).toEqual({ ok: true });
    expect(await version(templateId, 2)).toMatchObject({ state: "active", revoke: null });
    expect((await auditAt(at)).map((r) => r.action)).toEqual(["version.revoke_cancelled"]);

    as("jordan");
    expect(await cancelRevoke({ templateId, versionNumber: 2 })).toEqual({ ok: false, ...REFUSALS.noRevokePending });
  });
});

// ── After the Active version is revoked (handoff review D1) ───

describe("after the Active version is revoked (handoff review D1)", () => {
  const NAME = "Revoke Recovery — Terms";
  const PROMO: Variable = { key: "promo_code", label: "Promo code", type: "text", required: false, sample: "SPRING" };
  const FEE: Variable = { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95.00" };
  let templateId: string;

  /** Saves the open draft's variables the way autosave does. */
  async function saveVariables(userId: string, change: (variables: Variable[]) => Variable[]) {
    const draft = (await draftOf(templateId))!;
    const saved = await saveDraft(people[userId]!, draft.id, {
      rev: draft.rev,
      sessionKey: `d1-${minute}`,
      variables: change(draft.variables),
    });
    expect(saved).toMatchObject({ ok: true });
  }

  /** Revokes a version: Jordan starts it, Alex confirms it. */
  async function revoke(versionNumber: number) {
    as("jordan");
    expect(await startRevoke({ templateId, versionNumber, reason: "Wrong APR in the legal notices." })).toEqual({ ok: true });
    as("alex");
    expect(await confirmRevoke({ templateId, versionNumber })).toEqual({ ok: true });
    expect((await version(templateId, versionNumber))?.state).toBe("revoked");
  }

  // v1 goes live; v2 adds an optional promo code and replaces it, so v1 is Superseded with no sunset
  // and still renders; Coral renders v2; then v2 is revoked. Nothing is Active.
  beforeAll(async () => {
    ({ templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE, name: NAME }));
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 1 });
    as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: [] })).toMatchObject({ ok: true, wentLive: true });

    as("maya");
    await startDraft({ templateId });
    await saveVariables("maya", (variables) => [...variables, PROMO]);
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 2 });
    const at = as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 2, sampleSetsSeen: [] })).toMatchObject({ ok: true, wentLive: true });

    const v2 = (await version(templateId, 2))!;
    await db.insert(renderLog).values({
      id: "rl_test_d1",
      at,
      templateId,
      versionId: v2.id,
      versionNumber: 2,
      consumerId: "coral",
      channel: "web",
      isPreview: false,
      correlationId: "test-d1",
      outcome: "ok",
    });
    await revoke(2);
    expect(await version(templateId, 1)).toMatchObject({ state: "superseded", sunsetAt: null });
  });

  it("offers Edit, which starts the corrected draft from the revoked version", async () => {
    as("maya");
    expect(await getWorkspaceHeader("coral-offers", templateId)).toMatchObject({
      status: "revoked",
      activeNumber: null,
      canStartDraft: true,
    });
    as("sam");
    expect((await getWorkspaceHeader("coral-offers", templateId)).canStartDraft, "a viewer can't edit").toBe(false);

    const at = as("maya");
    vi.mocked(redirect).mockClear();
    await startDraft({ templateId });
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(`/coral-offers/templates/${templateId}`, "replace");

    const v2 = (await version(templateId, 2))!;
    const draft = (await draftOf(templateId))!;
    expect(draft).toMatchObject({
      number: null,
      basedOnVersionId: v2.id,
      createdBy: "maya",
      body: v2.body,
      variables: v2.variables,
      channels: v2.channels,
      channelFields: v2.channelFields,
      sampleSets: v2.sampleSets,
      contractChanges: null,
    });
    expect(blockIds(draft.body), "the same block ids, so comment threads carry over").toEqual(blockIds(v2.body));
    expect((await auditAt(at)).map((r) => [r.action, r.details])).toEqual([["draft.started", { basedOn: 2 }]]);
    expect((await version(templateId, 2))?.state, "the revoked version stays revoked").toBe("revoked");

    const header = await getWorkspaceHeader("coral-offers", templateId);
    expect(header).toMatchObject({ status: "draft", versionLabel: "Based on v2", basedOnNumber: 2, canStartDraft: false });
  });

  it("compares the draft with v1, the newest version that still renders, in the workspace and the submit dialog", async () => {
    as("maya");
    await saveVariables("maya", (variables) => [...variables, FEE]);
    const v1 = (await version(templateId, 1))!;

    const document = await getWorkspaceDocument("coral-offers", templateId);
    expect(document.baseline).toEqual(v1.variables);
    expect(document.baseline?.map((v) => v.key)).not.toContain(PROMO.key);

    const summary = await getSubmitSummary(people.maya!, { templateId });
    expect(summary).toMatchObject({ ok: true, summary: { number: 3, baseline: { number: 1, variables: v1.variables } } });
  });

  it("submit freezes the contract changes against v1, not the revoked v2", async () => {
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 3 });
    const v3 = (await version(templateId, 3))!;
    expect(v3.contractChanges).toEqual([
      { kind: "added", key: PROMO.key, breaking: false, type: "text", required: false },
      { kind: "added", key: FEE.key, breaking: true, type: "currency", required: true },
    ]);
  });

  it("Jordan approves v3: it goes live over nothing, v2 stays Revoked, v1 keeps rendering, and Coral is told", async () => {
    const v1Before = (await version(templateId, 1))!;
    const v2Before = (await version(templateId, 2))!;
    const at = as("jordan");
    // There's no previous Active version for a sunset to land on: the date is ignored.
    const sunset = new Date(at.getTime() + 14 * DAY).toISOString().slice(0, 10);
    expect(await approveVersion({ templateId, versionNumber: 3, sunsetPrevious: sunset, sampleSetsSeen: ["typical"] })).toEqual({
      ok: true,
      wentLive: true,
      number: 3,
    });

    expect(await version(templateId, 3)).toMatchObject({ state: "active", activatedAt: at });
    expect(await version(templateId, 2)).toEqual(v2Before);
    expect(await version(templateId, 1)).toEqual(v1Before);
    expect((await auditAt(at)).map((r) => [r.action, r.details])).toEqual([
      ["version.activated", { number: 3, supersedes: null, stage: "Team approver" }],
    ]);

    const notices = await noticesAt(at);
    expect(notices.map((n) => [n.consumerId, n.kind])).toEqual([["coral", "new_version"]]);
    expect(notices[0]!.payload).toMatchObject({
      templateName: NAME,
      versionNumber: 3,
      activeVersion: 3,
      contractLines: describeChanges((await version(templateId, 3))!.contractChanges!, 3),
    });
    expect(notices[0]!.payload).toMatchObject({
      contractLines: ["v3 adds optional `promo_code` (Text).", "v3 adds required `annual_fee` (Currency)."],
    });

    as("maya");
    expect(await getWorkspaceHeader("coral-offers", templateId)).toMatchObject({
      status: "active",
      activeNumber: 3,
      canStartDraft: true,
    });
  });

  it("with nothing left that renders, the corrected draft has no baseline, like a first version", async () => {
    await revoke(3);
    // v1's sunset passes as well.
    const passed = new Date(env.now.getTime() - DAY);
    await db.update(versions).set({ sunsetAt: passed }).where(and(eq(versions.templateId, templateId), eq(versions.number, 1)));

    as("maya");
    await startDraft({ templateId });
    expect((await draftOf(templateId))?.basedOnVersionId).toBe((await version(templateId, 3))!.id);
    expect((await getWorkspaceDocument("coral-offers", templateId)).baseline).toBeNull();
    expect(await getSubmitSummary(people.maya!, { templateId })).toMatchObject({ ok: true, summary: { number: 4, baseline: null } });
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 4 });
    expect((await version(templateId, 4))?.contractChanges).toBeNull();
  });
});

// ── A renamed variable is one rename, through submit and to consumers (handoff review D8) ──

describe("a variable renamed in a draft", () => {
  const NAME = "Rename Contract — Terms";
  let templateId: string;

  /**
   * One editing session, as the workspace runs it: the editor's variable store opens on the saved list,
   * `edit` works on it, and autosave sends the list it reports through the route's own parser.
   */
  async function editVariables(userId: string, edit: (store: ReturnType<typeof createVariableStore>) => void) {
    const draft = (await draftOf(templateId))!;
    const store = createVariableStore(draft.variables);
    edit(store);
    const text = JSON.stringify({ rev: draft.rev, sessionKey: `d8-session-${minute}`, variables: store.getState().variables });
    const parsed = parseDraftPatchText(text);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(await saveDraft(people[userId]!, draft.id, parsed.patch)).toMatchObject({ ok: true });
  }

  // v1 goes live with `first_name`, and Coral renders it, so it hears about the next version.
  beforeAll(async () => {
    ({ templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE, name: NAME }));
    as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 1 });
    const at = as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 1, sampleSetsSeen: [] })).toMatchObject({ ok: true, wentLive: true });
    const v1 = (await version(templateId, 1))!;
    expect(v1.variables.map((v) => v.key)).toContain("first_name");
    await db.insert(renderLog).values({
      id: "rl_test_d8",
      at,
      templateId,
      versionId: v1.id,
      versionNumber: 1,
      consumerId: "coral",
      channel: "web",
      isPreview: false,
      correlationId: "test-d8",
      outcome: "ok",
    });
  });

  it("is saved with the draft: renamed in one session and again after a reload, it is one rename against v1", async () => {
    as("maya");
    await startDraft({ templateId });
    await editVariables("maya", (store) => store.getState().update("first_name", { key: "given_name" }));
    expect((await draftOf(templateId))!.variables.find((v) => v.key === "given_name")).toMatchObject({ id: "first_name" });

    // A new page visit: the store opens on the saved list, and the next rename chains onto the first.
    await editVariables("maya", (store) => store.getState().update("given_name", { key: "name_on_card" }));
    const summary = await getSubmitSummary(people.maya!, { templateId });
    if (!summary.ok) throw new Error(summary.reason);
    expect(describeChanges(diffVariables(summary.summary.baseline!.variables, summary.summary.variables), 2)).toEqual([
      "v2 renames `first_name` to `name_on_card`.",
    ]);
  });

  it("submit stores one key_renamed with the old and the new key, not a removal and an addition", async () => {
    const at = as("maya");
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 2 });
    expect((await version(templateId, 2))!.contractChanges).toEqual([
      { kind: "key_renamed", key: "name_on_card", breaking: true, from: "first_name", to: "name_on_card" },
    ]);
    expect((await auditAt(at)).find((r) => r.action === "version.submitted")?.details).toMatchObject({
      contractChanges: 1,
      breaking: true,
    });
  });

  it("approved, the consumer notice carries the rename for Coral to map", async () => {
    const at = as("jordan");
    expect(await approveVersion({ templateId, versionNumber: 2, sampleSetsSeen: [] })).toMatchObject({ ok: true, wentLive: true });
    const [notice] = (await noticesAt(at)).filter((n) => n.kind === "new_version");
    expect(notice).toMatchObject({ consumerId: "coral", templateId });
    expect(notice!.payload).toMatchObject({
      versionNumber: 2,
      contractChanges: [{ kind: "key_renamed", key: "name_on_card", breaking: true, from: "first_name", to: "name_on_card" }],
      contractLines: ["v2 renames `first_name` to `name_on_card`."],
    });
    const served = noticeView(notice!);
    expect(served.changes).toEqual([
      {
        kind: "key_renamed",
        key: "name_on_card",
        breaking: true,
        from: "first_name",
        to: "name_on_card",
        text: "v2 renames `first_name` to `name_on_card`.",
      },
    ]);
    expect(served.message).toBe(`${NAME} v2 is available. It renames first_name to name_on_card.`);
  });

  it("in the next version, a new variable under the old key is an addition, not the renamed one", async () => {
    as("maya");
    await startDraft({ templateId });
    await editVariables("maya", (store) =>
      store.getState().create({ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }),
    );
    expect(await submitNow(templateId)).toEqual({ ok: true, number: 3 });
    expect((await version(templateId, 3))!.contractChanges).toEqual([
      { kind: "added", key: "first_name", breaking: true, type: "text", required: true },
    ]);
  });
});

// ── Submit freezes only what the summary showed (handoff review I8) ──

describe("submit is a compare-and-set on the summary's rev", () => {
  const GIFT: Variable = { key: "gift_card", label: "Gift card", type: "text", required: false, sample: "Amazon" };

  it("refuses a summary the draft has moved past, and writes nothing", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    as("maya");
    const read = await getSubmitSummary(people.maya!, { templateId });
    if (!read.ok) throw new Error(read.reason);
    expect(read.summary.rev).toBe(0);
    expect(read.summary.variables.map((v) => v.key)).not.toContain(GIFT.key);

    // A save lands after the summary was read: from a debounce still running on this page, or another tab.
    const draft = (await draftOf(templateId))!;
    expect(
      await saveDraft(people.maya!, draft.id, { rev: draft.rev, sessionKey: "i8-late", variables: [...draft.variables, GIFT] }),
    ).toMatchObject({ ok: true, rev: 1 });
    const before = (await draftOf(templateId))!;

    const at = as("maya");
    expect(await submitVersion({ templateId, note: "Ready.", rev: read.summary.rev })).toEqual({
      ok: false,
      ...REFUSALS.summaryStale,
    });
    expect(await draftOf(templateId), "still the same draft, unfrozen, with the late save in it").toEqual(before);
    expect(await auditAt(at)).toEqual([]);
    expect(await notificationsAt(at)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("submits with the rev of a summary read after that save, freezing what it showed", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    as("maya");
    const draft = (await draftOf(templateId))!;
    await saveDraft(people.maya!, draft.id, { rev: draft.rev, sessionKey: "i8-early", variables: [...draft.variables, GIFT] });

    const read = await getSubmitSummary(people.maya!, { templateId });
    if (!read.ok) throw new Error(read.reason);
    expect(read.summary.rev).toBe(1);
    expect(read.summary.variables.map((v) => v.key)).toContain(GIFT.key);

    as("maya");
    expect(await submitVersion({ templateId, rev: read.summary.rev })).toEqual({ ok: true, number: 1 });
    const v1 = (await version(templateId, 1))!;
    expect(v1.state).toBe("in_review");
    expect(v1.variables.map((v) => v.key)).toContain(GIFT.key);
  });

  it("refuses a call without a rev", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    as("maya");
    const unchecked = submitVersion as (input: { templateId: string }) => ReturnType<typeof submitVersion>;
    expect(await unchecked({ templateId })).toMatchObject({ ok: false });
    expect((await draftOf(templateId))?.state).toBe("draft");
  });
});

// ── Permissions and unknowns ──────────────────────────────────

describe("permission checks come first", () => {
  it("refuses a viewer, and an unknown template the same way, without writing", async () => {
    const { templateId } = await createTemplateWithDraft(db, { teamId: "coral-offers", createdBy: "maya", at: BASE });
    const at = as("sam");
    expect(await submitNow(templateId)).toEqual({ ok: false, ...REASONS.generic });
    expect(await submitVersion({ templateId: "UC-ZZZZZZ", rev: 0 })).toEqual({ ok: false, ...REASONS.generic });
    expect(await requestChanges({ templateId: ids["cash-back"]!, versionNumber: 2, reason: "x" })).toEqual({
      ok: false,
      ...REASONS.generic,
    });
    expect((await draftOf(templateId))?.state).toBe("draft");
    expect(await auditAt(at)).toEqual([]);
  });

  it("refuses an approver on another team", async () => {
    as("jordan");
    const deposits = ids["high-yield-savings"]!;
    expect(await startRevoke({ templateId: deposits, versionNumber: 2, reason: "x" })).toEqual({
      ok: false,
      ...REASONS.generic,
    });
  });
});

// ── The migration's backfill ──────────────────────────────────

// Last, once every test above has written versions through the actions: the SQL that filled `writers`
// for rows that existed before the column did must reach the same writers the app records.
describe("the writers backfill in the migration", () => {
  it("rebuilds every version's writers from its creator, submitter, edits and returned rounds", async () => {
    const folder = "./src/server/db/migrations";
    const file = readdirSync(folder).find((name) => name.endsWith("_version_writers.sql"))!;
    const [, backfill] = readFileSync(`${folder}/${file}`, "utf8").split("--> statement-breakpoint");
    const writersById = async () =>
      Object.fromEntries(
        (await db.select({ id: versions.id, writers: versions.writers }).from(versions)).map((v) => [v.id, [...v.writers].sort()]),
      );

    const recorded = await writersById();
    expect(Object.values(recorded).some((w) => w.length > 1), "some version has two writers").toBe(true);
    await libsql.execute("UPDATE versions SET writers = '[]'");
    await libsql.execute(backfill!);
    expect(await writersById()).toEqual(recorded);
  });
});
