import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  NAME,
  asPersona,
  caret,
  chip,
  chipsPresent,
  clickCounter,
  dragRowTo,
  editor,
  expect,
  expectAutosaved,
  expectVisibleFocus,
  history,
  liveEditor,
  mouseMoves,
  mousePresses,
  nameField,
  openLibrary,
  panelRow,
  pointInText,
  requiredHeading,
  test,
} from "./helpers/scenario";

// Phase 2 gate: demo scenario 2, steps 1–3 ("Create"), must feel effortless.
//
//   1. New template, pick "Card offer terms", rename it. Exactly two clicks from the Library to a focused name.
//   2. Write the offer text. Drag `first_name` in from the panel. Type {{ to insert `purchase_apr`.
//      Create `offer_end_date` (Date) inline.
//   3. Try to delete "Legal notices": it is blocked inline.
//
// Two runs of the same flow (mouse, then keyboard only), then axe on the key screens.
// Runs serially against a fresh reset (`npm run db:reset`), as Maya unless a test says otherwise.

const OFFER_TEXT = " Earn triple points on travel.";
const GREETING = "Hello! Your Spring Travel Rewards offer is ready.";
const GREETING_LOCATOR = "Spring Travel Rewards offer is ready";
const REQUIRED_NOTE = "Required for disclosures";
const SECTIONS = ["Offer details", "Rates and fees", "Legal notices"];
const CHIPS = ["first_name", "purchase_apr", "offer_end_date"] as const;
const MOD = "ControlOrMeta";
/** Caret to the end of the document: ⌘↓ on a Mac, Ctrl+End elsewhere. */
const DOC_END = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

// ── Reading and asserting ────────────────────────────────────────────────────

const docText = (page: Page) => editor(page).evaluate((el) => el.textContent ?? "");

async function expectEditorCaret(page: Page, section: string) {
  await expect.poll(async () => (await caret(page)).focused, { message: "the document has focus" }).toBe(true);
  expect((await caret(page)).section).toBe(section);
}

/** The name field: focused, editable, with all of its text selected. */
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

/** The panel row for `key`: its usage text ("Unused", "1 use"). */
async function expectUses(page: Page, key: string, uses: "Unused" | "1 use" | "2 uses") {
  await expect(panelRow(page, key)).toContainText(uses);
}

/**
 * A person needs a moment to see the new page before the first keystroke. Landing drops `?created=1`
 * from the address (a router.replace); wait for that, plus a beat, and check the name is still the
 * focused, fully selected field. (Typing before that moment can lose characters: see "keystrokes
 * during the page settling" below.)
 */
async function afterLanding(page: Page, text: string) {
  await expect(page).not.toHaveURL(/created=/);
  await page.waitForTimeout(300);
  await expectNameSelected(page, text);
}

/** Presses a caret key and waits until the editor's selection has actually moved. */
async function moveCaret(page: Page, key: string) {
  const where = async () => {
    const c = await caret(page);
    return `${c.kind}:${c.offset}:${c.block}`;
  };
  const before = await where();
  await page.keyboard.press(key);
  await expect.poll(where, { message: `${key} moves the selection` }).not.toBe(before);
}

/** Types the way a person does: a little slower than the machine can. */
const type = (page: Page, text: string) => page.keyboard.type(text, { delay: 18 });

/** The offer paragraph, found by text no chip splits. */
const greetingBlock = (page: Page) => editor(page).locator("p", { hasText: GREETING_LOCATOR });

/** The note at "Legal notices" shows, in the document and to a screen reader, and the heading is intact. */
async function expectBlocked(page: Page, what: string) {
  const heading = requiredHeading(page, "legal_notices");
  await expect(heading, `${what}: the heading is still there`).toHaveCount(1);
  await expect(heading, `${what}: with its text`).toHaveText("Legal notices");
  await expect(heading, `${what}: the note is on the heading`).toHaveAttribute("data-required-note", REQUIRED_NOTE);
  await expect
    .poll(
      () =>
        heading.evaluate((el) => {
          const style = getComputedStyle(el, "::after");
          return (
            style.content.includes("Required for disclosures") &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            parseFloat(style.opacity) > 0.5
          );
        }),
      { message: `${what}: the note "${REQUIRED_NOTE}" is painted` },
    )
    .toBe(true);
  await expect(page.getByRole("status").filter({ hasText: REQUIRED_NOTE }), `${what}: announced politely`).toHaveCount(1);
  await expectRequiredSectionsIntact(page);
}

async function expectRequiredSectionsIntact(page: Page) {
  await expect(editor(page).locator("h2[data-required]")).toHaveText(SECTIONS);
}

/** The note lasts about two seconds. Wait it out so the next attempt's note is a new one. */
async function waitForNoteToClear(page: Page) {
  await expect(requiredHeading(page, "legal_notices")).not.toHaveAttribute("data-required-note", /./, { timeout: 5_000 });
}

/** Undo until `keys` are all gone, noting the order they disappeared in. */
async function undoUntilGone(page: Page, keys: readonly string[], cap = 40) {
  const order: string[] = [];
  let present = await chipsPresent(page, keys);
  for (let i = 0; i < cap && present.length; i++) {
    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(async () => (await chipsPresent(page, keys)).length, { timeout: 1_000 }).toBeLessThanOrEqual(present.length);
    const now = await chipsPresent(page, keys);
    for (const key of present) if (!now.includes(key)) order.push(key);
    present = now;
  }
  expect(present, `still in the document after ${cap} undos`).toEqual([]);
  return order;
}

/** Redo until every one of `keys` is back, noting the order they came back in. */
async function redoUntilBack(page: Page, keys: readonly string[], cap = 40) {
  const order: string[] = [];
  let present = await chipsPresent(page, keys);
  for (let i = 0; i < cap && present.length < keys.length; i++) {
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(async () => (await chipsPresent(page, keys)).length, { timeout: 1_000 }).toBeGreaterThanOrEqual(present.length);
    const now = await chipsPresent(page, keys);
    for (const key of now) if (!present.includes(key)) order.push(key);
    present = now;
  }
  expect(present.length, `chips back after ${cap} redos`).toBe(keys.length);
  return order;
}

/**
 * Redo until the document reads `expected` again. (Not "redo everything": the select-all that was
 * undone earlier is still on the redo stack, and redoing it would clear the document again.)
 */
async function redoUntilDocument(page: Page, expected: string, cap = 40) {
  for (let i = 0; i < cap && (await docText(page)) !== expected && (await history(page)).redo; i++) {
    await page.keyboard.press(`${MOD}+Shift+z`);
    await page.waitForTimeout(40);
  }
  expect(await docText(page), "redo restores the document exactly").toBe(expected);
}

/**
 * Selects the heading as a block (a NodeSelection). Required headings have no grip, so a pointer has
 * no way to do this: ask the live editor.
 */
async function selectHeadingBlock(page: Page, requiredKey: string) {
  await page.evaluate((key) => {
    interface Node {
      attrs: Record<string, unknown>;
    }
    interface Handle {
      state: { doc: { forEach(fn: (node: Node, offset: number) => void): void } };
      chain(): { focus(): { setNodeSelection(pos: number): { run(): boolean } } };
    }
    const dom = [...document.querySelectorAll(".ProseMirror")].find((el) => (el as HTMLElement).offsetParent !== null) as
      | (HTMLElement & { editor: Handle })
      | undefined;
    if (!dom) throw new Error("no live editor on screen");
    let at = -1;
    dom.editor.state.doc.forEach((node, offset) => {
      if (node.attrs.requiredKey === key) at = offset;
    });
    if (at < 0) throw new Error(`no required heading ${key}`);
    dom.editor.chain().focus().setNodeSelection(at).run();
  }, requiredKey);
}

/** Lets entrance animations finish, so a scan or a measurement sees the settled state. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity)
            .length,
      ),
    )
    .toBe(0);
}

// ── Creating the template (shared by the mouse run and the axe scans) ─────────

/** Library → New template → Card offer terms, with every click counted. Leaves the name selected. */
async function createCardOfferTerms(page: Page) {
  const clicks = clickCounter();
  await clicks.click(page.getByRole("button", { name: "New template" }));
  const gallery = page.getByRole("dialog");
  await expect(gallery).toBeVisible();
  await clicks.click(gallery.getByRole("button", { name: /Card offer terms/ }));
  await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
  await expectNameSelected(page, "Card offer terms");
  return clicks;
}

// ───────────────────────────────────────────────────────────────────────────
// The mouse run
// ───────────────────────────────────────────────────────────────────────────

test.describe("scenario 2, steps 1–3: Create", () => {
  test("mouse run: two clicks to a selected name, rename, write, drag, {{ and inline Create, the guard, undo and redo", async ({ page }) => {
    test.setTimeout(150_000);
    await asPersona(page, "maya");
    await openLibrary(page);
    expect(await mousePresses(page), "no mouse press before the first click").toBe(0);

    await test.step("1. Exactly two clicks from the Library to a focused, editable name with all of its text selected", async () => {
      const clicks = await createCardOfferTerms(page);
      expect(clicks.count, "clicks made from the Library until the name is ready").toBe(2);
      expect(await mousePresses(page), "mouse presses the page saw").toBe(2);
      await expectNameSelected(page, "Card offer terms");
      // The query that got us here is dropped from the address bar, and the name keeps its selection.
      await afterLanding(page, "Card offer terms");
    });

    await test.step("2. Rename by typing over the selection; Enter puts the caret in Offer details", async () => {
      await type(page, NAME);
      await expect(nameField(page)).toHaveValue(NAME);
      await page.keyboard.press("Enter");
      await liveEditor(page);
      await expect(nameField(page)).not.toBeFocused();
      await expectEditorCaret(page, "Offer details");
      await expect(nameField(page)).toHaveValue(NAME);
    });

    await test.step("2. Write the offer text", async () => {
      await type(page, OFFER_TEXT);
      await page.keyboard.press("Enter");
      await type(page, GREETING);
      await expect(greetingBlock(page)).toHaveText(GREETING);
      await expectEditorCaret(page, "Offer details");
      await expect(editor(page)).toContainText(OFFER_TEXT.trim());
    });

    await test.step("2. Drag first_name from the panel into the text", async () => {
      await expectUses(page, "first_name", "Unused");
      await expect(chip(page, "first_name")).toHaveCount(0);

      const target = await pointInText(greetingBlock(page), "Hello".length);
      await dragRowTo(page, panelRow(page, "first_name"), target);

      await expect(chip(page, "first_name")).toHaveCount(1);
      await expect(greetingBlock(page).locator('[data-variable="first_name"]'), "it landed in the paragraph it was dropped on").toHaveCount(1);
      await expect(chip(page, "first_name")).toHaveText("First name");
      await expectUses(page, "first_name", "1 use");
      await expectEditorCaret(page, "Offer details");
    });

    await test.step("2. Type {{pur and pick Purchase APR with Enter", async () => {
      await expectUses(page, "purchase_apr", "Unused");
      await page.keyboard.press("End");
      await type(page, " Your purchase APR is {{pur");
      const picker = page.getByRole("option");
      await expect(picker.filter({ hasText: "Purchase APR" })).toBeVisible();
      await expect(picker.filter({ hasText: "purchase_apr" })).toHaveAttribute("data-selected", "true");
      await page.keyboard.press("Enter");
      await expect(picker).toHaveCount(0);
      await expect(chip(page, "purchase_apr")).toHaveCount(1);
      await expect(chip(page, "purchase_apr")).toHaveText("Purchase APR");
      await expectUses(page, "purchase_apr", "1 use");
      // No raw `{{pur` left behind.
      expect(await docText(page)).not.toContain("{{");
    });

    await test.step("2. Type {{Offer end date, choose Create, set the Type to Date", async () => {
      await type(page, " until {{Offer end date");
      const create = page.getByRole("option", { name: /Create/ });
      await expect(create).toHaveCount(1);
      await expect(create).toContainText("Offer end date");
      await expect(create).toHaveAttribute("data-selected", "true");
      await page.keyboard.press("Enter");

      const form = page.getByRole("form", { name: "New variable" });
      await expect(form).toBeVisible();
      await expect(form.getByLabel("Label"), "focus is in Label").toBeFocused();
      await expect(form.getByLabel("Label"), "prefilled").toHaveValue("Offer end date");
      await expect(form.getByLabel("Key")).toHaveValue("offer_end_date");

      const clicks = clickCounter();
      await clicks.click(form.getByRole("combobox"));
      await clicks.click(page.getByRole("option", { name: "Date" }));
      await expect(form.getByRole("combobox")).toHaveText(/Date/);
      // The list closes and focus is back on the trigger; Enter there saves the variable.
      await expect(page.getByRole("option")).toHaveCount(0);
      await expect(form.getByRole("combobox")).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(form).toBeHidden();
      await expect(chip(page, "offer_end_date")).toHaveCount(1);
      await expect(chip(page, "offer_end_date")).toHaveText("Offer end date");
      await expect(chip(page, "offer_end_date")).toHaveAttribute("data-variable-type", "date");
      await expect(panelRow(page, "offer_end_date"), "a new row in the panel").toBeVisible();
      await expect(panelRow(page, "offer_end_date")).toContainText("offer_end_date");
      await expectUses(page, "offer_end_date", "1 use");
      await expectEditorCaret(page, "Offer details");
      await type(page, ".");

      // The panel row is a Date: its edit form says so.
      await page.getByRole("button", { name: "Edit Offer end date" }).click({ delay: 90 });
      await expect(page.getByRole("form", { name: "Edit Offer end date" }).getByRole("combobox")).toHaveText(/Date/);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("form", { name: "Edit Offer end date" })).toBeHidden();
      expect(await docText(page)).not.toContain("{{");
    });

    const filled = await docText(page);
    for (const key of CHIPS) await expect(chip(page, key)).toHaveCount(1);

    await test.step("3. Deleting Legal notices is blocked inline: (a) triple-click the text, Backspace", async () => {
      const legal = requiredHeading(page, "legal_notices");
      await legal.click({ clickCount: 3, delay: 60 });
      const selected = await caret(page);
      expect(selected.section).toBe("Legal notices");
      expect(selected.empty, "the heading text is selected").toBe(false);
      await page.keyboard.press("Backspace");
      await expectBlocked(page, "triple-click + Backspace");
      expect(await docText(page)).toBe(filled);
      await waitForNoteToClear(page);
    });

    await test.step("3. (b) click the heading, select the block, Delete", async () => {
      const legal = requiredHeading(page, "legal_notices");
      await legal.click({ delay: 90 });
      await selectHeadingBlock(page, "legal_notices");
      expect((await caret(page)).kind).toBe("NodeSelection");
      await page.keyboard.press("Delete");
      await expectBlocked(page, "block selected + Delete");
      expect(await docText(page)).toBe(filled);
      await waitForNoteToClear(page);
    });

    await test.step("3. (c) select all, Backspace; the sections stay; Undo brings the document back", async () => {
      await requiredHeading(page, "legal_notices").click({ delay: 90 });
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.press("Backspace");
      await expectRequiredSectionsIntact(page);
      for (const key of CHIPS) await expect(chip(page, key)).toHaveCount(0);
      expect(await docText(page)).not.toBe(filled);

      await page.keyboard.press(`${MOD}+z`);
      await expect.poll(() => docText(page), { message: "one Undo brings everything back" }).toBe(filled);
      await expectRequiredSectionsIntact(page);
      for (const key of CHIPS) await expect(chip(page, key)).toHaveCount(1);
    });

    await test.step("Undo removes the chips and Redo restores them, newest first and oldest first", async () => {
      expect(await undoUntilGone(page, CHIPS)).toEqual(["offer_end_date", "purchase_apr", "first_name"]);
      await expectUses(page, "first_name", "Unused");
      await expectUses(page, "purchase_apr", "Unused");
      await expectRequiredSectionsIntact(page);

      expect(await redoUntilBack(page, CHIPS)).toEqual(["first_name", "purchase_apr", "offer_end_date"]);
      await redoUntilDocument(page, filled);
      for (const key of CHIPS) await expectUses(page, key, "1 use");
      await expect(chip(page, "offer_end_date")).toHaveAttribute("data-variable-type", "date");
    });

    await test.step("Autosave: Saved, and after a reload the name, the text and the three chips are still there", async () => {
      await expectAutosaved(page);
      await page.reload();
      await liveEditor(page);
      await expect(nameField(page)).toHaveValue(NAME);
      await expect(editor(page)).toContainText(OFFER_TEXT.trim());
      await expect(greetingBlock(page)).toContainText("Your purchase APR is");
      for (const key of CHIPS) await expect(chip(page, key)).toHaveCount(1);
      await expect(chip(page, "offer_end_date"), "the variable's type was saved too").toHaveAttribute("data-variable-type", "date");
      expect(await docText(page)).toBe(filled);
      for (const key of CHIPS) await expectUses(page, key, "1 use");
      await expect(panelRow(page, "offer_end_date")).toContainText("offer_end_date");
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The keyboard-only run
// ───────────────────────────────────────────────────────────────────────────

/** Tab (or Shift+Tab) until `target` has focus. Returns how many presses it took. */
async function tabTo(page: Page, target: Locator, what: string, cap = 40, key = "Tab") {
  for (let presses = 1; presses <= cap; presses++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return presses;
  }
  throw new Error(`${what}: not reached with ${cap} presses of ${key}`);
}

/** Arrow keys in the document until the caret is in the block with this text. */
async function arrowTo(page: Page, key: "ArrowUp" | "ArrowDown", block: string, cap = 40) {
  for (let presses = 0; presses < cap; presses++) {
    if ((await caret(page)).block === block) return;
    await page.keyboard.press(key);
    await page.waitForTimeout(25);
  }
  throw new Error(`the caret never reached "${block}" with ${cap} ${key} presses`);
}

test.describe("scenario 2, steps 1–3: Create, keyboard only", () => {
  test("keyboard-only run: the same flow with no mouse at all after the page loads", async ({ page }) => {
    test.setTimeout(150_000);
    await asPersona(page, "maya");
    await openLibrary(page);

    await test.step("1. Tab to New template, Enter opens the gallery, Esc closes it and gives focus back", async () => {
      const newTemplate = page.getByRole("button", { name: "New template" });
      await tabTo(page, newTemplate, "New template");
      await expectVisibleFocus(newTemplate, "New template");

      await page.keyboard.press("Enter");
      const gallery = page.getByRole("dialog");
      await expect(gallery).toBeVisible();
      await expectVisibleFocus(gallery.getByRole("button", { name: /^Blank/ }), "the first card (Blank)");

      await page.keyboard.press("Escape");
      await expect(gallery).toBeHidden();
      await expectVisibleFocus(newTemplate, "New template, after Esc");
    });

    await test.step("1. Enter, the arrow keys to Card offer terms, Enter: the name is ready", async () => {
      await page.keyboard.press("Enter");
      const gallery = page.getByRole("dialog");
      await expect(gallery).toBeVisible();
      // The dialog opens with Blank focused (Base UI applies initial focus a frame after the popup
      // shows, so wait for it rather than racing it with Tab).
      await expect(gallery.getByRole("button", { name: /^Blank/ }), "Blank is focused on open").toBeFocused();

      // Focus stays inside the dialog both ways round.
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role='dialog']"))).toBe(true);
      await page.keyboard.press("Shift+Tab");
      await expectVisibleFocus(gallery.getByRole("button", { name: /^Blank/ }), "the first card (Blank)");

      await page.keyboard.press("ArrowRight");
      const card = gallery.getByRole("button", { name: /^Card offer terms/ });
      await expectVisibleFocus(card, "Card offer terms");
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
      await expectNameSelected(page, "Card offer terms");
      await expectVisibleFocus(nameField(page), "the name");
      await afterLanding(page, "Card offer terms");
    });

    await test.step("2. Type the new name over the selection, Enter: the caret is in Offer details", async () => {
      await type(page, NAME);
      await page.keyboard.press("Enter");
      await liveEditor(page);
      await expectEditorCaret(page, "Offer details");
      await expect(nameField(page)).toHaveValue(NAME);
    });

    await test.step("2. Write the offer text", async () => {
      await type(page, OFFER_TEXT);
      await page.keyboard.press("Enter");
      await type(page, GREETING);
      await expect(greetingBlock(page)).toHaveText(GREETING);
    });

    await test.step("2. A panel row inserts first_name at the caret: Tab to the row, Enter", async () => {
      await expectUses(page, "first_name", "Unused");
      await page.keyboard.press("Home");
      for (let i = 0; i < "Hello".length; i++) await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await caret(page)).offset).toBe("Hello".length);

      const row = page.getByRole("button", { name: "Insert First name" });
      await tabTo(page, row, "the First name row");
      await expectVisibleFocus(row, "the First name row");
      await page.keyboard.press("Enter");

      await expect(chip(page, "first_name")).toHaveCount(1);
      await expect(greetingBlock(page).locator('[data-variable="first_name"]')).toHaveCount(1);
      await expectUses(page, "first_name", "1 use");
      await expectEditorCaret(page, "Offer details");
    });

    await test.step("2. {{pur, Enter: Purchase APR", async () => {
      await page.keyboard.press("End");
      await type(page, " Your purchase APR is {{pur");
      await expect(page.getByRole("option").filter({ hasText: "purchase_apr" })).toHaveAttribute("data-selected", "true");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("option")).toHaveCount(0);
      await expect(chip(page, "purchase_apr")).toHaveCount(1);
      await expectUses(page, "purchase_apr", "1 use");
    });

    await test.step("2. {{Offer end date, Create, Tab to Type, open it, arrows to Date, Enter, Enter", async () => {
      await type(page, " until {{Offer end date");
      await expect(page.getByRole("option", { name: /Create/ })).toHaveAttribute("data-selected", "true");
      await page.keyboard.press("Enter");

      const form = page.getByRole("form", { name: "New variable" });
      await expectVisibleFocus(form.getByLabel("Label"), "Label");
      await expect(form.getByLabel("Label")).toHaveValue("Offer end date");

      await page.keyboard.press("Tab");
      await expectVisibleFocus(form.getByLabel("Key"), "Key");
      await expect(form.getByLabel("Key")).toHaveValue("offer_end_date");

      await page.keyboard.press("Tab");
      const typeSelect = form.getByRole("combobox");
      await expectVisibleFocus(typeSelect, "Type");
      await page.keyboard.press("Space");
      const options = page.getByRole("option");
      await expect(options).toHaveText(["Text", "Currency", "Percent", "Date", "Number", "US state"]);
      for (let presses = 0; presses < 8; presses++) {
        if ((await page.evaluate(() => document.activeElement?.textContent)) === "Date") break;
        await page.keyboard.press("ArrowDown");
      }
      await expect(page.getByRole("option", { name: "Date" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(typeSelect).toHaveText(/Date/);
      await expectVisibleFocus(typeSelect, "Type, after choosing");
      await page.keyboard.press("Enter");

      await expect(form).toBeHidden();
      await expect(chip(page, "offer_end_date")).toHaveCount(1);
      await expect(chip(page, "offer_end_date")).toHaveAttribute("data-variable-type", "date");
      await expect(panelRow(page, "offer_end_date")).toContainText("offer_end_date");
      await expectUses(page, "offer_end_date", "1 use");
      await expectEditorCaret(page, "Offer details");
      await type(page, ".");
    });

    const filled = await docText(page);

    await test.step("Arrow onto a chip, Enter shows what it is", async () => {
      await moveCaret(page, "ArrowLeft"); // before the "."
      await moveCaret(page, "ArrowLeft"); // onto the chip: selected
      expect((await caret(page)).kind).toBe("NodeSelection");
      await page.keyboard.press("Enter");
      const popover = page.getByRole("dialog").filter({ hasText: "offer_end_date" });
      await expect(popover).toBeVisible();
      await expect(popover).toContainText("Offer end date");
      await expect(popover).toContainText("Date");
      await page.keyboard.press("Escape");
      await expect(popover).toBeHidden();
      await expect(chip(page, "offer_end_date")).toHaveCount(1);
    });

    await test.step("3. Arrow up to Legal notices, select its text with the keyboard, Backspace: blocked", async () => {
      await page.keyboard.press(DOC_END);
      await arrowTo(page, "ArrowUp", "Legal notices");
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await expect.poll(async () => (await caret(page)).empty).toBe(false);
      await page.keyboard.press("Backspace");
      await expectBlocked(page, "Shift+End + Backspace");
      await waitForNoteToClear(page);

      // Typing over the selected title is refused as well.
      await page.keyboard.type("x");
      await expectBlocked(page, "typing over the title");
      await waitForNoteToClear(page);

      // Backspace at the very start of the title must not pull it into the line above.
      await page.keyboard.press("Home");
      await expect.poll(async () => (await caret(page)).offset).toBe(0);
      await page.keyboard.press("Backspace");
      await expectBlocked(page, "Backspace at the start of the title");
      expect(await docText(page)).toBe(filled);
      await waitForNoteToClear(page);

      // Delete at the end of the line above does the same from the other side.
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Delete");
      await expectBlocked(page, "Delete at the end of the line above the title");
      expect(await docText(page)).toBe(filled);
    });

    await test.step("3. Select all, Backspace: the sections stay; Undo brings the document back", async () => {
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.press("Backspace");
      await expectRequiredSectionsIntact(page);
      for (const key of CHIPS) await expect(chip(page, key)).toHaveCount(0);
      await page.keyboard.press(`${MOD}+z`);
      await expect.poll(() => docText(page)).toBe(filled);
      for (const key of CHIPS) await expect(chip(page, key)).toHaveCount(1);
    });

    await test.step("Undo and Redo by key cover every chip", async () => {
      expect(await undoUntilGone(page, CHIPS)).toEqual(["offer_end_date", "purchase_apr", "first_name"]);
      expect(await redoUntilBack(page, CHIPS)).toEqual(["first_name", "purchase_apr", "offer_end_date"]);
      await redoUntilDocument(page, filled);
    });

    await test.step("Autosave, reload: it is all still there; and not one mouse press happened", async () => {
      expect(await mousePresses(page), "mouse presses since the page loaded").toBe(0);
      expect(await mouseMoves(page), "mouse moves since the page loaded").toBe(0);
      await expectAutosaved(page);
      await page.reload();
      await liveEditor(page);
      await expect(nameField(page)).toHaveValue(NAME);
      expect(await docText(page)).toBe(filled);
      for (const key of CHIPS) await expect(chip(page, key)).toHaveCount(1);
      expect(await mousePresses(page)).toBe(0);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Typing straight away
// ───────────────────────────────────────────────────────────────────────────

test.describe("scenario 2, step 1: the name is ready the moment the page lands", () => {
  // Landing drops `?created=1` from the address with a router.replace. A keystroke that lands just
  // before that commit has been seen to come back out of the field: the typing below starts the
  // moment the name has focus and runs through the settle, on a slow connection (the first autosave
  // is still in flight while the author keeps typing). The race is narrow, so a few new templates
  // are tried; any lost character fails the test.
  test("keystrokes during the page settling are not lost", async ({ page }) => {
    test.setTimeout(120_000);
    await asPersona(page, "maya");
    await page.route("**/api/drafts/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue().catch(() => undefined);
    });

    const typed = `${NAME} — a second pass over the offer terms, kept short, with the dates written out in full`;
    expect(typed.length, "stays under the 120-character name limit").toBeLessThan(120);

    const lost: string[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      await openLibrary(page);
      const clicks = await createCardOfferTerms(page);
      expect(clicks.count).toBe(2);
      await page.keyboard.type(typed, { delay: 7 });
      await expect(page).not.toHaveURL(/created=/);
      await page.waitForTimeout(400);
      const value = await nameField(page).inputValue();
      if (value !== typed) lost.push(`attempt ${attempt}: typed ${JSON.stringify(typed)}, the field holds ${JSON.stringify(value)}`);
    }
    await page.unrouteAll({ behavior: "wait" });
    expect(lost, "characters lost while typing as the page settled").toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// axe: WCAG 2.1 A and AA
// ───────────────────────────────────────────────────────────────────────────

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * axe cannot judge the contrast of one- or two-character text ("too short to determine if it is
 * actual text content") and reports it as "incomplete", which would hide a failing count or badge.
 * Work those out directly: text colour against the colours painted behind it, AA for normal text.
 */
async function shortTextContrast(page: Page, selectors: string[]): Promise<string[]> {
  return page.evaluate((list) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: number[], bottom: number[]): [number, number, number, number] => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      const mix = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / (a || 1);
      return [mix(0), mix(1), mix(2), a];
    };
    const luminance = ([r, g, b]: number[]) => {
      const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const failures: string[] = [];
    for (const selector of list) {
      const el = document.querySelector(selector);
      if (!el) continue;
      let back: [number, number, number, number] = [255, 255, 255, 1];
      const layers: [number, number, number, number][] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        layers.push(rgba(getComputedStyle(node).backgroundColor));
      }
      for (const layer of layers.reverse()) back = over(layer, back);
      const style = getComputedStyle(el);
      const text = over(rgba(style.color), back);
      const [hi, lo] = [luminance(text), luminance(back)].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        failures.push(`${selector}: "${el.textContent}" contrast ${ratio.toFixed(2)}:1 (${style.color} on rgb(${back.slice(0, 3).map(Math.round)}), ${size}px)`);
      }
    }
    return failures;
  }, selectors);
}

async function scan(page: Page, screen: string) {
  await settled(page);
  const { violations, incomplete } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes
        .slice(0, 4)
        .map((n) => `    ${n.target.join(" ")}\n      ${n.html.slice(0, 160)}\n      ${(n.failureSummary ?? "").split("\n").slice(1, 3).join(" / ")}`)
        .join("\n"),
  );

  // What axe left undecided: short text goes through the check above, the rest is noted for a person.
  const shortText = incomplete
    .filter((item) => item.id === "color-contrast")
    .flatMap((item) => item.nodes)
    .filter((node) => node.any.some((check) => /too short/.test(check.message ?? "")))
    .map((node) => node.target.join(" "));
  const shortFailures = await shortTextContrast(page, shortText);
  if (shortFailures.length) report.push(`color-contrast (short text, measured directly):\n    ${shortFailures.join("\n    ")}`);
  for (const item of incomplete) {
    test.info().annotations.push({ type: "axe needs review", description: `${screen}: ${item.id} (${item.nodes.length} nodes)` });
  }

  expect.soft(report, `axe violations on ${screen}`).toEqual([]);
}

test.describe("axe, WCAG 2.1 A and AA", () => {
  test("the Library", async ({ page }) => {
    await asPersona(page, "maya");
    await openLibrary(page);
    await scan(page, "the Library");
  });

  test("the starter gallery, open", async ({ page }) => {
    await asPersona(page, "maya");
    await openLibrary(page);
    await page.getByRole("button", { name: "New template" }).click({ delay: 90 });
    await expect(page.getByRole("dialog").getByRole("button", { name: /Card offer terms/ })).toBeVisible();
    await scan(page, "the starter gallery");
  });

  test("the editable workspace, with the {{ picker and a chip popover open", async ({ page }) => {
    await asPersona(page, "maya");
    await openLibrary(page);
    await createCardOfferTerms(page);
    await afterLanding(page, "Card offer terms");
    await type(page, NAME);
    await page.keyboard.press("Enter");
    await liveEditor(page);
    await expectEditorCaret(page, "Offer details");
    await scan(page, "the editable workspace (Maya's new template)");

    // The {{ picker.
    await page.keyboard.press("Enter");
    await type(page, "{{");
    await expect(page.getByRole("option").first()).toBeVisible();
    await scan(page, "the workspace with the {{ picker open");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toHaveCount(0);

    // A chip popover: the starter's Home state chip.
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await chip(page, "home_state").click({ delay: 90 });
    const popover = page.getByRole("dialog").filter({ hasText: "home_state" });
    await expect(popover).toBeVisible();
    await scan(page, "the workspace with a chip popover open");
  });

  test("the read-only workspace (Priya on a Deposits template)", async ({ page }) => {
    await asPersona(page, "priya");
    await openLibrary(page, "deposits");
    await page.getByRole("link", { name: /^Everyday Checking — Fee Schedule/ }).click({ delay: 90 });
    await expect(page.getByRole("heading", { level: 1, name: "Everyday Checking — Fee Schedule" })).toBeVisible();
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    const ed = await liveEditor(page);
    await expect(ed).toHaveAttribute("contenteditable", "false");
    await scan(page, "the read-only workspace");
  });
});
