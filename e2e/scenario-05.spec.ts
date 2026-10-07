import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { expectError, longDate, openDb } from "./api/helpers";
import {
  CUSTOMERS,
  SPRING_NAME,
  SPRING_OFFER_NAME,
  TEAM,
  backToUcomp,
  clockDay,
  click,
  coralRender,
  createSpringTravel,
  dropDemoNoise,
  escapeRe,
  expectFailed,
  json,
  linkSpringOffer,
  openDemoDrawer,
  openOffer,
  openOfferTab,
  openSimulator,
  reactReady,
  restore,
  resultsHeadline,
  resultsRows,
  rows,
  selectCustomers,
  send,
  switchPersona,
  takeSnapshot,
  type Snapshot,
  type SpringFixture,
} from "./helpers/golive";
import {
  asPersona,
  beat,
  caret,
  demoTimeout,
  documentEditor,
  expect,
  expectAutosaved,
  hydrated,
  liveEditor,
  openLibrary,
  panelRow,
  shoot,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// Phase 5 gate: demo scenario 5 ("Breaking change, pin and sunset"), start to finish.
//
//   0. The fixture: Spring Travel Rewards v2 is Active, Coral's offer is linked to it (pinned to v2) and Coral
//      has rendered it once (a live render through the API). Without that render nothing would name Coral:
//      notices and the consequence text only name a consumer that rendered the template.
//   1. Maya edits (the Edit button opens a draft), creates the required `annual_fee` (Currency) in the text and
//      submits v3. The submit dialog flags the breaking change.
//   2. Jordan opens v3: the rail shows the contract change (breaking). He approves, and sets v2's sunset 14 days
//      out in the same dialog; the consequence text names Coral, and says it has to map `annual_fee`. v3 is
//      Active, v2 Superseded with its sunset.
//   3. Coral's simulator: the offer shows "v3 available" and still sends on v2 (delivered, "Newer: v3").
//   4. The Demo pill advances the clock 15 days: Coral's send fails with the sunset message, verbatim.
//   5. Coral relinks to v3: the mapping asks for `annual_fee`; "Offer · Annual fee" fills it; the send succeeds.
//   6. Usage shows who is on what: the Failing and On superseded filters both find Coral on v2.
//
// Standalone: the fixture inserts Spring Travel v2 Active and Coral's link; afterAll removes everything this run
// wrote (the template, its rows, Coral's link and deliveries, the render_log rows of those sends) and puts the
// clock back to what it was, however the run ended. Console and page errors fail it.

// The preview frames are sandboxed; Playwright's trace injects scripts into them ("Blocked script execution").
test.use({ trace: "off", screenshot: "only-on-failure" });

const NOTE_V3 = "Added the annual fee.";
const FEE_SENTENCE = " The annual fee is {{Annual fee";
const SUNSET_DAYS = 14;
const ADVANCE_DAYS = 15;

let db: Client;
let fixture: SpringFixture | null = null;
let snapshot: Snapshot;

test.beforeAll(async () => {
  db = openDb();
  snapshot = await takeSnapshot(db);
  fixture = await createSpringTravel(db);
  await linkSpringOffer(db, fixture);
});

test.afterEach(({ problems }) => dropDemoNoise(problems));

test.afterAll(async () => {
  if (!db) return;
  try {
    // The clock first and always: the other specs run on the real day.
    if (snapshot) await restore(db, snapshot, { templates: fixture ? [fixture.templateId] : [] });
  } finally {
    db.close();
  }
});

// ── The screens (product) ────────────────────────────────────────────────────

const reviewNav = (page: Page) => page.locator('[data-slot="sidebar-menu-button"][href$="/review"]').filter({ visible: true });
const usageNav = (page: Page) => page.locator('[data-slot="sidebar-menu-button"][href$="/usage"]').filter({ visible: true });
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) => decision(page).getByRole("button", { name: "Approve", exact: true });
const queueTab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${escapeRe(name)}`) });
const queueRow = (page: Page, id: string, number: number) => page.locator(`a[href="/${TEAM}/review/${id}/${number}"]`).filter({ visible: true });

/** The text paragraph of the document that holds this text. */
const block = (page: Page, text: string) => documentEditor(page).locator("p", { hasText: text });

// ── The screens (Coral) ──────────────────────────────────────────────────────

const offerRow = (page: Page) =>
  page.getByRole("table", { name: "Offers" }).getByRole("row").filter({ has: page.getByRole("link", { name: SPRING_OFFER_NAME, exact: true }) });

/** The failed cells of the results grid, each one's text. */
const failedCells = (page: Page) => page.getByRole("table", { name: "Results" }).locator("td").filter({ hasText: "Failed" });

/** The Send tab: two customers, send, and the headline. */
async function sendToTwo(page: Page) {
  await openOfferTab(page, "Send");
  // The customers picker starts empty (a new page state).
  await expect(page.getByRole("table", { name: "Customers" })).toBeVisible();
  await selectCustomers(page, [CUSTOMERS.olivia, CUSTOMERS.marcus]);
  await beat(page, 500);
  await send(page);
}

/** Picks a day in the sunset popover (react-day-picker's `data-day` is the locale date, M/D/YYYY). */
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

test.describe("scenario 5: breaking change, pin and sunset", () => {
  test("Maya adds a required annual_fee in v3; Jordan approves it and sunsets v2; Coral sees v3, keeps sending on v2, then fails at the sunset and relinks to v3", async ({ page, request }) => {
    test.setTimeout(demoTimeout(360_000));
    const { templateId, v2Id } = fixture!;
    let v3Id = "";
    let sunsetDay = "";

    // ── 0. Coral has rendered v2 ─────────────────────────────────────────────

    await test.step("0. Before: Coral renders v2 through the API (so the notices and the consequence text name Coral)", async () => {
      const { res } = await coralRender(request, fixture!, 2, "scenario05-before");
      expect(res.status(), "Coral renders the Active v2").toBe(200);
      expect(res.headers()["x-stencil-version"]).toBe("2");
      const [link] = await rows(db, "SELECT * FROM sim_links WHERE offer_id = 'offer_spring_travel'");
      expect(link).toMatchObject({ template_id: templateId, pinned_version: 2 });
    });

    // ── 1. Maya edits and submits v3 ─────────────────────────────────────────

    await asPersona(page, "maya");
    await openLibrary(page, TEAM);
    await beat(page, 800);

    await test.step("1.1 Maya opens Spring Travel (Active, v2) and presses Edit: a draft opens", async () => {
      await click(page.locator(`main a[href="/${TEAM}/templates/${templateId}"]`).filter({ visible: true }));
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/templates/${templateId}$`));
      await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
      await expect(statusBadge(page)).toHaveText("Active");
      await hydrated(page);
      await beat(page);
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      await reactReady(edit);
      // One press opens the draft (it used to need a second when a busy SQLite file failed the first).
      await click(edit);
      await expect(statusBadge(page)).toHaveText("Draft");
      await expect(page.locator("header").filter({ visible: true }).getByText("Based on v2", { exact: true })).toBeVisible();
      await liveEditor(page);
      await expect(documentEditor(page)).toHaveAttribute("contenteditable", "true");
    });

    await test.step("1.2 She creates `annual_fee` (Currency, required) in the text", async () => {
      const paragraph = block(page, "Open your account by");
      await paragraph.scrollIntoViewIfNeeded();
      const box = (await paragraph.boundingBox())!;
      const end = { x: box.width - 4, y: box.height - 10 };
      await untilUncovered(paragraph, end);
      await tap(paragraph, { position: end });
      await page.keyboard.press("End");
      await expect.poll(async () => (await caret(page)).focused).toBe(true);
      await expect.poll(async () => (await caret(page)).block.startsWith("Open your account by"), { message: "the caret is in that paragraph" }).toBe(true);

      await typeSlowly(page, FEE_SENTENCE);
      const create = page.getByRole("option", { name: /Create/ });
      await expect(create).toContainText("Annual fee");
      await beat(page);
      await page.keyboard.press("Enter");
      const form = page.getByRole("form", { name: "New variable" });
      await expect(form).toBeVisible();
      await expect(form.getByLabel("Label")).toBeFocused();
      await expect(form.getByLabel("Key")).toHaveValue("annual_fee");
      await tap(form.getByRole("combobox"));
      await tap(page.getByRole("option", { name: "Currency" }));
      await expect(form.getByRole("combobox")).toHaveText(/Currency/);
      await expect(form.getByRole("switch", { name: "Required" }), "a new variable is required").toBeChecked();
      await beat(page, 500);
      await expect(form.getByRole("combobox")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(form).toBeHidden();
      await expect(documentEditor(page).locator('[data-variable="annual_fee"]')).toHaveCount(1);
      await expect(documentEditor(page).locator('[data-variable="annual_fee"]')).toHaveAttribute("data-variable-type", "currency");
      await expect(panelRow(page, "annual_fee")).toContainText("1 use");
      await typeSlowly(page, ".");
      await expectAutosaved(page);
      await beat(page, 800);
      await shoot(page, "annual-fee-added");
    });

    await test.step("1.3 She submits v3: the dialog flags the breaking change", async () => {
      const submit = page.getByRole("button", { name: "Submit for review" });
      await expect(submit).toBeEnabled();
      await tap(submit);
      const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      const contract = dialog.getByText("Contract changes", { exact: true }).locator("xpath=ancestor::section[1]");
      await expect(contract).toContainText("Breaking change");
      await expect(contract).toContainText("adds required");
      await expect(contract).toContainText("annual_fee");
      await expect(contract.getByText("Breaking: ", { exact: false })).toHaveCount(1);
      const note = dialog.getByRole("textbox", { name: "Note to reviewers" });
      await expect(note).toBeFocused();
      await typeSlowly(page, NOTE_V3);
      await beat(page, 900);
      await shoot(page, "submit-breaking");

      await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });

      const [v3] = await rows(db, "SELECT * FROM versions WHERE template_id = ? AND number = 3", [templateId]);
      expect(v3).toMatchObject({ state: "in_review", submitted_by: "maya", submit_note: NOTE_V3 });
      v3Id = String(v3.id);
      const changes = json(v3.contract_changes) as { kind: string; key: string; breaking: boolean }[];
      expect(changes.filter((c) => c.breaking).map((c) => [c.kind, c.key]), "one breaking change: the new required variable").toEqual([["added", "annual_fee"]]);
      expect((json(v3.variables) as { key: string; required: boolean; type: string }[]).find((v) => v.key === "annual_fee")).toMatchObject({ required: true, type: "currency" });
      // v2 is untouched until v3 is approved.
      expect((await rows(db, "SELECT state, sunset_at FROM versions WHERE id = ?", [v2Id]))[0]).toMatchObject({ state: "active", sunset_at: null });
    });

    // ── 2. Jordan approves, with a sunset for v2 ─────────────────────────────

    await test.step("2.1 Jordan opens v3 from the queue: the rail shows the contract change, marked breaking", async () => {
      await beat(page);
      await switchPersona(page, "Jordan Ellis");
      await click(reviewNav(page));
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/review$`));
      await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
      await expect(queueTab(page, "Waiting on me")).toHaveAttribute("aria-selected", "true");
      const row = queueRow(page, templateId, 3);
      await expect(row, "v3 waits on Jordan").toBeVisible();
      await expect(row).toContainText("Breaking");
      await beat(page, 600);
      await click(row);
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/review/${templateId}/3$`));
      await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
      await liveEditor(page);
      await hydrated(page);

      const contract = decision(page).getByRole("region", { name: "Contract changes" });
      await expect(contract).toBeVisible();
      await expect(contract).toContainText("Breaking change");
      await expect(contract).toContainText("adds required");
      await expect(contract).toContainText("annual_fee");
      await expect(contract.getByLabel("Breaking")).toHaveCount(1);
      await expect(approveButton(page)).toBeEnabled();
      await beat(page, 900);
      await shoot(page, "review-breaking");
    });

    await test.step("2.2 Approve: the dialog sets v2's sunset 14 days out; the consequence text names Coral", async () => {
      await click(approveButton(page));
      const dialog = page.getByRole("dialog", { name: "Approve v3" });
      await expect(dialog).toBeVisible();
      const consequences = dialog.locator('[data-slot="consequences"]');
      // Before a sunset date: Coral keeps rendering v2 until it relinks, and has to map annual_fee.
      await expect(dialog.locator('[data-slot="dialog-description"]')).toContainText("v3 becomes Active. v2 becomes Superseded; Coral keeps rendering v2 until it relinks.");
      await expect(consequences).toContainText("Coral has to map annual_fee before it moves to v3.");

      // Set a sunset date for v2, 14 days out (the demo clock's day).
      const toggle = dialog.getByRole("checkbox");
      await expect(toggle).not.toBeChecked();
      await click(dialog.getByText("Set a sunset date for v2", { exact: true }));
      await expect(toggle).toBeChecked();
      sunsetDay = await clockDay(db, SUNSET_DAYS);
      await click(dialog.getByRole("button", { name: /^Sunset date/ }));
      await pickDay(page, sunsetDay);
      await expect(dialog.getByRole("button", { name: `Sunset date, ${longDate(`${sunsetDay}T00:00:00Z`)}` })).toBeVisible();

      // The consequence text now names Coral and the day.
      const sunsetLong = longDate(`${sunsetDay}T00:00:00Z`);
      await expect(consequences).toContainText(/Coral still renders v2 \(last render .+\)\. It will keep working until /);
      await expect(consequences).toContainText(`It will keep working until ${sunsetLong}.`);
      await expect(consequences).toContainText("Coral has to map annual_fee before it moves to v3.");
      await beat(page, 1000);
      await shoot(page, "approve-sunset");

      await click(dialog.getByRole("button", { name: "Approve v3", exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      const moment = page.locator("[data-go-live]");
      await expect(moment, "the go-live moment plays").toBeVisible({ timeout: 10_000 });
      await expect(moment).toHaveCount(0, { timeout: 15_000 });
      await expect(statusBadge(page)).toHaveText("Active");
      await beat(page, 1000);
    });

    await test.step("2.3 The database: v3 Active, v2 Superseded with its sunset, Coral told", async () => {
      const [v2] = await rows(db, "SELECT * FROM versions WHERE id = ?", [v2Id]);
      const [v3] = await rows(db, "SELECT * FROM versions WHERE id = ?", [v3Id]);
      expect(v3.state).toBe("active");
      expect(v2.state).toBe("superseded");
      expect(v2.sunset_at, "sunset at the start of the chosen day").toBe(Date.parse(`${sunsetDay}T00:00:00Z`));
      expect(v2.sunset_set_by).toBe("jordan");

      const notices = await rows(db, "SELECT * FROM consumer_notices WHERE template_id = ? ORDER BY created_at, id", [templateId]);
      expect(notices.length, "Coral rendered v2, so Coral is told").toBeGreaterThanOrEqual(1);
      expect(notices.every((n) => n.consumer_id === "coral"), "only Coral rendered it").toBe(true);
      expect(JSON.stringify(notices.map((n) => json(n.payload)))).toContain(SPRING_NAME);
    });

    // ── 3. Coral: v3 available, still sending on v2 ──────────────────────────

    await test.step("3.1 The simulator: the offer shows v3 available, and v2's sunset", async () => {
      await openSimulator(page);
      const row = offerRow(page);
      await expect(row).toContainText("v3 available");
      await expect(row).toContainText("Superseded");
      await expect(row).toContainText("sunset");
      await expect(row.getByText("v2", { exact: true })).toBeVisible();
      await beat(page, 900);
      await shoot(page, "simulator-v3-available");

      await openOffer(page, SPRING_OFFER_NAME);
      await expect(page.getByText("v3 available", { exact: true }).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByText("Pinned to v2", { exact: true })).toBeVisible();
      const strip = page.getByText(/Stencil released v3\./);
      await expect(strip).toContainText("annual_fee");
      await beat(page, 900);
      await shoot(page, "simulator-offer-upgrade");
    });

    await test.step("3.2 It still sends on v2: delivered, with the newer version noted", async () => {
      await sendToTwo(page);
      await expect(resultsHeadline(page)).toHaveText("6 delivered", { timeout: 90_000 });
      await expect(resultsRows(page)).toHaveCount(2);
      await expect(page.getByRole("table", { name: "Results" }).getByText("Newer: v3").first()).toBeVisible();
      await expect(failedCells(page)).toHaveCount(0);
      await expect(page.getByText(/v2 · /).first()).toBeVisible();
      await beat(page, 900);
      await resultsHeadline(page).scrollIntoViewIfNeeded();
      await shoot(page, "send-on-v2");

      const sent = await rows(db, "SELECT * FROM sim_deliveries WHERE template_id = ? ORDER BY id", [templateId]);
      expect(sent).toHaveLength(6);
      for (const delivery of sent) expect(delivery).toMatchObject({ status: "delivered", version_number: 2, newer_version: 3 });
    });

    // ── 4. Advance the clock 15 days: the sunset has passed ──────────────────

    await test.step("4. The Demo pill advances the clock 15 days: Coral's send fails with the sunset message", async () => {
      const before = await clockDay(db);
      const drawer = await openDemoDrawer(page);
      await beat(page, 600);
      await click(drawer.getByRole("button", { name: `+${ADVANCE_DAYS} days`, exact: true }));
      await expect.poll(() => clockDay(db), { message: "the clock moved" }).not.toBe(before);
      expect(await clockDay(db)).toBe(new Date(Date.parse(`${before}T00:00:00Z`) + ADVANCE_DAYS * 86_400_000).toISOString().slice(0, 10));
      await beat(page, 600);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Demo" })).toHaveCount(0);

      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: SPRING_OFFER_NAME })).toBeVisible();
      await reactReady(page.getByRole("tab", { name: "Template" }));
      await expect(page.getByText("A send now fails.")).toBeVisible();
      await expect(page.getByText("Sunset passed", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/v2 stopped rendering on /)).toBeVisible();

      await sendToTwo(page);
      await expect(resultsHeadline(page)).toHaveText("0 delivered, 6 failed", { timeout: 90_000 });
      const message = `Version 2 was sunset on ${longDate(`${sunsetDay}T00:00:00Z`)}. Version 3 is active.`;
      await expectFailed(page, 6, { status: 410, code: "version_sunset", message });
      await beat(page, 900);
      await resultsHeadline(page).scrollIntoViewIfNeeded();
      await shoot(page, "send-after-sunset");

      // The API's own words, stored by Coral as received.
      const failed = await rows(db, "SELECT * FROM sim_deliveries WHERE template_id = ? AND status = 'failed'", [templateId]);
      expect(failed).toHaveLength(6);
      for (const delivery of failed) expect(json(delivery.error)).toMatchObject({ status: 410, code: "version_sunset", message });

      // And the API says the same to anyone who asks.
      const { res } = await coralRender(request, fixture!, 2, "scenario05-sunset");
      await expectError(res, 410, "version_sunset", message);
    });

    // ── 5. Relink to v3 ──────────────────────────────────────────────────────

    await test.step("5.1 Relink to v3: what changed, then the mapping asks for annual_fee", async () => {
      await click(page.getByRole("link", { name: "Relink to v3" }).or(page.getByRole("button", { name: "Relink to v3" })).first());
      await expect(page).toHaveURL(new RegExp(`/link\\?template=${templateId}$`));
      await expect(page.getByRole("heading", { level: 1, name: "Relink to v3" })).toBeVisible();

      const changes = page.getByRole("table", { name: "Changes" });
      await expect(changes).toBeVisible();
      await expect(changes).toContainText("annual_fee");
      await expect(changes).toContainText("Added");
      const newValues = page.getByRole("table", { name: "New values" });
      const annualFee = newValues.getByRole("combobox", { name: "Annual fee", exact: true });
      await expect(annualFee, "annual_fee is never auto-mapped").toHaveValue("");
      await expect(page.getByText("Map Annual fee to send.")).toBeVisible();
      await reactReady(annualFee);
      await beat(page, 900);
      await shoot(page, "relink-map");

      await annualFee.selectOption({ label: "Offer · Annual fee" });
      await expect(annualFee.locator("option:checked")).toHaveText("Offer · Annual fee");
      await expect(page.getByText("Map Annual fee to send.")).toHaveCount(0);
      await beat(page, 700);
      await click(page.getByRole("button", { name: "Relink to v3", exact: true }));
      await expect(page).toHaveURL(/\/sim\/offers\/offer_spring_travel\?tab=send$/);

      const [link] = await rows(db, "SELECT * FROM sim_links WHERE offer_id = 'offer_spring_travel'");
      expect(link).toMatchObject({ template_id: templateId, pinned_version: 3 });
      expect(json(link.mapping)).toMatchObject({ annual_fee: "offer.annualFee", first_name: "customer.firstName" });
    });

    await test.step("5.2 The send on v3 succeeds, and the customer's view shows the fee", async () => {
      await expect(page.getByText("Pinned to v3", { exact: true })).toBeVisible();
      await expect(page.getByText("A send now fails.")).toHaveCount(0);
      await expect(page.getByRole("table", { name: "Customers" })).toBeVisible();
      await selectCustomers(page, [CUSTOMERS.olivia, CUSTOMERS.marcus]);
      await beat(page, 500);
      await send(page);
      await expect(resultsHeadline(page)).toHaveText("6 delivered", { timeout: 90_000 });
      await expect(failedCells(page)).toHaveCount(0);
      await expect(page.getByRole("table", { name: "Results" }).getByText(/Newer: v/)).toHaveCount(0);

      const delivered = (customer: string) =>
        page.getByRole("table", { name: "Results" }).getByRole("button", { name: new RegExp(`^Delivered\\s*,\\s*view ${escapeRe(customer)} · Web$`) });
      await click(delivered(CUSTOMERS.olivia.name));
      const frame = page.frameLocator(`iframe[title="${CUSTOMERS.olivia.name} · Web"]`);
      await expect(frame.locator("body")).toContainText(/annual fee is \$95/i, { timeout: 20_000 });
      await beat(page, 1200);
      await shoot(page, "send-on-v3");
      await page.keyboard.press("Escape");

      const latest = await rows(db, "SELECT * FROM sim_deliveries WHERE template_id = ? AND version_number = 3", [templateId]);
      expect(latest).toHaveLength(6);
      for (const delivery of latest) expect(delivery).toMatchObject({ status: "delivered", error: null, newer_version: null });
    });

    // ── 6. Usage: who is on what ─────────────────────────────────────────────

    await test.step("6. Usage: Coral's v2 shows under both On superseded and Failing", async () => {
      await backToUcomp(page);
      await hydrated(page);
      await click(usageNav(page));
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/usage$`));
      await click(page.getByRole("tab", { name: "Consumers", exact: true }));
      const table = page.getByRole("table", { name: "Consumers" });
      await expect(table).toBeVisible();
      const show = page.getByRole("group", { name: "Show" });
      const mine = () => table.getByRole("row").filter({ has: page.locator(`a[href$="/templates/${templateId}/usage"]`) });

      await expect(mine(), "v2 and v3 both have renders").toHaveCount(2);
      await click(show.getByRole("button", { name: "On superseded", exact: true }));
      await expect(show.getByRole("button", { name: "On superseded", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(mine()).toHaveCount(1);
      await expect(mine()).toContainText("v2");
      await expect(mine()).toContainText("Coral");
      await beat(page, 800);
      await mine().scrollIntoViewIfNeeded();
      await shoot(page, "usage-superseded");

      await click(show.getByRole("button", { name: "Failing", exact: true }));
      await expect(show.getByRole("button", { name: "Failing", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(mine()).toHaveCount(1);
      await expect(mine()).toContainText("v2");
      await expect(mine()).toContainText(/fail/i);
      await beat(page, 900);
      await shoot(page, "usage-failing");
    });
  });
});
