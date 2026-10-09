import type { Client, InValue } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { rowsOf } from "./helpers/cleanup";
import { asPersona, expect, hydrated, liveEditor, tap, test, typeSlowly } from "./helpers/scenario";

// Comments belong to a draft or a version in review (docs/handoff-review.md, S7 and S9; decision 0010).
//
//   1. Jordan, an approver, opens Cash Back v3 (in review, the seed's) and comments on a block from the rail's
//      "Comment on a block" menu. The thread shows at once and is saved. He replies to it, then resolves it.
//   2. Balance Transfer v2 is Active, so its threads are a record. On its review screen and in the template's
//      workspace, a thread on it shows its comment and nothing to answer it with: no Reply, no Resolve, and no
//      "Comment on a block". (The UI has never offered them there; the server now refuses a direct call too,
//      which src/server/actions/comments.test.ts covers.)
//
// afterAll removes the threads, comments, audit rows and notifications this spec wrote.

const TEAM = "coral-offers";
const CASH_BACK = "Cash Back Welcome Bonus — Terms";
const BALANCE = "Balance Transfer Intro — Terms";
const COMMENT = "Is the bonus window still 90 days?";
const REPLY = "Checked with Product: it is.";
/** The thread this spec puts on Balance Transfer v2 (Active), and its one comment. */
const RECORD = "th_e2e_comment_record";
const RECORD_BODY = "Approved wording, kept for the record.";

let db: Client;
let cashBack: { templateId: string; number: number };
let balance: { templateId: string; number: number };
/** Jordan's thread on Cash Back v3, once it is saved, and when (the demo clock), for the cleanup. */
let posted: { id: string; createdAt: number } | null = null;

const one = async (sql: string, args: InValue[]) => (await rowsOf(db, sql, args))[0];

test.beforeAll(async () => {
  db = openDb();
  const inReview = await one(
    "SELECT v.template_id, v.number FROM versions v JOIN templates t ON t.id = v.template_id WHERE t.name = ? AND v.state = 'in_review'",
    [CASH_BACK],
  );
  const active = await one(
    "SELECT v.id, v.template_id, v.number, v.body FROM versions v JOIN templates t ON t.id = v.template_id WHERE t.name = ? AND v.state = 'active'",
    [BALANCE],
  );
  if (!inReview || !active) throw new Error("This spec needs the fresh seed (npm run db:reset).");
  cashBack = { templateId: String(inReview.template_id), number: Number(inReview.number) };
  balance = { templateId: String(active.template_id), number: Number(active.number) };
  const drafts = await rowsOf(db, "SELECT id FROM versions WHERE template_id = ? AND state = 'draft'", [balance.templateId]);
  expect(drafts, "Balance Transfer has no open draft: nothing on it takes comments").toEqual([]);

  // A thread on a block of the Active version, as one left from its review would be.
  const body = JSON.parse(String(active.body)) as { content: { attrs?: { id?: string } }[] };
  const blockId = body.content.map((b) => b.attrs?.id).filter(Boolean)[1]!;
  const at = Date.now() - 86_400_000;
  await rowsOf(
    db,
    "INSERT INTO comment_threads (id, template_id, origin_version_id, block_id, quote, status, created_at) VALUES (?, ?, ?, ?, NULL, 'open', ?)",
    [RECORD, balance.templateId, String(active.id), blockId, at],
  );
  await rowsOf(
    db,
    "INSERT INTO comments (id, thread_id, author_id, body, kind, created_at) VALUES (?, ?, 'jordan', ?, 'comment', ?)",
    [`cm_${RECORD}`, RECORD, RECORD_BODY, at],
  );
});

test.afterAll(async () => {
  if (!db) return;
  try {
    const threads = [RECORD, ...(posted ? [posted.id] : [])];
    for (const id of threads) {
      await rowsOf(db, "DELETE FROM comments WHERE thread_id = ?", [id]);
      await rowsOf(db, "DELETE FROM audit_events WHERE json_extract(details, '$.threadId') = ?", [id]);
      await rowsOf(db, "DELETE FROM comment_threads WHERE id = ?", [id]);
    }
    if (posted) {
      await rowsOf(db, "DELETE FROM notifications WHERE kind = 'comment_added' AND href LIKE ? AND created_at >= ?", [
        `%/${cashBack.templateId}%`,
        posted.createdAt,
      ]);
    }
  } finally {
    db.close();
  }
});

const decision = (page: Page): Locator => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const blockMenu = (scope: Locator) => scope.getByRole("button", { name: "Comment on a block" });
const replyControl = (card: Locator) => card.locator('[data-slot="reply"]');
const resolveButton = (card: Locator) => card.getByRole("button", { name: "Resolve", exact: true });

async function openReview(page: Page, person: string, templateId: string, number: number, name: string) {
  await asPersona(page, person);
  await page.goto(`/${TEAM}/review/${templateId}/${number}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(decision(page)).toBeVisible();
  await liveEditor(page);
  await hydrated(page);
}

test.use({ trace: "off", screenshot: "only-on-failure" });

test("a reviewer comments on a version in review; an Active version's threads offer nothing to answer them with", async ({ page }) => {
  test.setTimeout(120_000);

  await test.step("1. Jordan comments on a block of Cash Back v3, replies and resolves", async () => {
    await openReview(page, "jordan", cashBack.templateId, cashBack.number, CASH_BACK);
    await tap(blockMenu(decision(page)));
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await tap(menu.getByRole("menuitem").nth(1));

    const composer = decision(page).locator("article[data-compose]");
    await expect(composer).toBeVisible();
    const field = composer.getByRole("textbox", { name: "Add a comment" });
    await expect(field).toBeFocused();
    await typeSlowly(page, COMMENT);
    await tap(composer.getByRole("button", { name: "Comment", exact: true }));
    await expect(composer).toBeHidden();

    const card = decision(page).locator("article[data-thread]").filter({ hasText: COMMENT });
    await expect(card).toHaveAttribute("data-status", "open");
    await expect(card).toContainText("Jordan Ellis");
    await expect.poll(async () => (await one("SELECT id FROM comment_threads WHERE id IN (SELECT thread_id FROM comments WHERE body = ?)", [COMMENT]))?.id, {
      message: "the thread is saved",
    }).toBeTruthy();
    const saved = await one(
      "SELECT t.id, t.created_at, t.origin_version_id, v.number FROM comment_threads t JOIN versions v ON v.id = t.origin_version_id WHERE t.id IN (SELECT thread_id FROM comments WHERE body = ?)",
      [COMMENT],
    );
    posted = { id: String(saved!.id), createdAt: Number(saved!.created_at) };
    expect(Number(saved!.number)).toBe(cashBack.number);

    // Once the card carries the saved thread's id, its own Reply, then Resolve: the server takes both.
    await expect(card).toHaveAttribute("data-thread", posted.id);
    await tap(replyControl(card));
    const replyField = card.getByRole("textbox", { name: "Reply" });
    await expect(replyField).toBeFocused();
    await typeSlowly(page, REPLY);
    await tap(card.getByRole("button", { name: "Reply", exact: true }));
    await expect(card).toContainText(REPLY);
    await expect
      .poll(async () => (await rowsOf(db, "SELECT body FROM comments WHERE thread_id = ? ORDER BY created_at", [posted!.id])).map((r) => r.body), {
        message: "the reply is saved",
      })
      .toEqual([COMMENT, REPLY]);
    await expect(card.locator('[role="alert"]')).toHaveCount(0);

    await tap(resolveButton(card));
    await expect
      .poll(async () => (await one("SELECT status, resolved_by FROM comment_threads WHERE id = ?", [posted!.id])) ?? null, {
        message: "the resolve is saved",
      })
      .toMatchObject({ status: "resolved", resolved_by: "jordan" });
  });

  await test.step("2. On Balance Transfer v2 (Active), the review screen offers nothing to comment with", async () => {
    await openReview(page, "jordan", balance.templateId, balance.number, BALANCE);
    const record = decision(page).locator(`article[data-thread="${RECORD}"]`);
    await expect(record).toBeVisible();
    await expect(record).toContainText(RECORD_BODY);
    await expect(replyControl(record)).toHaveCount(0);
    await expect(resolveButton(record)).toHaveCount(0);
    await expect(blockMenu(decision(page))).toHaveCount(0);
  });

  await test.step("3. The template's workspace shows the thread the same way", async () => {
    await asPersona(page, "maya");
    await page.goto(`/${TEAM}/templates/${balance.templateId}`);
    await liveEditor(page);
    await hydrated(page);
    const rail = page.locator('aside[aria-label="Comments and variables"]');
    await expect(rail).toBeVisible();
    const record = rail.locator(`article[data-thread="${RECORD}"]`);
    await expect(record).toBeVisible();
    await expect(record).toContainText(RECORD_BODY);
    await expect(replyControl(record)).toHaveCount(0);
    await expect(resolveButton(record)).toHaveCount(0);
  });
});
