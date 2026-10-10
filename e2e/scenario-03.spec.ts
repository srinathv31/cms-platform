import type { Client, InValue } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { allVersions, correlation, expectError, logFor, openDb, render, validValues, type SeedVersion } from "./api/helpers";
import {
  NAME,
  asPersona,
  beat,
  caret,
  demoTimeout,
  documentEditor,
  expect,
  expectAutosaved,
  hydrated,
  isDemo,
  liveEditor,
  moveTo,
  nameField,
  openLibrary,
  pointInText,
  shoot,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// Phase 4 gate: demo scenario 3 ("Review loop"), start to finish, with Maya and Jordan taking turns
// through the persona switcher, as a presenter would.
//
//   0. Maya makes her own template (Card offer terms, renamed, a line added) and submits v1 through the
//      dialog with a note. The spec doesn't depend on scenario 2 having run.
//   1. Maya opens v1 in the review screen (Review, Submitted by me, the row): Approve and Request changes
//      are disabled, and "You submitted this version." says why.
//   2. Jordan: the Review badge counts the item and "Waiting on me" lists it. He opens it: the Document
//      view, the stepper on "Team approver". He selects text in a block and comments; the thread is in the
//      rail and the marker is in the gutter. He requests changes with a reason. v1 is Changes requested,
//      and from now on it reads "v1, round 1" (decision 0033). The database holds the decision, a new
//      draft with the same block ids, and the reason as a document-level thread whose first comment is a
//      change request. The render API refuses v1 as sent back for changes.
//   3. Maya: the template opens on the new draft ("[Draft] Based on v1 · Round 1"). The rail reads
//      "Comments N | Variables" with the change request and Jordan's comment, which is anchored to its
//      block (marker in the gutter, highlight in the text). She fixes the sentence, resolves Jordan's
//      thread and resubmits: a send-back doesn't use up a number, so it is "v1, round 2", In review, and
//      resubmitting answers the change request (it resolves as hers, with an audit row).
//   4. Jordan opens v1 · Round 2 from the queue (its link names the round; round 1 is in Recently
//      decided). Nothing was ever released to compare with (round 1 was sent back), so the screen has no
//      "Show changes". The rail has no open comment: the change request and Maya's resolved thread are
//      both under "Resolved (2)". He approves "v1, round 2": the dialog says v1 becomes Active (and has no
//      sunset row, since there is no previous Active); the go-live moment plays; the header shows Active
//      and the SHARE ring.
//   5. The Activity tab tells the whole story by round (submitted twice, changes requested, commented,
//      resolved, the change request answered, approved on round 2), the audit events and notifications
//      hold the same trail, and the render API agrees: v1 renders as Coral, and never names a round.
//
// Self-contained: it creates one template, and afterAll removes everything it wrote for it (the template,
// its versions, approvals, threads, comments, audit events, notifications, notices and render_log rows), so
// the queue counts the other specs see stay as they were. Console and page errors fail it.
//
// Run it against a HEALTHY server: playwright.config.ts reuses the server on E2E_PORT only while "/" answers
// without an error; when it doesn't (a compile error from someone's edit), Playwright starts its own, and its
// command runs `npm run db:reset` first, which re-seeds the shared database.

const TEAM = "coral-offers";
const NOTE_V1 = "First version of the spring travel terms.";
const NOTE_V2 = "Spelled out the purchase APR.";
const OFFER_SENTENCE = "Earn triple points on travel.";
const OFFER_TEXT = ` ${OFFER_SENTENCE}`;
/** The paragraph Jordan comments on (the starter's "interest" block, under "Rates and fees"), and the words he selects. */
const INTEREST_STARTS = "Interest on purchases starts on the transaction date";
const QUOTE = "starts on the transaction date";
const COMMENT = "Please state the APR more plainly.";
const REASON = "The interest wording is too vague. State the purchase APR plainly.";
/** Maya's fix, typed at the end of that paragraph. */
const FIX = " Your purchase APR is 21.99%.";
const OWN_VERSION = "You submitted this version.";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── The database ─────────────────────────────────────────────────────────────

type Row = Record<string, InValue>;

/** The file has no busy timeout, and the app writes to it: a read or write waits its turn. */
async function busy<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const text = String((error as { code?: unknown; message?: unknown })?.code ?? "") + String((error as Error)?.message ?? "");
      if (attempt >= 8 || !/SQLITE_BUSY|database is locked/i.test(text)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    }
  }
}

async function rows(db: Client, sql: string, args: InValue[] = []): Promise<Row[]> {
  const result = await busy(() => db.execute({ sql, args }));
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column) => [column, row[column] as InValue])));
}

/** A row the app writes a moment after the screen shows it (comments are shown at once, then saved): waits for it. */
async function rowWhen(db: Client, sql: string, args: InValue[], message: string): Promise<Row> {
  let found: Row | undefined;
  await expect
    .poll(
      async () => {
        found = (await rows(db, sql, args))[0];
        return found !== undefined;
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

const json = (value: InValue) => (value === null || value === undefined ? null : JSON.parse(String(value)));

/** The ids of a document's top-level blocks, in order. */
function blockIds(body: { content?: { attrs?: { id?: unknown } }[] }): string[] {
  return (body.content ?? []).map((block) => String(block.attrs?.id ?? ""));
}

let db: Client;
/** Set once the template exists, so afterAll removes it even when the test fails half way. */
let templateId: string | null = null;

test.beforeAll(() => {
  db = openDb();
});

/** Removes everything this run wrote: the rows this template owns, children first. */
test.afterAll(async () => {
  if (!db) return;
  try {
    if (templateId) {
      const id = templateId;
      const own = "(SELECT id FROM versions WHERE template_id = ?)";
      const threads = "(SELECT id FROM comment_threads WHERE template_id = ?)";
      const statements: [string, InValue[]][] = [
        [`DELETE FROM comments WHERE thread_id IN ${threads}`, [id]],
        ["DELETE FROM comment_threads WHERE template_id = ?", [id]],
        [`DELETE FROM approvals WHERE version_id IN ${own}`, [id]],
        ["DELETE FROM audit_events WHERE template_id = ?", [id]],
        ["DELETE FROM notifications WHERE href LIKE ?", [`%/${id}%`]],
        ["DELETE FROM consumer_notices WHERE template_id = ?", [id]],
        ["DELETE FROM render_log WHERE template_id = ?", [id]],
        ["DELETE FROM uploads WHERE template_id = ?", [id]],
        ["DELETE FROM versions WHERE template_id = ?", [id]],
        ["DELETE FROM templates WHERE id = ?", [id]],
      ];
      for (const [sql, args] of statements) await busy(() => db.execute({ sql, args }));
    }
  } finally {
    db.close();
  }
});

// ── The screens ──────────────────────────────────────────────────────────────

const profileButton = (page: Page) => page.getByRole("button", { name: /profile and persona/ });
const templateTab = (page: Page, name: string) => page.getByRole("navigation", { name: "Template" }).getByRole("link", { name });
/** The sidebar's Review item (the review screen has a back link of the same name). */
const reviewNav = (page: Page) => page.locator('[data-slot="sidebar-menu-button"][href$="/review"]').filter({ visible: true });
const libraryNav = (page: Page) => page.locator('[data-slot="sidebar-menu-button"][href$="/library"]').filter({ visible: true });
/** The count on the Review item (hidden at zero). */
const reviewBadge = (page: Page) => reviewNav(page).locator('[aria-label$=" waiting"]');
const queueTab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${escapeRe(name)}`) });

/** A counted-free, human-paced click, once the page has stopped moving under the target. */
async function press(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await untilUncovered(target);
  await tap(target);
}

/** Through the persona switcher, as a presenter would: the URL stays, the page re-reads as the new person. */
async function switchPersona(page: Page, person: string) {
  const url = page.url();
  await press(profileButton(page));
  await press(page.getByRole("menuitemradio", { name: new RegExp(escapeRe(person)) }));
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(profileButton(page)).toHaveAccessibleName(new RegExp(`^${escapeRe(person)},`));
  await expect(page).toHaveURL(url);
}

// The review screen.
const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) => decision(page).getByRole("button", { name: "Approve", exact: true });
const requestButton = (page: Page) => decision(page).getByRole("button", { name: "Request changes", exact: true });
/** The version's status badge in a header (the review screen's or the workspace's). */
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const reviewThread = (page: Page, text: string | RegExp) => decision(page).locator("article[data-thread]").filter({ hasText: text });
const gutterMarkers = (page: Page) => page.locator('[data-slot="gutter-markers"] [data-marker]').filter({ visible: true });
/** The highlighted text of open threads, in the document that is showing. */
const highlights = (page: Page) => page.locator(".ProseMirror mark.ucomp-thread").filter({ visible: true });

/** The row of a round in the review queue (any tab): its link names the round once the label does (`?round=`). */
const queueRow = (page: Page, id: string, number: number, round?: number) =>
  page.locator(`a[href="/${TEAM}/review/${id}/${number}${round ? `?round=${round}` : ""}"]`).filter({ visible: true });

/** The Review queue, as the person who is looking: its tab chosen, its row to hand. */
async function openQueue(page: Page, tab?: string) {
  await press(reviewNav(page));
  await expect(page).toHaveURL(new RegExp(`/${TEAM}/review$`));
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  if (tab) {
    await press(queueTab(page, tab));
    await expect(queueTab(page, tab)).toHaveAttribute("aria-selected", "true");
  }
}

/** How many in-review versions of the team wait on this person: all of them, except the ones they submitted (one stage, so one approver's say). */
async function waitingOn(person: string): Promise<number> {
  const [row] = await rows(
    db,
    `SELECT COUNT(*) AS n FROM versions v JOIN templates t ON t.id = v.template_id
     WHERE t.team_id = ? AND v.state = 'in_review' AND (v.submitted_by IS NULL OR v.submitted_by <> ?)`,
    [TEAM, person],
  );
  return Number(row.n);
}

/** The Review item's badge says what the database says waits on this person (no badge at zero). Polled: the badge follows a decision a moment after it. */
async function expectBadgeCounts(page: Page, person: string) {
  await expect
    .poll(
      async () => {
        const shown = (await reviewBadge(page).count()) === 0 ? 0 : Number((await reviewBadge(page).first().textContent()) ?? "0");
        return `${shown} shown, ${await waitingOn(person)} waiting`;
      },
      { message: `the Review badge counts what waits on ${person}` },
    )
    .toMatch(/^(\d+) shown, \1 waiting$/);
}

/** The review screen's grid, drawn: the header's name and the decision rail are there. */
async function expectReviewScreen(page: Page, id: string, number: number, round?: number) {
  await expect(page).toHaveURL(new RegExp(`/${TEAM}/review/${id}/${number}${round ? `\\?round=${round}` : ""}$`));
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(decision(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Document" })).toHaveAttribute("aria-selected", "true");
  await liveEditor(page);
  await hydrated(page);
}

/** The block of the document that holds this text (the live editor, read-only or not). */
const block = (page: Page, text: string) => documentEditor(page).locator("p", { hasText: text });

/** Waits until the target has stopped moving: the page's scroll and layout have settled (three looks, 60ms apart). */
async function untilStill(target: Locator) {
  let last = "";
  let same = 0;
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox();
        const now = box ? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}` : "";
        same = now !== "" && now === last ? same + 1 : 0;
        last = now;
        return same >= 3;
      },
      { message: "the target has stopped moving", intervals: [60] },
    )
    .toBe(true);
}

/**
 * Selects `phrase` inside a block with the real mouse: press at its first character, drag to its last,
 * release. In the demo project the mouse glides there first.
 */
async function selectPhrase(page: Page, target: Locator, phrase: string) {
  await target.scrollIntoViewIfNeeded();
  const text = await target.evaluate((el) => el.textContent ?? "");
  const start = text.indexOf(phrase);
  expect(start, `"${phrase}" is in the block`).toBeGreaterThanOrEqual(0);
  await untilStill(target);
  const from = await pointInText(target, start);
  const to = await pointInText(target, start + phrase.length);
  const box = (await target.boundingBox())!;
  // Aim only at text that nothing covers (a page change, a bubble).
  await untilUncovered(target, { x: from.x - box.x + 1, y: from.y - box.y });
  await moveTo(page, target, { x: from.x - box.x, y: from.y - box.y });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(isDemo() ? 140 : 60);
  await page.mouse.move(to.x, to.y, { steps: isDemo() ? 24 : 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected, "the drag selected the phrase").toBe(phrase);
}

// ── The spec ─────────────────────────────────────────────────────────────────

// Nothing here opens a preview frame, but the trace would still be heavy for a run this long.
test.use({ trace: "off", screenshot: "only-on-failure" });

test.describe("scenario 3: the review loop", () => {
  test("Maya submits, Jordan comments and sends it back, Maya resubmits as v1, round 2, Jordan approves: v1 is Active", async ({ page, request }) => {
    test.setTimeout(demoTimeout(240_000));

    let v1: Row;
    let draftId = "";
    let interestBlock = "";
    let threadId = "";
    let requestThreadId = "";

    // ── 0. Maya's template, submitted as v1 ─────────────────────────────────

    await asPersona(page, "maya");
    await openLibrary(page, TEAM);
    await beat(page, 800);

    await test.step("0. Maya writes Spring Travel Rewards and submits v1 with a note", async () => {
      await tap(page.getByRole("button", { name: "New template" }));
      const gallery = page.getByRole("dialog");
      await expect(gallery).toBeVisible();
      await tap(gallery.getByRole("button", { name: /Card offer terms/ }));
      await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
      templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];

      // The name is selected: typing replaces it; Enter goes to the document, where the caret is in the first section.
      await expect(nameField(page)).toBeFocused();
      await expect(nameField(page)).toHaveValue("Card offer terms");
      await page.waitForTimeout(300);
      await page.keyboard.press("ControlOrMeta+a");
      await typeSlowly(page, NAME);
      await expect(nameField(page)).toHaveValue(NAME);
      await page.keyboard.press("Enter");
      await liveEditor(page);
      await expect.poll(async () => (await caret(page)).focused, { message: "the document has focus" }).toBe(true);
      expect((await caret(page)).section).toBe("Offer details");
      await typeSlowly(page, OFFER_TEXT);
      await expect(documentEditor(page)).toContainText(OFFER_SENTENCE);
      await expectAutosaved(page);
      await beat(page);

      const submit = page.getByRole("button", { name: "Submit for review" });
      await expect(submit).toBeEnabled();
      await tap(submit);
      const dialog = page.getByRole("dialog", { name: "Submit v1 for review" });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      const note = dialog.getByRole("textbox", { name: "Note to reviewers" });
      await expect(note).toBeFocused();
      await typeSlowly(page, NOTE_V1);
      await expect(note).toHaveValue(NOTE_V1);
      await tap(dialog.getByRole("button", { name: "Submit v1", exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });

      [v1] = await rows(db, "SELECT * FROM versions WHERE template_id = ? AND number = 1", [templateId]);
      expect(v1).toMatchObject({ state: "in_review", submitted_by: "maya", submit_note: NOTE_V1 });
      interestBlock = (await block(page, INTEREST_STARTS).getAttribute("data-id")) ?? "";
      expect(interestBlock, "the paragraph has a block id").not.toBe("");
      expect(blockIds(json(v1.body))).toContain(interestBlock);
    });
    const id = templateId!;

    // ── 1. Maya sees Approve disabled ───────────────────────────────────────

    await test.step("1. Maya opens v1 in the review screen: Approve and Request changes are disabled, with why", async () => {
      await beat(page);
      await openQueue(page, "Submitted by me");
      await expect(queueRow(page, id, 1), "v1 is in Submitted by me").toBeVisible();
      await expect(queueRow(page, id, 1)).toContainText(NAME);
      await beat(page, 600);
      await press(queueRow(page, id, 1));
      await expectReviewScreen(page, id, 1);

      await expect(statusBadge(page)).toHaveText("In review");
      await expect(page.getByRole("heading", { level: 1, name: NAME }).locator("xpath=..")).toContainText("Review");
      await expect(approveButton(page)).toBeVisible();
      await expect(approveButton(page), "she can't approve her own version").toBeDisabled();
      await expect(requestButton(page)).toBeDisabled();
      await expect(decision(page).getByText(OWN_VERSION)).toBeVisible();
      await expect(approveButton(page)).toHaveAccessibleDescription(OWN_VERSION);
      // The stepper is on "Team approver", waiting.
      await expect(decision(page).locator('[data-step="current"]')).toContainText("Team approver");
      // Her note is on the screen.
      await expect(decision(page)).toContainText(NOTE_V1);
      await beat(page, 900);
      await shoot(page, "maya-disabled");
    });

    // ── 2. Jordan comments and requests changes ─────────────────────────────

    await test.step("2.1 Jordan: the Review badge counts v1, and Waiting on me lists it", async () => {
      await switchPersona(page, "Jordan Ellis");
      await beat(page);
      await openQueue(page);
      // Waiting on me opens first for him (Maya had left the queue on Submitted by me).
      await expect(queueTab(page, "Waiting on me")).toHaveAttribute("aria-selected", "true");
      const row = queueRow(page, id, 1);
      await expect(row, "v1 waits on Jordan").toBeVisible();
      await expect(row).toContainText(NAME);
      await expect(row).toContainText("v1");
      await expect(row).toContainText("Maya Chen");
      await expect(row).toContainText("Team approver");

      // The badge is the number of rows waiting on him, and the tab says the same.
      expect(await waitingOn("jordan")).toBeGreaterThanOrEqual(1);
      await expectBadgeCounts(page, "jordan");
      await expect(reviewBadge(page)).toHaveAttribute("aria-label", /^\d+ waiting$/);
      const count = (await reviewBadge(page).textContent())!.trim();
      await expect(queueTab(page, "Waiting on me"), "the tab counts the same rows").toHaveText(new RegExp(`^Waiting on me\\s*${count}`));
      await beat(page, 900);
      await shoot(page, "queue-jordan");
    });

    await test.step("2.2 He opens it: the Document view, the stepper on Team approver, Approve and Request changes his to press", async () => {
      await press(queueRow(page, id, 1));
      await expectReviewScreen(page, id, 1);
      await expect(statusBadge(page)).toHaveText("In review");
      const step = decision(page).locator('[data-step="current"]');
      await expect(step).toContainText("Team approver");
      await expect(step).toContainText("Waiting for a decision");
      await expect(approveButton(page)).toBeEnabled();
      await expect(requestButton(page)).toBeEnabled();
      await expect(decision(page).getByText(OWN_VERSION)).toHaveCount(0);
      await expect(documentEditor(page)).toContainText(OFFER_SENTENCE);
      await expect(documentEditor(page), "the document is read-only").toHaveAttribute("contenteditable", "false");
      await expect(gutterMarkers(page)).toHaveCount(0);
      await beat(page, 900);
      await shoot(page, "review-document");
    });

    await test.step("2.3 He selects text in a block and comments: the thread is in the rail, the marker is in the gutter", async () => {
      const paragraph = block(page, INTEREST_STARTS);
      await expect(paragraph).toBeVisible();
      await selectPhrase(page, paragraph, QUOTE);

      const comment = page.getByRole("button", { name: "Comment", exact: true }).filter({ visible: true });
      await expect(comment, "selected text offers Comment").toBeVisible();
      await tap(comment);

      const composer = decision(page).locator("article[data-compose]");
      await expect(composer).toBeVisible();
      await expect(composer).toContainText(QUOTE);
      const field = composer.getByRole("textbox", { name: "Add a comment" });
      await expect(field).toBeFocused();
      await expect(composer.getByRole("button", { name: "Comment", exact: true }), "no text, no comment").toBeDisabled();
      await typeSlowly(page, COMMENT);
      await expect(field).toHaveValue(COMMENT);
      // The quote stays marked in the text while the box is open.
      await expect(highlights(page).first()).toHaveText(QUOTE);
      await beat(page, 900);
      await shoot(page, "comment-composer");

      await tap(composer.getByRole("button", { name: "Comment", exact: true }));
      await expect(composer).toBeHidden();

      const thread = reviewThread(page, COMMENT);
      await expect(thread).toBeVisible();
      await expect(thread).toHaveAttribute("data-status", "open");
      await expect(thread).toHaveAccessibleName(`Comment on “${QUOTE}”`);
      await expect(thread).toContainText("Jordan Ellis");
      await expect(thread).toContainText(QUOTE);
      await expect(decision(page)).toContainText("1 open");

      // The marker in the gutter, one comment, and the highlight in the text.
      await expect(gutterMarkers(page)).toHaveCount(1);
      await expect(gutterMarkers(page).first()).toHaveAccessibleName("1 comment on this block");
      await expect(gutterMarkers(page).first()).toHaveAttribute("data-marker", interestBlock);
      await expect(highlights(page)).toHaveText([QUOTE]);

      // Stored on the block, with the quote.
      const stored = await rowWhen(db, "SELECT * FROM comment_threads WHERE template_id = ? AND block_id = ?", [id, interestBlock], "Jordan's thread is saved");
      expect(stored).toMatchObject({ block_id: interestBlock, quote: QUOTE, status: "open", origin_version_id: v1.id });
      threadId = String(stored.id);
      await rowWhen(db, "SELECT * FROM comments WHERE thread_id = ?", [threadId], "Jordan's comment is saved");
      const stash = await rows(db, "SELECT * FROM comments WHERE thread_id = ?", [threadId]);
      expect(stash.map((c) => [c.author_id, c.body, c.kind])).toEqual([["jordan", COMMENT, "comment"]]);
      await beat(page, 600);
    });

    await test.step("2.4 He requests changes with a reason: v1 is Changes requested, and reads as round 1", async () => {
      await press(requestButton(page));
      const dialog = page.getByRole("dialog", { name: "Request changes on v1", exact: true });
      await expect(dialog).toBeVisible();
      const reason = dialog.getByRole("textbox", { name: "Reason" });
      await expect(reason, "the reason has the focus").toBeFocused();
      const confirm = dialog.getByRole("button", { name: "Request changes", exact: true });
      await expect(confirm, "no reason, no request").toBeDisabled();
      await typeSlowly(page, REASON);
      await expect(reason).toHaveValue(REASON);
      await expect(confirm).toBeEnabled();
      await beat(page, 900);
      await shoot(page, "request-dialog");

      await tap(confirm);
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      await expect(statusBadge(page)).toHaveText("Changes requested", { timeout: 20_000 });
      // Sent back, the number has rounds: the round is in its name from now on.
      await expect(decision(page).locator("[data-decided]")).toHaveText("You returned v1, round 1 to Maya Chen.");
      await expect(page.getByRole("heading", { level: 1, name: NAME }).locator("xpath=../..")).toContainText("v1 · Round 1 by Maya Chen");
      await expect(approveButton(page), "nothing left to decide").toHaveCount(0);
      await expect(decision(page).locator('[data-step="returned"]')).toContainText("Team approver");
      // The reason is the first comment in the rail: a change request about the whole version.
      await expect(decision(page).locator('article[aria-label="Change request"]')).toContainText(REASON);
      await beat(page, 900);
    });

    await test.step("2.5 The database: the decision, the new draft with the same block ids, the reason as a document thread", async () => {
      const [version] = await rows(db, "SELECT state FROM versions WHERE id = ?", [v1.id]);
      expect(version.state).toBe("changes_requested");

      // The decision.
      const decisions = await rows(db, "SELECT * FROM approvals WHERE version_id = ?", [v1.id]);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ actor_id: "jordan", decision: "changes_requested", reason: REASON, stage_position: 0, stage_name: "Team approver" });

      // The new draft: a copy with the same block ids, based on v1.
      const drafts = await rows(db, "SELECT * FROM versions WHERE template_id = ? AND state = 'draft'", [id]);
      expect(drafts, "one new draft").toHaveLength(1);
      const [draft] = drafts;
      draftId = String(draft.id);
      expect(draft.number, "an open draft has no number").toBeNull();
      expect(draft.round, "nor a round").toBeNull();
      expect(draft.based_on_version_id).toBe(v1.id);
      expect(draft.created_by, "the author's draft").toBe("maya");
      expect(blockIds(json(draft.body))).toEqual(blockIds(json(v1.body)));
      expect(json(draft.body)).toEqual(json(v1.body));

      // The reason: a thread about the whole version, with a change_request comment.
      const documentThreads = await rows(db, "SELECT * FROM comment_threads WHERE template_id = ? AND block_id = 'doc'", [id]);
      expect(documentThreads).toHaveLength(1);
      expect(documentThreads[0]).toMatchObject({ origin_version_id: v1.id, status: "open", quote: null });
      requestThreadId = String(documentThreads[0].id);
      const reasonComments = await rows(db, "SELECT * FROM comments WHERE thread_id = ?", [String(documentThreads[0].id)]);
      expect(reasonComments).toHaveLength(1);
      expect(reasonComments[0]).toMatchObject({ author_id: "jordan", body: REASON, kind: "change_request" });

      // Jordan's comment is still where it was.
      const [kept] = await rows(db, "SELECT * FROM comment_threads WHERE id = ?", [threadId]);
      expect(kept).toMatchObject({ block_id: interestBlock, status: "open" });
    });

    await test.step("2.6 The render API: v1 is refused as sent back for changes, and nothing is active yet", async () => {
      const [v1Version] = (await allVersions(db)).filter((v) => v.templateId === id && v.number === 1);
      expect(v1Version).toMatchObject({ round: 1, state: "changes_requested", head: true, activeNumber: null });
      const sentBack = await render(request, {
        templateId: id,
        consumer: "coral",
        correlationId: correlation("scenario03-v1-sent-back"),
        body: { version: 1, channel: v1Version.channels.includes("web") ? "web" : v1Version.channels[0], values: validValues(v1Version.variables) },
      });
      await expectError(sentBack.res, 409, "version_not_released", "Version 1 was sent back for changes. No version is active yet.");
      const [refusedLog] = await logFor(db, sentBack.correlationId!);
      expect(refusedLog).toMatchObject({ consumer_id: "coral", version_number: 1, is_preview: 0, error_code: "version_not_released" });
    });

    // ── 3. Maya fixes and resubmits ─────────────────────────────────────────

    await test.step("3.1 Maya opens the template: it is on the new draft, Based on v1 · Round 1", async () => {
      await beat(page);
      await switchPersona(page, "Maya Chen");
      await press(libraryNav(page));
      await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
      await press(page.locator(`main a[href="/${TEAM}/templates/${id}"]`).filter({ visible: true }));
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/templates/${id}$`));
      await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
      await liveEditor(page);
      await hydrated(page);

      await expect(statusBadge(page)).toHaveText("Draft");
      await expect(page.locator("header").filter({ visible: true }).getByText("Based on v1 · Round 1", { exact: true })).toBeVisible();
      await expect(documentEditor(page), "the draft is hers to edit").toHaveAttribute("contenteditable", "true");
      await expect(page.getByRole("button", { name: "Submit for review" })).toBeEnabled();
    });

    await test.step("3.2 The rail reads Comments N | Variables: the change request, and Jordan's comment in the margin", async () => {
      const rail = page.locator('aside[aria-label="Comments and variables"]');
      await expect(rail).toBeVisible();
      const tabs = rail.getByRole("tablist", { name: "Rail" });
      await expect(tabs.getByRole("tab")).toHaveCount(2);
      await expect(tabs.getByRole("tab").nth(0), "Comments, with its open count").toHaveAccessibleName("Comments 2");
      await expect(tabs.getByRole("tab").nth(1)).toHaveAccessibleName("Variables");
      await expect(tabs.getByRole("tab", { name: /^Comments/ }), "it opens on the comments").toHaveAttribute("aria-selected", "true");

      // The change request: the reason, on the round it sent back, as the first card.
      const change = rail.locator('article[aria-label="Change request"]');
      await expect(change).toBeVisible();
      await expect(change).toContainText("Changes requested");
      await expect(change).toContainText("on v1 · Round 1");
      await expect(change).toContainText("Jordan Ellis");
      await expect(change).toContainText(REASON);
      // Jordan's comment: on its quote.
      const thread = rail.locator("article[data-thread]").filter({ hasText: COMMENT });
      await expect(thread).toBeVisible();
      await expect(thread).toHaveAccessibleName(`Comment on “${QUOTE}”`);
      await expect(thread).toContainText(QUOTE);
      await expect(thread).toContainText("Jordan Ellis");
      // The change request comes first.
      const cards = await rail.locator("article[data-thread]").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
      expect(cards).toEqual(["Change request", `Comment on “${QUOTE}”`]);

      // In the margin: the marker in the gutter, and the highlight in the text.
      await expect(gutterMarkers(page)).toHaveCount(1);
      await expect(gutterMarkers(page).first()).toHaveAttribute("data-marker", interestBlock);
      await expect(gutterMarkers(page).first()).toHaveAccessibleName("1 comment on this block");
      await expect(highlights(page)).toHaveText([QUOTE]);
      await expect(block(page, INTEREST_STARTS).locator("mark.ucomp-thread")).toHaveText(QUOTE);

      // Choosing the card makes the document follow: the highlight is the active one.
      await tap(thread.getByText(COMMENT));
      await expect(thread).toHaveAttribute("data-active", "");
      const active = page.locator(".ProseMirror mark.ucomp-thread[data-active]").first();
      await expect(active).toHaveText(QUOTE);
      // The document scrolls to the quote (smoothly); the still is taken once it has arrived.
      await expect(active).toBeInViewport();
      await untilStill(active);
      await beat(page, 900);
      await shoot(page, "maya-comments");
    });

    await test.step("3.3 She fixes the sentence, in that block", async () => {
      const paragraph = block(page, INTEREST_STARTS);
      await paragraph.scrollIntoViewIfNeeded();
      const box = (await paragraph.boundingBox())!;
      // The end of the paragraph, as a person finds it: click just past its text, on its last line.
      const end = { x: box.width - 4, y: box.height - 10 };
      await untilUncovered(paragraph, end);
      await tap(paragraph, { position: end });
      await page.keyboard.press("End");
      await expect.poll(async () => (await caret(page)).focused).toBe(true);
      await expect
        .poll(async () => (await caret(page)).block.startsWith(INTEREST_STARTS) && (await caret(page)).block.endsWith("due date."), { message: "the caret is at the end of that paragraph" })
        .toBe(true);
      await typeSlowly(page, FIX);
      await expect(block(page, INTEREST_STARTS)).toContainText(FIX.trim());
      await expectAutosaved(page);
      // Still the same block, and the highlight follows the edit.
      await expect(block(page, INTEREST_STARTS)).toHaveAttribute("data-id", interestBlock);
      await expect(highlights(page)).toHaveText([QUOTE]);
      await beat(page);

      const [saved] = await rows(db, "SELECT body FROM versions WHERE id = ?", [draftId]);
      expect(JSON.stringify(json(saved.body))).toContain(FIX.trim());
      expect(blockIds(json(saved.body)), "the same block ids").toEqual(blockIds(json(v1.body)));
    });

    await test.step("3.4 She resolves Jordan's thread: its marker and highlight go, the count drops", async () => {
      const rail = page.locator('aside[aria-label="Comments and variables"]');
      const thread = rail.locator("article[data-thread]").filter({ hasText: COMMENT });
      await press(thread.getByRole("button", { name: "Resolve" }));

      await expect(thread).toHaveCount(0); // it moves into the collapsed "Resolved" group
      const group = rail.getByRole("region", { name: "Resolved comments" });
      await expect(group.getByRole("button", { name: "Resolved (1)" })).toHaveAttribute("aria-expanded", "false");
      await expect(rail.getByRole("tablist", { name: "Rail" }).getByRole("tab").nth(0)).toHaveAccessibleName("Comments 1");
      await expect(gutterMarkers(page)).toHaveCount(0);
      await expect(highlights(page)).toHaveCount(0);
      await beat(page, 600);

      await press(group.getByRole("button", { name: "Resolved (1)" }));
      const resolved = group.locator("article[data-thread]").filter({ hasText: COMMENT });
      await expect(resolved).toBeVisible();
      await expect(resolved).toHaveAttribute("data-status", "resolved");
      await expect(resolved).toContainText("Resolved by Maya Chen");

      // Shown at once, saved a moment later.
      await expect.poll(async () => (await rows(db, "SELECT status FROM comment_threads WHERE id = ?", [threadId]))[0]?.status, { message: "the resolve is saved" }).toBe("resolved");
      const [row] = await rows(db, "SELECT * FROM comment_threads WHERE id = ?", [threadId]);
      expect(row).toMatchObject({ status: "resolved", resolved_by: "maya" });
      expect(row.resolved_at).not.toBeNull();
      await beat(page, 600);
    });

    await test.step("3.5 She resubmits through the dialog: the same number, its next round, v1 · Round 2 is In review", async () => {
      const submit = page.getByRole("button", { name: "Submit for review" });
      await expect(submit).toBeEnabled();
      await tap(submit);
      const dialog = page.getByRole("dialog", { name: "Submit v1, round 2 for review", exact: true });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      const note = dialog.getByRole("textbox", { name: "Note to reviewers" });
      await expect(note).toBeFocused();
      await typeSlowly(page, NOTE_V2);
      await expect(note).toHaveValue(NOTE_V2);
      await beat(page, 900);
      await shoot(page, "resubmit-dialog");

      await tap(dialog.getByRole("button", { name: "Submit v1, round 2", exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
      await expect(page.locator("header").filter({ visible: true }).getByText("v1 · Round 2", { exact: true })).toBeVisible();
      await expect(submit, "the Submit button is gone").toHaveCount(0);
      await expect(documentEditor(page)).toHaveAttribute("contenteditable", "false");
      await expect(documentEditor(page)).toContainText(FIX.trim());

      const versionRows = await rows(db, "SELECT number, round, state, submitted_by, submit_note FROM versions WHERE template_id = ? ORDER BY number, round", [id]);
      expect(versionRows).toEqual([
        { number: 1, round: 1, state: "changes_requested", submitted_by: "maya", submit_note: NOTE_V1 },
        { number: 1, round: 2, state: "in_review", submitted_by: "maya", submit_note: NOTE_V2 },
      ]);

      // Resubmitting answers the change request: it resolves as Maya's, still about round 1. Jordan's comment stays as she left it.
      const [answered] = await rows(db, "SELECT * FROM comment_threads WHERE id = ?", [requestThreadId]);
      expect(answered).toMatchObject({ block_id: "doc", status: "resolved", resolved_by: "maya", origin_version_id: v1.id });
      expect(answered.resolved_at, "it has the moment it was answered").not.toBeNull();
      const [comment] = await rows(db, "SELECT * FROM comment_threads WHERE id = ?", [threadId]);
      expect(comment).toMatchObject({ block_id: interestBlock, status: "resolved", resolved_by: "maya" });
      expect(await rows(db, "SELECT id FROM comment_threads WHERE template_id = ? AND status = 'open'", [id]), "nothing is left open").toEqual([]);
      await beat(page, 900);
    });

    // ── 4. Jordan approves v1, round 2 ──────────────────────────────────────

    await test.step("4.1 Jordan opens v1 · Round 2 from the queue: nothing Active to compare with, so no Show changes", async () => {
      await beat(page);
      await switchPersona(page, "Jordan Ellis");
      await openQueue(page, "Waiting on me");
      await expectBadgeCounts(page, "jordan");
      await expect(queueRow(page, id, 1, 1), "round 1 was sent back: it no longer waits on him").toHaveCount(0);
      await expect(queueRow(page, id, 1), "every link to v1 names its round now").toHaveCount(0);
      await press(queueTab(page, "Recently decided"));
      const decided = queueRow(page, id, 1, 1);
      await expect(decided, "round 1 is in Recently decided").toBeVisible();
      await expect(decided).toContainText("v1 · Round 1");
      await expect(decided).toContainText("Changes requested");
      await expect(decided).toContainText("Jordan Ellis");
      await press(queueTab(page, "Waiting on me"));
      const row = queueRow(page, id, 1, 2);
      await expect(row, "round 2 waits on Jordan, its link naming the round").toBeVisible();
      await expect(row).toContainText("v1 · Round 2");
      await expect(row).toContainText("Maya Chen");
      await beat(page, 600);
      await press(row);
      await expectReviewScreen(page, id, 1, 2);

      await expect(statusBadge(page)).toHaveText("In review");
      await expect(page.getByRole("heading", { level: 1, name: NAME }).locator("xpath=../..")).toContainText("v1 · Round 2 by Maya Chen");
      await expect(decision(page).locator('[data-step="current"]')).toContainText("Team approver");
      await expect(approveButton(page)).toBeEnabled();
      await expect(requestButton(page)).toBeEnabled();
      await expect(decision(page)).toContainText(NOTE_V2);
      await expect(documentEditor(page)).toContainText(FIX.trim());

      // Nothing is Active and nothing was released before (round 2's draft came from round 1, sent back): nothing to
      // compare with, as for a first version, so no switches at all.
      await expect(page.locator("[data-change-toggles]")).toHaveCount(0);
      await expect(page.getByRole("switch", { name: /Show changes/ })).toHaveCount(0);
      await expect(page.getByRole("switch", { name: /Changes only/ })).toHaveCount(0);
      // The rest of the bar is there: the two views.
      await expect(page.getByRole("tab", { name: "Document" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: "Preview" })).toBeVisible();
      // The review's comments are in the rail. Resubmitting answered the change request, so nothing is open:
      // the change request and Jordan's thread (resolved by Maya) are both in the collapsed "Resolved (2)".
      await expect(decision(page).locator("article[data-thread][data-status='open']"), "no open card").toHaveCount(0);
      await expect(decision(page).getByText("No open comments.")).toBeVisible();
      await expect(decision(page), "no open count beside the label").not.toContainText(/\d+ open/);
      const resolvedToggle = decision(page).getByRole("button", { name: "Resolved (2)" });
      await expect(resolvedToggle).toHaveAttribute("aria-expanded", "false");
      await expect(decision(page).locator("article[data-thread]"), "collapsed: no cards").toHaveCount(0);
      await expect(gutterMarkers(page), "the resolved thread has no marker").toHaveCount(0);
      await expect(highlights(page)).toHaveCount(0);
      await press(resolvedToggle);
      await expect(resolvedToggle).toHaveAttribute("aria-expanded", "true");
      const resolvedGroup = decision(page).getByRole("region", { name: "Resolved comments" });
      await expect(resolvedGroup.locator("article[data-thread][data-status='resolved']")).toHaveCount(2);
      const answered = resolvedGroup.locator('article[aria-label="Change request"]');
      await expect(answered, "the change request is kept, answered").toHaveAttribute("data-status", "resolved");
      await expect(answered).toContainText(REASON);
      await expect(answered).toContainText("on v1 · Round 1");
      await expect(answered).toContainText("Resolved by Maya Chen");
      const kept = resolvedGroup.locator("article[data-thread]").filter({ hasText: COMMENT });
      await expect(kept).toHaveAttribute("data-status", "resolved");
      await expect(kept).toContainText("Resolved by Maya Chen");
      // Still the template's first version: round 1 was never released, so there is nothing before it to differ from.
      await expect(decision(page).getByRole("region", { name: "Contract changes" })).toContainText("First version.");
      await beat(page, 900);
    });

    await test.step("4.2 Approve: the dialog says what happens, with no sunset row; the go-live moment plays", async () => {
      await press(approveButton(page));
      // The dialog names the round it decides; what goes live is the version consumers see, v1.
      const dialog = page.getByRole("dialog", { name: "Approve v1, round 2", exact: true });
      await expect(dialog).toBeVisible();
      // The consequence is the dialog's description; a first Active version adds what that means for consumers.
      await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText("v1 becomes Active.");
      await expect(dialog.locator('[data-slot="consequences"]')).toHaveText("Consumers can start using it right away.");
      // Nothing is Active yet, so there is no previous version to sunset.
      await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      await expect(dialog.getByText(/sunset/i)).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Cancel" }), "the safe action has the focus").toBeFocused();
      await beat(page, 900);
      await shoot(page, "approve-dialog");

      await tap(dialog.getByRole("button", { name: "Approve v1, round 2", exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      // The moment: the canvas washes over, the ring stamps in with "v1 is Active", then flies to its slot.
      const moment = page.locator("[data-go-live]");
      await expect(moment, "the go-live moment plays").toBeVisible({ timeout: 10_000 });
      await expect(moment.getByRole("status")).toHaveText("v1 is Active");
      // Its end state: the moment is gone, the header says Active and holds the SHARE ring.
      await expect(moment).toHaveCount(0, { timeout: 15_000 });
      await expect(statusBadge(page)).toHaveText("Active");
      const ring = page.locator('[data-slot="share"]').filter({ visible: true }).getByRole("button", { name: `Share ${NAME} — integration details` });
      await expect(ring).toBeVisible();
      await expect(decision(page).locator("[data-decided]")).toHaveText("You approved v1.");
      await expect(page.getByRole("heading", { level: 1, name: NAME }).locator("xpath=../..")).toContainText("Approved on round 2");
      await expect(approveButton(page)).toHaveCount(0);
      await expect(decision(page).locator('[data-step="done"]')).toContainText("Team approver");
      await expect(decision(page).locator('[data-step="done"]')).toContainText("Jordan Ellis");
      await beat(page, 1200);
      await shoot(page, "go-live-end");
    });

    await test.step("4.3 The database: round 2 is Active, round 1 is as it was, and the approval records who and what", async () => {
      const list = await rows(db, "SELECT number, round, state, activated_at FROM versions WHERE template_id = ? ORDER BY number, round", [id]);
      expect(list.map((v) => [v.number, v.round, v.state])).toEqual([
        [1, 1, "changes_requested"],
        [1, 2, "active"],
      ]);
      expect(list[1].activated_at, "round 2 has its activation time").not.toBeNull();
      expect(list[0].activated_at).toBeNull();

      const [round2] = await rows(db, "SELECT id, current_stage FROM versions WHERE template_id = ? AND number = 1 AND round = 2", [id]);
      const approvals = await rows(db, "SELECT * FROM approvals WHERE version_id = ?", [round2.id]);
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({ actor_id: "jordan", decision: "approved", stage_position: 0, stage_name: "Team approver" });
      // Every approval of the template: Jordan's request on round 1, his approval of round 2. Nothing else.
      const all = await rows(
        db,
        "SELECT a.decision, v.number, v.round FROM approvals a JOIN versions v ON v.id = a.version_id WHERE v.template_id = ? ORDER BY a.decided_at, a.id",
        [id],
      );
      expect(all.map((r) => [r.number, r.round, r.decision])).toEqual([
        [1, 1, "changes_requested"],
        [1, 2, "approved"],
      ]);
    });

    await test.step("4.4 The queue after the approval: round 2 left Waiting on me and is in Recently decided as Approved", async () => {
      await beat(page);
      await openQueue(page, "Waiting on me");
      await expectBadgeCounts(page, "jordan");
      await expect(queueRow(page, id, 1, 1)).toHaveCount(0);
      await expect(queueRow(page, id, 1, 2), "round 2 no longer waits on anyone").toHaveCount(0);
      await expect(queueRow(page, id, 1)).toHaveCount(0);
      await press(queueTab(page, "Recently decided"));
      // Released, v1 is the bare link again (it is the number's head); the row still names the round it was approved on.
      const approved = queueRow(page, id, 1);
      await expect(approved).toBeVisible();
      await expect(approved).toContainText("v1 · Round 2");
      await expect(approved).toContainText("Approved");
      await expect(approved).toContainText("Jordan Ellis");
      await expect(queueRow(page, id, 1, 1), "and the change request on round 1, as before").toContainText("Changes requested");
      await beat(page, 600);
    });

    // ── 5. Activity and the render API ──────────────────────────────────────

    await test.step("5.1 The Activity tab, by round: submitted twice, changes requested, commented, resolved, approved on round 2", async () => {
      await beat(page);
      await press(libraryNav(page));
      await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
      await press(page.locator(`main a[href="/${TEAM}/templates/${id}"]`).filter({ visible: true }));
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/templates/${id}$`));
      await expect(statusBadge(page)).toHaveText("Active");
      await expect(page.locator('[data-slot="share"]').filter({ visible: true }).getByRole("button", { name: /^Share / }), "the SHARE ring is on the Active template").toBeVisible();
      await hydrated(page);
      await press(templateTab(page, "Activity"));
      await expect(page).toHaveURL(new RegExp(`/templates/${id}/activity$`));

      const activity = page.locator('[data-slot="activity"]').filter({ visible: true });
      const line = (text: string | RegExp) => activity.locator("li").filter({ hasText: text });
      // Review events name the round, as the review history does: round 1 was sent back, round 2 went live.
      const submittedV1 = line(`Maya Chen submitted v1, round 1 for review: ${NOTE_V1}`);
      const commented = line("Jordan Ellis commented on v1, round 1.");
      const requested = line(`Jordan Ellis requested changes on v1, round 1: ${REASON}`);
      const resolved = line("Maya Chen resolved a comment on v1, round 1.");
      const answered = line("Maya Chen answered the change request on v1, round 1 by resubmitting.");
      const submittedV2 = line(`Maya Chen submitted v1, round 2 for review: ${NOTE_V2}`);
      const activated = line("Jordan Ellis approved v1 on round 2, making it Active.");
      for (const entry of [submittedV1, commented, requested, resolved, answered, submittedV2, activated]) await expect(entry).toHaveCount(1);
      await expect(line(/ submitted v1, round \d for review/), "submitted twice").toHaveCount(2);
      await expect(line(/requested changes/), "changes requested once").toHaveCount(1);
      await expect(line(/commented on/), "one comment added").toHaveCount(1);
      await expect(line(/resolved a comment/), "one thread resolved by hand").toHaveCount(1);
      await expect(line(/answered the change request/), "the change request answered once, by resubmitting").toHaveCount(1);
      await expect(line(/making it Active/), "activated once").toHaveCount(1);
      // The version chips: round 1 for what happened to round 1, round 2 for the last two.
      await expect(requested.locator("span", { hasText: /^v1 · Round 1$/ })).toBeVisible();
      await expect(answered.locator("span", { hasText: /^v1 · Round 1$/ }), "it is about round 1, the round that was sent back").toBeVisible();
      await expect(submittedV2.locator("span", { hasText: /^v1 · Round 2$/ })).toBeVisible();
      await expect(activated.locator("span", { hasText: /^v1 · Round 2$/ })).toBeVisible();
      await expect(activated.locator("time")).toBeVisible();

      // Newest first, in the order it happened. Submitting round 2 and answering the change request are one moment
      // (one transaction, one timestamp), so those two lines may stand either way round.
      const lines = await activity.locator("li").allInnerTexts();
      const at = (needle: string | RegExp) => lines.findIndex((text) => (typeof needle === "string" ? text.includes(needle) : needle.test(text)));
      const [approved, submitted2, answeredAt, resolvedAt, requestedAt, commentedAt, submitted1] = [
        at("approved v1 on round 2, making it Active"),
        at("submitted v1, round 2 for review"),
        at("answered the change request on v1, round 1"),
        at(/resolved a comment/),
        at("requested changes on v1, round 1"),
        at("commented on v1, round 1"),
        at("submitted v1, round 1 for review"),
      ];
      const order = [approved, submitted2, answeredAt, resolvedAt, requestedAt, commentedAt, submitted1];
      expect(order.every((index) => index >= 0), `every line is there: ${JSON.stringify(order)}`).toBe(true);
      expect(approved, "newest first").toBeLessThan(Math.min(submitted2, answeredAt));
      expect(Math.max(submitted2, answeredAt), "newest first").toBeLessThan(resolvedAt);
      expect([resolvedAt, requestedAt, commentedAt, submitted1], "newest first").toEqual([resolvedAt, requestedAt, commentedAt, submitted1].sort((a, b) => a - b));
      await beat(page, 900);
      await shoot(page, "activity");
    });

    await test.step("5.2 The trail in the database: the audit events and who was notified", async () => {
      // audit_events: the lifecycle, in order, by who did it (autosaves and the template's creation aside). Rows written
      // in one transaction share a timestamp: the change request answered follows round 2's submit by insertion order.
      const audit = (await rows(db, "SELECT * FROM audit_events WHERE template_id = ? ORDER BY at, rowid", [id])).filter((r) => /^(version|comment|thread)\./.test(String(r.action)));
      expect(audit.map((r) => [r.action, r.actor_id])).toEqual([
        ["version.submitted", "maya"],
        ["comment.added", "jordan"],
        ["version.changes_requested", "jordan"],
        ["thread.resolved", "maya"],
        ["version.submitted", "maya"],
        ["thread.resolved", "maya"],
        ["version.activated", "jordan"],
      ]);
      for (const event of audit) expect(event).toMatchObject({ team_id: TEAM, template_id: id });
      expect(json(audit[0].details)).toMatchObject({ number: 1, round: 1, note: NOTE_V1 });
      expect(json(audit[1].details)).toMatchObject({ number: 1, round: 1, blockId: interestBlock, quote: QUOTE });
      expect(json(audit[2].details)).toMatchObject({ number: 1, round: 1, stage: "Team approver", reason: REASON });
      expect(json(audit[3].details)).toMatchObject({ threadId, blockId: interestBlock });
      expect(json(audit[4].details)).toMatchObject({ number: 1, round: 2, note: NOTE_V2 });
      // The change request, answered by the resubmit: about round 1 (the thread's origin), saying round 2 of v1 answered it, and automatic.
      expect(json(audit[5].details)).toEqual({ threadId: requestThreadId, blockId: "doc", auto: true, resolvedWith: 1, resolvedWithRound: 2 });
      expect(audit[5].at, "answered at the moment round 2 was submitted").toBe(audit[4].at);
      expect(json(audit[6].details)).toMatchObject({ number: 1, round: 2, supersedes: null, stage: "Team approver" });
      expect(audit[4].version_id, "round 2 is its own row").not.toBe(v1.id);
      expect(audit.map((r) => r.version_id)).toEqual([v1.id, v1.id, v1.id, v1.id, audit[4].version_id, v1.id, audit[4].version_id]);

      // notifications: each submit asks the team's approvers except the submitter; the author hears about the
      // comment, the change request and the go-live.
      const approvers = (
        await rows(
          db,
          `SELECT DISTINCT m.user_id AS id FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
           WHERE m.team_id = ? AND m.status = 'active' AND r.role = 'approver'`,
          [TEAM],
        )
      )
        .map((r) => String(r.id))
        .filter((user) => user !== "maya")
        .sort();
      expect(approvers, "Jordan and others can approve").toContain("jordan");
      const notes = await rows(db, "SELECT * FROM notifications WHERE href LIKE ? ORDER BY created_at, id", [`%/${id}%`]);
      const to = (kind: string) => notes.filter((r) => r.kind === kind).map((r) => String(r.user_id)).sort();
      expect(to("review_requested"), "rounds 1 and 2, each to the approvers but not to Maya").toEqual([...approvers, ...approvers].sort());
      expect(to("comment_added")).toEqual(["maya"]);
      expect(to("changes_requested")).toEqual(["maya"]);
      expect(to("version_live")).toEqual(["maya"]);
      expect(notes.length, "nothing else was sent").toBe(approvers.length * 2 + 3);
      for (const note of notes) expect(note).toMatchObject({ team_id: TEAM, read_at: null });
      // Round 1's ask names no round (nothing had been sent back yet), and its link is the bare one; round 2's names it.
      const asked = notes.filter((r) => r.kind === "review_requested" && r.user_id === "jordan");
      expect(asked.map((r) => [r.title, r.href])).toEqual([
        [`Maya Chen submitted ${NAME} v1 for review.`, `/${TEAM}/review/${id}/1`],
        [`Maya Chen submitted ${NAME} v1, round 2 for review.`, `/${TEAM}/review/${id}/1?round=2`],
      ]);
      const [sentBack] = notes.filter((r) => r.kind === "changes_requested");
      expect(sentBack).toMatchObject({ title: `Jordan Ellis requested changes on ${NAME} v1, round 1.`, body: REASON, href: `/${TEAM}/templates/${id}` });
      const [live] = notes.filter((r) => r.kind === "version_live");
      expect(live).toMatchObject({ title: `${NAME} v1 is now Active.`, href: `/${TEAM}/templates/${id}` });
    });

    await test.step("5.3 The render API: v1 renders as Coral, its released round, and no round is named", async () => {
      const all = await allVersions(db);
      const v1Rows = all.filter((v) => v.templateId === id && v.number === 1);
      expect(v1Rows.map((v) => [v.round, v.state, v.head])).toEqual([
        [1, "changes_requested", false],
        [2, "active", true],
      ]);
      const released: SeedVersion = v1Rows[1];
      expect(released.activeNumber).toBe(1);

      const active = await render(request, {
        templateId: id,
        consumer: "coral",
        correlationId: correlation("scenario03-v1"),
        body: { version: 1, channel: released.channels.includes("web") ? "web" : released.channels[0], values: validValues(released.variables) },
      });
      expect(active.res.status(), "v1 is the Active version: the round sent back is only a record").toBe(200);
      expect(active.res.headers()["x-stencil-version"]).toBe("1");
      expect(active.res.headers()["x-stencil-newer-version"], "v1 is the newest").toBeUndefined();
      const [okLog] = await logFor(db, active.correlationId!);
      expect(okLog).toMatchObject({ consumer_id: "coral", version_id: released.id, version_number: 1, is_preview: 0, outcome: "ok", error_code: null });
    });
  });
});
