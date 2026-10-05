import path from "node:path";
import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { removeTemplate, rowsOf } from "./helpers/cleanup";
import { asPersona, beat, chip, expect, liveEditor, nameField, openLibrary, shoot, tap, test, typeSlowly, untilUncovered } from "./helpers/scenario";

// Phase 7a gate: demo scenario 9 ("Import").
//
//   Maya imports a .docx containing {{first_name}} and a table. The draft has a chip and the table.
//   "Compare with original" shows the source.
//
//   1. Library → ⌘K → "Import a file": the New template dialog opens with the import row focused, under the starters.
//   2. She picks e2e/fixtures/import/spring-offer.docx: the row says "Importing spring-offer.docx"
//      until the new template opens.
//   3. The draft opens with its name (the file's title) selected, a first_name chip in the text, the
//      table, and the three required sections (the missing one added empty).
//   4. The rail opens on Original: the file's name, the import report (detected, dropped) and the
//      source as a document: the table, the {{placeholders}} as written.
//   5. The other rail tabs still work; coming back to Original shows the same source.
//   6. The database holds the upload, linked to the draft, and Activity says who imported what.
//   7. ⌘K, straight from the new template, finds the draft by name with its status.
//
// Self-contained: it creates one template and afterAll removes it, its upload row and its upload
// folder (by id). Console and page errors fail it.

const TEAM = "coral-offers";
const FILE = path.join(process.cwd(), "e2e", "fixtures", "import", "spring-offer.docx");
const FILE_NAME = "spring-offer.docx";
const TEMPLATE_NAME = "Spring Balance Transfer Offer";

let db: Client;
/** Set once the template exists, so afterAll removes it even when the test fails half way. */
let templateId: string | null = null;

test.beforeAll(() => {
  db = openDb();
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (templateId) await removeTemplate(db, templateId);
  } finally {
    db.close();
  }
});

const rail = (page: Page) => page.locator('[data-slot="rail"]').filter({ visible: true });
const railTab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).filter({ visible: true });

test("scenario 9: Maya imports a .docx; the draft has the chip and the table; the Original tab shows the source", async ({ page }) => {
  test.setTimeout(120_000);

  await asPersona(page, "maya");
  await openLibrary(page, TEAM);
  await beat(page, 800);

  await test.step("1. ⌘K 'Import a file' opens New template with the import row under the starters, focused", async () => {
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Search" });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("group", { name: "Actions" })).toBeVisible();
    await typeSlowly(page, "import");
    await expect(palette.getByRole("option", { name: /Import a file/ })).toBeVisible();
    await shoot(page, "00-palette");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    const dialog = page.getByRole("dialog", { name: "New template" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Import a file" })).toBeFocused();
    await expect(dialog.getByRole("button", { name: /Card offer terms/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Import a file/ })).toBeVisible();
    await beat(page, 600);
    await shoot(page, "01-import-row");
  });

  await test.step("2. She picks the .docx: the row shows what is importing, then the template opens", async () => {
    const dialog = page.getByRole("dialog");
    // The picker is a hidden file input behind the row; this is what choosing the file in the OS dialog does.
    await dialog.locator('input[type="file"]').setInputFiles(FILE);
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/, { timeout: 30_000 });
    templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];
  });

  await test.step("3. The draft: the title is the name (selected), the chip, the table, the required sections", async () => {
    await expect(nameField(page)).toHaveValue(TEMPLATE_NAME);
    await expect(nameField(page)).toBeFocused();
    await liveEditor(page);

    // {{First Name}} and {{first_name}} are the same key: chips, not text.
    await expect(chip(page, "first_name").first()).toBeVisible();
    await expect(chip(page, "purchase_apr").first()).toBeVisible();
    await expect(chip(page, "annual_fee").first()).toBeVisible();
    expect(await chip(page, "first_name").count(), "{{First Name}} and {{first_name}} became chips").toBeGreaterThanOrEqual(2);

    // The table, header row and all.
    const body = page.getByRole("textbox", { name: "Document" });
    const table = body.locator("table");
    await expect(table).toBeVisible();
    await expect(table.locator("th").first()).toHaveText("Fee");
    await expect(table).toContainText("Balance transfer fee");
    await expect(table.locator('[data-variable="annual_fee"]')).toBeVisible();

    // The required sections, in order; "Legal notices" was missing from the file and is added empty.
    for (const key of ["offer_details", "rates_and_fees", "legal_notices"]) await expect(body.locator(`h2[data-required="${key}"]`)).toBeVisible();
    await expect(body.locator("h2[data-required]")).toHaveText(["Offer details", "Rates and fees", "Legal notices"]);

    // Template logic stays as text.
    await expect(body).toContainText("{{#if member}}");
    await beat(page, 600);
  });

  await test.step("4. The rail opens on Original: the file, the report, the source", async () => {
    const original = rail(page);
    await expect(original).toHaveAttribute("data-view", "original");
    await expect(original).toHaveAccessibleName("Original");
    await expect(railTab(page, "Original")).toHaveAttribute("aria-selected", "true");

    await expect(original.locator('[data-slot="original-file"]')).toContainText(FILE_NAME);
    await expect(original.locator('[data-slot="original-file"]')).toContainText("Maya Chen");

    const report = original.getByRole("region", { name: "Import report" });
    await expect(report).toBeVisible();
    await expect(report.getByRole("list", { name: "Detected" })).toContainText("First name");
    await expect(report.getByRole("list", { name: "Detected" })).toContainText("1 table");
    await expect(report.getByRole("list", { name: "Detected" })).toContainText("Added empty section: Legal notices");
    await expect(report.getByRole("list", { name: "Kept as text" })).toContainText("{{#if member}}");
    await expect(report.getByRole("list", { name: "Dropped" })).toContainText("1 comment");

    // The source, as written: a document with its table and its placeholders still in braces.
    const source = original.getByRole("region", { name: "Original file" });
    const doc = source.locator(".ucomp-doc");
    await expect(doc).toBeVisible();
    await expect(doc.locator("table")).toBeVisible();
    await expect(doc).toContainText("Dear {{First Name}},");
    await expect(doc).toContainText("Balance transfer fee");
    await expect(doc.locator("img")).toHaveCount(1);

    // The draft is beside it, not replaced: both are on screen.
    await expect(page.getByRole("textbox", { name: "Document" })).toBeVisible();
    await beat(page, 900);
    await shoot(page, "02-draft-beside-original");
  });

  await test.step("5. The other tabs work, and Original comes back as it was", async () => {
    await untilUncovered(railTab(page, "Variables"));
    await tap(railTab(page, "Variables"));
    await expect(rail(page)).toHaveAttribute("data-view", "variables");
    await expect(page.locator('[data-variable-row="first_name"]').filter({ visible: true })).toBeVisible();
    await shoot(page, "03-variables");

    await tap(railTab(page, "Original"));
    await expect(rail(page)).toHaveAttribute("data-view", "original");
    await expect(rail(page).getByRole("region", { name: "Original file" }).locator(".ucomp-doc table")).toBeVisible();
  });

  await test.step("6. The database and Activity know where the draft came from", async () => {
    const [version] = await rowsOf(db, "SELECT import_upload_id, state FROM versions WHERE template_id = ?", [templateId!]);
    expect(version.state).toBe("draft");
    const [upload] = await rowsOf(db, "SELECT id, filename, template_id FROM uploads WHERE template_id = ?", [templateId!]);
    expect(upload).toMatchObject({ filename: FILE_NAME, template_id: templateId });
    expect(version.import_upload_id).toBe(upload.id);

    await tap(page.getByRole("navigation", { name: "Template" }).getByRole("link", { name: "Activity" }));
    await expect(page).toHaveURL(/\/activity/);
    await expect(page.getByText(`Maya Chen imported ${FILE_NAME}`)).toBeVisible();
    await shoot(page, "04-activity");
  });

  await test.step("7. ⌘K finds the new draft by name, with its status", async () => {
    // Straight from the template page the import opened (the palette refetches after an import).
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Search" });
    await expect(palette).toBeVisible();
    await typeSlowly(page, "Spring Balance");
    await expect(palette.getByRole("option", { name: new RegExp(`${TEMPLATE_NAME} Draft ${templateId}`) })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });
});
