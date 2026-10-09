import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { SPRING_NAME, TEAM, click, createSpringTravel, json, reactReady, removeTemplate, rows, run, type SpringFixture } from "./helpers/golive";
import {
  asPersona,
  caret,
  documentEditor,
  expect,
  expectAutosaved,
  hydrated,
  liveEditor,
  panelRow,
  saveIndicator,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// Submit holds the draft still (handoff review I8). Maya edits Spring Travel v2 and presses Submit while her
// last saves are still on their way to the server:
//
//   1. From the click, the page is read-only (the document, the channels, the name, the variables panel)
//      while the pending saves go out; what she typed can't change under the summary.
//   2. The dialog lists the variable she added just before the click: the summary is read after the saves.
//   3. Cancel: everything is editable again, Undo included, and she keeps typing.
//   4. Another tab saves the draft while the dialog is open: Submit is refused as stale, and the dialog
//      offers Refresh summary. Refreshed, it submits; v3 holds both sentences and the variable.
//
// Standalone: the fixture inserts Spring Travel v2 Active; afterAll removes the template and every row this
// run wrote for it. Console and page errors fail it.

const FIRST = "Typed before Submit.";
const SECOND = "Typed after Cancel.";
/** How long each autosave request is held on its way, so Submit is pressed while one is out. */
const SLOW_SAVE_MS = 1_500;

let db: Client;
let fixture: SpringFixture | null = null;

test.beforeAll(async () => {
  db = openDb();
  fixture = await createSpringTravel(db);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (fixture) await removeTemplate(db, fixture.templateId);
  } finally {
    db.close();
  }
});

const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const submitButton = (page: Page) => page.getByRole("button", { name: "Submit for review" });
const newVariable = (page: Page) => page.getByRole("button", { name: "New variable" });
const undoButton = (page: Page) => page.locator("header").filter({ visible: true }).getByRole("button", { name: "Undo", exact: true });
// By selector rather than by role: an open dialog hides the page behind it from the accessibility tree.
const held = {
  document: (page: Page) => page.locator('.ProseMirror[aria-label="Document"]').filter({ visible: true }),
  name: (page: Page) => page.locator('textarea[aria-label="Template name"]').filter({ visible: true }),
  channels: (page: Page) => page.locator('[aria-label="Channels"] button').filter({ visible: true }),
  newVariable: (page: Page) => page.locator("button").filter({ hasText: /^New variable$/, visible: true }),
};

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

/** Everything that edits the draft, as it should be: editable, or held read-only. */
async function expectEditable(page: Page, editable: boolean) {
  await expect(held.document(page)).toHaveAttribute("contenteditable", String(editable));
  await expect(held.name(page)).toHaveJSProperty("readOnly", !editable);
  await expect(held.channels(page)).toHaveCount(3);
  for (const toggle of await held.channels(page).all()) {
    if (editable) await expect(toggle).not.toHaveAttribute("data-disabled");
    else await expect(toggle).toHaveAttribute("data-disabled");
  }
  await expect(held.newVariable(page)).toHaveCount(editable ? 1 : 0);
}

test("Submit holds the draft still while it reads the summary, Cancel lets go, and a stale summary is refreshed", async ({ page }) => {
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
    await expectEditable(page, true);
  });

  // Every autosave now takes a while to reach the server, so the saves are still out when she presses Submit.
  await page.route("**/api/drafts/**", async (route) => {
    if (route.request().method() === "PUT") await new Promise((resolve) => setTimeout(resolve, SLOW_SAVE_MS));
    await route.continue();
  });

  await test.step("She types, adds Gift card, and presses Submit while the saves are still out: the page is held still", async () => {
    await typeAtEndOfFirstParagraph(page, FIRST);
    await tap(newVariable(page));
    const form = page.getByRole("form", { name: "New variable" });
    await expect(form.getByLabel("Label")).toBeFocused();
    await page.keyboard.type("Gift card");
    await expect(form.getByLabel("Key")).toHaveValue("gift_card");
    await page.keyboard.press("Enter");
    await expect(form).toBeHidden();
    await expect(panelRow(page, "gift_card")).toBeVisible();
    await expect(saveIndicator(page)).not.toHaveText("Saved");

    await tap(submitButton(page));
    await expect(submitButton(page)).toBeDisabled();
    await expectEditable(page, false);
    // Typing into the document changes nothing now.
    const before = await documentEditor(page).textContent();
    await documentEditor(page).locator("p").first().click({ delay: 90 });
    await page.keyboard.type("Nope");
    expect(await documentEditor(page).textContent()).toBe(before);
  });

  const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });

  await test.step("The dialog lists what she added just before the click", async () => {
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText("v3 adds required gift_card (Text).");
    await expect(saveIndicator(page)).toHaveText("Saved");
    const [draft] = await rows(db, "SELECT body, variables FROM versions WHERE template_id = ? AND state = 'draft'", [templateId]);
    expect(JSON.stringify(json(draft.body))).toContain(FIRST);
    expect((json(draft.variables) as { key: string }[]).map((v) => v.key)).toContain("gift_card");
  });

  await page.unroute("**/api/drafts/**");

  await test.step("Cancel: the page is editable again, Undo too, and she keeps typing", async () => {
    await tap(dialog.getByRole("button", { name: "Cancel" }));
    await expect(dialog).toBeHidden();
    await expectEditable(page, true);
    await expect(undoButton(page)).not.toHaveAttribute("data-disabled");
    await typeAtEndOfFirstParagraph(page, SECOND);
    await expectAutosaved(page);
  });

  await test.step("Another tab saves while the dialog is open: Submit is refused, and the refreshed summary submits", async () => {
    await tap(submitButton(page));
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expectEditable(page, false);

    // What a save from another tab leaves behind: the draft's rev moves on.
    await run(db, "UPDATE versions SET rev = rev + 1 WHERE template_id = ? AND state = 'draft'", [templateId]);
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    await expect(dialog.getByRole("alert")).toHaveText("This draft changed after this summary was made.");
    const [still] = await rows(db, "SELECT state FROM versions WHERE template_id = ? AND number IS NULL", [templateId]);
    expect(still.state, "nothing was frozen").toBe("draft");

    await tap(dialog.getByRole("button", { name: "Refresh summary" }));
    await expect(dialog.getByRole("alert")).toHaveText("");
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    await expect(dialog, "the submit goes through").toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
    await expect(held.document(page)).toHaveAttribute("contenteditable", "false");
  });

  await test.step("v3 holds everything she typed, and nothing failed to save after the submit", async () => {
    const [v3] = await rows(db, "SELECT state, body, variables FROM versions WHERE template_id = ? AND number = 3", [templateId]);
    expect(v3.state).toBe("in_review");
    const body = JSON.stringify(json(v3.body));
    expect(body).toContain(FIRST);
    expect(body).toContain(SECOND);
    expect(body).not.toContain("Nope");
    expect((json(v3.variables) as { key: string }[]).map((v) => v.key)).toContain("gift_card");
    await expect(page.getByText(/Not saved/)).toHaveCount(0);
  });
});
