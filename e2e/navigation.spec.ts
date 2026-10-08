import type { Locator, Page } from "@playwright/test";
import { resetDemoData } from "./helpers/access";
import {
  asPersona,
  caret,
  clickCounter,
  editor,
  expect,
  liveEditor,
  nameField,
  openLibrary,
  test,
  type ClickCounter,
} from "./helpers/scenario";

// Regression guard for how the app moves between pages: the browser's Back and Forward, what a new
// template does to the history, and where the one scrolling canvas sits as pages change.
//
//   1. Back and Forward on a Draft. Next keeps the page you left alive behind the new one and shows
//      it again on Back; an editor effect used to touch the TipTap view while that happened, and the
//      page came back as "This page couldn't load".
//   2. Creating a template is one history entry: one Back from the new template is the Library.
//   3. The app scrolls one container (the canvas in AppFrame; see canvas-scroll.tsx). Opening a page
//      puts it at the top, Back and Forward put each page where it was left, and a modal opening
//      over a page does not move it.
//
// Chrome only: the canvas keeps its positions by the Navigation API's entry keys.
//
// These tests create templates, and phase-1.spec.ts (which runs after this file, alphabetically)
// expects the fresh seed, so the file puts the demo data back when it is done.

const DRAFT = "Annual Fee Waiver — Terms";
const LIBRARY_URL = /\/coral-offers\/library$/;
/** A template's own address: no query, no hash. */
const TEMPLATE_URL = /\/coral-offers\/templates\/UC-[0-9A-Z]{6}$/;
const TYPED = "qz";

// ── Putting the data back ────────────────────────────────────────────────────

test.afterAll(() => {
  test.setTimeout(90_000);
  resetDemoData();
});

// ── Finding things ───────────────────────────────────────────────────────────

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const libraryHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Library" });

const rowLink = (page: Page, name: string) => page.getByRole("link", { name: new RegExp(`^${escapeRe(name)}`) });

/** The workspace's tab bar. Hidden pages keep their own, so role queries (which skip hidden) see one. */
const tab = (page: Page, label: "Content" | "Versions" | "Usage" | "Activity") =>
  page.getByRole("navigation", { name: "Template" }).getByRole("link", { name: label });

/**
 * Waits until the point on `target` (its centre, or `at` from its top left) is not covered by another
 * element. A page change runs a view transition for a few hundred milliseconds, and while it does the
 * root element takes the pointer: a click then would be retried by Playwright with the target scrolled
 * into view a different way, which moves the very canvas these tests are watching. A person waits for
 * the screen to settle, and so does this.
 */
async function untilUncovered(target: Locator, at?: { x: number; y: number }) {
  await expect
    .poll(
      () =>
        target.evaluate((el, offset) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + (offset?.x ?? r.width / 2), r.top + (offset?.y ?? r.height / 2));
          return !!hit && (hit === el || el.contains(hit));
        }, at),
      { message: "the target is not covered (a page transition is still running)" },
    )
    .toBe(true);
}

/** A counted, human-paced click, once the target can take it. */
async function press(clicks: ClickCounter, target: Locator) {
  await untilUncovered(target);
  await clicks.click(target);
}

/** No error page: Next's own ("This page couldn't load", curly apostrophe) is what a crashed route shows. */
async function expectNoErrorPage(page: Page, what: string) {
  await expect(page.getByText(/This page couldn.t load/), `${what}: not the error page`).toHaveCount(0);
}

/** The Library, shown (not the hidden copy Next keeps behind another page), with its rows live. */
async function expectLibraryShown(page: Page, what: string) {
  await expect(page, `${what}: the Library's address`).toHaveURL(LIBRARY_URL);
  await expect(libraryHeading(page), `${what}: the Library's heading`).toBeVisible();
  await expect(rowLink(page, DRAFT).filter({ visible: true }), `${what}: its rows`).toBeVisible();
  await expectNoErrorPage(page, what);
}

/** The text of the block the caret is in, from the live document (the model, so chips and layout cannot move it). */
async function caretBlock(page: Page) {
  return (await caret(page)).block;
}

/**
 * The document on screen takes typing: click at the end of the first paragraph (a natural
 * press-and-release), type two characters, see them, take them out again, see the text as it was.
 * Leaves the document as it found it, so a Draft stays what the seed made it.
 */
async function expectEditorTakesTyping(page: Page, what: string) {
  const ed = await liveEditor(page);
  await expect(ed, `${what}: exactly one document on screen`).toHaveCount(1);
  await expect(ed, `${what}: it is editable`).toHaveAttribute("contenteditable", "true");

  const paragraph = ed.locator("p").first();
  const box = (await paragraph.boundingBox())!;
  const end = { x: box.width - 3, y: box.height - 9 };
  await untilUncovered(paragraph, end);
  await paragraph.click({ position: end, delay: 90 });
  await page.keyboard.press("End");
  await expect.poll(async () => (await caret(page)).focused, { message: `${what}: the document takes focus` }).toBe(true);

  const before = await caretBlock(page);
  await page.keyboard.type(TYPED, { delay: 18 });
  await expect
    .poll(() => caretBlock(page), { message: `${what}: the typed characters arrive` })
    .toHaveLength(before.length + TYPED.length);
  expect(await caretBlock(page), `${what}: they are the ones typed`).toContain(TYPED);

  for (let i = 0; i < TYPED.length; i++) await page.keyboard.press("Backspace");
  await expect.poll(() => caretBlock(page), { message: `${what}: removing them restores the text` }).toBe(before);
  await expectNoErrorPage(page, what);
}

/** Hover the first paragraph: the block handle (+ and grip) appears. It attaches a moment after the editor does. */
async function expectBlockHandleOnHover(page: Page, what: string) {
  const paragraph = editor(page).locator("p").first();
  const box = (await paragraph.boundingBox())!;
  await expect(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y - 30);
    await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 8 });
    await page.mouse.move(box.x + 60, box.y + box.height / 2 + 1, { steps: 4 });
    await expect(page.getByRole("button", { name: "Insert block below" })).toBeVisible({ timeout: 700 });
  }, `${what}: the block handle shows on hover`).toPass({ timeout: 10_000 });
  await expect(page.getByLabel("Drag to move block, or click for options"), `${what}: with its grip`).toBeVisible();
}

/** The draft's Content tab is what is on screen, live and typeable, with its block handle. */
async function expectContentShown(page: Page, contentUrl: string, what: string) {
  await expect(page, `${what}: the draft's address`).toHaveURL(contentUrl);
  await expect(tab(page, "Content"), `${what}: the Content tab is the current one`).toHaveAttribute("aria-current", "page");
  await expectEditorTakesTyping(page, what);
  await expectBlockHandleOnHover(page, what);
}

async function expectVersionsShown(page: Page, versionsUrl: string, what: string) {
  await expect(page, `${what}: the Versions address`).toHaveURL(versionsUrl);
  await expect(tab(page, "Versions"), `${what}: the Versions tab is the current one`).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-slot="versions"]').filter({ visible: true }), `${what}: its page`).toBeVisible();
  await expectNoErrorPage(page, what);
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Back and Forward on a Draft
// ───────────────────────────────────────────────────────────────────────────

test.describe("Back and Forward on a Draft", () => {
  test("Library → Draft → Back → Forward, three times: the editor is alive every time it is shown again", async ({ page }) => {
    test.setTimeout(150_000);
    await asPersona(page, "maya");
    await openLibrary(page);

    const clicks = clickCounter();
    await press(clicks, rowLink(page, DRAFT));
    await expect(page).toHaveURL(TEMPLATE_URL);
    const contentUrl = page.url();
    await expectContentShown(page, contentUrl, "the draft, opened from the Library");

    for (const cycle of [1, 2, 3]) {
      await page.goBack();
      await expectLibraryShown(page, `Back, round ${cycle}`);

      await page.goForward();
      await expectContentShown(page, contentUrl, `Forward, round ${cycle}`);
    }
  });

  test("Draft → Versions tab → Back → Forward → Back", async ({ page }) => {
    test.setTimeout(150_000);
    await asPersona(page, "maya");
    await openLibrary(page);

    const clicks = clickCounter();
    await press(clicks, rowLink(page, DRAFT));
    await expect(page).toHaveURL(TEMPLATE_URL);
    const contentUrl = page.url();
    const versionsUrl = `${contentUrl}/versions`;
    await expectContentShown(page, contentUrl, "the draft, opened from the Library");

    await press(clicks, tab(page, "Versions"));
    await expectVersionsShown(page, versionsUrl, "the Versions tab, opened");

    await page.goBack();
    await expectContentShown(page, contentUrl, "Back from Versions");

    await page.goForward();
    await expectVersionsShown(page, versionsUrl, "Forward to Versions");

    await page.goBack();
    await expectContentShown(page, contentUrl, "Back from Versions, again");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. One Back after create returns to the Library
// ───────────────────────────────────────────────────────────────────────────

interface Position {
  /** `history.length`: every entry of the tab, forward ones included. */
  length: number;
  /** The Navigation API's index of the entry on screen, and how many entries it lists. */
  index: number;
  entries: number;
}

const historyPosition = (page: Page): Promise<Position> =>
  page.evaluate(() => {
    const nav = (window as unknown as { navigation: { currentEntry: { index: number }; entries(): unknown[] } }).navigation;
    return { length: history.length, index: nav.currentEntry.index, entries: nav.entries().length };
  });

/** The name field: focused, editable, all of its text selected. */
async function expectNameSelected(page: Page, text: string) {
  const field = nameField(page);
  await expect(field).toBeFocused();
  await expect(field).toBeEditable();
  await expect(field).toHaveValue(text);
  const selection = await field.evaluate((el: HTMLTextAreaElement) => ({
    active: document.activeElement === el,
    start: el.selectionStart,
    end: el.selectionEnd,
    length: el.value.length,
  }));
  expect(selection).toEqual({ active: true, start: 0, end: text.length, length: text.length });
}

/**
 * New template → a starter, with human-paced clicks. Returns the history position from just before
 * the starter was picked and from once the workspace is settled and ready for the first keystroke.
 */
async function createFromStarter(page: Page, card: RegExp, name: string) {
  const clicks = clickCounter();
  await press(clicks, page.getByRole("button", { name: "New template" }));
  const gallery = page.getByRole("dialog");
  await expect(gallery).toBeVisible();

  const before = await historyPosition(page);
  await clicks.click(gallery.getByRole("button", { name: card }));

  // Landed: the template's own address (no query, no hash), the name ready to be typed over.
  await expect(page).toHaveURL(TEMPLATE_URL);
  expect(new URL(page.url()).search, "no query on the address").toBe("");
  await expectNameSelected(page, name);
  // The live document swaps in after hydration; the name keeps its focus and selection through that.
  await liveEditor(page);
  await expectNameSelected(page, name);
  expect(page.url(), "the address is still the template's own").toMatch(TEMPLATE_URL);

  return { before, after: await historyPosition(page), clicks };
}

test.describe("creating a template is one history entry", () => {
  test("three creates from fresh Libraries: the history grows by one, and one Back is the Library", async ({ page }) => {
    test.setTimeout(180_000);
    await asPersona(page, "maya");

    const starters = [
      { card: /^Blank/, name: "Untitled template" },
      { card: /^Rate change notice/, name: "Rate change notice" },
      { card: /^Fee schedule/, name: "Fee schedule" },
    ];

    for (const [i, starter] of starters.entries()) {
      // A fresh load of the Library each time, with nothing ahead of it in the history: pushing from
      // the middle of the history drops the entries ahead (the template the last Back left behind),
      // so the length could not grow by one otherwise. (Loading the Library again from the Library
      // would only replace its entry, and keep that template ahead.)
      if (i > 0) await page.goto("about:blank");
      await openLibrary(page);
      const { before, after, clicks } = await createFromStarter(page, starter.card, starter.name);
      const what = `create ${i + 1} (${starter.name})`;

      expect(clicks.count, `${what}: clicks from the Library to the name`).toBe(2);
      expect(after.length - before.length, `${what}: history.length grew by exactly one`).toBe(1);
      expect(after.index - before.index, `${what}: one entry on top of the Library`).toBe(1);
      expect(after.entries, `${what}: nothing ahead of the new entry`).toBe(after.index + 1);

      await page.goBack();
      await expectLibraryShown(page, `${what}: one Back`);
      expect(new URL(page.url()).search, `${what}: the Library's own address`).toBe("");
      const back = await historyPosition(page);
      expect(back.index, `${what}: Back stepped exactly one entry`).toBe(before.index);
      expect(back.length, `${what}: and added none`).toBe(after.length);
    }
  });

  test("create again straight after a Back: still one entry, still one Back", async ({ page }) => {
    test.setTimeout(150_000);
    await asPersona(page, "maya");
    await openLibrary(page);

    // The first create, then Back: the Library is now the page Next re-showed, with the template ahead of it.
    const first = await createFromStarter(page, /^Card offer terms/, "Card offer terms");
    expect(first.after.index - first.before.index, "the first create: one entry").toBe(1);
    await page.goBack();
    await expectLibraryShown(page, "Back from the first create");

    // The second create replaces the entry ahead: the history is no longer, and Back is the Library again.
    const second = await createFromStarter(page, /^Rate change notice/, "Rate change notice");
    expect(second.after.index - second.before.index, "the second create: one entry on top of the Library").toBe(1);
    expect(second.after.entries, "nothing ahead of it").toBe(second.after.index + 1);
    expect(second.after.length, "the entry ahead of the Library was replaced, not kept beside it").toBe(second.before.length);

    await page.goBack();
    await expectLibraryShown(page, "one Back from the second create");
    expect((await historyPosition(page)).index, "one entry back, the Library").toBe(second.before.index);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Canvas scroll: reset on a page change, restore on Back and Forward
// ───────────────────────────────────────────────────────────────────────────

// The canvas has the window's height less about 90px of frame. At 1440x600 the five-row Library
// scrolls only about 70px, too little to tell "left where it was" from "clamped", so the window is
// shorter. The offsets stay well inside what each page can scroll (checked below).
const SHORT_VIEWPORT = { width: 1440, height: 420 };
const LIBRARY_OFFSET = 200;
const TEMPLATE_OFFSET = 150;
/** Offsets are compared to within this many pixels (fractional scroll positions on a scaled display). */
const SLACK = 2;

const canvas = (page: Page): Locator => page.locator('[data-slot="canvas-scroll"]');
const canvasTop = (page: Page) => canvas(page).evaluate((el) => el.scrollTop);
const canvasRange = (page: Page) => canvas(page).evaluate((el) => el.scrollHeight - el.clientHeight);

/** Lets the browser run a few frames: scroll events, layout effects and restores all land within them. */
const frames = (page: Page, count = 3) =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const next = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => next(left - 1)));
        next(n);
      }),
    count,
  );

/** Scrolls the canvas the way the reader leaves it, and waits until the page has seen the position. */
async function scrollCanvasTo(page: Page, top: number) {
  const range = await canvasRange(page);
  expect(range, `the page can scroll to ${top}px (it has ${range}px to scroll)`).toBeGreaterThanOrEqual(top + 10);
  await canvas(page).evaluate((el, to) => el.scrollTo({ top: to, behavior: "instant" }), top);
  await frames(page);
  await expectCanvasAt(page, top, "after scrolling");
}

/** The canvas is at `top` (within a couple of pixels), and is still there a few frames later. */
async function expectCanvasAt(page: Page, top: number, what: string) {
  await expect.poll(() => canvasTop(page), { message: `${what}: canvas scrollTop ≥ ${top - SLACK}` }).toBeGreaterThanOrEqual(top - SLACK);
  await expect.poll(() => canvasTop(page), { message: `${what}: canvas scrollTop ≤ ${top + SLACK}` }).toBeLessThanOrEqual(top + SLACK);
  await frames(page);
  const settled = await canvasTop(page);
  expect(Math.abs(settled - top), `${what}: canvas scrollTop is still ${top} a few frames later (it is ${settled})`).toBeLessThanOrEqual(SLACK);
}

/**
 * A Library row that is fully on screen at the current scroll, so clicking it does not scroll
 * the canvas first (Playwright brings a link into view before it clicks).
 */
async function visibleRow(page: Page): Promise<{ href: string; name: string }> {
  const row = await canvas(page).evaluate((el) => {
    const view = el.getBoundingClientRect();
    for (const a of el.querySelectorAll<HTMLAnchorElement>("main ul > li > a[href*='/templates/']")) {
      const r = a.getBoundingClientRect();
      if (r.width > 0 && r.top >= view.top + 4 && r.bottom <= view.bottom - 4) {
        return { href: a.getAttribute("href")!, name: a.innerText.split("\n")[0]!.trim() };
      }
    }
    return null;
  });
  expect(row, "a Library row is fully on screen at this scroll").not.toBeNull();
  return row!;
}

test.describe("canvas scroll", () => {
  test.use({ viewport: SHORT_VIEWPORT });

  test("opening a template starts at the top; Back restores the Library, Forward restores the template", async ({ page }) => {
    test.setTimeout(150_000);
    await asPersona(page, "maya");
    await openLibrary(page);

    await expectCanvasAt(page, 0, "the Library, freshly loaded");
    await scrollCanvasTo(page, LIBRARY_OFFSET);

    const row = await visibleRow(page);
    const clicks = clickCounter();
    await press(clicks, page.locator(`a[href="${row.href}"]`).filter({ visible: true }));
    await expect(page).toHaveURL(new RegExp(`${escapeRe(row.href)}$`));
    await expect(tab(page, "Content")).toHaveAttribute("aria-current", "page");
    await liveEditor(page);
    await expectCanvasAt(page, 0, `${row.name}, opened from a Library scrolled to ${LIBRARY_OFFSET}`);

    // Where the reader leaves the template.
    await scrollCanvasTo(page, TEMPLATE_OFFSET);

    await page.goBack();
    await expectLibraryShown(page, "Back");
    await expectCanvasAt(page, LIBRARY_OFFSET, "Back: the Library is where it was left");

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${escapeRe(row.href)}$`));
    await expect(tab(page, "Content")).toHaveAttribute("aria-current", "page");
    await liveEditor(page);
    await expectCanvasAt(page, TEMPLATE_OFFSET, "Forward: the template is where it was left");

    // And once more round, in case the first restore only held by luck.
    await page.goBack();
    await expectLibraryShown(page, "Back, again");
    await expectCanvasAt(page, LIBRARY_OFFSET, "Back, again: the Library is where it was left");
  });

  test("a workspace tab switch starts at the top, and Back returns to where the Content tab was left", async ({ page }) => {
    test.setTimeout(150_000);
    await asPersona(page, "maya");
    await openLibrary(page);

    // The row is below the fold of this short window: the click scrolls the Library to it first
    // (where the Library ends up does not matter to this test), so no waiting for it to be uncovered.
    const clicks = clickCounter();
    await clicks.click(rowLink(page, DRAFT).filter({ visible: true }));
    await expect(page).toHaveURL(TEMPLATE_URL);
    const contentUrl = page.url();
    await liveEditor(page);
    await scrollCanvasTo(page, TEMPLATE_OFFSET);

    await press(clicks, tab(page, "Versions"));
    await expect(page).toHaveURL(`${contentUrl}/versions`);
    await expect(tab(page, "Versions")).toHaveAttribute("aria-current", "page");
    await expectCanvasAt(page, 0, "the Versions tab, opened from a scrolled Content tab");

    await page.goBack();
    await expect(page).toHaveURL(contentUrl);
    await expect(tab(page, "Content")).toHaveAttribute("aria-current", "page");
    await liveEditor(page);
    await expectCanvasAt(page, TEMPLATE_OFFSET, "Back: the Content tab is where it was left");
  });

  test("the settings modal opening over the Library does not move it", async ({ page }) => {
    test.setTimeout(150_000);
    await asPersona(page, "alex");
    await openLibrary(page);
    await scrollCanvasTo(page, LIBRARY_OFFSET);

    const clicks = clickCounter();
    await press(clicks, page.locator('[data-slot="sidebar-footer"]').getByRole("link", { name: "Settings" }));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/coral-offers\/settings\/members$/);
    await expectCanvasAt(page, LIBRARY_OFFSET, "the settings modal open: the Library behind it");
    // (The page behind a modal is inert, so it is not in the accessibility tree: find the heading by tag.)
    await expect(page.locator("main h1", { hasText: "Library" }).filter({ visible: true }), "the Library is still the page behind the modal").toBeVisible();

    // Moving between the modal's own sections is not a page change either.
    await clicks.click(dialog.getByRole("link", { name: "Recertification" }));
    await expect(page).toHaveURL(/\/settings\/recertification$/);
    await expectCanvasAt(page, LIBRARY_OFFSET, "another settings section: the Library behind it");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(LIBRARY_URL);
    await expectCanvasAt(page, LIBRARY_OFFSET, "the modal closed: the Library");
  });
});
