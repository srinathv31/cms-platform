import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import {
  CUSTOMERS,
  FIVE,
  SPRING_NAME,
  SPRING_OFFER_NAME,
  TEAM,
  backToUcomp,
  click,
  createSpringTravel,
  dropDemoNoise,
  escapeRe,
  json,
  openDemoDrawer,
  openOffer,
  reactReady,
  restore,
  resultsHeadline,
  resultsRows,
  rows,
  selectCustomers,
  send,
  sendButton,
  takeSnapshot,
  type Snapshot,
  type SpringFixture,
} from "./helpers/golive";
import { asPersona, beat, demoTimeout, expect, hydrated, openLibrary, shoot, test, typeSlowly } from "./helpers/scenario";

// Phase 5 gate: demo scenario 4 ("Going live"), start to finish.
//
//   1. Maya opens the simulator from the Demo pill ("Coral — simulated", an outside app). Spring Travel
//      Rewards has no template linked.
//   2. She links the offer: UCOMP's search finds the template by name; the link pins the Active version
//      (v2); the three channels are on; she maps the variables (each is a combobox named by its label).
//      Linking lands on Send.
//   3. She sends to five customers, the long-name one among them. Every render (customer x channel) shows
//      Delivered: 15 of 15.
//   4. She opens one in the phone frame, switches that customer to the inbox and to the PDF (Open PDF is a
//      real PDF), then the long-name customer's phone view: the layout holds (no sideways overflow).
//   5. Usage reflects the renders: the Consumers table on the team dashboard and the template's own Usage tab
//      both say Coral rendered v2 fifteen times.
//   6. The render log holds no customer values: not a name, an email address or an APR, in render_log or
//      anywhere UCOMP writes (audit events, notifications, notices). Coral's own tables hold the deliveries.
//
// Self-contained, like scenario 3: a fixture inserts "Spring Travel Rewards — Terms" with v2 Active (as Maya
// and Jordan would have left it), and afterAll removes everything this run wrote (the template and its rows,
// Coral's link and deliveries, the render_log rows of those sends, the reads of notices) and puts the clock
// back. Console and page errors fail it.
//
// Run it against a HEALTHY server (see scenario 3's note about playwright.config.ts).

// The preview frames are sandboxed; Playwright's trace injects scripts into them ("Blocked script execution").
test.use({ trace: "off", screenshot: "only-on-failure" });

let db: Client;
let fixture: SpringFixture | null = null;
let snapshot: Snapshot;

test.beforeAll(async () => {
  db = openDb();
  snapshot = await takeSnapshot(db);
  fixture = await createSpringTravel(db);
});

test.afterEach(({ problems }) => dropDemoNoise(problems));

test.afterAll(async () => {
  if (!db) return;
  try {
    if (snapshot) await restore(db, snapshot, { templates: fixture ? [fixture.templateId] : [] });
  } finally {
    db.close();
  }
});

/** The mapping row's combobox, named by the variable's label. */
const mapping = (page: Page, label: string) => page.getByRole("table", { name: "Variables" }).getByRole("combobox", { name: label, exact: true });

/** Picks the Coral field for a variable (a native select: it saves in the page on change). */
async function mapTo(page: Page, label: string, field: string) {
  const select = mapping(page, label);
  await select.scrollIntoViewIfNeeded();
  await select.selectOption({ label: field });
  await expect(select.locator("option:checked")).toHaveText(field);
}

/** The customer view, a non-modal side dialog named "{Customer} · {Channel}". */
const customerView = (page: Page, customer: string, channel: string) => page.getByRole("dialog", { name: `${customer} · ${channel}`, exact: true });

/** The delivered cell of the results grid: "Delivered, view {Name} · {PDF|Web|Email}". */
const delivered = (page: Page, customer: string, channel: string) =>
  page.getByRole("table", { name: "Results" }).getByRole("button", { name: new RegExp(`^Delivered\\s*,\\s*view ${escapeRe(customer)} · ${channel}$`) });

test.describe("scenario 4: going live", () => {
  test("Maya links the offer to Spring Travel v2, sends to five customers, all are delivered; Usage shows it and the render log holds no customer values", async ({ page, request }) => {
    test.setTimeout(demoTimeout(240_000));
    const { templateId, v2Id } = fixture!;

    // ── 1. The simulator, from the Demo pill ─────────────────────────────────

    await asPersona(page, "maya");
    await openLibrary(page, TEAM);
    await beat(page, 800);

    await test.step("1. The Demo pill opens the simulator: Coral, an outside app, with Spring Travel Rewards not linked", async () => {
      const drawer = await openDemoDrawer(page);
      await expect(drawer.getByRole("button", { name: "Open simulator" })).toBeVisible();
      await beat(page, 700);
      await click(drawer.getByRole("button", { name: "Open simulator" }));
      await expect(page).toHaveURL(/\/sim$/);

      await expect(page.getByText("Coral — simulated", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to Stencil" })).toBeVisible();
      const offers = page.getByRole("table", { name: "Offers" });
      await expect(offers).toBeVisible();
      await expect(offers.getByRole("link", { name: SPRING_OFFER_NAME, exact: true })).toBeVisible();
      const spring = offers.getByRole("row").filter({ has: page.getByRole("link", { name: SPRING_OFFER_NAME, exact: true }) });
      await expect(spring, "the offer has no template linked").toContainText("Not linked");
      await reactReady(offers.getByRole("link").first());
      await beat(page, 900);
      await shoot(page, "simulator-offers");
    });

    // ── 2. Link the template, found by search, pinned to v2 ──────────────────

    await test.step("2.1 She opens the offer and chooses Link template", async () => {
      await openOffer(page, SPRING_OFFER_NAME);
      await expect(page.getByRole("tab", { name: "Template", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText("No template linked.")).toBeVisible();
      await beat(page);
      await click(page.getByRole("link", { name: "Link template" }).or(page.getByRole("button", { name: "Link template" })).first());
      await expect(page).toHaveURL(/\/sim\/offers\/offer_spring_travel\/link$/);
      await expect(page.getByRole("heading", { level: 1, name: "Link a template" })).toBeVisible();
    });

    await test.step("2.2 UCOMP's search finds the template by name; only Active templates are offered", async () => {
      const search = page.getByRole("searchbox", { name: "Search templates" });
      await reactReady(search);
      await click(search);
      await typeSlowly(page, "Spring Travel");
      // The list answers the whole query (it says it is busy while a newer search is on its way and may reorder).
      await expect(page.getByRole("list", { name: "Templates" })).toHaveAttribute("aria-busy", "false");
      const result = page.getByRole("list", { name: "Templates" }).getByRole("button", { name: new RegExp(`^${SPRING_NAME}`) }).filter({ hasText: templateId });
      await expect(result, "the template is found by name").toHaveCount(1);
      await expect(result).toContainText(templateId);
      await expect(result).toContainText("Active v2");
      await beat(page, 900);
      await shoot(page, "link-search");
      await click(result);
      await expect(page).toHaveURL(new RegExp(`/link\\?template=${templateId}$`));
    });

    await test.step("2.3 The link pins v2, with all three channels on; she maps the variables", async () => {
      await expect(page.getByText("Version", { exact: true })).toBeVisible();
      await expect(page.getByText("v2", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("group", { name: "Channels" }).or(page.locator("fieldset")).first()).toBeVisible();
      for (const channel of ["PDF", "Web", "Email"]) await expect(page.getByRole("checkbox", { name: channel, exact: true })).toBeChecked();

      const variables = page.getByRole("table", { name: "Variables" });
      await expect(variables).toBeVisible();
      await expect(variables.getByRole("combobox")).toHaveCount(5);
      await reactReady(variables.getByRole("combobox").first());
      await beat(page, 700);
      await mapTo(page, "First name", "Customer · First name");
      await mapTo(page, "Last name", "Customer · Last name");
      await mapTo(page, "Purchase APR", "Customer · Purchase APR");
      await mapTo(page, "Home state", "Customer · Home state");
      await mapTo(page, "Offer end date", "Offer · Ends on");
      await expect(page.getByText(/^Map .* to send\.$/), "nothing is left unmapped").toHaveCount(0);
      await beat(page, 900);
      await shoot(page, "link-map");
    });

    await test.step("2.4 Link template: Coral's link is pinned to v2 and Send opens", async () => {
      await click(page.getByRole("button", { name: "Link template", exact: true }));
      await expect(page).toHaveURL(/\/sim\/offers\/offer_spring_travel\?tab=send$/);
      await expect(page.getByRole("tab", { name: "Send", exact: true })).toHaveAttribute("aria-selected", "true");

      // Coral's own table holds the link: UCOMP's tables never see it.
      const [link] = await rows(db, "SELECT * FROM sim_links WHERE offer_id = 'offer_spring_travel'");
      expect(link).toMatchObject({ template_id: templateId, template_name: SPRING_NAME, pinned_version: 2 });
      expect(json(link.channels)).toEqual(["pdf", "web", "email"]);
      expect(json(link.mapping)).toEqual({
        first_name: "customer.firstName",
        last_name: "customer.lastName",
        purchase_apr: "customer.purchaseApr",
        home_state: "customer.homeState",
        offer_end_date: "offer.endsOn",
      });
      await beat(page, 700);
    });

    // ── 3. Send to five customers ────────────────────────────────────────────

    await test.step("3. She sends to five customers: every render shows Delivered", async () => {
      await expect(page.getByRole("table", { name: "Customers" })).toBeVisible();
      await reactReady(page.getByRole("checkbox", { name: "Select all customers" }));
      await expect(sendButton(page), "no customer chosen, no send").toBeDisabled();
      await selectCustomers(page, FIVE);
      await beat(page, 600);
      await send(page);

      // 5 customers x PDF, Web and Email = 15 renders. The first PDF warms the fonts: give it time.
      await expect(resultsHeadline(page)).toHaveText("15 delivered", { timeout: 90_000 });
      const grid = page.getByRole("table", { name: "Results" });
      await expect(resultsRows(page)).toHaveCount(5);
      for (const customer of FIVE) {
        const row = resultsRows(page).filter({ has: page.getByRole("rowheader", { name: customer.name, exact: true }) });
        await expect(row, `${customer.name} has a row`).toHaveCount(1);
        await expect(row.getByRole("button", { name: /^Delivered/ }), `${customer.name}: three renders delivered`).toHaveCount(3);
      }
      await expect(grid.getByText("Failed")).toHaveCount(0);
      await expect(grid.getByRole("columnheader")).toHaveText(["Customer", "PDF", "Web", "Email"]);
      await beat(page, 900);
      await resultsHeadline(page).scrollIntoViewIfNeeded();
      await shoot(page, "send-results");
    });

    // ── 4. The customer's view ───────────────────────────────────────────────

    await test.step("4.1 One customer in the phone frame: the disclosure as they would see it", async () => {
      const olivia = CUSTOMERS.olivia;
      await click(delivered(page, olivia.name, "Web"));
      const view = customerView(page, olivia.name, "Web");
      await expect(view).toBeVisible();
      await expect(view.getByRole("heading", { level: 2, name: olivia.name })).toBeVisible();
      const frame = page.frameLocator(`iframe[title="${olivia.name} · Web"]`);
      await expect(frame.locator("body")).toContainText(`Hi ${olivia.first} ${olivia.last}`, { timeout: 20_000 });
      await expect(frame.locator("body")).toContainText(olivia.apr);
      await expect(frame.getByRole("heading", { name: "Legal notices" })).toBeVisible();
      await expect(view.getByRole("button", { name: "Close", exact: true })).toBeFocused();
      await beat(page, 1200);
      await shoot(page, "customer-phone");
    });

    await test.step("4.2 The same customer, in the inbox and as the PDF; Open PDF is a real PDF", async () => {
      const olivia = CUSTOMERS.olivia;
      const switcher = page.getByRole("group", { name: "Customer view" });
      await expect(switcher.getByRole("button")).toHaveText(["Phone", "Inbox", "PDF"]);

      await click(switcher.getByRole("button", { name: "Inbox", exact: true }));
      const inbox = customerView(page, olivia.name, "Email");
      await expect(inbox).toBeVisible();
      await expect(inbox.getByRole("heading", { level: 3, name: `${olivia.first}, your Spring Travel Rewards terms` })).toBeVisible({ timeout: 20_000 });
      await expect(inbox).toContainText(`To ${olivia.email}`);
      await expect(page.frameLocator(`iframe[title="${olivia.name} · Email"]`).locator("body")).toContainText(`Hi ${olivia.first} ${olivia.last}`);
      await beat(page, 900);
      await shoot(page, "customer-inbox");

      await click(switcher.getByRole("button", { name: "PDF", exact: true }));
      const pdf = customerView(page, olivia.name, "PDF");
      await expect(pdf).toBeVisible();
      const open = pdf.getByRole("link", { name: "Open PDF" });
      await expect(open).toBeVisible({ timeout: 20_000 });
      const href = await open.getAttribute("href");
      expect(href, "Open PDF points at Coral's stored copy").toMatch(/^\/sim\/deliveries\/[^/]+\/file$/);
      const file = await request.get(href!);
      expect(file.status()).toBe(200);
      expect(file.headers()["content-type"]).toContain("application/pdf");
      const bytes = await file.body();
      expect(bytes.subarray(0, 5).toString("latin1"), "PDF bytes").toBe("%PDF-");
      expect(bytes.length, "a real document").toBeGreaterThan(2_000);
      // No still of the embedded PDF: the browsers these projects run (headless Chromium) have no PDF viewer, so
      // the frame would be blank paper. The file itself is what is checked above.
      await beat(page, 1200);
    });

    await test.step("4.3 The long-name customer: the layout holds in the grid, the drawer, the phone and the PDF", async () => {
      const long = CUSTOMERS.long;
      // The grid: the full name is on the row and the row stays inside the table.
      const rowHead = page.getByRole("table", { name: "Results" }).getByRole("rowheader", { name: long.name, exact: true });
      await rowHead.scrollIntoViewIfNeeded();
      await expect(rowHead).toBeVisible();
      const overflowing = await page
        .getByRole("table", { name: "Results" })
        .evaluate((table) => table.scrollWidth > (table.parentElement?.clientWidth ?? Infinity) + 1);
      expect(overflowing, "the results grid doesn't scroll sideways for the long name").toBe(false);

      await click(delivered(page, long.name, "Web"));
      const view = customerView(page, long.name, "Web");
      await expect(view).toBeVisible();
      await expect(view.getByRole("heading", { level: 2 })).toHaveText(long.name);
      const frame = page.frameLocator(`iframe[title="${long.name} · Web"]`);
      await expect(frame.locator("body")).toContainText(`Hi ${long.first} ${long.last}`, { timeout: 20_000 });
      // The document in the phone doesn't scroll sideways, and the drawer doesn't either.
      const sideways = await frame.locator("html").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(sideways, "the web page holds its width").toBe(false);
      const drawerSideways = await view.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(drawerSideways, "the drawer holds its width").toBe(false);
      await beat(page, 1000);
      await shoot(page, "customer-long-name");

      // And as the PDF: the document exists and is a PDF.
      await click(page.getByRole("group", { name: "Customer view" }).getByRole("button", { name: "PDF", exact: true }));
      const open = customerView(page, long.name, "PDF").getByRole("link", { name: "Open PDF" });
      await expect(open).toBeVisible({ timeout: 20_000 });
      const file = await request.get((await open.getAttribute("href"))!);
      expect(file.status()).toBe(200);
      expect((await file.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

      // Esc closes the drawer, and the focus goes back to the cell it came from.
      await page.keyboard.press("Escape");
      await expect(customerView(page, long.name, "PDF")).toHaveCount(0);
      await beat(page, 600);
    });

    // ── 5. Usage reflects the renders ────────────────────────────────────────

    await test.step("5.1 Back in UCOMP, the team's Usage: Coral renders Spring Travel v2, 15 times", async () => {
      await backToUcomp(page);
      await hydrated(page);
      await page.locator('[data-slot="sidebar-menu-button"][href$="/usage"]').filter({ visible: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/usage$`));
      await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
      await expect(page.getByText("Renders · 30 days").first()).toBeVisible();
      await click(page.getByRole("tab", { name: "Consumers", exact: true }));
      const table = page.getByRole("table", { name: "Consumers" });
      await expect(table).toBeVisible();
      // By the template's own link: other specs leave templates of the same name behind (scenario 2's).
      const row = table.getByRole("row").filter({ has: page.locator(`a[href$="/templates/${templateId}/usage"]`) });
      await expect(row, "Coral's row for the new template").toHaveCount(1);
      await expect(row).toContainText("Coral");
      await expect(row).toContainText("v2");
      await expect(row.getByRole("cell").nth(3), "renders in the last 30 days").toHaveText("15");
      await beat(page, 900);
      await row.scrollIntoViewIfNeeded();
      await shoot(page, "usage-consumers");
    });

    await test.step("5.2 The template's own Usage tab: who renders it, and how often", async () => {
      await page.goto(`/${TEAM}/templates/${templateId}/usage`);
      await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
      await hydrated(page);
      const usage = page.locator('section[data-slot="usage"]').filter({ visible: true });
      await expect(usage.getByText("Renders · 30 days")).toBeVisible();
      await expect(usage.locator(".numeral").first(), "the stat").toHaveText("15");
      const who = usage.getByRole("table", { name: "Who renders it" });
      const row = who.getByRole("row").filter({ hasText: "Coral" });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("v2");
      await expect(row.getByRole("cell").nth(2), "renders").toHaveText("15");
      await beat(page, 900);
      await shoot(page, "usage-template");
    });

    // ── 6. The render log holds no customer values ───────────────────────────

    await test.step("6. The render log: 15 live renders by Coral, and not one customer value in anything UCOMP wrote", async () => {
      const log = await rows(db, "SELECT * FROM render_log WHERE template_id = ? ORDER BY at, id", [templateId]);
      expect(log, "one row per customer and channel").toHaveLength(15);
      for (const entry of log) {
        expect(entry).toMatchObject({ consumer_id: "coral", version_id: v2Id, version_number: 2, is_preview: 0, outcome: "ok", error_code: null });
      }
      const byChannel = (channel: string) => log.filter((entry) => entry.channel === channel).length;
      expect([byChannel("pdf"), byChannel("web"), byChannel("email")], "five of each channel").toEqual([5, 5, 5]);
      expect(new Set(log.map((entry) => entry.correlation_id)).size, "each render has its own correlation id").toBe(15);

      // The log's columns are metadata only.
      const columns = Object.keys(log[0]).sort();
      expect(columns).toEqual(["at", "channel", "consumer_id", "correlation_id", "duration_ms", "error_code", "id", "is_preview", "outcome", "template_id", "version_id", "version_number"]);

      // None of the five customers' values is anywhere UCOMP wrote for this template: the log, the audit
      // events, the notifications, the consumer notices.
      const written = [
        ...log,
        ...(await rows(db, "SELECT * FROM audit_events WHERE template_id = ?", [templateId])),
        ...(await rows(db, "SELECT * FROM notifications WHERE href LIKE ?", [`%/${templateId}%`])),
        ...(await rows(db, "SELECT * FROM consumer_notices WHERE template_id = ?", [templateId])),
      ];
      const haystack = JSON.stringify(written);
      for (const customer of FIVE) {
        for (const value of [customer.first, customer.last, customer.email]) expect(haystack, `"${value}" is not in UCOMP's data`).not.toContain(value);
      }
      for (const apr of new Set(FIVE.map((c) => c.apr))) expect(haystack, `"${apr}" is not in UCOMP's data`).not.toContain(apr);

      // Coral's own tables hold the deliveries (with the customers' values, rendered), all delivered.
      const deliveries = await rows(db, "SELECT * FROM sim_deliveries WHERE template_id = ? ORDER BY id", [templateId]);
      expect(deliveries).toHaveLength(15);
      for (const delivery of deliveries) expect(delivery).toMatchObject({ status: "delivered", error: null, template_id: templateId, version_number: 2 });
      expect(new Set(deliveries.map((d) => d.customer_id)).size).toBe(5);
    });
  });
});
