import path from "node:path";
import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { removeTemplate as removeImported } from "./helpers/cleanup";
import { SPRING_NAME, TEAM, click, createSpringTravel, reactReady, removeTemplate, type SpringFixture } from "./helpers/golive";
import { asPersona, expect, hydrated, liveEditor, nameField, openLibrary, saveIndicator, tap, test, typeSlowly } from "./helpers/scenario";

// Where focus goes after an Esc, a submit, or the rail's header row swapping (handoff review I15). Each control
// that code sends focus to registers itself with the workspace session, and nothing finds one by its label or
// by polling the page (decision 0027). The flows that move focus, end to end:
//
//   1. Esc in the rail puts the preview away, and focus goes back to the Preview toggle that opened it.
//   2. Below the rail's breakpoint, the overlay's Close puts the preview away, and focus goes to the Preview toggle.
//   3. Esc in the template name with nothing to put back closes the preview, and focus stays in the name.
//      Mid-edit, the same Esc puts the old name back and the preview stays open; the next one closes it.
//   4. Submit: once the header reads In review, focus is on its status row.
//   5. An imported template: picking the plain rail's Original tab widens the rail, and focus follows to the
//      widened rail's Original tab; Esc puts it away, and focus comes back to the plain rail's. Switched to
//      Variables in the widened rail, Esc gives focus to the Preview toggle.
//
// Standalone: the fixture inserts Spring Travel v2 Active, and the second test imports a .docx; afterAll removes
// both templates and what they own. Console and page errors fail it.

const FILE = path.join(process.cwd(), "e2e", "fixtures", "import", "spring-offer.docx");

let db: Client;
let fixture: SpringFixture | null = null;
/** Set once the import has made its template, so afterAll removes it even when the test fails half way. */
let imported: string | null = null;

test.beforeAll(async () => {
  db = openDb();
  fixture = await createSpringTravel(db);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (fixture) await removeTemplate(db, fixture.templateId);
    if (imported) await removeImported(db, imported);
  } finally {
    db.close();
  }
});

const previewToggle = (page: Page) => page.getByRole("button", { name: "Preview", exact: true });
const rail = (page: Page) => page.locator('[data-slot="rail"]').filter({ visible: true });
const railTab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).filter({ visible: true });
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const statusRow = (page: Page) => page.getByRole("group", { name: "Status" }).filter({ visible: true });
const submitButton = (page: Page) => page.getByRole("button", { name: "Submit for review" });

test("the preview, the name and a submit leave focus where the keyboard picks up", async ({ page }) => {
  const { templateId } = fixture!;
  await asPersona(page, "maya");
  await page.goto(`/${TEAM}/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
  await hydrated(page);

  await test.step("Maya opens a draft of v2", async () => {
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await reactReady(edit);
    await click(edit);
    await expect(statusBadge(page)).toHaveText("Draft");
    await liveEditor(page);
  });

  await test.step("1. Esc in the rail puts the preview away, and focus goes back to the Preview toggle", async () => {
    await tap(previewToggle(page));
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "true");
    await tap(railTab(page, "Variables"));
    await expect(railTab(page, "Variables")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(previewToggle(page)).toBeFocused();
  });

  await test.step("2. Below the breakpoint, the overlay's Close puts the preview away, and focus goes to the Preview toggle", async () => {
    await page.setViewportSize({ width: 1024, height: 900 });
    // The rail is an overlay here: the tab bar has its toggle.
    await expect(page.getByRole("button", { name: "Channels and variables" })).toBeVisible();
    await tap(previewToggle(page));
    const close = page.locator('aside[aria-label="Preview"] [data-slot="rail-header"]').getByRole("button", { name: "Close" });
    await expect(close).toBeVisible();
    await tap(close);
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(previewToggle(page)).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("3. Esc in the name with nothing to put back closes the preview, and focus stays in the name", async () => {
    await tap(previewToggle(page));
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "true");
    await tap(nameField(page));
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(nameField(page)).toBeFocused();
    await expect(nameField(page)).toHaveValue(SPRING_NAME);
  });

  await test.step("3. Mid-edit, Esc puts the old name back and the preview stays open; the next Esc closes it", async () => {
    await tap(previewToggle(page));
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "true");
    await tap(nameField(page));
    await page.keyboard.press("End");
    await typeSlowly(page, " (edited)");
    await expect(nameField(page)).toHaveValue(`${SPRING_NAME} (edited)`);
    await page.keyboard.press("Escape");
    await expect(nameField(page)).toHaveValue(SPRING_NAME);
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(nameField(page)).toBeFocused();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
  });

  await test.step("4. Submit: once the header reads In review, focus is on its status row", async () => {
    await tap(submitButton(page));
    const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
    await expect(statusRow(page)).toBeFocused();
  });
});

test("an imported template's Original tab: focus follows the rail's header row both ways", async ({ page }) => {
  test.setTimeout(120_000);
  await asPersona(page, "maya");
  await openLibrary(page, TEAM);

  await test.step("Maya imports a .docx: the template opens with the rail widened on Original", async () => {
    await tap(page.getByRole("button", { name: "New template" }));
    const dialog = page.getByRole("dialog", { name: "New template" });
    await expect(dialog).toBeVisible();
    // The picker is a hidden file input behind the import row; this is what choosing the file in the OS dialog does.
    await dialog.locator('input[type="file"]').setInputFiles(FILE);
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/, { timeout: 30_000 });
    imported = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];
    await liveEditor(page);
    await expect(rail(page)).toHaveAttribute("data-view", "original");
    // From the rail, Esc puts the widened view away (where focus goes then depends on what had it on arrival).
    await tap(railTab(page, "Original"));
    await page.keyboard.press("Escape");
    await expect(rail(page)).not.toHaveAttribute("data-preview");
  });

  await test.step("5. Picking the plain rail's Original tab widens the rail, and focus follows to the widened rail's", async () => {
    await expect(railTab(page, "Original")).toHaveAttribute("aria-selected", "false");
    await tap(railTab(page, "Original"));
    await expect(rail(page)).toHaveAttribute("data-view", "original");
    // One header row in the rail: the plain rail's went as the rail widened, and this Original tab is the widened rail's.
    await expect(rail(page).locator('[data-slot="rail-header"]').filter({ visible: true })).toHaveCount(1);
    await expect(railTab(page, "Original")).toHaveAttribute("aria-selected", "true");
    await expect(railTab(page, "Original")).toBeFocused();
  });

  await test.step("5. Esc puts it away, and focus comes back to the plain rail's Original tab", async () => {
    await page.keyboard.press("Escape");
    await expect(rail(page)).not.toHaveAttribute("data-preview");
    await expect(railTab(page, "Original")).toHaveAttribute("aria-selected", "false");
    await expect(railTab(page, "Original")).toBeFocused();
  });

  await test.step("5. Switched to Variables in the widened rail, Esc gives focus to the Preview toggle", async () => {
    await tap(railTab(page, "Original"));
    await expect(railTab(page, "Original")).toBeFocused();
    await tap(railTab(page, "Variables"));
    await expect(rail(page)).toHaveAttribute("data-view", "variables");
    await expect(railTab(page, "Variables")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(rail(page)).not.toHaveAttribute("data-preview");
    await expect(previewToggle(page)).toBeFocused();
  });
});
