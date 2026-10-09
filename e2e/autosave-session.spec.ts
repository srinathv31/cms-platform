import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { SPRING_NAME, TEAM, click, createSpringTravel, json, reactReady, removeTemplate, rows, type SpringFixture } from "./helpers/golive";
import {
  asPersona,
  caret,
  documentEditor,
  expect,
  expectAutosaved,
  hydrated,
  liveEditor,
  nameField,
  saveIndicator,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// Three ways the autosave session used to drop edits without a word (handoff review I1, I6, I10).
//
//   1. A rename on the Versions tab, opened by its address, saves: the header binds the session on every
//      tab, not only the Content tab. Reloaded, the new name is there.
//   2. Another session saves the draft first, so this page's next save is a conflict. The page turns
//      read-only (the document, the name, the channels), the status says the change can't be saved, and
//      Reload shows the draft as the other session left it.
//   3. Leaving while a save is still out asks first (`beforeunload`); leaving once everything is saved
//      doesn't.
//
// Standalone: each test inserts Spring Travel v2 Active and removes it, and every row it wrote, after.
// Console and page errors fail it, but for the one 409 the conflict is.

const RENAMED = "Spring Travel Rewards — Card Terms";
const ELSEWHERE = "Spring Travel Rewards — Renamed in another tab";
const TYPED = "Typed in this tab.";
const TOO_LATE = "Typed after the other tab saved.";
const CONFLICT = "Your latest changes can't be saved — this draft changed elsewhere.";

let db: Client;
let fixture: SpringFixture | null = null;

test.beforeAll(() => {
  db = openDb();
});
test.beforeEach(async () => {
  fixture = await createSpringTravel(db);
});
test.afterEach(async () => {
  if (fixture) await removeTemplate(db, fixture.templateId);
  fixture = null;
});
test.afterAll(() => {
  db?.close();
});

const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const stopped = (page: Page) => page.locator('[data-slot="save-stopped"]').filter({ visible: true });
const stoppedReason = (page: Page) => stopped(page).getByRole("alert");
const reloadButton = (page: Page) => stopped(page).getByRole("button", { name: "Reload", exact: true });
const channels = (page: Page) => page.locator('[aria-label="Channels"] button').filter({ visible: true });

/** Maya opens Spring Travel and presses Edit: the page shows its draft, editable. Returns the draft's id. */
async function openDraft(page: Page): Promise<string> {
  await asPersona(page, "maya");
  await page.goto(`/${TEAM}/templates/${fixture!.templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
  await hydrated(page);
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await reactReady(edit);
  await click(edit);
  await expect(statusBadge(page)).toHaveText("Draft");
  await liveEditor(page);
  return String((await theDraft()).id);
}

const theDraft = async () => {
  const [draft] = await rows(db, "SELECT id, rev, name, body FROM versions WHERE template_id = ? AND state = 'draft'", [fixture!.templateId]);
  return draft!;
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

test("a rename on the Versions tab, opened by its address, saves", async ({ page }) => {
  await openDraft(page);

  await test.step("Maya opens the Versions tab by its address and renames the draft: Saving…, then Saved", async () => {
    await page.goto(`/${TEAM}/templates/${fixture!.templateId}/versions`);
    await hydrated(page);
    await expect(page.locator('[data-slot="tab-bar"]').getByRole("link", { name: "Versions" })).toHaveAttribute("aria-current", "page");
    await expect(documentEditor(page), "no Content tab on screen").toHaveCount(0);
    const field = nameField(page);
    await expect(field).toHaveValue(SPRING_NAME);
    await field.fill(RENAMED);
    await expectAutosaved(page);
    expect((await theDraft()).name).toBe(RENAMED);
  });

  await test.step("Reloaded, the new name is there", async () => {
    await page.reload();
    await hydrated(page);
    await expect(nameField(page)).toHaveValue(RENAMED);
    await expect(saveIndicator(page)).toHaveText("Saved");
  });
});

test("after another session saves first, the page turns read-only and offers Reload", async ({ page, problems }) => {
  const draftId = await openDraft(page);

  await test.step("Maya types a sentence: it saves", async () => {
    await typeAtEndOfFirstParagraph(page, TYPED);
    await expectAutosaved(page);
  });

  await test.step("Another session renames the draft: it saves first, through the same API", async () => {
    const { rev } = await theDraft();
    const res = await page.request.put(`/api/drafts/${draftId}`, { data: { rev: Number(rev), sessionKey: randomUUID(), name: ELSEWHERE } });
    expect(res.status()).toBe(200);
  });

  await test.step("Her next save is refused: the page is read-only, the status says so, and Reload shows", async () => {
    await typeSlowly(page, ` ${TOO_LATE}`);
    await expect(stoppedReason(page)).toHaveText(CONFLICT, { timeout: 15_000 });
    await expect(saveIndicator(page)).toHaveText("Not saved.");
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "false");
    await expect(nameField(page)).toHaveJSProperty("readOnly", true);
    await expect(channels(page)).toHaveCount(3);
    for (const toggle of await channels(page).all()) await expect(toggle).toHaveAttribute("data-disabled");
    await expect(reloadButton(page)).toBeVisible();

    // Typing changes nothing now, and nothing is sent.
    const before = await documentEditor(page).textContent();
    await page.keyboard.type("Nope");
    expect(await documentEditor(page).textContent()).toBe(before);
    const draft = await theDraft();
    expect(draft.name).toBe(ELSEWHERE);
    expect(JSON.stringify(json(draft.body))).toContain(TYPED);
    expect(JSON.stringify(json(draft.body))).not.toContain(TOO_LATE);
  });

  await test.step("Reload shows the draft as the other session left it, editable again", async () => {
    await tap(reloadButton(page));
    await expect(nameField(page)).toHaveValue(ELSEWHERE, { timeout: 20_000 });
    await hydrated(page);
    await liveEditor(page);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "true");
    await expect(documentEditor(page)).toContainText(TYPED);
    await expect(documentEditor(page)).not.toContainText(TOO_LATE);
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expect(stopped(page)).toHaveCount(0);
  });

  // The refused save is a 409, which Chrome logs. It is the one console error this test expects.
  const refused = problems.filter((p) => /status of 409/.test(p) && p.includes(`/api/drafts/${draftId}`));
  expect(refused).toHaveLength(1);
  problems.splice(problems.indexOf(refused[0]!), 1);
});

test("leaving while a save is out asks first, and leaving once saved doesn't", async ({ page }) => {
  await openDraft(page);
  const dialogs: string[] = [];
  // Stay on the page when asked, so what happens next can be checked.
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });

  await test.step("Everything saved: a reload goes ahead without asking", async () => {
    await typeAtEndOfFirstParagraph(page, TYPED);
    await expectAutosaved(page);
    await page.reload();
    await hydrated(page);
    await liveEditor(page);
    expect(dialogs).toEqual([]);
  });

  await test.step("A save still out: the reload asks, and staying keeps what was typed until it lands", async () => {
    // Every save is held on its way until the test lets it go.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/drafts/**", async (route) => {
      await held;
      await route.continue();
    });

    await typeAtEndOfFirstParagraph(page, TOO_LATE);
    await expect(saveIndicator(page)).toHaveText("Saving…");
    // The page reloads itself, as the browser's Reload would. (Playwright's own reload waits for a load
    // that never comes once the question is answered "stay".)
    await page.evaluate(() => void setTimeout(() => location.reload()));
    await expect.poll(() => dialogs, { message: "the browser asks before leaving" }).toEqual(["beforeunload"]);
    await expect(documentEditor(page)).toContainText(TOO_LATE);
    await expect(saveIndicator(page), "still the same page, still saving").toHaveText("Saving…");

    release();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    await page.unroute("**/api/drafts/**");
    expect(JSON.stringify(json((await theDraft()).body))).toContain(TOO_LATE);

    await page.reload();
    await hydrated(page);
    await expect(documentEditor(page)).toContainText(TOO_LATE);
    expect(dialogs, "no second question once saved").toEqual(["beforeunload"]);
  });
});
