import type { Client } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { removeTemplate, rowsOf } from "./helpers/cleanup";
import {
  asPersona,
  caret,
  documentEditor,
  expect,
  expectAutosaved,
  hydrated,
  liveEditor,
  nameField,
  openLibrary,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// Maker-checker reaches everyone who wrote a version, not only whoever pressed Submit
// (docs/handoff-review.md, S3). Holding Author and Approver on one team is normal: approving an access
// request can add the role. The seed gives nobody both, and the other specs rely on its roles, so Priya
// gets Approver on Coral Offers for this spec only and afterAll takes it away again.
//
//   1. Maya makes a template.
//   2. Priya adds a sentence to Maya's draft; it autosaves.
//   3. Maya submits it as v1.
//   4. Priya opens v1: Approve and Request changes are disabled, the reason says why, and v1 doesn't wait
//      on her in the queue.
//   5. Jordan, who wrote none of it, may decide it.
//
// Self-contained: afterAll removes the template and everything it wrote.

const TEAM = "coral-offers";
const NAME = "Maker-checker — Terms";
/** A paragraph of the "Card offer terms" starter, under "Rates and fees". */
const INTEREST_STARTS = "Interest on purchases starts on the transaction date";
const SENTENCE = " Priya wrote this sentence.";
const WROTE = "You wrote part of this version.";

let db: Client;
let templateId: string | null = null;
/** Priya's Coral Offers membership, once this spec has given it the Approver role. */
let approverAddedTo: string | null = null;

test.beforeAll(async () => {
  db = openDb();
  const [membership] = await rowsOf(db, "SELECT id FROM memberships WHERE user_id = 'priya' AND team_id = ?", [TEAM]);
  const id = String(membership!.id);
  const roles = await rowsOf(db, "SELECT role FROM membership_roles WHERE membership_id = ?", [id]);
  expect(roles.map((r) => r.role), "the seed makes Priya an author on Coral Offers").toEqual(["author"]);
  await rowsOf(db, "INSERT INTO membership_roles (membership_id, role) VALUES (?, 'approver')", [id]);
  approverAddedTo = id;
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (approverAddedTo) {
      await rowsOf(db, "DELETE FROM membership_roles WHERE membership_id = ? AND role = 'approver'", [approverAddedTo]);
    }
    if (templateId) await removeTemplate(db, templateId);
  } finally {
    db.close();
  }
});

const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) => decision(page).getByRole("button", { name: "Approve", exact: true });
const requestButton = (page: Page) => decision(page).getByRole("button", { name: "Request changes", exact: true });
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const block = (page: Page, text: string): Locator => documentEditor(page).locator("p", { hasText: text });

async function openWorkspace(page: Page, person: string, id: string) {
  await asPersona(page, person);
  await page.goto(`/${TEAM}/templates/${id}`);
  await liveEditor(page);
  await hydrated(page);
}

async function openReview(page: Page, person: string, id: string) {
  await asPersona(page, person);
  await page.goto(`/${TEAM}/review/${id}/1`);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(decision(page)).toBeVisible();
  await liveEditor(page);
  await hydrated(page);
}

test.use({ trace: "off", screenshot: "only-on-failure" });

test("someone who edited a draft another author submitted can't approve it or send it back", async ({ page }) => {
  test.setTimeout(120_000);

  await test.step("1. Maya makes a template", async () => {
    await asPersona(page, "maya");
    await openLibrary(page, TEAM);
    await tap(page.getByRole("button", { name: "New template" }));
    const gallery = page.getByRole("dialog");
    await expect(gallery).toBeVisible();
    await tap(gallery.getByRole("button", { name: /Card offer terms/ }));
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
    templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1]!;

    await expect(nameField(page)).toBeFocused();
    await page.waitForTimeout(300);
    await page.keyboard.press("ControlOrMeta+a");
    await typeSlowly(page, NAME);
    await expect(nameField(page)).toHaveValue(NAME);
    await expectAutosaved(page);
  });
  const id = templateId!;

  await test.step("2. Priya adds a sentence to Maya's draft", async () => {
    await openWorkspace(page, "priya", id);
    const paragraph = block(page, INTEREST_STARTS);
    await paragraph.scrollIntoViewIfNeeded();
    const box = (await paragraph.boundingBox())!;
    const end = { x: box.width - 4, y: box.height - 10 };
    await untilUncovered(paragraph, end);
    await tap(paragraph, { position: end });
    await page.keyboard.press("End");
    await expect.poll(async () => (await caret(page)).block.startsWith(INTEREST_STARTS), { message: "the caret is in that paragraph" }).toBe(true);
    await typeSlowly(page, SENTENCE);
    await expect(paragraph).toContainText(SENTENCE.trim());
    await expectAutosaved(page);

    const [draft] = await rowsOf(db, "SELECT created_by, writers FROM versions WHERE template_id = ? AND state = 'draft'", [id]);
    expect(draft).toMatchObject({ created_by: "maya" });
    expect(JSON.parse(String(draft!.writers))).toEqual(["maya", "priya"]);
  });

  await test.step("3. Maya submits it as v1", async () => {
    await openWorkspace(page, "maya", id);
    await expect(documentEditor(page)).toContainText(SENTENCE.trim());
    await tap(page.getByRole("button", { name: "Submit for review" }));
    const dialog = page.getByRole("dialog", { name: "Submit v1 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await tap(dialog.getByRole("button", { name: "Submit v1", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });

    const [v1] = await rowsOf(db, "SELECT state, submitted_by, writers FROM versions WHERE template_id = ? AND number = 1", [id]);
    expect(v1).toMatchObject({ state: "in_review", submitted_by: "maya" });
    expect(JSON.parse(String(v1!.writers))).toEqual(["maya", "priya"]);
  });

  await test.step("4. Priya opens v1: Approve and Request changes are disabled, and the reason says why", async () => {
    await openReview(page, "priya", id);
    await expect(approveButton(page)).toBeVisible();
    await expect(approveButton(page), "she wrote part of it").toBeDisabled();
    await expect(requestButton(page)).toBeDisabled();
    await expect(decision(page).getByText(WROTE)).toBeVisible();
    await expect(approveButton(page)).toHaveAccessibleDescription(WROTE);

    await page.goto(`/${TEAM}/review`);
    await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
    await hydrated(page);
    const waiting = page.getByRole("tab", { name: /^Waiting on me/ });
    await tap(waiting);
    await expect(waiting).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel").filter({ visible: true });
    await expect(panel.locator("ul > li").first().or(panel.getByText("Nothing waiting on you."))).toBeVisible();
    await expect(panel.locator(`a[href="/${TEAM}/review/${id}/1"]`), "v1 doesn't wait on Priya").toHaveCount(0);
    expect(await rowsOf(db, "SELECT id FROM approvals WHERE version_id IN (SELECT id FROM versions WHERE template_id = ?)", [id])).toEqual([]);
  });

  await test.step("5. Jordan wrote none of it: Approve and Request changes are his to press", async () => {
    await openReview(page, "jordan", id);
    await expect(approveButton(page)).toBeEnabled();
    await expect(requestButton(page)).toBeEnabled();
    await expect(decision(page).getByText(WROTE)).toHaveCount(0);
  });
});
