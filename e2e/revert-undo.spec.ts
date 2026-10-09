import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { rowsOf } from "./helpers/cleanup";
import {
  asPersona,
  caret,
  documentEditor,
  expect,
  expectAutosaved,
  hydrated,
  liveEditor,
  saveIndicator,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// "Revert to v2" and its toast's Undo (handoff review I2 and I9). Eli, an Author on Deposits, presses
// Edit on High-Yield Savings (v2 Active), so the draft on screen was started from v2:
//
//   1. He types a sentence, reverts to v2 (the sentence goes) and presses Undo straight away (it comes
//      back). Neither press scrolls the page.
//   2. He reverts again and types another sentence: the toast goes with the first keystroke, so no Undo
//      is left that could put the old content over what he typed. Reloaded, the draft has it.
//   3. He reverts again and switches to the Versions tab: the toast goes there too (Undo would save
//      content the hidden editor doesn't show). Back on Content, what is shown is what is saved.
//
// Standalone: afterAll deletes the draft and its audit rows, so the template is as the seed made it.
// Console and page errors fail it.

const TEAM = "deposits";
const NAME = "High-Yield Savings — Rate Disclosure";
const BEFORE = "Typed before the revert.";
const AFTER = "Typed after the revert.";
/** Scroll offsets are compared to within this many pixels (fractional positions on a scaled display). */
const SLACK = 2;

test.describe.configure({ mode: "serial" });

let db: Client;
let templateId = "";

test.beforeAll(async () => {
  db = openDb();
  const [row] = await rowsOf(
    db,
    `SELECT DISTINCT t.id FROM templates t JOIN teams tm ON tm.id = t.team_id JOIN versions v ON v.template_id = t.id
     WHERE tm.slug = ? AND v.name = ?`,
    [TEAM, NAME],
  );
  if (!row) throw new Error(`The seed has no ${NAME}. Run npm run db:reset.`);
  templateId = String(row.id);
  const drafts = await rowsOf(db, "SELECT id FROM versions WHERE template_id = ? AND state = 'draft'", [templateId]);
  if (drafts.length > 0) throw new Error(`${NAME} already has a draft. Run npm run db:reset.`);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    const drafts = await rowsOf(db, "SELECT id FROM versions WHERE template_id = ? AND state = 'draft'", [templateId]);
    for (const draft of drafts) {
      await rowsOf(db, "DELETE FROM audit_events WHERE version_id = ?", [draft.id]);
      await rowsOf(db, "DELETE FROM versions WHERE id = ?", [draft.id]);
    }
  } finally {
    db.close();
  }
});

const header = (page: Page) => page.locator("header").filter({ visible: true });
const statusMenu = (page: Page) => page.locator('[data-slot="status-row"] button[aria-haspopup="menu"]').filter({ visible: true });
const revertItem = (page: Page) => page.getByRole("menuitem", { name: /^Revert to v2/ });
const revertToast = (page: Page) => page.locator("[data-sonner-toast]").filter({ hasText: "Reverted to v2" });
const toastUndo = (page: Page) => revertToast(page).getByRole("button", { name: "Undo", exact: true });
const tab = (page: Page, label: "Content" | "Versions") =>
  page.getByRole("navigation", { name: "Template" }).getByRole("link", { name: label });
const canvas = (page: Page) => page.locator('[data-slot="canvas-scroll"]');
const canvasTop = (page: Page) => canvas(page).evaluate((el) => el.scrollTop);

async function openDraft(page: Page) {
  await asPersona(page, "eli");
  await page.goto(`/${TEAM}/templates/${templateId}`);
  await hydrated(page);
  await expect(header(page).getByText("Based on v2", { exact: true })).toBeVisible();
  await liveEditor(page);
}

/** Clicks at the end of the document's first paragraph and types `text` after a space. */
async function typeAtEndOfFirstParagraph(page: Page, text: string) {
  const paragraph = documentEditor(page).locator("p").first();
  const box = (await paragraph.boundingBox())!;
  const end = { x: box.width - 3, y: box.height - 9 };
  await untilUncovered(paragraph, end);
  await paragraph.click({ position: end, delay: 90 });
  await page.keyboard.press("End");
  await expect.poll(async () => (await caret(page)).focused, { message: "the document takes focus" }).toBe(true);
  await typeSlowly(page, ` ${text}`);
  await expect(documentEditor(page)).toContainText(text);
}

/** The status menu, then Revert to v2: the toast says so. */
async function revertToV2(page: Page) {
  await tap(statusMenu(page));
  await tap(revertItem(page));
  await expect(revertToast(page)).toBeVisible();
}

/** Lets the browser run a few frames: scrolls, layout effects and remounts land within them. */
const frames = (page: Page, count = 4) =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );

test("Revert to v2 takes out what was typed, and Undo straight away puts it back, without scrolling", async ({ page }) => {
  await asPersona(page, "eli");
  await page.goto(`/${TEAM}/templates/${templateId}`);
  await hydrated(page);
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await expect(edit).toBeVisible();
  await tap(edit);
  await expect(header(page).getByText("Based on v2", { exact: true })).toBeVisible();
  await liveEditor(page);

  await typeAtEndOfFirstParagraph(page, BEFORE);
  await expectAutosaved(page);

  // A little way down, with the status row still in view: the presses below must leave it there.
  await canvas(page).evaluate((el) => el.scrollTo({ top: 24 }));
  await frames(page);
  const top = await canvasTop(page);
  expect(top).toBeGreaterThan(0);

  await revertToV2(page);
  await expect(documentEditor(page)).not.toContainText(BEFORE);
  await frames(page);
  expect(Math.abs((await canvasTop(page)) - top), "Revert to v2 doesn't scroll the page").toBeLessThanOrEqual(SLACK);
  await expectAutosaved(page);

  await tap(toastUndo(page));
  await expect(documentEditor(page)).toContainText(BEFORE);
  await expect(revertToast(page)).toHaveCount(0);
  await frames(page);
  expect(Math.abs((await canvasTop(page)) - top), "Undo doesn't scroll the page").toBeLessThanOrEqual(SLACK);
  await expectAutosaved(page);
});

test("typing after Revert to v2 takes the Undo away, so it can't wipe what was typed", async ({ page }) => {
  await openDraft(page);
  await expect(documentEditor(page)).toContainText(BEFORE);

  await revertToV2(page);
  await expect(documentEditor(page)).not.toContainText(BEFORE);
  await expect(toastUndo(page)).toBeVisible();

  await typeAtEndOfFirstParagraph(page, AFTER);
  // The first keystroke took the toast away: there is no Undo left that could put the old content back.
  await expect(revertToast(page)).toHaveCount(0);
  await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });

  await page.reload();
  await hydrated(page);
  await liveEditor(page);
  await expect(documentEditor(page)).toContainText(AFTER);
  await expect(documentEditor(page)).not.toContainText(BEFORE);
});

test("switching tabs after Revert to v2 takes the Undo away, and the content shown is what is saved", async ({ page }) => {
  await openDraft(page);
  await expect(documentEditor(page)).toContainText(AFTER);

  await revertToV2(page);
  await expect(documentEditor(page)).not.toContainText(AFTER);
  await expect(toastUndo(page)).toBeVisible();

  await tap(tab(page, "Versions"));
  await expect(page).toHaveURL(new RegExp(`/${TEAM}/templates/${templateId}/versions$`));
  await expect(revertToast(page)).toHaveCount(0);

  await tap(tab(page, "Content"));
  await expect(page).toHaveURL(new RegExp(`/${TEAM}/templates/${templateId}$`));
  await liveEditor(page);
  await expect(documentEditor(page)).not.toContainText(AFTER);
  await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });

  await page.reload();
  await hydrated(page);
  await liveEditor(page);
  await expect(documentEditor(page)).not.toContainText(AFTER);
});
