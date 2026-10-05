import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { removeTemplate } from "./helpers/cleanup";
import {
  asPersona,
  beat,
  caret,
  chip,
  chipsPresent,
  documentEditor,
  expect,
  expectAutosaved,
  history,
  liveEditor,
  nameField,
  openLibrary,
  shoot,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// Phase 7a gate: demo scenario 10 ("Copilot prompt").
//
//   Maya copies the generated prompt, then pastes back text containing {{purchase_apr}}, which
//   becomes a chip.
//
//   1. Maya writes a Card offer terms draft (a name, a first sentence), so there is a draft to improve.
//   2. "Copilot prompt" at the end of the rail opens "Prompt for Copilot": the prompt for her
//      template, built from the saved draft: the section headings, the placeholders as {{key}} (it
//      names {{purchase_apr}} and {{first_name}}), and her draft as Markdown.
//   3. "Copy prompt" (the one black button) puts it on the clipboard (read back here), and the button
//      says "Copied".
//   4. She closes the dialog and pastes Copilot's answer into the document: Markdown text under the
//      "Rates and fees" heading with {{purchase_apr}} in it. It becomes a chip, the heading merges into
//      the existing section (no second "Rates and fees"), the bullet list is a list.
//   5. One Cmd+Z takes the whole paste back; Cmd+Shift+Z puts it back; it autosaves.
//
// The clipboard is the browser's own (the context is granted clipboard-read and clipboard-write): Copy
// prompt is read back from it, and the answer is written to it and pasted with Cmd+V.
//
// Self-contained: creates one template; afterAll removes it by id. Console and page errors fail it.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const TEAM = "coral-offers";
const NAME = "Spring Travel Rewards — Terms";
const OFFER_SENTENCE = "Earn a $200 statement credit on your first travel purchase.";

/** Copilot's answer, as the prompt asks for it: Markdown, the required heading, placeholders in braces. */
const ANSWER = [
  "## Rates and fees",
  "",
  "Your purchase APR is {{purchase_apr}}, and it stays the same for the life of the offer.",
  "",
  "- No annual fee",
  "- No foreign transaction fee",
].join("\n");

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

const copilotRow = (page: Page) => page.getByRole("button", { name: "Copilot prompt" }).filter({ visible: true });

test("scenario 10: Maya copies the Copilot prompt, then pastes back text with {{purchase_apr}}, which becomes a chip", async ({ page }) => {
  test.setTimeout(120_000);

  await asPersona(page, "maya");
  await openLibrary(page, TEAM);
  await beat(page, 600);

  await test.step("1. A draft with some text in it", async () => {
    await tap(page.getByRole("button", { name: "New template" }));
    const gallery = page.getByRole("dialog");
    await expect(gallery).toBeVisible();
    await tap(gallery.getByRole("button", { name: /Card offer terms/ }));
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
    templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];

    await expect(nameField(page)).toBeFocused();
    await page.waitForTimeout(300);
    await page.keyboard.press("ControlOrMeta+a");
    await typeSlowly(page, NAME);
    await page.keyboard.press("Enter");
    await liveEditor(page);
    await expect.poll(async () => (await caret(page)).focused, { message: "the document has focus" }).toBe(true);
    await typeSlowly(page, OFFER_SENTENCE);
    await expect(documentEditor(page)).toContainText(OFFER_SENTENCE);
    expect(await chipsPresent(page, ["purchase_apr"]), "no purchase APR chip yet").toEqual([]);
    await expectAutosaved(page);
    await shoot(page, "01-draft");
  });

  let prompt = "";

  await test.step("2. 'Copilot prompt' opens the prompt built from the saved draft", async () => {
    await untilUncovered(copilotRow(page));
    await tap(copilotRow(page));
    const dialog = page.getByRole("dialog", { name: "Prompt for Copilot" });
    await expect(dialog).toBeVisible();

    const shown = dialog.getByLabel("Prompt");
    await expect(shown).toContainText("Help me write the body of");
    prompt = (await shown.textContent()) ?? "";

    expect(prompt).toContain(`Template: ${NAME}`);
    // The sections, exactly and in order.
    expect(prompt).toMatch(/## Offer details\n## Rates and fees\n## Legal notices/);
    // The placeholders it may use, in braces.
    expect(prompt).toContain("{{purchase_apr}}");
    expect(prompt).toContain("{{first_name}}");
    // Her draft comes with it, as Markdown.
    expect(prompt).toContain("Improve this draft:");
    expect(prompt).toContain(OFFER_SENTENCE);
    expect(prompt).toContain("| Rate or fee | What you pay |");
    await beat(page, 900);
    await shoot(page, "02-prompt");
  });

  await test.step("3. Copy prompt puts it on the clipboard", async () => {
    const dialog = page.getByRole("dialog", { name: "Prompt for Copilot" });
    const copy = dialog.getByRole("button", { name: "Copy prompt" });
    await expect(copy).toBeFocused();
    await expect(copy).toBeEnabled();
    await tap(copy);
    await expect(dialog.getByRole("status")).toHaveText("Copied");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(prompt);
    expect(clipboard).toContain("{{purchase_apr}}");
    await beat(page, 700);
    await shoot(page, "03-copied");

    await tap(dialog.getByRole("button", { name: "Close" }));
    await expect(dialog).toBeHidden();
    await expect(copilotRow(page)).toBeFocused();
  });

  const body = documentEditor(page);

  await test.step("4. Copilot's answer pasted into the document: a chip, the section merged, a list", async () => {
    // Her caret goes back into the document, at the end of the sentence she wrote.
    await tap(body.getByText(OFFER_SENTENCE));
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    const before = await body.locator("h2[data-required]").count();
    expect(before).toBe(3);

    // Copilot's answer is on the clipboard (as text), and she pastes it.
    await page.evaluate((text) => navigator.clipboard.writeText(text), ANSWER);
    await page.keyboard.press("ControlOrMeta+v");

    await expect(chip(page, "purchase_apr")).toHaveCount(1);
    await expect(chip(page, "purchase_apr")).toBeVisible();
    // The chip is in the Rates and fees section, which is still one section.
    await expect(body.locator("h2[data-required]")).toHaveText(["Offer details", "Rates and fees", "Legal notices"]);
    expect(await body.getByRole("heading", { name: "Rates and fees" }).count(), "the heading merged, not repeated").toBe(1);
    const section = await body.evaluate((root) => {
      const heading = root.querySelector('h2[data-required="rates_and_fees"]')!;
      const next = root.querySelector('h2[data-required="legal_notices"]')!;
      const between: Element[] = [];
      for (let el = heading.nextElementSibling; el && el !== next; el = el.nextElementSibling) between.push(el);
      return {
        chipInSection: between.some((el) => el.querySelector('[data-variable="purchase_apr"]')),
        lists: between.filter((el) => el.tagName === "UL").length,
      };
    });
    expect(section.chipInSection, "the chip is under Rates and fees").toBe(true);
    expect(section.lists, "the bullets became a list").toBe(1);
    await expect(body).toContainText("No foreign transaction fee");
    await expect(body).not.toContainText("{{purchase_apr}}");
    await expect(body).not.toContainText("## Rates");
    await beat(page, 700);
    await shoot(page, "04-pasted");
  });

  await test.step("5. One undo takes the paste back; redo and autosave keep it", async () => {
    await page.keyboard.press("ControlOrMeta+z");
    await expect(chip(page, "purchase_apr")).toHaveCount(0);
    await expect(body).not.toContainText("No foreign transaction fee");
    // The sentence she typed before the paste is still there: the paste was its own step.
    await expect(body).toContainText(OFFER_SENTENCE);
    expect((await history(page)).redo).toBe(true);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(chip(page, "purchase_apr")).toHaveCount(1);
    await expect(body).toContainText("No foreign transaction fee");
    await expectAutosaved(page);
  });
});
