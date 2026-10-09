import path from "node:path";
import type { Client } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { sunsetInstant } from "@/domain/business-zone";
import { longDate, openDb } from "./api/helpers";
import {
  advanceClock,
  openBell,
  openSettings,
  personRow,
  resetDemoData,
  settingsDialog,
  strip,
  switchPersona as switchPersonaAnywhere,
  unreadCount,
} from "./helpers/access";
import {
  CUSTOMERS,
  FIVE,
  SPRING_OFFER_NAME,
  backToUcomp,
  click,
  clockDay,
  dropDemoNoise,
  escapeRe,
  expectFailed,
  json,
  openDemoDrawer,
  openOffer,
  openOfferTab,
  openSimulator,
  reactReady,
  resultsHeadline,
  resultsRows,
  rows,
  selectCustomers,
  send,
  sendButton,
  switchPersona,
} from "./helpers/golive";
import {
  NAME,
  asPersona,
  beat,
  caret,
  chip,
  clickCounter,
  demoTimeout,
  documentEditor,
  dragRowTo,
  expect,
  expectAutosaved,
  hydrated,
  isDemo,
  liveEditor,
  liveField,
  moveTo,
  mousePresses,
  nameField,
  openLibrary,
  panelRow,
  pointInText,
  requiredHeading,
  shoot,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// Phase 7 gate: the whole demo script (build plan, "Demo script", scenarios 1–11) as ONE story, in order,
// on ONE database state, from a fresh `db:reset`. No fixtures and no resets or restores in between:
// scenario 4 links the Spring Travel v2 that Maya and Jordan made through the UI in scenarios 2–3,
// scenario 5 approves the real v3 and sunsets that v2, scenario 6 revokes on a clock already 15 days on,
// scenario 8 runs its deadline on top of that, and scenario 11 is the demo drawer's own Reset.
//
// The per-scenario specs (scenario-02 … scenario-10) assert the details; this one asserts the "what to
// look for" of each step briefly and that the story holds end to end. Scenario 1 (first impression) and
// scenario 11 (reset) have no spec of their own: they are implemented here.
//
// The demo clock moves only through the Demo pill (+15 days in scenario 5, the custom field in scenario 8).
// It ends on the drawer's Reset, so it leaves the starting data behind; a failure leaves the DB as it was
// when it failed (the next run starts with a reset).
//
// One test, one page: console errors and page errors anywhere in the run fail it (the `problems` fixture;
// in the `demo` project the recording harness's own noise is dropped by `dropDemoNoise`). Stills at the key
// moments go to e2e/__screens__/gate/demo-script/<width>-demo-NN-<moment>.png (demo and stills-1280 only).

// The preview frames are sandboxed; Playwright's trace injects scripts into them ("Blocked script execution").
// Scenario 10 reads and writes the clipboard.
test.use({ trace: "off", screenshot: "only-on-failure", permissions: ["clipboard-read", "clipboard-write"] });

const TEAM = "coral-offers";
const SEEDED_CORAL = [
  "Annual Fee Waiver — Terms",
  "Balance Transfer Intro — Terms",
  "Cash Back Welcome Bonus — Terms",
  "Holiday Points Promo — Terms",
  "Rate Change Notice",
];

// Scenario 2
const OFFER_SENTENCE = "Earn triple points on travel.";
const GREETING = "Hello! Your Spring Travel Rewards offer is ready.";
const GREETING_LOCATOR = "Spring Travel Rewards offer is ready";
const SUBJECT_TAIL = ", your Spring Travel Rewards terms";
const PREHEADER = "See your rates, fees and offer end date.";
const TYPICAL = "Typical customer";
const LONG = "Long name and maximum values";
const TYPICAL_NAME = "Maya";
const LONG_NAME = "Alexandria-Marguerite";
const NOTE_V1 = "First version of the spring travel terms.";
// Scenario 3
const INTEREST_STARTS = "Interest on purchases starts on the transaction date";
const QUOTE = "starts on the transaction date";
const COMMENT = "Please state the APR more plainly.";
const REASON_CHANGES = "The interest wording is too vague. State the purchase APR plainly.";
const FIX = " Your purchase APR is 21.99%.";
const NOTE_V2 = "Spelled out the purchase APR.";
const OWN_VERSION = "You submitted this version.";
// Scenario 5
const NOTE_V3 = "Added the annual fee.";
const SUNSET_DAYS = 14;
const ADVANCE_DAYS = 15;
// Scenario 6
const BT_NAME = "Balance Transfer Intro — Terms";
const BT_OFFER = "offer_balance_transfer";
const BT_OFFER_NAME = "Balance Transfer Intro";
const REASON_REVOKE = "Wrong intro APR in the legal notices.";
const OWN_REVOKE = "You started this revoke. Another approver must confirm it.";
// Scenario 8
const ACCESS_REASON = "I'm joining the spring campaign and need to draft its offer terms.";
const KEEP = ["jordan", "maya", "priya", "devon", "dana"] as const;
/** The seeded review's deadline is 30 days after the reset; scenario 5 already moved the clock 15. */
const PAST_DEADLINE_DAYS = 16;
// Scenario 9
const IMPORT_FILE = path.join(process.cwd(), "e2e", "fixtures", "import", "spring-offer.docx");
const IMPORT_FILE_NAME = "spring-offer.docx";
const IMPORTED_NAME = "Spring Balance Transfer Offer";
// Scenario 10
const COPILOT_ANSWER = [
  "## Rates and fees",
  "",
  "Your purchase APR is {{purchase_apr}}, and it stays the same for the life of the offer.",
  "",
  "- No annual fee",
  "- No foreign transaction fee",
].join("\n");

// ── The screens ──────────────────────────────────────────────────────────────

const navItem = (page: Page, slug: string) => page.locator(`[data-slot="sidebar-menu-button"][href$="/${slug}"]`).filter({ visible: true });
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const libraryRows = (page: Page) => page.locator("main ul > li > a[href*='/templates/']").filter({ visible: true });
const templateTab = (page: Page, name: string) => page.getByRole("navigation", { name: "Template" }).getByRole("link", { name });
const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) => decision(page).getByRole("button", { name: "Approve", exact: true });
const requestButton = (page: Page) => decision(page).getByRole("button", { name: "Request changes", exact: true });
const queueTab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${escapeRe(name)}`) });
const queueRow = (page: Page, id: string, number: number) => page.locator(`a[href="/${TEAM}/review/${id}/${number}"]`).filter({ visible: true });
const gutterMarkers = (page: Page) => page.locator('[data-slot="gutter-markers"] [data-marker]').filter({ visible: true });
const docBlock = (page: Page, text: string) => documentEditor(page).locator("p", { hasText: text });
const sidebarCard = (page: Page) => page.locator('[data-slot="sidebar-card"]').filter({ visible: true });
const viewOnly = (page: Page) => page.getByText("View only", { exact: true });

/** The preview rail and its controls. */
const previewToggle = (page: Page) => page.getByRole("button", { name: "Preview", exact: true });
const previewRail = (page: Page) => page.locator("aside[aria-label='Preview']");
const channelTab = (page: Page, label: string) =>
  previewRail(page).getByRole("group", { name: "Channel", exact: true }).getByRole("button", { name: label, exact: true });
const setTrigger = (page: Page) => previewRail(page).getByRole("button", { name: /^Sample set:/ });
const pdfRegion = (page: Page) => page.getByRole("region", { name: "PDF preview" });
const webFrame = (page: Page) => page.locator('iframe[title="Web preview"]');
const emailFrame = (page: Page) => page.locator('iframe[title="Email preview"]');
const emailSubject = (page: Page) => previewRail(page).getByRole("heading", { level: 3 });

/** Text compared without whitespace: a PDF breaks lines and splits runs wherever it likes. */
const compact = (text: string) => text.replace(/\s+/g, "");
const pdfText = (page: Page) =>
  pdfRegion(page).evaluate((region) =>
    [...region.querySelectorAll<HTMLElement>('[role="group"] span')]
      .filter((span) => !span.querySelector("span"))
      .map((span) => span.textContent ?? "")
      .join(" "),
  );
/** A frame's text read from the page that holds it (not frameLocator: that injects a script into a sandboxed frame). */
const frameText = (frame: Locator) => frame.evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.innerText ?? "");

async function expectPdfText(page: Page, text: string) {
  await expect.poll(async () => compact(await pdfText(page)), { message: `the PDF says "${text}"`, timeout: 30_000 }).toContain(compact(text));
}
async function expectFrameText(frame: Locator, text: string, what: string) {
  await expect.poll(() => frameText(frame), { message: `${what} shows "${text}"`, timeout: 20_000 }).toContain(text);
}

async function showChannel(page: Page, label: string) {
  await tap(channelTab(page, label));
  await expect(channelTab(page, label)).toHaveAttribute("aria-pressed", "true");
}
async function showSet(page: Page, name: string) {
  await tap(setTrigger(page));
  await tap(page.getByRole("menuitemradio", { name, exact: true }));
  await expect(setTrigger(page)).toHaveAccessibleName(`Sample set: ${name}`);
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** The Review queue, with a tab chosen. */
async function openQueue(page: Page, tab?: string) {
  await click(navItem(page, "review"));
  await expect(page).toHaveURL(new RegExp(`/${TEAM}/review$`));
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  if (tab) {
    await click(queueTab(page, tab));
    await expect(queueTab(page, tab)).toHaveAttribute("aria-selected", "true");
  }
}

async function expectReviewScreen(page: Page, id: string, number: number, name: string) {
  await expect(page).toHaveURL(new RegExp(`/${TEAM}/review/${id}/${number}$`));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(decision(page)).toBeVisible();
  await liveEditor(page);
  await hydrated(page);
}

/** From the sidebar: the Library, then a template by its link. */
async function openFromLibrary(page: Page, href: string, name: string) {
  await click(navItem(page, "library"));
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await click(page.locator(`main a[href="${href}"]`).filter({ visible: true }));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await hydrated(page);
}

/** Opens a template by its name in the Library on screen. */
async function openByName(page: Page, name: string) {
  await click(page.getByRole("main").getByRole("link", { name: new RegExp(`^${escapeRe(name)}`) }).filter({ visible: true }).first());
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await hydrated(page);
}

/** Puts the caret at the end of a paragraph, as a person does: a click just past its text on its last line, then End. */
async function caretAtEnd(page: Page, paragraph: Locator, endsWith: string) {
  await paragraph.scrollIntoViewIfNeeded();
  const box = (await paragraph.boundingBox())!;
  const end = { x: box.width - 4, y: box.height - 10 };
  await untilUncovered(paragraph, end);
  await tap(paragraph, { position: end });
  await page.keyboard.press("End");
  await expect.poll(async () => (await caret(page)).focused).toBe(true);
  await expect.poll(async () => (await caret(page)).block.endsWith(endsWith), { message: `the caret is at the end of "…${endsWith}"` }).toBe(true);
}

/** Waits until the target has stopped moving (three looks, 60ms apart). */
async function untilStill(target: Locator) {
  let last = "";
  let same = 0;
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox();
        const now = box ? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}` : "";
        same = now !== "" && now === last ? same + 1 : 0;
        last = now;
        return same >= 3;
      },
      { message: "the target has stopped moving", intervals: [60] },
    )
    .toBe(true);
}

/** Selects `phrase` inside a block with the real mouse. */
async function selectPhrase(page: Page, target: Locator, phrase: string) {
  await target.scrollIntoViewIfNeeded();
  const text = await target.evaluate((el) => el.textContent ?? "");
  const start = text.indexOf(phrase);
  expect(start, `"${phrase}" is in the block`).toBeGreaterThanOrEqual(0);
  await untilStill(target);
  const from = await pointInText(target, start);
  const to = await pointInText(target, start + phrase.length);
  const box = (await target.boundingBox())!;
  await untilUncovered(target, { x: from.x - box.x + 1, y: from.y - box.y });
  await moveTo(page, target, { x: from.x - box.x, y: from.y - box.y });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(isDemo() ? 140 : 60);
  await page.mouse.move(to.x, to.y, { steps: isDemo() ? 24 : 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? ""), "the drag selected the phrase").toBe(phrase);
}

/** Creates a variable from the {{ picker's "Create" option, with a type, and saves it with Enter. */
async function createVariableInline(page: Page, key: string, type: string) {
  const create = page.getByRole("option", { name: /Create/ });
  await expect(create).toBeVisible();
  await beat(page);
  await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "New variable" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Label")).toBeFocused();
  await expect(form.getByLabel("Key")).toHaveValue(key);
  await tap(form.getByRole("combobox"));
  await tap(page.getByRole("option", { name: type }));
  await expect(form.getByRole("combobox")).toHaveText(new RegExp(type));
  await beat(page, 500);
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(form.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(form).toBeHidden();
}

/** The simulator's mapping row for a variable (a native select, named by the variable's label). */
async function mapTo(page: Page, table: string, label: string, field: string) {
  const select = page.getByRole("table", { name: table }).getByRole("combobox", { name: label, exact: true });
  await select.scrollIntoViewIfNeeded();
  await reactReady(select);
  await select.selectOption({ label: field });
  await expect(select.locator("option:checked")).toHaveText(field);
}

/** The Send tab's picker, holding exactly these customers. Each visit to the offer page starts it empty. */
async function chooseOnly(page: Page, customers: readonly { name: string }[]) {
  await expect(page.getByRole("table", { name: "Customers" })).toBeVisible();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await selectCustomers(page, customers);
  await expect(sendButton(page)).toHaveAccessibleName(`Send to ${customers.length} customer${customers.length === 1 ? "" : "s"}`);
}

const customerView = (page: Page, customer: string, channel: string) => page.getByRole("dialog", { name: `${customer} · ${channel}`, exact: true });
const deliveredCell = (page: Page, customer: string, channel: string) =>
  page.getByRole("table", { name: "Results" }).getByRole("button", { name: new RegExp(`^Delivered\\s*,\\s*view ${escapeRe(customer)} · ${channel}$`) });
const offerRow = (page: Page, name: string) =>
  page.getByRole("table", { name: "Offers" }).getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

/** Picks a day in the sunset popover (react-day-picker's `data-day` is M/D/YYYY). It opens on the default, 30 days out. */
async function pickDay(page: Page, ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = page.locator(`[role="dialog"] button[data-day="${m}/${d}/${y}"], [data-slot="popover-content"] button[data-day="${m}/${d}/${y}"]`).filter({ visible: true });
  for (let attempt = 0; attempt < 3 && (await day.count()) === 0; attempt++) {
    await click(page.getByRole("button", { name: /previous month/i }).filter({ visible: true }));
    await beat(page, 200);
  }
  await expect(day, `${ymd} is in the calendar`).toHaveCount(1);
  await click(day);
}

// ── The run ──────────────────────────────────────────────────────────────────

let db: Client;

test.beforeAll(() => {
  test.setTimeout(120_000);
  // The story starts from the seed, whatever ran before it.
  resetDemoData();
  db = openDb();
});

test.afterEach(({ problems }) => dropDemoNoise(problems));

test.afterAll(() => {
  db?.close();
});

test("the demo script, scenarios 1–11, as one story from a fresh reset", async ({ page, request }) => {
  test.setTimeout(demoTimeout(20 * 60_000));

  let springId = "";
  let springV2Id = "";
  let importedId = "";
  let sunsetDay = "";
  let revokedDay = "";

  // ── 1. First impression ────────────────────────────────────────────────────

  await asPersona(page, "maya");
  await openLibrary(page, TEAM);
  await beat(page, 1200);

  await test.step("1. Maya's Library: Coral Offers templates in mixed states, status at a glance, one primary action", async () => {
    await expect(libraryRows(page)).toHaveCount(SEEDED_CORAL.length);
    for (const name of SEEDED_CORAL) await expect(libraryRows(page).filter({ hasText: name })).toHaveCount(1);
    const states: string[] = [];
    for (const row of await libraryRows(page).all()) {
      const badges = row.locator('[data-slot="badge"][data-status]');
      expect(await badges.count(), "every row shows its status with the badge").toBeGreaterThanOrEqual(1);
      states.push((await badges.first().getAttribute("data-status")) ?? "");
    }
    expect(new Set(states).size, `mixed states: ${states.join(", ")}`).toBeGreaterThanOrEqual(3);
    const primary = page.locator("main .bg-primary").filter({ visible: true });
    await expect(primary, "one black primary button").toHaveCount(1);
    await expect(primary).toHaveText(/New template/);
    await shoot(page, "demo-01-library");
  });

  // ── 2. Create ──────────────────────────────────────────────────────────────

  await test.step("2.1 New template, Card offer terms, renamed: two clicks from the Library to typing", async () => {
    const clicks = clickCounter();
    await clicks.click(page.getByRole("button", { name: "New template" }));
    const gallery = page.getByRole("dialog");
    await expect(gallery).toBeVisible();
    await beat(page);
    await shoot(page, "demo-02-gallery");
    await clicks.click(gallery.getByRole("button", { name: /Card offer terms/ }));
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
    springId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];
    await expect(nameField(page)).toBeFocused();
    await expect(nameField(page)).toHaveValue("Card offer terms");
    expect(clicks.count, "clicks from the Library to a selected name").toBe(2);
    expect(await mousePresses(page), "mouse presses the page saw").toBe(2);
    await page.waitForTimeout(300);
    await beat(page, 900);
    await typeSlowly(page, NAME);
    await expect(nameField(page)).toHaveValue(NAME);
    await page.keyboard.press("Enter");
    await liveEditor(page);
    await expect.poll(async () => (await caret(page)).focused, { message: "the document has focus" }).toBe(true);
    expect((await caret(page)).section).toBe("Offer details");
  });

  await test.step("2.2 The offer text: drag first_name in, {{ for purchase_apr, create offer_end_date (Date)", async () => {
    await typeSlowly(page, ` ${OFFER_SENTENCE}`);
    await page.keyboard.press("Enter");
    await typeSlowly(page, GREETING);
    const greeting = docBlock(page, GREETING_LOCATOR);
    await expect(greeting).toHaveText(GREETING);
    await expect(panelRow(page, "first_name")).toContainText("Unused");
    await dragRowTo(page, panelRow(page, "first_name"), await pointInText(greeting, "Hello".length));
    await expect(greeting.locator('[data-variable="first_name"]'), "first_name landed where it was dropped").toHaveCount(1);
    await beat(page);

    // After the drop the chip may hold a node selection, where End does not always reach the line's end:
    // click past the sentence instead, as a person would.
    await caretAtEnd(page, greeting, "is ready.");
    await typeSlowly(page, " Your purchase APR is {{pur");
    await expect(page.getByRole("option").filter({ hasText: "Purchase APR" })).toBeVisible();
    await beat(page);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(chip(page, "purchase_apr")).toHaveCount(1);

    await typeSlowly(page, " until {{Offer end date");
    await createVariableInline(page, "offer_end_date", "Date");
    await expect(chip(page, "offer_end_date")).toHaveAttribute("data-variable-type", "date");
    await typeSlowly(page, ".");
    for (const key of ["first_name", "purchase_apr", "offer_end_date"]) await expect(panelRow(page, key)).toContainText("1 use");
    await expectAutosaved(page);
    await beat(page);
    await shoot(page, "demo-02-editing");
  });

  await test.step("2.3 Deleting Legal notices is blocked inline", async () => {
    const legal = requiredHeading(page, "legal_notices");
    await tap(legal, { clickCount: 3, delay: 60 });
    expect((await caret(page)).section).toBe("Legal notices");
    await page.keyboard.press("Backspace");
    await expect(legal).toHaveText("Legal notices");
    await expect(legal, "the note is on the heading").toHaveAttribute("data-required-note", "Required for disclosures");
    await expect(page.getByRole("status").filter({ hasText: "Required for disclosures" })).toHaveCount(1);
    await expect(documentEditor(page).locator("h2[data-required]")).toHaveText(["Offer details", "Rates and fees", "Legal notices"]);
    await beat(page, 600);
    await shoot(page, "demo-02-legal-blocked");
  });

  await test.step("2.4 Email on, {{first_name}} in the subject; preview PDF, Web and Email with Typical and Long name", async () => {
    const email = page.getByRole("group", { name: "Channels", exact: true }).getByRole("button", { name: "Email" });
    await tap(email);
    await expect(email).toHaveAttribute("aria-pressed", "true");
    const subject = page.getByRole("textbox", { name: "Email subject" });
    const preheader = page.getByRole("textbox", { name: "Email preheader" });
    await liveField(subject);
    await liveField(preheader);
    await tap(subject);
    await typeSlowly(page, "{{");
    const option = page.getByRole("option", { name: /First name/ });
    await expect(option).toBeVisible();
    await tap(option);
    await expect(subject.locator('[data-variable="first_name"]')).toHaveCount(1);
    await typeSlowly(page, SUBJECT_TAIL);
    await tap(preheader);
    await typeSlowly(page, PREHEADER);
    await expect(preheader).toHaveText(PREHEADER);
    await beat(page);

    await tap(previewToggle(page));
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(channelTab(page, "PDF")).toHaveAttribute("aria-pressed", "true");
    await expect(setTrigger(page)).toHaveAccessibleName(`Sample set: ${TYPICAL}`);
    await expectPdfText(page, `Hello ${TYPICAL_NAME}! Your Spring Travel Rewards offer is ready.`);
    await expectPdfText(page, OFFER_SENTENCE);
    expect(compact(await pdfText(page))).toMatch(/YourpurchaseAPRis21\.99%until[A-Z][a-z]+\d{1,2},\d{4}\./);
    await beat(page, 1000);
    await shoot(page, "demo-02-pdf-typical");

    await showSet(page, LONG);
    await expectPdfText(page, LONG_NAME);
    await beat(page, 900);
    await shoot(page, "demo-02-pdf-long");

    await showChannel(page, "Web");
    await expectFrameText(webFrame(page), LONG_NAME, "the Web preview");
    await showSet(page, TYPICAL);
    await expectFrameText(webFrame(page), OFFER_SENTENCE, "the Web preview");
    await expect.poll(() => frameText(webFrame(page))).not.toContain(LONG_NAME);
    await beat(page, 900);
    await shoot(page, "demo-02-web-typical");

    await showChannel(page, "Email");
    await expect(emailSubject(page)).toContainText(`${TYPICAL_NAME}${SUBJECT_TAIL}`, { timeout: 20_000 });
    await showSet(page, LONG);
    await expect(emailSubject(page)).toContainText(LONG_NAME, { timeout: 20_000 });
    await expectFrameText(emailFrame(page), LONG_NAME, "the email body");
    await beat(page, 900);
    await shoot(page, "demo-02-email-long");
    await page.keyboard.press("Escape");
    await expect(previewToggle(page)).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("2.5 Submit: v1, In review", async () => {
    const submit = page.getByRole("button", { name: "Submit for review" });
    await tap(submit);
    const dialog = page.getByRole("dialog", { name: "Submit v1 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole("textbox", { name: "Note to reviewers" })).toBeFocused();
    await typeSlowly(page, NOTE_V1);
    await beat(page, 700);
    await shoot(page, "demo-02-submit");
    await tap(dialog.getByRole("button", { name: "Submit v1", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
    await expect(page.locator("header").filter({ visible: true }).getByText("v1", { exact: true })).toBeVisible();
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "false");
    await beat(page, 900);
    await shoot(page, "demo-02-submitted");
  });

  // ── 3. Review loop ─────────────────────────────────────────────────────────

  await test.step("3.1 Maya sees Approve disabled: “You submitted this version.”", async () => {
    await openQueue(page, "Submitted by me");
    await click(queueRow(page, springId, 1));
    await expectReviewScreen(page, springId, 1, NAME);
    await expect(approveButton(page)).toBeDisabled();
    await expect(requestButton(page)).toBeDisabled();
    await expect(decision(page).getByText(OWN_VERSION)).toBeVisible();
    await beat(page, 900);
    await shoot(page, "demo-03-maya-disabled");
  });

  await test.step("3.2 Jordan: the Review badge shows it; he comments on a block and requests changes", async () => {
    await switchPersona(page, "Jordan Ellis");
    await openQueue(page);
    await expect(queueTab(page, "Waiting on me")).toHaveAttribute("aria-selected", "true");
    const badge = navItem(page, "review").locator('[aria-label$=" waiting"]');
    await expect(badge, "the Review badge counts what waits on him").toHaveText(/^[1-9]\d*$/);
    await expect(queueRow(page, springId, 1)).toContainText("Maya Chen");
    await beat(page, 700);
    await shoot(page, "demo-03-queue-jordan");
    await click(queueRow(page, springId, 1));
    await expectReviewScreen(page, springId, 1, NAME);
    await expect(approveButton(page)).toBeEnabled();

    await selectPhrase(page, docBlock(page, INTEREST_STARTS), QUOTE);
    const comment = page.getByRole("button", { name: "Comment", exact: true }).filter({ visible: true });
    await tap(comment);
    const composer = decision(page).locator("article[data-compose]");
    await expect(composer.getByRole("textbox", { name: "Add a comment" })).toBeFocused();
    await typeSlowly(page, COMMENT);
    await tap(composer.getByRole("button", { name: "Comment", exact: true }));
    await expect(decision(page).locator("article[data-thread]").filter({ hasText: COMMENT })).toBeVisible();
    await expect(gutterMarkers(page)).toHaveCount(1);
    await beat(page, 900);
    await shoot(page, "demo-03-jordan-comment");

    await click(requestButton(page));
    const dialog = page.getByRole("dialog", { name: "Request changes" });
    await expect(dialog.getByRole("textbox", { name: "Reason" })).toBeFocused();
    await typeSlowly(page, REASON_CHANGES);
    await beat(page, 600);
    await shoot(page, "demo-03-request-changes");
    await tap(dialog.getByRole("button", { name: "Request changes", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("Changes requested", { timeout: 20_000 });
    const [draft] = await rows(db, "SELECT based_on_version_id FROM versions WHERE template_id = ? AND state = 'draft'", [springId]);
    expect(draft, "a new draft appeared").toBeTruthy();
  });

  await test.step("3.3 Maya: the comment in the margin; she fixes it, resolves it and resubmits as v2", async () => {
    await switchPersona(page, "Maya Chen");
    await openFromLibrary(page, `/${TEAM}/templates/${springId}`, NAME);
    await liveEditor(page);
    await expect(statusBadge(page)).toHaveText("Draft");
    await expect(page.locator("header").filter({ visible: true }).getByText("Based on v1", { exact: true })).toBeVisible();
    const rail = page.locator('aside[aria-label="Comments and variables"]');
    await expect(rail.getByRole("tab", { name: /^Comments/ })).toHaveAttribute("aria-selected", "true");
    await expect(rail.locator('article[aria-label="Change request"]')).toContainText(REASON_CHANGES);
    const thread = rail.locator("article[data-thread]").filter({ hasText: COMMENT });
    await expect(thread).toBeVisible();
    await expect(gutterMarkers(page)).toHaveCount(1);
    await beat(page, 900);
    await shoot(page, "demo-03-maya-margin");

    await caretAtEnd(page, docBlock(page, INTEREST_STARTS), "due date.");
    await typeSlowly(page, FIX);
    await expectAutosaved(page);
    await click(thread.getByRole("button", { name: "Resolve" }));
    await expect(thread).toHaveCount(0);
    await expect(gutterMarkers(page)).toHaveCount(0);
    await beat(page, 600);

    await tap(page.getByRole("button", { name: "Submit for review" }));
    const dialog = page.getByRole("dialog", { name: "Submit v2 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole("textbox", { name: "Note to reviewers" })).toBeFocused();
    await typeSlowly(page, NOTE_V2);
    await tap(dialog.getByRole("button", { name: "Submit v2", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
    await expect(page.locator("header").filter({ visible: true }).getByText("v2", { exact: true })).toBeVisible();
  });

  await test.step("3.4 Jordan approves: v2 goes Active with the signature moment, and the Share button appears", async () => {
    await switchPersona(page, "Jordan Ellis");
    await openQueue(page, "Waiting on me");
    await click(queueRow(page, springId, 2));
    await expectReviewScreen(page, springId, 2, NAME);
    await expect(documentEditor(page)).toContainText(FIX.trim());
    await click(approveButton(page));
    const dialog = page.getByRole("dialog", { name: "Approve v2" });
    await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText("v2 becomes Active.");
    await beat(page, 700);
    await tap(dialog.getByRole("button", { name: "Approve v2", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const moment = page.locator("[data-go-live]");
    await expect(moment, "the go-live moment plays").toBeVisible({ timeout: 10_000 });
    await expect(moment.getByRole("status")).toHaveText("v2 is Active");
    await shoot(page, "demo-03-go-live-moment");
    await expect(moment).toHaveCount(0, { timeout: 15_000 });
    await expect(statusBadge(page)).toHaveText("Active");
    await expect(page.locator('[data-slot="share"]').filter({ visible: true }).getByRole("button", { name: `Share ${NAME} — integration details` })).toBeVisible();
    await beat(page, 1000);
    await shoot(page, "demo-03-active");
    const [v2] = await rows(db, "SELECT id, state FROM versions WHERE template_id = ? AND number = 2", [springId]);
    expect(v2.state).toBe("active");
    springV2Id = String(v2.id);
  });

  // ── 4. Going live ──────────────────────────────────────────────────────────

  await test.step("4.1 The simulator from the demo drawer: link Spring Travel Rewards to the template (by search), pinned to v2, mapped", async () => {
    const drawer = await openDemoDrawer(page);
    await beat(page, 600);
    await click(drawer.getByRole("button", { name: "Open simulator" }));
    await expect(page).toHaveURL(/\/sim$/);
    await expect(page.getByText("Coral — simulated", { exact: true })).toBeVisible();
    await expect(offerRow(page, SPRING_OFFER_NAME)).toContainText("Not linked");
    await reactReady(page.getByRole("table", { name: "Offers" }).getByRole("link").first());
    await beat(page, 900);
    await shoot(page, "demo-04-simulator");

    await openOffer(page, SPRING_OFFER_NAME);
    await click(page.getByRole("link", { name: "Link template" }).or(page.getByRole("button", { name: "Link template" })).first());
    await expect(page.getByRole("heading", { level: 1, name: "Link a template" })).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Search templates" });
    await reactReady(search);
    await click(search);
    await typeSlowly(page, "Spring Travel");
    // The list answers the whole query (it says it is busy while a newer search is on its way and may reorder).
    await expect(page.getByRole("list", { name: "Templates" })).toHaveAttribute("aria-busy", "false");
    const result = page.getByRole("list", { name: "Templates" }).getByRole("button", { name: new RegExp(`^${escapeRe(NAME)}`) });
    await expect(result, "UCOMP's search finds the one Active template of that name").toHaveCount(1);
    await expect(result).toContainText(springId);
    await expect(result).toContainText("Active v2");
    await beat(page, 700);
    await shoot(page, "demo-04-link-search");
    await click(result);
    // A router push to a server-rendered page (slow on a cold dev route; the button shows no pending state).
    await expect(page).toHaveURL(new RegExp(`/link\\?template=${springId}$`), { timeout: 30_000 });

    for (const channel of ["PDF", "Web", "Email"]) await expect(page.getByRole("checkbox", { name: channel, exact: true })).toBeChecked();
    // What Maya's v2 asks for: the starter's first_name, purchase_apr and home_state, and the offer_end_date she made.
    await expect(page.getByRole("table", { name: "Variables" }).getByRole("combobox")).toHaveCount(4);
    await mapTo(page, "Variables", "First name", "Customer · First name");
    await mapTo(page, "Variables", "Purchase APR", "Customer · Purchase APR");
    await mapTo(page, "Variables", "Home state", "Customer · Home state");
    await mapTo(page, "Variables", "Offer end date", "Offer · Ends on");
    await expect(page.getByText(/^Map .* to send\.$/)).toHaveCount(0);
    await beat(page, 900);
    await shoot(page, "demo-04-link-map");
    await click(page.getByRole("button", { name: "Link template", exact: true }));
    await expect(page).toHaveURL(/\/sim\/offers\/offer_spring_travel\?tab=send$/, { timeout: 30_000 });
    const [link] = await rows(db, "SELECT * FROM sim_links WHERE offer_id = 'offer_spring_travel'");
    expect(link).toMatchObject({ template_id: springId, pinned_version: 2 });
  });

  await test.step("4.2 Send to five customers: all Delivered; one in the phone frame, one as a PDF; the long name holds", async () => {
    await expect(page.getByRole("table", { name: "Customers" })).toBeVisible();
    await expect(sendButton(page)).toBeDisabled();
    await selectCustomers(page, FIVE);
    await beat(page, 600);
    await send(page);
    await expect(resultsHeadline(page)).toHaveText("15 delivered", { timeout: 90_000 });
    await expect(resultsRows(page)).toHaveCount(5);
    await expect(page.getByRole("table", { name: "Results" }).getByText("Failed")).toHaveCount(0);
    await beat(page, 900);
    await resultsHeadline(page).scrollIntoViewIfNeeded();
    await shoot(page, "demo-04-delivered");

    const olivia = CUSTOMERS.olivia;
    await click(deliveredCell(page, olivia.name, "Web"));
    const phone = customerView(page, olivia.name, "Web");
    await expect(phone).toBeVisible();
    // Coral's own frames: read through frameLocator, as scenario-04 does.
    const oliviaFrame = page.frameLocator(`iframe[title="${olivia.name} · Web"]`).locator("body");
    await expect(oliviaFrame).toContainText(new RegExp(`Hello ?${olivia.first}!`), { timeout: 20_000 });
    await expect(oliviaFrame).toContainText(olivia.apr);
    await beat(page, 1200);
    await shoot(page, "demo-04-phone");

    const switcher = page.getByRole("group", { name: "Customer view" });
    await click(switcher.getByRole("button", { name: "Inbox", exact: true }));
    await expect(customerView(page, olivia.name, "Email").getByRole("heading", { level: 3, name: `${olivia.first}${SUBJECT_TAIL}` })).toBeVisible({ timeout: 20_000 });
    await beat(page, 900);
    await shoot(page, "demo-04-inbox");
    await click(switcher.getByRole("button", { name: "PDF", exact: true }));
    const open = customerView(page, olivia.name, "PDF").getByRole("link", { name: "Open PDF" });
    await expect(open).toBeVisible({ timeout: 20_000 });
    const file = await request.get((await open.getAttribute("href"))!);
    expect(file.status()).toBe(200);
    expect((await file.body()).subarray(0, 5).toString("latin1"), "Open PDF is a real PDF").toBe("%PDF-");
    await beat(page, 900);

    const long = CUSTOMERS.long;
    const overflowing = await page.getByRole("table", { name: "Results" }).evaluate((table) => table.scrollWidth > (table.parentElement?.clientWidth ?? Infinity) + 1);
    expect(overflowing, "the results grid holds the long name").toBe(false);
    await click(deliveredCell(page, long.name, "Web"));
    const longView = customerView(page, long.name, "Web");
    await expect(longView).toBeVisible();
    const longFrame = page.frameLocator(`iframe[title="${long.name} · Web"]`);
    await expect(longFrame.locator("body")).toContainText(long.first, { timeout: 20_000 });
    expect(await longFrame.locator("html").evaluate((el) => el.scrollWidth > el.clientWidth + 1), "the long name's page holds its width").toBe(false);
    expect(await longView.evaluate((el) => el.scrollWidth > el.clientWidth + 1), "the drawer holds its width").toBe(false);
    await beat(page, 1000);
    await shoot(page, "demo-04-long-name");
    await page.keyboard.press("Escape");
    await expect(longView).toHaveCount(0);
  });

  await test.step("4.3 Usage reflects the renders, and the render log holds no customer values", async () => {
    await backToUcomp(page);
    await hydrated(page);
    await click(navItem(page, "usage"));
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/usage$`));
    await click(page.getByRole("tab", { name: "Consumers", exact: true }));
    const row = page.getByRole("table", { name: "Consumers" }).getByRole("row").filter({ has: page.locator(`a[href$="/templates/${springId}/usage"]`) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Coral");
    await expect(row).toContainText("v2");
    await expect(row.getByRole("cell").nth(3), "Coral rendered v2 fifteen times").toHaveText("15");
    await beat(page, 900);
    await row.scrollIntoViewIfNeeded();
    await shoot(page, "demo-04-usage");

    const log = await rows(db, "SELECT * FROM render_log WHERE template_id = ? AND is_preview = 0", [springId]);
    expect(log).toHaveLength(15);
    for (const entry of log) expect(entry).toMatchObject({ consumer_id: "coral", version_id: springV2Id, version_number: 2, outcome: "ok" });
    const haystack = JSON.stringify([
      ...(await rows(db, "SELECT * FROM render_log WHERE template_id = ?", [springId])),
      ...(await rows(db, "SELECT * FROM audit_events WHERE template_id = ?", [springId])),
      ...(await rows(db, "SELECT * FROM notifications WHERE href LIKE ?", [`%/${springId}%`])),
    ]);
    for (const customer of FIVE) for (const value of [customer.first, customer.last, customer.email]) expect(haystack, `"${value}" is not in UCOMP's data`).not.toContain(value);
  });

  // ── 5. Breaking change, pin and sunset ─────────────────────────────────────

  await test.step("5.1 Maya edits, adds required annual_fee, and submits v3: the submit dialog flags the breaking change", async () => {
    // The switch refreshes the page in place: Usage keeps `?tab=consumers` and its Consumers tab.
    await switchPersona(page, "Maya Chen");
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/usage\\?tab=consumers$`));
    await expect(page.getByRole("tab", { name: "Consumers", exact: true })).toHaveAttribute("aria-selected", "true");
    await openFromLibrary(page, `/${TEAM}/templates/${springId}`, NAME);
    await expect(statusBadge(page)).toHaveText("Active");
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await reactReady(edit);
    await click(edit);
    await expect(statusBadge(page)).toHaveText("Draft");
    await expect(page.locator("header").filter({ visible: true }).getByText("Based on v2", { exact: true })).toBeVisible();
    await liveEditor(page);

    await caretAtEnd(page, docBlock(page, INTEREST_STARTS), FIX.trim());
    await typeSlowly(page, " The annual fee is {{Annual fee");
    await createVariableInline(page, "annual_fee", "Currency");
    await expect(chip(page, "annual_fee")).toHaveAttribute("data-variable-type", "currency");
    await typeSlowly(page, ".");
    await expectAutosaved(page);
    await beat(page, 800);
    await shoot(page, "demo-05-annual-fee");

    await tap(page.getByRole("button", { name: "Submit for review" }));
    const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const contract = dialog.getByText("Contract changes", { exact: true }).locator("xpath=ancestor::section[1]");
    await expect(contract).toContainText("Breaking change");
    await expect(contract).toContainText("annual_fee");
    await expect(dialog.getByRole("textbox", { name: "Note to reviewers" })).toBeFocused();
    await typeSlowly(page, NOTE_V3);
    await beat(page, 900);
    await shoot(page, "demo-05-submit-breaking");
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
  });

  await test.step("5.2 Jordan sees the contract change, approves, and sets v2's sunset 14 days out: the consequence names Coral", async () => {
    await switchPersona(page, "Jordan Ellis");
    await openQueue(page, "Waiting on me");
    await expect(queueRow(page, springId, 3)).toContainText("Breaking");
    await click(queueRow(page, springId, 3));
    await expectReviewScreen(page, springId, 3, NAME);
    const contract = decision(page).getByRole("region", { name: "Contract changes" });
    await expect(contract).toContainText("Breaking change");
    await expect(contract).toContainText("annual_fee");
    await beat(page, 800);
    await shoot(page, "demo-05-review-breaking");

    await click(approveButton(page));
    const dialog = page.getByRole("dialog", { name: "Approve v3" });
    await expect(dialog).toBeVisible();
    const consequences = dialog.locator('[data-slot="consequences"]');
    await expect(consequences).toContainText("Coral has to map annual_fee before it moves to v3.");
    await click(dialog.getByText("Set a sunset date for v2", { exact: true }));
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    sunsetDay = await clockDay(db, SUNSET_DAYS);
    await click(dialog.getByRole("button", { name: /^Sunset date/ }));
    await pickDay(page, sunsetDay);
    const sunsetLong = longDate(`${sunsetDay}T00:00:00Z`);
    await expect(consequences).toContainText(/Coral still renders v2 \(last render .+\)\. It will keep working until /);
    await expect(consequences).toContainText(`It will keep working until ${sunsetLong}.`);
    await beat(page, 1000);
    await shoot(page, "demo-05-approve-sunset");
    await click(dialog.getByRole("button", { name: "Approve v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(page.locator("[data-go-live]")).toHaveCount(0, { timeout: 25_000 });
    await expect(statusBadge(page)).toHaveText("Active");
    const versions = await rows(db, "SELECT number, state, sunset_at FROM versions WHERE template_id = ? AND number IN (2, 3) ORDER BY number", [springId]);
    expect(versions).toEqual([
      // 00:00 Eastern on the day picked (the business time zone, decision 0017).
      { number: 2, state: "superseded", sunset_at: sunsetInstant(sunsetDay, "America/New_York").getTime() },
      { number: 3, state: "active", sunset_at: null },
    ]);
  });

  await test.step("5.3 In the simulator the offer shows “v3 available” and still sends on v2", async () => {
    await openSimulator(page);
    await expect(offerRow(page, SPRING_OFFER_NAME)).toContainText("v3 available");
    await beat(page, 800);
    await shoot(page, "demo-05-v3-available");
    await openOffer(page, SPRING_OFFER_NAME);
    await expect(page.getByText("Pinned to v2", { exact: true })).toBeVisible();
    await openOfferTab(page, "Send");
    await chooseOnly(page, [CUSTOMERS.olivia, CUSTOMERS.marcus]);
    await send(page);
    await expect(resultsHeadline(page)).toHaveText("6 delivered", { timeout: 90_000 });
    await expect(page.getByRole("table", { name: "Results" }).getByText("Newer: v3").first()).toBeVisible();
    await beat(page, 900);
    await resultsHeadline(page).scrollIntoViewIfNeeded();
    await shoot(page, "demo-05-send-on-v2");
  });

  await test.step("5.4 Advance the clock 15 days (the Demo pill): sending fails with the sunset message", async () => {
    const before = await clockDay(db);
    const drawer = await openDemoDrawer(page);
    await beat(page, 600);
    await click(drawer.getByRole("button", { name: `+${ADVANCE_DAYS} days`, exact: true }));
    await expect.poll(() => clockDay(db), { message: "the clock moved" }).toBe(new Date(Date.parse(`${before}T00:00:00Z`) + ADVANCE_DAYS * 86_400_000).toISOString().slice(0, 10));
    await expect(drawer.getByText(`+${ADVANCE_DAYS} days from today`)).toBeVisible({ timeout: 20_000 });
    await beat(page, 600);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Demo" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: SPRING_OFFER_NAME })).toBeVisible();
    await reactReady(page.getByRole("tab", { name: "Template" }));
    await expect(page.getByText("A send now fails.")).toBeVisible();
    await openOfferTab(page, "Send");
    await chooseOnly(page, [CUSTOMERS.olivia, CUSTOMERS.marcus]);
    await send(page);
    await expect(resultsHeadline(page)).toHaveText("0 delivered, 6 failed", { timeout: 90_000 });
    await expectFailed(page, 6, { status: 410, code: "version_sunset", message: `Version 2 was sunset on ${longDate(`${sunsetDay}T00:00:00Z`)}. Version 3 is active.` });
    await beat(page, 900);
    await resultsHeadline(page).scrollIntoViewIfNeeded();
    await shoot(page, "demo-05-sunset-failed");
  });

  await test.step("5.5 Relink to v3: the mapping asks for annual_fee; mapped, the send succeeds", async () => {
    await click(page.getByRole("link", { name: "Relink to v3" }).or(page.getByRole("button", { name: "Relink to v3" })).first());
    await expect(page.getByRole("heading", { level: 1, name: "Relink to v3" })).toBeVisible();
    const annualFee = page.getByRole("table", { name: "New values" }).getByRole("combobox", { name: "Annual fee", exact: true });
    await expect(annualFee).toHaveValue("");
    await expect(page.getByText("Map Annual fee to send.")).toBeVisible();
    await beat(page, 800);
    await shoot(page, "demo-05-relink");
    await mapTo(page, "New values", "Annual fee", "Offer · Annual fee");
    await expect(page.getByText("Map Annual fee to send.")).toHaveCount(0);
    await click(page.getByRole("button", { name: "Relink to v3", exact: true }));
    await expect(page).toHaveURL(/\/sim\/offers\/offer_spring_travel\?tab=send$/, { timeout: 30_000 });
    await expect(page.getByText("Pinned to v3", { exact: true })).toBeVisible();

    await chooseOnly(page, [CUSTOMERS.olivia, CUSTOMERS.marcus]);
    await send(page);
    await expect(resultsHeadline(page)).toHaveText("6 delivered", { timeout: 90_000 });
    await click(deliveredCell(page, CUSTOMERS.olivia.name, "Web"));
    await expect(page.frameLocator(`iframe[title="${CUSTOMERS.olivia.name} · Web"]`).locator("body")).toContainText(/annual fee is \$95/i, { timeout: 20_000 });
    await beat(page, 1000);
    await shoot(page, "demo-05-send-on-v3");
    await page.keyboard.press("Escape");
  });

  // ── 6. Revoke ──────────────────────────────────────────────────────────────

  let btId = "";

  await test.step("6.1 Jordan starts a revoke on Balance Transfer Intro v1 with a reason, and can't confirm it himself", async () => {
    await backToUcomp(page);
    await hydrated(page);
    await click(navItem(page, "library"));
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    await openByName(page, BT_NAME);
    btId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];
    await click(templateTab(page, "Versions"));
    await expect(page).toHaveURL(new RegExp(`/templates/${btId}/versions$`), { timeout: 30_000 });
    const v1 = page.locator('[data-slot="version-entry"][data-version="1"]').filter({ visible: true });
    await expect(v1).toHaveAttribute("data-state", "superseded");
    await click(v1.getByRole("button", { name: "Revoke v1", exact: true }));
    const dialog = page.getByRole("dialog", { name: "Revoke v1" });
    await expect(dialog.getByLabel("Reason")).toBeFocused();
    await expect(dialog.locator('[data-slot="consequences"]'), "Coral still renders v1").toContainText(/^Coral .*v1.*Once confirmed, its renders will fail immediately\./);
    await typeSlowly(page, REASON_REVOKE);
    await beat(page, 800);
    await shoot(page, "demo-06-revoke-dialog");
    await click(dialog.getByRole("button", { name: "Start revoke", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const block = v1.locator('[data-slot="revoke"]');
    await expect(block).toContainText(`Revoke started by Jordan Ellis: “${REASON_REVOKE}”`);
    const confirm = block.getByRole("button", { name: "Confirm revoke", exact: true });
    await expect(confirm, "Jordan can't confirm his own revoke").toBeDisabled();
    await expect(block.getByText(OWN_REVOKE)).toBeVisible();
    await beat(page, 900);
    await block.scrollIntoViewIfNeeded();
    await shoot(page, "demo-06-pending");
  });

  await test.step("6.2 Alex confirms; Coral's sends on that offer fail immediately with the revoke message", async () => {
    await switchPersona(page, "Alex Kim");
    const v1 = page.locator('[data-slot="version-entry"][data-version="1"]').filter({ visible: true });
    await click(v1.locator('[data-slot="revoke"]').getByRole("button", { name: "Confirm revoke", exact: true }));
    const dialog = page.getByRole("dialog", { name: "Confirm revoke of v1" });
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await beat(page, 800);
    await click(dialog.getByRole("button", { name: "Confirm revoke", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(v1).toHaveAttribute("data-state", "revoked", { timeout: 20_000 });
    await expect(v1.locator("[data-status]")).toHaveText("Revoked");
    await beat(page, 900);
    await v1.scrollIntoViewIfNeeded();
    await shoot(page, "demo-06-revoked");
    const [row] = await rows(db, "SELECT revoke FROM versions WHERE template_id = ? AND number = 1", [btId]);
    revokedDay = longDate(json(row.revoke).confirmedAt);

    await openSimulator(page);
    await expect(offerRow(page, BT_OFFER_NAME)).toContainText("Revoked");
    await openOffer(page, BT_OFFER_NAME);
    await expect(page.getByText("A send now fails.")).toBeVisible();
    await openOfferTab(page, "Send");
    await chooseOnly(page, [CUSTOMERS.olivia, CUSTOMERS.marcus]);
    await send(page);
    await expect(resultsHeadline(page)).toHaveText("0 delivered, 4 failed", { timeout: 60_000 });
    await expectFailed(page, 4, { status: 410, code: "version_revoked", message: `Version 1 was revoked on ${revokedDay}. Version 2 is active.` });
    await beat(page, 900);
    await resultsHeadline(page).scrollIntoViewIfNeeded();
    await shoot(page, "demo-06-sim-revoked");
    const failed = await rows(db, "SELECT status FROM sim_deliveries WHERE offer_id = ? AND status = 'failed'", [BT_OFFER]);
    expect(failed.length).toBeGreaterThanOrEqual(4);
  });

  await test.step("6.3 The audit log shows both steps", async () => {
    await backToUcomp(page);
    await hydrated(page);
    await click(navItem(page, "audit"));
    await expect(page.getByRole("heading", { level: 1, name: "Audit" })).toBeVisible();
    const table = page.getByRole("table", { name: "Audit events" });
    const started = table.getByRole("row").filter({ hasText: BT_NAME }).filter({ hasText: /Revoke started/ });
    const revoked = table.getByRole("row").filter({ hasText: BT_NAME }).filter({ hasText: /Revoked/ }).filter({ hasText: "Alex Kim" });
    await expect(started.first()).toContainText("Jordan Ellis");
    await expect(revoked.first()).toBeVisible();
    await beat(page, 900);
    await shoot(page, "demo-06-audit");
  });

  // ── 7. Teams and roles ─────────────────────────────────────────────────────

  await test.step("7.1 Priya edits on Coral Offers and is View only (no toolbar) on Deposits", async () => {
    await switchPersonaAnywhere(page, "Priya Raman");
    await click(navItem(page, "library"));
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch team" })).toContainText("Coral Offers");
    await openByName(page, "Annual Fee Waiver — Terms");
    await liveEditor(page);
    await expect(viewOnly(page)).toHaveCount(0);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "true");
    await beat(page, 800);
    await shoot(page, "demo-07-priya-coral");

    await click(page.getByRole("button", { name: "Switch team" }));
    await click(page.getByRole("menuitem", { name: "Deposits" }));
    await expect(page).toHaveURL(/\/deposits\/library$/);
    await expect(page.getByRole("button", { name: "New template" })).toHaveCount(0);
    await openByName(page, "Everyday Checking — Fee Schedule");
    await expect(viewOnly(page)).toBeVisible();
    await liveEditor(page);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "false");
    await documentEditor(page).locator("p").first().click({ clickCount: 3 });
    await page.mouse.move(400, 400);
    await expect(page.getByRole("toolbar", { name: "Format text" })).toHaveCount(0);
    await beat(page, 800);
    await shoot(page, "demo-07-priya-deposits");
  });

  await test.step("7.2 Sam can view and use the integration panel, but can't edit", async () => {
    await switchPersonaAnywhere(page, "Sam Ortiz");
    await click(navItem(page, "library"));
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/library$`));
    await openByName(page, NAME);
    await expect(viewOnly(page)).toBeVisible();
    await liveEditor(page);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "false");
    await click(page.getByRole("button", { name: `Share ${NAME} — integration details` }));
    const sheet = page.getByRole("dialog").filter({ hasText: "Integration" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(springId);
    await expect(sheet).toContainText("annual_fee");
    await beat(page, 900);
    await shoot(page, "demo-07-sam-integration");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  await test.step("7.3 Riley changes a channel rule, and can open but not edit a template", async () => {
    await switchPersonaAnywhere(page, "Riley Brooks");
    await click(navItem(page, "library"));
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    const dialog = await openSettings(page, "Channel rules");
    const email = dialog.getByRole("switch", { name: "Disclosure on Email" });
    await expect(email).toBeChecked();
    await click(email);
    const consequence = strip(dialog);
    await expect(consequence).toContainText(/\d+ Active Disclosure versions? stops? rendering to Email\./);
    await beat(page, 900);
    await shoot(page, "demo-07-riley-channel-rule");
    await click(consequence.getByRole("button", { name: "Turn off Email", exact: true }));
    await expect(email).not.toBeChecked({ timeout: 20_000 });
    await click(email);
    await expect(email).toBeChecked({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toBeHidden();

    await openByName(page, NAME);
    await expect(viewOnly(page)).toBeVisible();
    await liveEditor(page);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "false");
    await beat(page, 800);
  });

  await test.step("7.4 Taylor sees all teams and the whole story in the audit log, with demo-clock times", async () => {
    await switchPersonaAnywhere(page, "Taylor Nguyen");
    // Riley left the page on a Coral Offers template, which Taylor may see too: she goes to All teams.
    await click(page.getByRole("button", { name: "Switch team" }));
    await click(page.getByRole("menuitem", { name: "All teams" }));
    await expect(page).toHaveURL(/\/all\/library$/);
    await expect(page.getByRole("button", { name: "Switch team" })).toContainText("All teams");
    await click(navItem(page, "audit"));
    await expect(page).toHaveURL(/\/all\/audit$/);
    const table = page.getByRole("table", { name: "Audit events" });
    await expect(table.getByRole("columnheader", { name: "Team" })).toBeVisible();
    const off = table.getByRole("row").filter({ hasText: /Turned off Email for Disclosure/i }).first();
    await expect(off).toContainText("Riley Brooks");
    await expect(table.getByRole("row").filter({ hasText: BT_NAME }).filter({ hasText: /Revoked/ }).first()).toContainText("Alex Kim");
    // The times are the demo clock's: Riley's change is 15 days ahead of the real day.
    const at = Date.parse((await off.locator("time").getAttribute("datetime")) ?? "");
    expect(at - Date.now(), "Riley's change carries the demo clock's time").toBeGreaterThan((ADVANCE_DAYS - 1) * 86_400_000);
    await beat(page, 900);
    await shoot(page, "demo-07-taylor-audit");
    // The story's earlier steps are in the log too, filtered by template.
    await click(page.getByRole("button", { name: /^Person/ }));
    await click(page.getByRole("checkbox", { name: "Jordan Ellis" }));
    await page.keyboard.press("Escape");
    await expect(table.getByRole("row").filter({ hasText: NAME }).first()).toBeVisible({ timeout: 20_000 });
    await beat(page, 800);
    await shoot(page, "demo-07-taylor-jordan");
    await click(page.getByRole("button", { name: "Remove Person: Jordan Ellis" }));
  });

  // ── 8. Access ──────────────────────────────────────────────────────────────

  await test.step("8.1 Morgan requests Author on Coral Offers", async () => {
    await switchPersonaAnywhere(page, "Morgan Lee");
    await expect(page).toHaveURL(/\/request-access$/);
    await hydrated(page);
    const coral = page.locator(`section[data-team="${TEAM}"]`);
    await expect(coral).toContainText("Team Admin: Alex Kim");
    const form = coral.getByRole("form", { name: "Request access to Coral Offers" });
    await expect(async () => {
      if (!(await form.isVisible())) await click(coral.getByRole("button", { name: "Request access", exact: true }));
      await expect(form).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await click(form.getByRole("radio", { name: "Author", exact: true }));
    await click(form.getByRole("textbox", { name: "Reason" }));
    await typeSlowly(page, ACCESS_REASON);
    await beat(page, 800);
    await shoot(page, "demo-08-morgan-request");
    await click(form.getByRole("button", { name: "Send request", exact: true }));
    await expect(coral.locator('[data-slot="request-status"]')).toContainText("Your request for Author access is waiting on Alex Kim.", { timeout: 20_000 });
    await expect(sidebarCard(page)).toContainText("Your request is waiting");
  });

  await test.step("8.2 Alex sees the sidebar card and the notification, and approves; Morgan now sees the Library", async () => {
    await switchPersonaAnywhere(page, "Alex Kim");
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/`));
    await click(navItem(page, "library"));
    await hydrated(page);
    await expect(sidebarCard(page)).toContainText(/Access requests? pending/);
    expect(await unreadCount(page)).toBeGreaterThanOrEqual(1);
    const popover = await openBell(page);
    const item = popover.getByRole("link", { name: /Morgan Lee asked for Author access to Coral Offers\./ });
    await expect(item).toHaveAttribute("data-unread", "true");
    await beat(page, 900);
    await shoot(page, "demo-08-alex-bell");
    await click(item);
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/settings/access-requests$`));
    const dialog = settingsDialog(page);
    const row = personRow(dialog, "morgan");
    await expect(row).toContainText(ACCESS_REASON);
    await click(row.getByRole("button", { name: "Approve", exact: true }));
    const consequence = strip(dialog);
    await expect(consequence).toContainText("Morgan Lee gets Author access to Coral Offers");
    await beat(page, 800);
    await shoot(page, "demo-08-alex-approve");
    await click(consequence.getByRole("button", { name: "Approve as Author", exact: true }));
    await expect(dialog.getByRole("table", { name: "Decided requests" }).getByRole("row").filter({ hasText: "Morgan Lee" })).toContainText("Approved by Alex Kim", { timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await switchPersonaAnywhere(page, "Morgan Lee");
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/library$`));
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    await expect(libraryRows(page).first()).toBeVisible();
    await beat(page, 900);
    await shoot(page, "demo-08-morgan-library");
  });

  await test.step("8.3 Alex runs recertification and leaves Sam unconfirmed", async () => {
    await switchPersonaAnywhere(page, "Alex Kim");
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    await hydrated(page);
    const dialog = await openSettings(page, /^Recertification/);
    const summary = dialog.locator('[data-slot="recert-summary"]');
    await expect(summary).toContainText("0 of 6");
    let kept = 0;
    for (const id of KEEP) {
      const row = personRow(dialog, id);
      await click(row.getByRole("button", { name: "Keep", exact: true }));
      kept++;
      await expect(summary).toContainText(`${kept} of 6`, { timeout: 20_000 });
    }
    await expect(personRow(dialog, "sam").getByRole("button", { name: "Keep", exact: true }), "Sam is left unconfirmed").toBeVisible();
    await beat(page, 900);
    await shoot(page, "demo-08-recert");
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toBeHidden();
  });

  await test.step("8.4 Advance the clock past the deadline: Sam loses access", async () => {
    await advanceClock(page, PAST_DEADLINE_DAYS);
    await switchPersonaAnywhere(page, "Sam Ortiz");
    await expect(page).toHaveURL(/\/request-access$/);
    await expect(page.getByText(/^Your access to Coral Offers lapsed on .+: it wasn't confirmed in the access review\.$/)).toBeVisible();
    await beat(page, 900);
    await shoot(page, "demo-08-sam-lapsed");

    await switchPersonaAnywhere(page, "Alex Kim");
    await page.goto(`/${TEAM}/library`);
    await hydrated(page);
    const dialog = await openSettings(page, /^Members/);
    await expect(personRow(dialog, "sam")).toContainText(/Access lapsed/);
    for (const id of [...KEEP.filter((id) => id !== "devon"), "morgan"]) {
      await expect(personRow(dialog, id).getByRole("button", { name: "Edit roles", exact: true }), `${id} is still active`).toBeVisible();
    }
    await beat(page, 900);
    await shoot(page, "demo-08-alex-members");
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toBeHidden();
  });

  // ── 9. Import ──────────────────────────────────────────────────────────────

  await test.step("9. Maya imports a .docx with {{first_name}} and a table; the draft has the chip and the table; the original is beside it", async () => {
    await switchPersonaAnywhere(page, "Maya Chen");
    await click(navItem(page, "library"));
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    await hydrated(page);
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Search" });
    await expect(palette).toBeVisible();
    await typeSlowly(page, "import");
    await expect(palette.getByRole("option", { name: /Import a file/ })).toBeVisible();
    await beat(page, 700);
    await shoot(page, "demo-09-palette");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "New template" });
    await expect(dialog.getByRole("button", { name: "Import a file" })).toBeFocused();
    await beat(page, 600);
    await dialog.locator('input[type="file"]').setInputFiles(IMPORT_FILE);
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/, { timeout: 30_000 });
    importedId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];
    await expect(nameField(page)).toHaveValue(IMPORTED_NAME);
    await liveEditor(page);

    await expect(chip(page, "first_name").first()).toBeVisible();
    const table = documentEditor(page).locator("table");
    await expect(table).toBeVisible();
    await expect(table).toContainText("Balance transfer fee");
    await expect(documentEditor(page).locator("h2[data-required]")).toHaveText(["Offer details", "Rates and fees", "Legal notices"]);

    const rail = page.locator('[data-slot="rail"]').filter({ visible: true });
    await expect(rail).toHaveAttribute("data-view", "original");
    await expect(rail.locator('[data-slot="original-file"]')).toContainText(IMPORT_FILE_NAME);
    const source = rail.getByRole("region", { name: "Original file" }).locator(".ucomp-doc");
    await expect(source.locator("table")).toBeVisible();
    await expect(source).toContainText("Dear {{First Name}},");
    await beat(page, 1000);
    await shoot(page, "demo-09-imported");
  });

  // ── 10. Copilot prompt ─────────────────────────────────────────────────────

  await test.step("10. Maya copies the Copilot prompt, then pastes back text with {{purchase_apr}}: it becomes a chip", async () => {
    // The import left the rail on Original; Copilot prompt is at the end of the Variables view.
    const variablesTab = page.getByRole("tab", { name: "Variables", exact: true }).filter({ visible: true });
    await click(variablesTab);
    await expect(page.locator('[data-slot="rail"]').filter({ visible: true })).toHaveAttribute("data-view", "variables");
    const copilot = page.getByRole("button", { name: "Copilot prompt" }).filter({ visible: true });
    await click(copilot);
    const dialog = page.getByRole("dialog", { name: "Prompt for Copilot" });
    await expect(dialog).toBeVisible();
    // The prompt is built on the server from the saved draft: it arrives a moment after the dialog.
    await expect(dialog.getByLabel("Prompt")).toContainText("Help me write the body of", { timeout: 20_000 });
    const prompt = (await dialog.getByLabel("Prompt").textContent()) ?? "";
    expect(prompt).toContain(`Template: ${IMPORTED_NAME}`);
    expect(prompt).toContain("{{purchase_apr}}");
    const copy = dialog.getByRole("button", { name: "Copy prompt" });
    await expect(copy).toBeFocused();
    await tap(copy);
    await expect(dialog.getByRole("status")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
    await beat(page, 900);
    await shoot(page, "demo-10-prompt");
    await tap(dialog.getByRole("button", { name: "Close" }));
    await expect(dialog).toBeHidden();

    const body = documentEditor(page);
    const chipsBefore = await chip(page, "purchase_apr").count();
    const anchor = "Terms apply to every transfer.";
    await tap(body.getByText(anchor));
    await page.keyboard.press("End");
    await expect.poll(async () => (await caret(page)).block.endsWith(anchor)).toBe(true);
    await page.evaluate((text) => navigator.clipboard.writeText(text), COPILOT_ANSWER);
    await page.keyboard.press("ControlOrMeta+v");
    await expect(chip(page, "purchase_apr"), "the pasted {{purchase_apr}} is a chip").toHaveCount(chipsBefore + 1);
    await expect(body).not.toContainText("{{purchase_apr}}");
    await expect(body).toContainText("No foreign transaction fee");
    await expect(body.locator("h2[data-required]"), "the heading merged into its section").toHaveText(["Offer details", "Rates and fees", "Legal notices"]);
    await expectAutosaved(page);
    await beat(page, 900);
    await shoot(page, "demo-10-pasted");
  });

  // ── 11. Reset ──────────────────────────────────────────────────────────────

  await test.step("11. Reset from the demo drawer returns the seeded data and the starting clock date", async () => {
    const drawer = await openDemoDrawer(page);
    await expect(drawer.getByText(`+${ADVANCE_DAYS + PAST_DEADLINE_DAYS} days from today`)).toBeVisible();
    await beat(page, 700);
    await shoot(page, "demo-11-drawer-before");
    await click(drawer.getByRole("button", { name: "Reset demo" }));
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Maya Chen");
    await beat(page, 700);
    await click(confirm.getByRole("button", { name: "Reset", exact: true }));
    await expect(page).toHaveURL(/\/coral-offers\/library$/, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: /profile and persona/ })).toHaveAccessibleName(/^Maya Chen,/);
    await expect(libraryRows(page)).toHaveCount(SEEDED_CORAL.length, { timeout: 20_000 });
    for (const name of SEEDED_CORAL) await expect(libraryRows(page).filter({ hasText: name })).toHaveCount(1);
    await expect(libraryRows(page).filter({ hasText: /Spring/ }), "the story's templates are gone").toHaveCount(0);

    const after = await openDemoDrawer(page);
    await expect(after.getByText("Real time"), "the clock is back on the starting date").toBeVisible({ timeout: 20_000 });
    await beat(page, 900);
    await shoot(page, "demo-11-reset");
    await page.keyboard.press("Escape");
    await expect(after).toBeHidden();

    expect(await clockDay(db)).toBe(new Date().toISOString().slice(0, 10));
    const [bt] = await rows(db, "SELECT v.state, v.revoke FROM versions v JOIN templates t ON t.id = v.template_id WHERE v.name = ? AND v.number = 1", [BT_NAME]);
    expect(bt, "Balance Transfer v1's revoke is undone").toMatchObject({ state: "superseded", revoke: null });
    const [sam] = await rows(db, "SELECT status FROM memberships WHERE user_id = 'sam' AND team_id = ?", [TEAM]);
    expect(sam.status, "Sam's access is back").toBe("active");
    expect(await rows(db, "SELECT id FROM templates WHERE id IN (?, ?)", [springId, importedId])).toEqual([]);
  });
});
