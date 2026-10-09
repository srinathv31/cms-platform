import type { Client } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { openDb } from "./api/helpers";
import { SPRING_NAME, TEAM, click, createSpringTravel, json, reactReady, removeTemplate, rows, run, type SpringFixture } from "./helpers/golive";
import { asPersona, documentEditor, dragRowTo, expect, expectAutosaved, hydrated, liveEditor, panelRow, pointInText, tap, test } from "./helpers/scenario";

// A panel drop, then a block move (handoff review I4). Jordan left a comment on the "Open your account by"
// paragraph of Spring Travel v2. Maya opens a draft, drags Home state from the Variables panel into the
// greeting, then drags the commented paragraph above the greeting by its ⋮⋮ grip. The paragraph keeps its
// block id, so Jordan's thread stays on it (its card among the open comments, its marker, its highlight)
// and never falls to "On removed content"; the saved draft has the paragraph, with its id, in its new place.
//
// Standalone: the fixture inserts Spring Travel v2 Active and Jordan's thread; afterAll removes the template
// and every row this run wrote for it. Console and page errors fail it.

const MOVED = "Open your account by";
const QUOTE = "to qualify for this offer";
const COMMENT = "Is this the right deadline?";

type Body = { content: { attrs?: { id?: string }; content?: { text?: string }[] }[] };

let db: Client;
let fixture: SpringFixture | null = null;
/** The commented paragraph's block id, as v2 stores it. */
let blockId = "";

test.beforeAll(async () => {
  db = openDb();
  fixture = await createSpringTravel(db);
  const [v2] = await rows(db, "SELECT body FROM versions WHERE id = ?", [fixture.v2Id]);
  const moved = (json(v2.body) as Body).content.find((node) => node.content?.[0]?.text?.startsWith(MOVED));
  if (!moved?.attrs?.id) throw new Error(`Spring Travel v2 has no "${MOVED}" paragraph with an id.`);
  blockId = moved.attrs.id;

  const threadId = `th_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`;
  const at = Date.now() - 86_400_000;
  await run(
    db,
    "INSERT INTO comment_threads (id, template_id, origin_version_id, block_id, quote, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)",
    [threadId, fixture.templateId, fixture.v2Id, blockId, QUOTE, at],
  );
  await run(db, "INSERT INTO comments (id, thread_id, author_id, body, kind, created_at) VALUES (?, ?, 'jordan', ?, 'comment', ?)", [
    `cm_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`,
    threadId,
    COMMENT,
    at,
  ]);
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
const rail = (page: Page) => page.locator('aside[aria-label="Comments and variables"]').filter({ visible: true });
const railTab = (page: Page, name: RegExp) => rail(page).getByRole("tablist", { name: "Rail" }).getByRole("tab", { name });
const thread = (page: Page) => rail(page).locator("article[data-thread]").filter({ hasText: COMMENT });
const gutterMarkers = (page: Page) => page.locator('[data-slot="gutter-markers"] [data-marker]').filter({ visible: true });
/** The commented paragraph, and the greeting ("Hi First name Last name, spend…"). */
const moved = (page: Page) => documentEditor(page).locator(":scope > p", { hasText: MOVED });
const greeting = (page: Page) => documentEditor(page).locator(":scope > p", { hasText: /^Hi / });

/** Where the commented paragraph is, counted from the greeting (1: right after it, -1: right before it). */
const placeFromGreeting = (page: Page) =>
  documentEditor(page).evaluate((el, start) => {
    const texts = [...el.querySelectorAll(":scope > p")].map((p) => p.textContent ?? "");
    return texts.findIndex((text) => text.startsWith(start)) - texts.findIndex((text) => text.startsWith("Hi "));
  }, MOVED);

/**
 * Drags a block by its ⋮⋮ grip with the real mouse, the way `dragRowTo` drags a panel row: hover the block
 * so the handle comes to it, press on the grip, nudge to start the drag, glide over the target, release.
 */
async function dragBlockTo(page: Page, block: Locator, target: { x: number; y: number }) {
  await block.hover();
  const grip = page.getByLabel("Drag to move block, or click for options", { exact: true });
  await expect(grip).toBeVisible();
  const box = (await grip.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y, { steps: 4 });
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

/** The thread is on its block: its card among the open comments, its marker in the gutter, its highlight in the paragraph. */
async function expectAnchored(page: Page) {
  await expect(railTab(page, /^Comments/)).toHaveAttribute("aria-selected", "true");
  await expect(thread(page)).toBeVisible();
  await expect(thread(page)).toHaveAttribute("data-status", "open");
  await expect(rail(page).getByRole("region", { name: "Comments on removed content" })).toHaveCount(0);
  await expect(gutterMarkers(page)).toHaveCount(1);
  await expect(gutterMarkers(page).first()).toHaveAttribute("data-marker", blockId);
  await expect(moved(page).locator("mark.ucomp-thread")).toHaveText(QUOTE);
}

test("a block moved by its grip after a panel drop keeps its id, and its comment thread stays on it", async ({ page }) => {
  const { templateId } = fixture!;
  await asPersona(page, "maya");
  await page.goto(`/${TEAM}/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
  await hydrated(page);

  await test.step("Maya opens a draft: Jordan's thread is on the paragraph", async () => {
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await reactReady(edit);
    await click(edit);
    await expect(statusBadge(page)).toHaveText("Draft");
    await liveEditor(page);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "true");
    await expect(moved(page)).toHaveAttribute("data-id", blockId);
    expect(await placeFromGreeting(page), "the paragraph comes right after the greeting").toBe(1);
    await expectAnchored(page);
  });

  await test.step("She drags Home state from the Variables panel into the greeting", async () => {
    await tap(railTab(page, /^Variables/));
    await expect(railTab(page, /^Variables/)).toHaveAttribute("aria-selected", "true");
    const chips = documentEditor(page).locator('[data-variable="home_state"]');
    await expect(chips).toHaveCount(1);
    await dragRowTo(page, panelRow(page, "home_state"), await pointInText(greeting(page), "Hi".length));
    await expect(greeting(page).locator('[data-variable="home_state"]'), "the drop put a chip in the greeting").toHaveCount(1);
    await expect(chips).toHaveCount(2);
    await expectAutosaved(page);
  });

  await test.step("She drags the commented paragraph above the greeting by its grip: it keeps its id", async () => {
    await dragBlockTo(page, moved(page), await pointInText(greeting(page), 0));
    await expect.poll(() => placeFromGreeting(page), { message: "the paragraph is now right before the greeting" }).toBe(-1);
    await expect(moved(page), "the moved paragraph keeps its block id").toHaveAttribute("data-id", blockId);
    await expectAutosaved(page);
  });

  await test.step("Jordan's thread is still on the paragraph, not on removed content", async () => {
    await tap(railTab(page, /^Comments/));
    await expectAnchored(page);
  });

  await test.step("The saved draft has the paragraph, with its id, right before the greeting", async () => {
    const [draft] = await rows(db, "SELECT body FROM versions WHERE template_id = ? AND state = 'draft'", [templateId]);
    const { content } = json(draft.body) as Body;
    const at = content.findIndex((node) => node.attrs?.id === blockId);
    expect(at, "the paragraph's id is in the saved draft").toBeGreaterThanOrEqual(0);
    expect(content[at].content?.[0]?.text?.startsWith(MOVED)).toBe(true);
    expect(content[at + 1].content?.[0]?.text?.startsWith("Hi")).toBe(true);
  });
});
