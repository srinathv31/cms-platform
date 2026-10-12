import { expect, test } from "@playwright/test";
import { settled } from "./helpers/settled";
import {
  ALLOWED_PLACEHOLDER,
  CARD_ABROAD,
  COLLECT,
  FEE_WAIVER,
  STATUS_WORDS,
  checkScreen,
  click,
  inspectPage,
  installCls,
  open,
  runAxe,
} from "./helpers/principles";

// Phase 7 principle checks: the simulator (a foreign system), the tabs and filters inside pages, and the checks catching what they should.
// The five checks, the personas and the route matrix are in e2e/helpers/principles.ts.

// The preview iframes are sandboxed: Playwright's trace injects scripts into frames and Chrome logs "Blocked script execution".
test.use({ trace: "off" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installCls);
});

// ── The simulator: a foreign system (axe, CLS and placeholders only) ─────────

test.describe("Simulator (foreign system)", () => {
  const SIM = [
    "/sim",
    "/sim/customers",
    "/sim/deliveries",
    "/sim/notices",
    "/sim/offers/offer_spring_travel",
    "/sim/offers/offer_cash_back",
    "/sim/offers/offer_cash_back/link",
    "/sim/offers/alert_payment_due",
    "/sim/offers/alert_card_abroad/link",
  ];
  for (const url of SIM) {
    test(`${url}`, async ({ page }) => {
      await open(page, url, "maya", { shell: false });
      expect(new URL(page.url()).pathname).toBe(url);
      await checkScreen(page, url, { foreign: true });
    });
  }
});

// ── Views inside a page: tabs and filters ────────────────────────────────────

test.describe("Views inside a page", () => {
  const TAB_PAGES: { url: string; persona: string }[] = [
    { url: "/coral-offers/review", persona: "jordan" },
    { url: "/all/review", persona: "riley" },
    { url: `/coral-offers/templates/${FEE_WAIVER}`, persona: "maya" }, // the rail's views (Variables, Comments, ...)
    { url: `/coral-offers/review/${COLLECT}/3`, persona: "jordan" },
    { url: `/coral-offers/review/${CARD_ABROAD}/1`, persona: "jordan" }, // an alert: its fields, then the phone
    { url: "/coral-offers/usage", persona: "jordan" }, // Overview, Consumers
  ];
  for (const { url, persona } of TAB_PAGES) {
    test(`every tab of ${url} as ${persona}`, async ({ page }) => {
      await open(page, url, persona);
      const names = await page
        .getByRole("tab")
        .filter({ visible: true })
        .evaluateAll((tabs) =>
          tabs.map((t) =>
            (t.getAttribute("aria-label") ?? t.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim(),
          ),
        );
      expect(names.length, "the page has tabs").toBeGreaterThan(0);
      for (const name of names) {
        const tab = page
          .getByRole("tab")
          .filter({ visible: true })
          .filter({ hasText: name.replace(/\s*\d+$/, "") })
          .first();
        await click(tab);
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await settled(page);
        await checkScreen(page, `${url} as ${persona}, tab "${name}"`);
      }
    });
  }

  test("every status filter of the Library (Maya)", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    const filters = page
      .getByRole("group", { name: "Filter by status" })
      .getByRole("button")
      .filter({ visible: true });
    const count = await filters.count();
    expect(count, "the Library has status filters").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const label = ((await filters.nth(i).textContent()) ?? "").trim();
      await click(filters.nth(i));
      await expect(filters.nth(i)).toHaveAttribute("aria-pressed", "true");
      await settled(page);
      await checkScreen(page, `Library filtered by "${label}" as maya`);
    }
  });
});

// ── The checks themselves must be able to fail ───────────────────────────────

test.describe("The checks catch what they should", () => {
  test("a stray status word, a second primary button and a placeholder are all found", async ({
    page,
  }) => {
    await open(page, "/coral-offers/library", "maya");
    const clean = await page.evaluate(inspectPage, {
      foreign: false,
      allowed: ALLOWED_PLACEHOLDER,
      words: STATUS_WORDS,
    });
    expect(
      clean.canvasPrimary,
      "the Library's one primary button is seen",
    ).toHaveLength(1);
    expect(
      await page
        .locator('main [data-slot="badge"][data-status]')
        .filter({ visible: true })
        .count(),
      "the Library shows StatusBadges",
    ).toBeGreaterThan(0);
    await page.evaluate(() => {
      const main = document.querySelector('main[data-slot="sidebar-inset"]')!;
      main.insertAdjacentHTML(
        "beforeend",
        '<span id="x1">Superseded</span><button id="x2" class="bg-primary">Second</button><input id="x3" placeholder="Enter a name">',
      );
    });
    const dirty = await page.evaluate(inspectPage, {
      foreign: false,
      allowed: ALLOWED_PLACEHOLDER,
      words: STATUS_WORDS,
    });
    expect(
      dirty.canvasPrimary.length,
      "a second primary button is counted",
    ).toBe(2);
    expect(dirty.strayStatus.join()).toContain("Superseded");
    expect(dirty.placeholders.join()).toContain("Enter a name");
    expect(
      (await runAxe(page)).passes,
      "axe checked something",
    ).toBeGreaterThan(0);
  });
});
