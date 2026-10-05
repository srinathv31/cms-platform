import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { allVersions, correlation, expectError, openDb, render, validValues } from "./api/helpers";
import {
  NAME,
  asPersona,
  caret,
  clickCounter,
  documentEditor,
  dragRowTo,
  expect,
  expectAutosaved,
  liveEditor,
  liveField,
  mousePresses,
  nameField,
  openLibrary,
  panelRow,
  pointInText,
  requiredHeading,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// Phase 3 gate: demo scenario 2 ("Create"), all five steps, as Maya, from the Library.
//
//   1. New template, pick "Card offer terms", rename it. Two clicks from the Library to typing.
//   2. Write the offer text: drag `first_name` in, type {{ for `purchase_apr`, create `offer_end_date` (Date).
//   3. Try to delete "Legal notices": blocked inline.
//   4. Preview. Email on, with {{first_name}} in the subject and a preheader. PDF, Web and Email with the
//      "Typical customer" and "Long name and maximum values" sets; Download PDF; a value edited in the
//      sample-set editor; a word typed into the document while previewing.
//   5. Submit: v1, In review, read-only. Then the render API: a consumer is refused, a preview is not,
//      and render_log tags the previews.
//
// Steps 1–3 are the Phase 2 gate (scenario-02a.spec.ts) in short form; this spec carries on from there.
// Runs against a fresh reset (`npm run db:reset`), as Maya. Console and page errors fail it.

/** Typed at the end of the first paragraph, where the caret lands: the leading space joins it to the sentence before. */
const OFFER_SENTENCE = "Earn triple points on travel.";
const OFFER_TEXT = ` ${OFFER_SENTENCE}`;
const GREETING = "Hello! Your Spring Travel Rewards offer is ready.";
const GREETING_LOCATOR = "Spring Travel Rewards offer is ready";
const REQUIRED_NOTE = "Required for disclosures";
const SECTIONS = ["Offer details", "Rates and fees", "Legal notices"];
const CHIPS = ["first_name", "purchase_apr", "offer_end_date"] as const;

const SUBJECT_TAIL = ", your Spring Travel Rewards terms";
const PREHEADER = "See your rates, fees and offer end date.";
/** Typed into the document while the preview is open. */
const LATE_WORD = "Enjoy";

const TYPICAL = "Typical customer";
const LONG = "Long name and maximum values";
const TYPICAL_NAME = "Maya";
const LONG_NAME = "Alexandria-Marguerite";
const EDITED_NAME = "Jordan";
/** The purchase APR in each set (the seed's sample values, src/server/seed/variables.ts). */
const TYPICAL_APR = "21.99%";
const LONG_APR = "29.99%";

type ChannelLabel = "PDF" | "Web" | "Email";

// ── Small things ─────────────────────────────────────────────────────────────

/** A human-paced click: a real press and release, about 90ms apart. */
const tap = (target: Locator, options?: Parameters<Locator["click"]>[0]) => target.click({ delay: 90, ...options });

/** A beat: the time a person takes to see what happened before the next move. */
const beat = (page: Page, ms = 150) => page.waitForTimeout(ms);

/** Text compared without any whitespace: a PDF breaks lines and splits runs wherever it likes. */
const compact = (text: string) => text.replace(/\s+/g, "");

const docText = (page: Page) => documentEditor(page).evaluate((el) => el.textContent ?? "");

const greetingBlock = (page: Page) => documentEditor(page).locator("p", { hasText: GREETING_LOCATOR });
const docChip = (page: Page, key: string) => documentEditor(page).locator(`[data-variable="${key}"]`);

// ── Steps 1–3 ────────────────────────────────────────────────────────────────

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

async function expectEditorCaret(page: Page, section: string) {
  await expect.poll(async () => (await caret(page)).focused, { message: "the document has focus" }).toBe(true);
  expect((await caret(page)).section).toBe(section);
}

/** The note at "Legal notices" shows, in the document and to a screen reader, and the heading is intact. */
async function expectBlocked(page: Page) {
  const heading = requiredHeading(page, "legal_notices");
  await expect(heading, "the heading is still there").toHaveCount(1);
  await expect(heading).toHaveText("Legal notices");
  await expect(heading, "the note is on the heading").toHaveAttribute("data-required-note", REQUIRED_NOTE);
  await expect
    .poll(
      () =>
        heading.evaluate((el) => {
          const style = getComputedStyle(el, "::after");
          return style.content.includes("Required for disclosures") && style.display !== "none" && style.visibility !== "hidden";
        }),
      { message: `the note "${REQUIRED_NOTE}" is painted` },
    )
    .toBe(true);
  await expect(page.getByRole("status").filter({ hasText: REQUIRED_NOTE }), "announced politely").toHaveCount(1);
  await expect(documentEditor(page).locator("h2[data-required]"), "all three required sections remain").toHaveText(SECTIONS);
}

async function create(page: Page) {
  await test.step("1. New template, Card offer terms, renamed: two clicks to typing", async () => {
    const clicks = clickCounter();
    await clicks.click(page.getByRole("button", { name: "New template" }));
    const gallery = page.getByRole("dialog");
    await expect(gallery).toBeVisible();
    await clicks.click(gallery.getByRole("button", { name: /Card offer terms/ }));
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
    await expectNameSelected(page, "Card offer terms");
    expect(clicks.count, "clicks from the Library to a selected name").toBe(2);
    expect(await mousePresses(page), "mouse presses the page saw").toBe(2);

    // A beat to see the new page, then typing replaces the selected name; Enter goes to the document.
    await expect(page).not.toHaveURL(/created=/);
    await beat(page, 300);
    await expectNameSelected(page, "Card offer terms");
    await typeSlowly(page, NAME);
    await expect(nameField(page)).toHaveValue(NAME);
    await page.keyboard.press("Enter");
    await liveEditor(page);
    await expect(nameField(page)).not.toBeFocused();
    await expectEditorCaret(page, "Offer details");
    await expect(nameField(page)).toHaveValue(NAME);
  });

  await test.step("2. Write the offer text: drag first_name, {{ for purchase_apr, create offer_end_date", async () => {
    await typeSlowly(page, OFFER_TEXT);
    await page.keyboard.press("Enter");
    await typeSlowly(page, GREETING);
    await expect(greetingBlock(page)).toHaveText(GREETING);

    // Drag first_name in from the panel, after "Hello".
    await expect(panelRow(page, "first_name")).toContainText("Unused");
    await dragRowTo(page, panelRow(page, "first_name"), await pointInText(greetingBlock(page), "Hello".length));
    await expect(docChip(page, "first_name")).toHaveCount(1);
    await expect(greetingBlock(page).locator('[data-variable="first_name"]'), "it landed where it was dropped").toHaveCount(1);
    await expect(panelRow(page, "first_name")).toContainText("1 use");

    // {{pur → Purchase APR, with Enter.
    await page.keyboard.press("End");
    await typeSlowly(page, " Your purchase APR is {{pur");
    const picker = page.getByRole("option");
    await expect(picker.filter({ hasText: "Purchase APR" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(docChip(page, "purchase_apr")).toHaveCount(1);
    await expect(panelRow(page, "purchase_apr")).toContainText("1 use");

    // {{Offer end date → Create → Type: Date → Enter saves it.
    await typeSlowly(page, " until {{Offer end date");
    const createOption = page.getByRole("option", { name: /Create/ });
    await expect(createOption).toContainText("Offer end date");
    await page.keyboard.press("Enter");
    const form = page.getByRole("form", { name: "New variable" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Label"), "focus is in Label").toBeFocused();
    await expect(form.getByLabel("Key")).toHaveValue("offer_end_date");
    await tap(form.getByRole("combobox"));
    await tap(page.getByRole("option", { name: "Date" }));
    await expect(form.getByRole("combobox")).toHaveText(/Date/);
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(form.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(form).toBeHidden();
    await expect(docChip(page, "offer_end_date")).toHaveCount(1);
    await expect(docChip(page, "offer_end_date")).toHaveAttribute("data-variable-type", "date");
    await expect(panelRow(page, "offer_end_date")).toContainText("1 use");
    await expectEditorCaret(page, "Offer details");
    await typeSlowly(page, ".");
    expect(await docText(page)).not.toContain("{{");
  });

  await test.step("3. Deleting Legal notices is blocked inline", async () => {
    const before = await docText(page);
    const legal = requiredHeading(page, "legal_notices");
    await legal.click({ clickCount: 3, delay: 60 });
    const selected = await caret(page);
    expect(selected.section).toBe("Legal notices");
    expect(selected.empty, "the heading text is selected").toBe(false);
    await page.keyboard.press("Backspace");
    await expectBlocked(page);
    expect(await docText(page), "nothing was deleted").toBe(before);
    for (const key of CHIPS) await expect(docChip(page, key)).toHaveCount(1);
    await expect(requiredHeading(page, "legal_notices")).not.toHaveAttribute("data-required-note", /./, { timeout: 5_000 });
  });
}

// ── The preview ──────────────────────────────────────────────────────────────

const previewToggle = (page: Page) => page.getByRole("button", { name: "Preview", exact: true });
/** The widened rail while the preview is open. */
const rail = (page: Page) => page.locator("aside[aria-label='Preview']");
const channelTab = (page: Page, label: ChannelLabel) =>
  rail(page).getByRole("group", { name: "Channel", exact: true }).getByRole("button", { name: label, exact: true });
const setTrigger = (page: Page) => rail(page).getByRole("button", { name: /^Sample set:/ });

async function showChannel(page: Page, label: ChannelLabel) {
  await tap(channelTab(page, label));
  await expect(channelTab(page, label)).toHaveAttribute("aria-pressed", "true");
}

async function showSet(page: Page, name: string) {
  await tap(setTrigger(page));
  await tap(page.getByRole("menuitemradio", { name, exact: true }));
  await expect(setTrigger(page)).toHaveAccessibleName(`Sample set: ${name}`);
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** "Edit values…", set one value, close the editor. */
async function editValue(page: Page, setName: string, label: string, value: string) {
  await tap(setTrigger(page));
  await tap(page.getByRole("menuitem", { name: "Edit values…" }));
  const popup = page.getByRole("dialog", { name: `${setName}: edit values` });
  await expect(popup).toBeVisible();
  const field = popup.getByLabel(label, { exact: true });
  // Base UI hands the popover its initial focus a frame after it shows: wait for it before typing.
  await expect(field).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await typeSlowly(page, value);
  await expect(field).toHaveValue(value);
  await page.keyboard.press("Enter"); // commits; the preview re-renders from it
  await page.keyboard.press("Escape"); // closes the popover, not the preview
  await expect(popup).toBeHidden();
  await expect(previewToggle(page), "Escape in the editor leaves the preview open").toHaveAttribute("aria-pressed", "true");
}

// PDF ─────────────────────────────────────────────────────────────────────────

const pdfRegion = (page: Page) => page.getByRole("region", { name: "PDF preview" });
const pdfPages = (page: Page) => pdfRegion(page).getByRole("group", { name: /^Page \d+ of \d+$/ });

/** What each drawn page's text layer says, one string per page. */
const pdfPageTexts = (page: Page) =>
  pdfRegion(page).evaluate((region) =>
    [...region.querySelectorAll<HTMLElement>('[role="group"]')].map((sheet) =>
      [...sheet.querySelectorAll("span")]
        .filter((span) => !span.querySelector("span"))
        .map((span) => span.textContent ?? "")
        .join(" "),
    ),
  );

const pdfText = async (page: Page) => (await pdfPageTexts(page)).join("\n");

/** Waits until the PDF's text layer holds `texts` (whitespace aside); the old render stays up until the new one is in. */
async function expectPdfText(page: Page, ...texts: string[]) {
  for (const text of texts) {
    await expect
      .poll(async () => compact(await pdfText(page)), { message: `the PDF says "${text}"`, timeout: 20_000 })
      .toContain(compact(text));
  }
}

/** Scrolls through the pages so every one has been drawn (the viewer only draws what is near). */
async function drawEveryPage(page: Page) {
  const pages = pdfPages(page);
  const count = await pages.count();
  for (let i = 0; i < count; i++) {
    await pages.nth(i).scrollIntoViewIfNeeded();
    await expect.poll(() => pages.nth(i).locator("span").count(), { message: `page ${i + 1} has its text` }).toBeGreaterThan(0);
  }
  return count;
}

/** Every text run's box against its page's box: what is outside the paper. */
const pdfOutsideThePaper = (page: Page) =>
  pdfRegion(page).evaluate((region) => {
    const outside: string[] = [];
    let runs = 0;
    const sheets = [...region.querySelectorAll<HTMLElement>('[role="group"]')];
    sheets.forEach((sheet, i) => {
      const paper = sheet.getBoundingClientRect();
      for (const span of sheet.querySelectorAll("span")) {
        if (span.querySelector("span") || !(span.textContent ?? "").trim()) continue;
        runs++;
        const box = span.getBoundingClientRect();
        const tolerance = 1;
        if (
          box.left < paper.left - tolerance ||
          box.right > paper.right + tolerance ||
          box.top < paper.top - tolerance ||
          box.bottom > paper.bottom + tolerance
        ) {
          const round = (n: number) => Math.round(n);
          outside.push(
            `page ${i + 1}: "${span.textContent}" box [${round(box.left)}, ${round(box.top)}, ${round(box.right)}, ${round(box.bottom)}] is outside the paper [${round(paper.left)}, ${round(paper.top)}, ${round(paper.right)}, ${round(paper.bottom)}]`,
          );
        }
      }
    });
    return { pages: sheets.length, runs, outside };
  });

// Web ─────────────────────────────────────────────────────────────────────────

const webFrame = (page: Page) => page.locator('iframe[title="Web preview"]');

const deviceButton = (page: Page, label: "Desktop" | "Mobile") =>
  rail(page).getByRole("group", { name: "Device", exact: true }).getByRole("button", { name: label, exact: true });

async function showDevice(page: Page, label: "Desktop" | "Mobile") {
  await tap(deviceButton(page, label));
  await expect(deviceButton(page, label)).toHaveAttribute("aria-pressed", "true");
}

/**
 * What a frame shows, read from the page that holds it (the frames are same-origin and sandboxed
 * without scripts). Not through `frameLocator`: Playwright injects its own script into the frame it
 * queries, and a frame with scripts off reports that as a console error ("Blocked script execution").
 */
const frameText = (frame: Locator) => frame.evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.innerText ?? "");

/** Waits until the frame shows `text`. The old document stays up until the new one has loaded. */
async function expectFrameText(frame: Locator, text: string, what: string) {
  await expect.poll(() => frameText(frame), { message: `${what} shows "${text}"`, timeout: 20_000 }).toContain(text);
}

async function expectFrameLacks(frame: Locator, text: string, what: string) {
  await expect.poll(() => frameText(frame), { message: `${what} no longer shows "${text}"`, timeout: 20_000 }).not.toContain(text);
}

/** The frame's own document: how wide it is, and how wide its content is. */
const documentWidth = (frame: Locator) =>
  frame.evaluate((el: HTMLIFrameElement) => {
    const root = el.contentDocument!.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });

// Email ───────────────────────────────────────────────────────────────────────

const emailSubject = (page: Page) => rail(page).getByRole("heading", { level: 3 });
const emailPreheader = (page: Page) => rail(page).getByText(PREHEADER, { exact: true }).filter({ visible: true });
const emailFrame = (page: Page) => page.locator('iframe[title="Email preview"]');

// ───────────────────────────────────────────────────────────────────────────

// Playwright's trace snapshotter (`trace` in playwright.config.ts) injects a script into every frame it
// can see. The preview's Web and Email frames are sandboxed with scripts off, so Chromium reports each
// injection as a console error ("Blocked script execution in 'about:srcdoc'") and the console-error
// fixture would fail the test for it. That is the harness, not the app: with tracing off the same run
// has none. So this file runs without a trace (a failure keeps a screenshot), and a real blocked
// script in a preview frame still fails it.
test.use({ trace: "off", screenshot: "only-on-failure" });

test.describe("scenario 2: create, preview, submit", () => {
  test("Maya writes Spring Travel Rewards, previews PDF, Web and Email with two sample sets, and submits v1", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await asPersona(page, "maya");
    await openLibrary(page);

    await create(page);
    const templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];

    // ── 4. Preview ───────────────────────────────────────────────────────────

    await test.step("4.1 Email on: {{first_name}} in the subject, and a preheader", async () => {
      const channels = page.getByRole("group", { name: "Channels", exact: true });
      const email = channels.getByRole("button", { name: "Email" });
      await expect(email).toHaveAttribute("aria-pressed", "false");
      await tap(email);
      await expect(email).toHaveAttribute("aria-pressed", "true");

      await expect(page.getByRole("heading", { name: "Email details" })).toBeVisible();
      const subject = page.getByRole("textbox", { name: "Email subject" });
      const preheader = page.getByRole("textbox", { name: "Email preheader" });
      await liveField(subject);
      await liveField(preheader);

      await tap(subject);
      await expect(subject).toBeFocused();
      await typeSlowly(page, "{{");
      const option = page.getByRole("option", { name: /First name/ });
      await expect(option).toBeVisible();
      await tap(option);
      await expect(page.getByRole("option")).toHaveCount(0);
      await expect(subject.locator('[data-variable="first_name"]')).toHaveCount(1);
      await typeSlowly(page, SUBJECT_TAIL);
      await expect(subject).toContainText(SUBJECT_TAIL.trim());

      await tap(preheader);
      await expect(preheader).toBeFocused();
      await typeSlowly(page, PREHEADER);
      await expect(preheader).toHaveText(PREHEADER);

      // The subject's chip counts like any other: first_name is used twice now.
      await expect(panelRow(page, "first_name")).toContainText("2 uses");
      // The document's own chips are unchanged.
      for (const key of CHIPS) await expect(docChip(page, key)).toHaveCount(1);
    });

    await test.step("4.2 Preview opens: the button is pressed, the PDF is the first output", async () => {
      await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "false");
      await tap(previewToggle(page));
      await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "true");
      await expect(rail(page)).toBeVisible();
      await expect(channelTab(page, "PDF")).toHaveAttribute("aria-pressed", "true");
      await expect(setTrigger(page)).toHaveAccessibleName(`Sample set: ${TYPICAL}`);
    });

    await test.step("4.3 PDF, Typical: pages, the name, the APR formatted, the offer text", async () => {
      await expect(pdfPages(page).first(), "the PDF shows at least one page").toBeVisible({ timeout: 30_000 });
      await expectPdfText(page, TYPICAL_NAME);
      // The purchase APR, formatted as a percent; the date, formatted as a date; the offer text as written.
      await expectPdfText(page, TYPICAL_APR, OFFER_SENTENCE);
      await expectPdfText(page, `Hello ${TYPICAL_NAME}! Your Spring Travel Rewards offer is ready.`);
      expect(compact(await pdfText(page))).toMatch(/YourpurchaseAPRis21\.99%until[A-Z][a-z]+\d{1,2},\d{4}\./);
      // The required sections are in it, in order.
      const text = compact(await pdfText(page));
      expect(text.indexOf("Offerdetails")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("Ratesandfees")).toBeGreaterThan(text.indexOf("Offerdetails"));
      expect(text.indexOf("Legalnotices")).toBeGreaterThan(text.indexOf("Ratesandfees"));
    });

    await test.step("4.4 PDF, Long name: the name, a layout that holds, and Download PDF", async () => {
      await showSet(page, LONG);
      await expectPdfText(page, LONG_NAME, LONG_APR);
      expect(compact(await pdfText(page))).not.toContain(`Hello${TYPICAL_NAME}!`);

      const pages = await drawEveryPage(page);
      expect(pages).toBeGreaterThanOrEqual(1);
      const { runs, outside } = await pdfOutsideThePaper(page);
      expect(runs, "text runs measured").toBeGreaterThan(10);
      expect(outside, "every text run lies inside its page").toEqual([]);
      await pdfPages(page).first().scrollIntoViewIfNeeded();

      // Download PDF: the exact bytes, named for the draft.
      const downloadButton = rail(page).getByRole("button", { name: "Download PDF" });
      await expect(downloadButton).toBeEnabled();
      const [download] = await Promise.all([page.waitForEvent("download"), tap(downloadButton)]);
      expect(download.suggestedFilename()).toMatch(/-draft\.pdf$/);
      expect(download.suggestedFilename()).toContain(templateId);
      const bytes = await readFile((await download.path())!);
      expect(bytes.subarray(0, 4).toString("latin1"), "the file is a PDF").toBe("%PDF");
      expect(bytes.byteLength, "and not an empty one").toBeGreaterThan(2_000);
    });

    await test.step("4.5 Web, both sets: the name; no sideways scroll on Mobile", async () => {
      await showChannel(page, "Web");
      await expect(webFrame(page)).toBeVisible();
      // Long name first (the set is still selected), desktop then mobile.
      await expectFrameText(webFrame(page), LONG_NAME, "the Web preview");
      await showDevice(page, "Mobile");
      await expectFrameText(webFrame(page), LONG_NAME, "the Web preview");
      await expectNoSidewaysScroll(page, "Long name, Mobile");

      await showSet(page, TYPICAL);
      await expectFrameText(webFrame(page), TYPICAL_NAME, "the Web preview");
      await expectFrameLacks(webFrame(page), LONG_NAME, "the Web preview");
      await expectNoSidewaysScroll(page, "Typical, Mobile");

      await showDevice(page, "Desktop");
      await expectFrameText(webFrame(page), TYPICAL_NAME, "the Web preview");
      await expectFrameText(webFrame(page), OFFER_SENTENCE, "the Web preview");
    });

    await test.step("4.6 Email, both sets: the subject, the preheader, the body", async () => {
      await showChannel(page, "Email");
      await expect(emailSubject(page)).toContainText(TYPICAL_NAME, { timeout: 20_000 });
      await expect(emailSubject(page)).toContainText(SUBJECT_TAIL.trim());
      await expect(emailPreheader(page)).toBeVisible();
      await expectFrameText(emailFrame(page), TYPICAL_NAME, "the email body");
      await expectFrameText(emailFrame(page), OFFER_SENTENCE, "the email body");

      await showSet(page, LONG);
      await expect(emailSubject(page)).toContainText(LONG_NAME, { timeout: 20_000 });
      await expect(emailSubject(page)).not.toContainText(TYPICAL_NAME);
      await expect(emailPreheader(page)).toBeVisible();
      await expectFrameText(emailFrame(page), LONG_NAME, "the email body");
    });

    await test.step("4.7 A value edited in the sample-set editor reaches the preview, which stays open", async () => {
      await showSet(page, TYPICAL);
      await expect(emailSubject(page)).toContainText(TYPICAL_NAME, { timeout: 20_000 });
      await editValue(page, TYPICAL, "First name", EDITED_NAME);

      await expect(emailSubject(page)).toContainText(EDITED_NAME, { timeout: 20_000 });
      await expect(emailSubject(page)).not.toContainText(TYPICAL_NAME);
      await expectFrameText(emailFrame(page), EDITED_NAME, "the email body");
      await expect(emailPreheader(page)).toBeVisible();

      await showChannel(page, "PDF");
      await expectPdfText(page, `Hello ${EDITED_NAME}!`);
      expect(compact(await pdfText(page))).not.toContain(`Hello${TYPICAL_NAME}!`);
      await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "true");
    });

    await test.step("4.8 A word typed into the document reaches the preview after the autosave lands", async () => {
      // The end of the first paragraph, as a person would find it: click just past its text. The paragraph that ends with the sentence typed in step 2 may wrap: click past the end of its last line.
      const offer = documentEditor(page).locator("p", { hasText: OFFER_SENTENCE });
      await offer.scrollIntoViewIfNeeded();
      const box = (await offer.boundingBox())!;
      const end = { x: box.width - 4, y: box.height - 10 };
      await untilUncovered(offer, end);
      await offer.click({ position: end, delay: 90 });
      await page.keyboard.press("End");
      await expect.poll(async () => (await caret(page)).focused).toBe(true);
      await expect
        .poll(async () => (await caret(page)).block.endsWith(OFFER_SENTENCE), { message: "the caret is at the end of that paragraph" })
        .toBe(true);

      expect(compact(await pdfText(page))).not.toContain(LATE_WORD);
      await typeSlowly(page, ` ${LATE_WORD}.`);
      await expectAutosaved(page);
      await expectPdfText(page, `${OFFER_SENTENCE} ${LATE_WORD}.`);
      // The same edit is in the other channels too.
      await showChannel(page, "Web");
      await expectFrameText(webFrame(page), `${OFFER_SENTENCE} ${LATE_WORD}.`, "the Web preview");
    });

    // ── 5. Submit ────────────────────────────────────────────────────────────

    await test.step("5.1 Esc closes the preview", async () => {
      await page.keyboard.press("Escape");
      await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "false");
      await expect(rail(page)).toHaveCount(0);
      await expect(page.locator("aside[aria-label='Channels and variables']")).toBeVisible();
    });

    await test.step("5.2 Submit for review: In review, v1, no Submit button, read-only", async () => {
      const submit = page.getByRole("button", { name: "Submit for review" });
      await expect(submit).toBeEnabled();
      await tap(submit);

      await expect(page.locator('[data-status="in_review"]').filter({ visible: true })).toHaveText("In review", { timeout: 20_000 });
      await expect(page.getByText("v1", { exact: true }).filter({ visible: true })).toBeVisible();
      await expect(submit, "the Submit button is gone").toHaveCount(0);
      await expect(documentEditor(page)).toHaveAttribute("contenteditable", "false");
      await expect(page.getByRole("textbox", { name: "Email subject" })).toHaveAttribute("contenteditable", "false");
      // What was written is what was frozen.
      await expect(documentEditor(page)).toContainText(`${OFFER_SENTENCE} ${LATE_WORD}.`);
      for (const key of CHIPS) await expect(docChip(page, key)).toHaveCount(1);
      // The Preview is still there for a version in review.
      await expect(previewToggle(page)).toBeVisible();
    });

    await test.step("5.3 The render API: a consumer is refused v1, a preview is not", async () => {
      const db = openDb();
      try {
        const version = (await allVersions(db)).find((v) => v.templateId === templateId && v.number === 1);
        expect(version, "v1 is in the database").toBeDefined();
        expect(version!.state).toBe("in_review");
        const values = validValues(version!.variables);

        const consumerCall = await render(request, {
          templateId,
          consumer: "coral",
          correlationId: correlation("scenario02-consumer"),
          body: { version: 1, channel: "pdf", values },
        });
        await expectError(consumerCall.res, 409, "version_not_released", "Version 1 is in review. No version is active yet.");

        const previewCall = await render(request, {
          templateId,
          consumer: null,
          correlationId: correlation("scenario02-preview"),
          headers: { Cookie: "ucomp_persona=maya" },
          body: { version: 1, channel: "web", values, preview: true },
        });
        expect(previewCall.res.status(), "a preview of a version in review").toBe(200);
        expect(previewCall.res.headers()["content-type"]).toContain("text/html");

        // render_log: every preview is tagged and has no consumer; the one consumer attempt is the one refusal.
        const { rows } = await db.execute({ sql: "SELECT * FROM render_log WHERE template_id = ? ORDER BY at, id", args: [templateId] });
        const consumerRows = rows.filter((row) => Number(row.is_preview) === 0);
        const previewRows = rows.filter((row) => Number(row.is_preview) === 1);
        expect(consumerRows, "exactly one render that was not a preview").toHaveLength(1);
        expect(consumerRows[0]).toMatchObject({
          consumer_id: "coral",
          version_number: 1,
          channel: "pdf",
          error_code: "version_not_released",
          correlation_id: consumerCall.correlationId,
        });
        expect(previewRows.length, "the previews in this scenario").toBeGreaterThanOrEqual(8);
        expect(previewRows.filter((row) => row.consumer_id !== null), "a preview has no consumer").toEqual([]);
        expect(new Set(previewRows.map((row) => row.channel)), "previews of every channel").toEqual(new Set(["pdf", "web", "email"]));
        expect(previewRows.filter((row) => row.outcome !== "ok"), "no preview was refused").toEqual([]);
        // And no value anywhere in the log.
        const logged = JSON.stringify(rows);
        for (const value of [TYPICAL_NAME, LONG_NAME, EDITED_NAME, TYPICAL_APR.replace("%", ""), LONG_APR.replace("%", ""), LATE_WORD]) expect(logged).not.toContain(value);
      } finally {
        db.close();
      }
    });
  });
});

/** No horizontal scroll in the Web frame's own document. */
async function expectNoSidewaysScroll(page: Page, what: string) {
  const frame = webFrame(page);
  await expect
    .poll(async () => {
      const { scrollWidth, clientWidth } = await documentWidth(frame);
      return scrollWidth <= clientWidth;
    }, { message: `${what}: the frame's document does not scroll sideways` })
    .toBe(true);
  const { scrollWidth, clientWidth } = await documentWidth(frame);
  expect(clientWidth, `${what}: this is the phone-width frame`).toBeLessThanOrEqual(420);
  expect(scrollWidth, `${what}: scrollWidth against clientWidth`).toBeLessThanOrEqual(clientWidth);
}
