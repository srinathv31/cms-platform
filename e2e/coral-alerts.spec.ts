import type { Locator, Page } from "@playwright/test";
import {
  CUSTOMERS,
  TEAM,
  click,
  dropDemoNoise,
  escapeRe,
  openSimulator,
  reactReady,
  resultsHeadline,
  selectCustomers,
  send,
} from "./helpers/golive";
import {
  asPersona,
  beat,
  demoTimeout,
  expect,
  hydrated,
  shoot,
  test,
} from "./helpers/scenario";
import { viewEveryOutput } from "./helpers/review";
import { Changes, findVersion, renderLog } from "./helpers/state";

// Coral receives alerts: the push and SMS demo moment, start to finish.
//
//   1. Jordan approves the seeded Card Used Abroad alert (v1, in review): it goes live.
//   2. In Coral, the "Card used abroad" alert links it: the search lists alert templates only, Push and
//      SMS are on, and every variable maps to the customer's card on its own.
//   3. Coral sends it to Olivia (iPhone) and Marcus (Android): 4 delivered.
//   4. Olivia's phone: the lock screen shows the push with its iPhone subtitle; Messages shows the text with
//      the content type's footer, and what Stencil reported (GSM-7, 1 part).
//   5. Marcus's phone: the same push, without the subtitle (Android never shows one).
//   6. With Marcus's phone open, Coral sends to him again: the heads-up drops in (opened and closed, it is on
//      the lock screen), and his thread holds both texts, oldest first. Back on the push: the lock screen.
//   7. In Stencil, the alert's Usage tab splits its renders by channel: Push by iPhone and by Android, and SMS.
//
// afterAll puts back what the run changed: Card Used Abroad goes back in review (its version row, and the
// approval, audit events, notifications and notices the approval wrote), and Coral's link, deliveries and
// the render_log rows of those sends go. Console and page errors fail it.

test.use({ trace: "off", screenshot: "only-on-failure" });

const ALERT_NAME = "Card Used Abroad";
const CORAL_ALERT = "Card used abroad";
const CORAL_ALERT_ID = "alert_card_abroad";
const FOOTER = "Coral: Reply STOP to opt out, HELP for help.";

/** What Coral holds for the two customers (src/server/seed/sim.ts): their phones and their last purchase abroad. */
const OLIVIA = {
  ...CUSTOMERS.olivia,
  phone: "iPhone · (201) 555-0142",
  last4: "3417",
  purchase: "$48.20 at Café Lisboa in Portugal",
};
const MARCUS = {
  name: "Marcus Delgado",
  phone: "Android · (415) 555-0118",
  last4: "9052",
  purchase: "$23.75 at Barcelona Tapas Bar & Grill in Spain",
};

const changes = new Changes();
let abroad: { templateId: string; versionId: string; number: number };

test.beforeAll(async () => {
  const version = await findVersion({
    teamSlug: TEAM,
    name: ALERT_NAME,
    state: "in_review",
  });
  if (!version || version.number === null)
    throw new Error(
      `This spec needs the fresh seed (npm run db:reset): ${ALERT_NAME} in review.`,
    );
  abroad = {
    templateId: version.templateId,
    versionId: version.id,
    number: version.number,
  };
  // The approval writes a decision, audit events, notifications and notices, and moves the version; Coral's
  // side (its link, deliveries and the render log rows of those sends) goes first on the way back. The clock is
  // never moved here.
  await changes.watchTemplate(abroad.templateId);
  await changes.watchSimulator({ offers: [CORAL_ALERT_ID] });
});

test.afterEach(({ problems }) => dropDemoNoise(problems));

test.afterAll(() => changes.undo());

// ── The screens ──────────────────────────────────────────────────────────────

const decision = (page: Page): Locator =>
  page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const statusBadge = (page: Page) =>
  page
    .locator('header [data-slot="badge"][data-status]')
    .filter({ visible: true });

/** The customer view, a non-modal side dialog named "{Customer} · {Channel}". */
const customerView = (page: Page, customer: string, channel: "Push" | "SMS") =>
  page.getByRole("dialog", { name: `${customer} · ${channel}`, exact: true });

/** The delivered cell of the results grid: "Delivered, view {Name} · {Push|SMS}". */
const delivered = (page: Page, customer: string, channel: "Push" | "SMS") =>
  page.getByRole("table", { name: "Results" }).getByRole("button", {
    name: new RegExp(
      `^Delivered\\s*,\\s*view ${escapeRe(customer)} · ${channel}$`,
    ),
  });

/** The drawer's Notification / Messages switch. */
const viewSwitch = (page: Page, label: "Notification" | "Messages") =>
  page
    .getByRole("group", { name: "Customer view" })
    .getByRole("button", { name: label, exact: true });

/** The phone in the drawer: the kit's figure, named by its caption. */
const phone = (view: Locator) => view.locator("figure");
const field = (view: Locator, name: "title" | "subtitle" | "body") =>
  phone(view).locator(`[data-slot="notification"] [data-field="${name}"]`);
const bubbles = (view: Locator) =>
  phone(view).locator('[data-slot="sms-bubble"]');

test.describe("Coral receives alerts", () => {
  test("Jordan approves Card Used Abroad; Coral links it, sends it to an iPhone and an Android customer, and each phone shows it", async ({
    page,
  }) => {
    test.setTimeout(demoTimeout(240_000));
    const { templateId, number } = abroad;

    await test.step("1. Jordan approves Card Used Abroad: it goes live", async () => {
      await asPersona(page, "jordan");
      await page.goto(`/${TEAM}/review/${templateId}/${number}`);
      await expect(
        page.getByRole("heading", { level: 1, name: ALERT_NAME }),
      ).toBeVisible();
      await expect(decision(page)).toBeVisible();
      await hydrated(page);
      await viewEveryOutput(page);
      await click(
        decision(page).getByRole("button", { name: "Approve", exact: true }),
      );
      const dialog = page.getByRole("dialog", { name: `Approve v${number}` });
      await expect(dialog).toBeVisible();
      await click(
        dialog.getByRole("button", { name: `Approve v${number}`, exact: true }),
      );
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page.locator("[data-go-live]")).toHaveCount(0, {
        timeout: 20_000,
      });
      await expect(statusBadge(page)).toHaveText("Active");
      await beat(page, 800);
    });

    await test.step("2. In Coral, the Card used abroad alert links it: alert templates only, Push and SMS, every value from the card", async () => {
      await openSimulator(page);
      const alerts = page.getByRole("table", { name: "Alerts" });
      const row = alerts.getByRole("row").filter({
        has: page.getByRole("link", { name: CORAL_ALERT, exact: true }),
      });
      await expect(row).toContainText("Not linked");
      await click(alerts.getByRole("link", { name: CORAL_ALERT, exact: true }));
      await expect(
        page.getByRole("heading", { level: 1, name: CORAL_ALERT }),
      ).toBeVisible();
      const link = page.getByRole("button", {
        name: "Link template",
        exact: true,
      });
      await reactReady(link);
      await click(link);
      await expect(
        page.getByRole("heading", { level: 1, name: "Link a template" }),
      ).toBeVisible();

      const list = page.getByRole("list", { name: "Templates" });
      await expect(list).toHaveAttribute("aria-busy", "false");
      const results = list.getByRole("button");
      await expect(results.filter({ hasText: ALERT_NAME })).toHaveCount(1);
      for (const text of await results.allInnerTexts())
        expect(text, "an alert lists alert templates only").toContain(
          "Push and SMS",
        );
      await beat(page, 700);
      await click(results.filter({ hasText: ALERT_NAME }));
      await expect(page).toHaveURL(
        new RegExp(`/link\\?template=${templateId}$`),
        { timeout: 30_000 },
      );

      for (const channel of ["Push", "SMS"])
        await expect(
          page.getByRole("checkbox", { name: channel, exact: true }),
        ).toBeChecked();
      const variables = page.getByRole("table", { name: "Variables" });
      const mapped = {
        "Card last 4": "Card · Last 4 digits",
        "Purchase amount": "Card · Last purchase amount",
        Merchant: "Card · Last purchase merchant",
        Country: "Card · Last purchase country",
      };
      await expect(variables.getByRole("combobox")).toHaveCount(
        Object.keys(mapped).length,
      );
      for (const [label, coral] of Object.entries(mapped)) {
        await expect(
          variables
            .getByRole("combobox", { name: label, exact: true })
            .locator("option:checked"),
        ).toHaveText(coral);
      }
      await expect(page.getByText(/^Map .* to send\.$/)).toHaveCount(0);
      await beat(page, 700);
      await shoot(page, "coral-alert-link");
      await click(
        page.getByRole("button", { name: "Link template", exact: true }),
      );
      await expect(page).toHaveURL(
        new RegExp(`/sim/offers/${CORAL_ALERT_ID}\\?tab=send$`),
        { timeout: 30_000 },
      );
    });

    await test.step("3. Coral sends it to Olivia (iPhone) and Marcus (Android): 4 delivered", async () => {
      const customers = page.getByRole("table", { name: "Customers" });
      await expect(customers.getByRole("columnheader")).toHaveText([
        "",
        "Customer",
        "Phone",
        "Number",
      ]);
      await selectCustomers(page, [OLIVIA, MARCUS]);
      await send(page);
      await expect(resultsHeadline(page)).toHaveText("4 delivered", {
        timeout: 30_000,
      });
      const grid = page.getByRole("table", { name: "Results" });
      await expect(grid.getByRole("columnheader")).toHaveText([
        "Customer",
        "Push",
        "SMS",
      ]);
      await expect(
        grid.getByRole("row").filter({ hasText: OLIVIA.name }),
      ).toContainText("iPhone");
      await expect(
        grid.getByRole("row").filter({ hasText: MARCUS.name }),
      ).toContainText("Android");
      // What Stencil reported for each text: Olivia's fits one part; Marcus's longer merchant takes two.
      await expect(
        grid.getByRole("row").filter({ hasText: OLIVIA.name }),
      ).toContainText("GSM-7 · 1 part");
      await expect(
        grid.getByRole("row").filter({ hasText: MARCUS.name }),
      ).toContainText("GSM-7 · 2 parts");
      // The render log names the phone each push was for (a setting of the request, never a value).
      const pushes = (await renderLog({ templateId, isPreview: false })).filter(
        (entry) => entry.channel === "push",
      );
      expect(
        pushes.map((entry) => entry.platform).sort(),
        "one push for each phone",
      ).toEqual(["android", "ios"]);
    });

    await test.step("4. Olivia's iPhone: the push on the lock screen, with its subtitle; the text with its footer", async () => {
      await click(delivered(page, OLIVIA.name, "Push"));
      const view = customerView(page, OLIVIA.name, "Push");
      await expect(view).toBeVisible();
      await expect(view).toContainText(OLIVIA.phone);
      await expect(phone(view).locator("figcaption")).toHaveText(
        "Lock screen, iOS-style preview",
        { timeout: 20_000 },
      );
      await expect(field(view, "title")).toHaveText("Was this you?");
      await expect(field(view, "subtitle")).toHaveText(
        `Card ending in ${OLIVIA.last4}`,
      );
      await expect(field(view, "body")).toHaveText(
        `Your Coral card was used for ${OLIVIA.purchase}. If it wasn't you, lock your card in the app.`,
      );
      await beat(page, 1000);
      await shoot(page, "coral-alert-iphone-lock");

      await click(viewSwitch(page, "Messages"));
      const sms = customerView(page, OLIVIA.name, "SMS");
      await expect(sms).toBeVisible();
      // Her thread with Coral's short code: this text is the newest in it.
      await expect(bubbles(sms).last()).toBeVisible({ timeout: 20_000 });
      expect(await bubbles(sms).last().innerText()).toBe(
        `Coral: Your card ending ${OLIVIA.last4} was used for ${OLIVIA.purchase}.\nNot you? Call 1-800-555-0142.\n${FOOTER}`,
      );
      await expect(sms).toContainText("GSM-7 · 1 part");
      await expect(phone(sms)).toContainText("26725");
      await beat(page, 1000);
      await shoot(page, "coral-alert-iphone-sms");
    });

    await test.step("5. Marcus's Android: the same push, without the subtitle", async () => {
      await click(delivered(page, MARCUS.name, "Push"));
      const view = customerView(page, MARCUS.name, "Push");
      await expect(view).toBeVisible();
      await expect(view).toContainText(MARCUS.phone);
      await expect(phone(view).locator("figcaption")).toHaveText(
        "Lock screen, Android-style preview",
        { timeout: 20_000 },
      );
      await expect(field(view, "title")).toHaveText("Was this you?");
      await expect(field(view, "subtitle")).toHaveCount(0);
      await expect(phone(view)).not.toContainText("Card ending in");
      await expect(field(view, "body")).toContainText(MARCUS.purchase);
      await beat(page, 1000);
      await shoot(page, "coral-alert-android-lock");
    });

    await test.step("6. With Marcus's phone open, Coral sends to him again: the heads-up drops in, and the thread holds both texts", async () => {
      await click(
        page.getByRole("checkbox", {
          name: `Select ${OLIVIA.name}`,
          exact: true,
        }),
      );
      await expect(
        page.getByRole("checkbox", {
          name: `Select ${OLIVIA.name}`,
          exact: true,
        }),
      ).toHaveAttribute("aria-checked", "false");
      await send(page);
      await expect(resultsHeadline(page)).toHaveText("2 delivered", {
        timeout: 30_000,
      });
      const view = customerView(page, MARCUS.name, "Push");
      await expect(phone(view).locator("figcaption")).toHaveText(
        "Heads-up, Android-style preview",
        { timeout: 20_000 },
      );
      await expect(field(view, "title")).toHaveText("Was this you?");
      await beat(page, 1200);
      await shoot(page, "coral-alert-android-heads-up");

      // Opened and closed again, it is on the lock screen: the heads-up has dropped, and doesn't drop again.
      const notification = () =>
        phone(view).locator('[data-slot="notification"]').first();
      await click(notification());
      await expect(phone(view).locator("figcaption")).toHaveText(
        "Expanded, Android-style preview",
      );
      await click(notification());
      await expect(phone(view).locator("figcaption")).toHaveText(
        "Lock screen, Android-style preview",
      );

      await click(viewSwitch(page, "Messages"));
      const sms = customerView(page, MARCUS.name, "SMS");
      await expect(sms).toBeVisible();
      await expect
        .poll(() => bubbles(sms).count(), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(2);
      // The two sends' texts, oldest first, are the newest two in his thread.
      const texts = (await bubbles(sms).allInnerTexts()).slice(-2);
      for (const text of texts)
        expect(text).toBe(
          `Coral: Your card ending ${MARCUS.last4} was used for ${MARCUS.purchase}.\nNot you? Call 1-800-555-0142.\n${FOOTER}`,
        );
      await expect(sms).toContainText("GSM-7 · 2 parts");

      // Back on the notification: the heads-up dropped once; now it is the lock screen.
      await click(viewSwitch(page, "Notification"));
      await expect(
        phone(customerView(page, MARCUS.name, "Push")).locator("figcaption"),
      ).toHaveText("Lock screen, Android-style preview");
      await page.keyboard.press("Escape");
      await expect(customerView(page, MARCUS.name, "Push")).toHaveCount(0);
    });

    await test.step("7. In Stencil, the alert's Usage splits its renders: Push by iPhone and Android, and SMS", async () => {
      // Three sends so far: Olivia's, Marcus's, and Marcus's again. One iPhone push, two Android, three texts.
      await page.goto(`/${TEAM}/templates/${templateId}/usage`);
      await expect(
        page.getByRole("heading", { level: 1, name: ALERT_NAME }),
      ).toBeVisible();
      await hydrated(page);
      const usage = page
        .locator('section[data-slot="usage"]')
        .filter({ visible: true });
      await expect(
        usage.getByRole("heading", { name: "Renders by channel" }),
      ).toBeVisible();
      const split = usage.getByRole("table", { name: "Renders by channel" });
      const cells = (name: string) =>
        split
          .getByRole("row")
          .filter({ has: page.getByRole("rowheader", { name, exact: true }) })
          .getByRole("cell");
      await expect(cells("Push · iPhone")).toHaveText(["1", "17%"]);
      await expect(cells("Push · Android")).toHaveText(["2", "33%"]);
      await expect(cells("SMS")).toHaveText(["3", "50%"]);
      await expect(
        split.getByRole("row"),
        "a header, Push by phone and SMS: no document channel",
      ).toHaveCount(4);
    });
  });
});
