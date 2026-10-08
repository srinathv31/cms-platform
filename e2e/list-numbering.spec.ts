import type { Client } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { removeTemplate } from "./helpers/cleanup";
import { asPersona, editor, expect, expectAutosaved, liveEditor, nameField, openLibrary, tap, test, typeSlowly } from "./helpers/scenario";

// List numbering from the block menu, in the real UI: what the author picks is what every channel prints.
//
//   1. Numbering: Maya writes a two-item numbered list, opens the list's block menu from its ⋮⋮ grip and
//      picks "(a)" under Numbering. The editor shows (a) and (b); the Preview's PDF and Web show the same.
//   2. Start at…: on the same list she sets Start at… to 3. The editor shows (c) and (d); so do the PDF
//      and the Web preview.
//
// Self-contained: the first test creates one template from the gallery and afterAll removes it and
// everything it wrote, so the counts other specs see stay as they were. Console and page errors fail it.

const FIRST = "Numbered first";
const SECOND = "Numbered second";

// The preview's Web frame is sandboxed with scripts off; Playwright's trace snapshotter injects a
// script into it, which Chromium reports as a console error. That is the harness, not the app.
test.use({ trace: "off", screenshot: "only-on-failure" });
test.describe.configure({ mode: "serial" });

let db: Client;
/** Set once the template exists, so afterAll removes it even when a test fails half way. */
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

// ── The editor ───────────────────────────────────────────────────────────────

const item = (page: Page, text: string) => editor(page).locator("li[data-list-marker]", { hasText: text });

/** The markers the editor draws beside the two items. */
async function expectEditorMarkers(page: Page, markers: [string, string]) {
  await expect(item(page, FIRST)).toHaveAttribute("data-list-marker", markers[0]);
  await expect(item(page, SECOND)).toHaveAttribute("data-list-marker", markers[1]);
}

/** The list's block menu, from its grip: hover the list so the handle comes to it, then click the grip. */
async function openBlockMenu(page: Page): Promise<Locator> {
  await item(page, FIRST).hover();
  const grip = page.getByLabel("Drag to move block, or click for options", { exact: true });
  await expect(grip).toBeVisible();
  await tap(grip);
  const menu = page.getByRole("menu", { name: "Block options", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Numbered list");
  return menu;
}

// ── The preview ──────────────────────────────────────────────────────────────

const previewToggle = (page: Page) => page.getByRole("button", { name: "Preview", exact: true });
const rail = (page: Page) => page.locator("aside[aria-label='Preview']");
const channelTab = (page: Page, label: "PDF" | "Web") =>
  rail(page).getByRole("group", { name: "Channel", exact: true }).getByRole("button", { name: label, exact: true });
const pdfRegion = (page: Page) => page.getByRole("region", { name: "PDF preview" });
const webFrame = (page: Page) => page.locator('iframe[title="Web preview"]');

/** Text compared without any whitespace: a PDF breaks lines and splits runs wherever it likes. */
const compact = (text: string) => text.replace(/\s+/g, "");

/** What the PDF's text layer says, all pages. */
const pdfText = (page: Page) =>
  pdfRegion(page).evaluate((region) =>
    [...region.querySelectorAll("span")]
      .filter((span) => !span.querySelector("span"))
      .map((span) => span.textContent ?? "")
      .join(" "),
  );

/**
 * The Web preview's list items whose text starts with "Numbered": [marker, text]. Read from the page
 * that holds the frame (same-origin, scripts off), not through `frameLocator`, which injects a script.
 */
const webItems = (page: Page) =>
  webFrame(page).evaluate((el: HTMLIFrameElement) =>
    [...(el.contentDocument?.querySelectorAll("li") ?? [])]
      .map((li) => [li.querySelector(":scope > .marker")?.textContent ?? "", li.querySelector(":scope > div")?.textContent ?? ""])
      .filter(([, text]) => text.startsWith("Numbered")),
  );

async function showChannel(page: Page, label: "PDF" | "Web") {
  await tap(channelTab(page, label));
  await expect(channelTab(page, label)).toHaveAttribute("aria-pressed", "true");
}

/** The PDF and the Web preview print the list with exactly these markers. */
async function expectPreviewMarkers(page: Page, markers: [string, string]) {
  if ((await previewToggle(page).getAttribute("aria-pressed")) !== "true") await tap(previewToggle(page));
  await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "true");

  await showChannel(page, "PDF");
  await expect
    .poll(async () => compact(await pdfText(page)), { message: `the PDF numbers the list ${markers.join(" ")}`, timeout: 30_000 })
    .toContain(compact(`${markers[0]} ${FIRST} ${markers[1]} ${SECOND}`));

  await showChannel(page, "Web");
  await expect
    .poll(() => webItems(page), { message: `the Web preview numbers the list ${markers.join(" ")}`, timeout: 20_000 })
    .toEqual([
      [markers[0], FIRST],
      [markers[1], SECOND],
    ]);

  await tap(previewToggle(page));
  await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "false");
}

// ── The tests ────────────────────────────────────────────────────────────────

test.describe("list numbering from the block menu", () => {
  test("Numbering: (a) on a list shows (a) in the editor, and the same markers in the PDF and Web previews", async ({ page }) => {
    test.setTimeout(120_000);
    await asPersona(page, "maya");
    await openLibrary(page);

    // A new template from the gallery; Enter from the name goes to the document.
    await tap(page.getByRole("button", { name: "New template" }));
    await tap(page.getByRole("dialog").getByRole("button", { name: /Card offer terms/ }));
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
    templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1]!;
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await liveEditor(page);
    await expect(editor(page), "Enter from the name puts the caret in the document").toBeFocused();

    // A numbered list of two items, typed: "1. " starts it.
    await page.keyboard.press("Enter");
    await typeSlowly(page, `1. ${FIRST}`);
    await page.keyboard.press("Enter");
    await typeSlowly(page, SECOND);
    await expectEditorMarkers(page, ["1.", "2."]);
    await expectAutosaved(page);

    // Block menu → Numbering → (a).
    const menu = await openBlockMenu(page);
    await tap(menu.getByRole("menuitem", { name: "Numbering" }));
    const styles = page.getByRole("menu", { name: "Numbering" });
    await expect(styles.getByRole("menuitemradio", { name: /^Default/ })).toHaveAttribute("aria-checked", "true");
    await tap(styles.getByRole("menuitemradio", { name: "(a) (b) (c)", exact: true }));
    await expect(page.getByRole("menu")).toHaveCount(0);

    await expectEditorMarkers(page, ["(a)", "(b)"]);
    await expectAutosaved(page);
    await expectPreviewMarkers(page, ["(a)", "(b)"]);
  });

  test("Start at…: 3 on the (a) list shows (c) and (d) in the editor, the PDF and the Web preview", async ({ page }) => {
    test.setTimeout(120_000);
    await asPersona(page, "maya");
    await page.goto(`/coral-offers/templates/${templateId}`);
    await liveEditor(page);
    await expectEditorMarkers(page, ["(a)", "(b)"]);

    // Block menu → Start at… → 3, Enter.
    const menu = await openBlockMenu(page);
    await expect(menu.getByRole("menuitem", { name: /^Start at…/ })).toContainText("1");
    await tap(menu.getByRole("menuitem", { name: /^Start at…/ }));
    const field = menu.getByRole("textbox", { name: "Start at" });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("1");
    await page.keyboard.press("ControlOrMeta+a");
    await typeSlowly(page, "3");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await expectEditorMarkers(page, ["(c)", "(d)"]);
    await expectAutosaved(page);
    await expectPreviewMarkers(page, ["(c)", "(d)"]);
  });
});
