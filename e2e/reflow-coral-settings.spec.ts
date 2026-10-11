import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Reflow (WCAG 2.1 SC 1.4.10, decision 0045) for the screens e2e/reflow.spec.ts leaves out: Coral, the simulated
// consumer (its offers, an offer's three tabs, the link flow, deliveries, customers and notices), and every section
// of the Settings dialog. At 320px wide (Chrome at 400% on a 1280px laptop) and at 1280px:
//
//   - axe finds nothing, which includes `scrollable-region-focusable`: a table that scrolls inside its own box is a
//     labelled region with a Tab stop (ScrollRegion), and
//   - the page never scrolls sideways, and neither does the scroll area around the content; only a box built for it
//     (a table's region) does.
//
// Read-only. Run against the production build: E2E_GATE_PORT=3120 npx playwright test e2e/reflow-coral-settings.spec.ts

test.use({ trace: "off" });

const PERSONA_COOKIE = "ucomp_persona";
const TEAM = "coral-offers";

async function hydrated(page: Page) {
  // Hydrated (the first control has React's props), and every skeleton has gone.
  await page.waitForFunction(() => {
    const el = document.querySelector("a[href], button");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")) && !document.querySelector('[data-slot="skeleton"]');
  });
  await page.waitForTimeout(800);
}

async function open(page: Page, url: string, persona = "riley") {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100";
  await page.context().addCookies([{ name: PERSONA_COOKIE, value: persona, url: baseURL }]);
  const response = await page.goto(url, { waitUntil: "load" });
  expect(response?.status(), `${url} responded`).toBeLessThan(500);
  await hydrated(page);
}

/** Every axe finding, whatever its impact, as `rule: where`. */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).exclude("nextjs-portal").exclude("[data-base-ui-focus-guard]").analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/**
 * What scrolls sideways: the page, and any box that does. A box that scrolls on purpose is a region with a Tab stop
 * (a table's ScrollRegion, a tab strip); anything else wider than its box is a layout that did not reflow.
 */
function sideways(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollers = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const { overflowX } = getComputedStyle(el);
        return (overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1 && el.checkVisibility();
      })
      .map((el) => ({
        what: `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[data-slot=${el.getAttribute("data-slot")}]` : ""}${el.getAttribute("aria-label") ? `[aria-label=${el.getAttribute("aria-label")}]` : ""} .${el.className.toString().split(" ").slice(0, 4).join(".")} (${el.clientWidth} of ${el.scrollWidth})`,
        tabStop: el.tabIndex >= 0 && el.getAttribute("role") === "region" && !!el.getAttribute("aria-label"),
      }));
    return { pageOverflow: doc.scrollWidth - doc.clientWidth, scrollers };
  });
}

// ── Coral ─────────────────────────────────────────────────────────────────────────────────────────────────────

const OFFER = "offer_cash_back"; // linked to a template, so its three tabs have their tables
const UNLINKED = "offer_spring_travel"; // not linked yet: its link flow starts at the search
const UPGRADE = "offer_balance_transfer"; // linked to v1 with a v2 available: relinking lists what changed
const UPGRADE_TEMPLATE = "UC-D6KSGY"; // Balance Transfer Intro

const CORAL: { name: string; url: string; then?: (page: Page) => Promise<void> }[] = [
  { name: "the offers", url: "/sim" },
  { name: "an offer's Template tab", url: `/sim/offers/${OFFER}?tab=template` },
  { name: "an offer's Values tab", url: `/sim/offers/${OFFER}?tab=values` },
  { name: "an offer's Send tab", url: `/sim/offers/${OFFER}?tab=send` },
  { name: "the link flow's search", url: `/sim/offers/${UNLINKED}/link` },
  {
    name: "the link flow's mapping",
    url: `/sim/offers/${UNLINKED}/link`,
    then: async (page) => {
      await page.getByRole("list", { name: "Templates" }).getByRole("button").first().click();
      await expect(page.getByRole("table", { name: "Variables" })).toBeVisible();
      await hydrated(page);
    },
  },
  { name: "the link flow's relink, with what changed", url: `/sim/offers/${UPGRADE}/link?template=${UPGRADE_TEMPLATE}` },
  { name: "the deliveries", url: "/sim/deliveries" },
  { name: "the customers", url: "/sim/customers" },
  { name: "the notices", url: "/sim/notices" },
];

for (const width of [320, 1280]) {
  test.describe(`Coral at ${width}px wide`, () => {
    test.use({ viewport: { width, height: width === 320 ? 720 : 800 } });

    for (const { name, url, then } of CORAL) {
      test(`${name}: axe finds nothing${width === 320 ? ", and nothing needs a sideways scroll but a table's own box" : ""}`, async ({ page }) => {
        await open(page, url);
        await then?.(page);
        expect(await violations(page)).toEqual([]);

        const { pageOverflow, scrollers } = await sideways(page);
        expect(pageOverflow, "the page doesn't scroll sideways").toBe(0);
        expect(scrollers.filter((s) => !s.tabStop), "every box that scrolls sideways is a region with a Tab stop").toEqual([]);
      });
    }
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────

// Alex runs the Coral Offers team (its four sections); Riley owns the platform (the other five).
const SECTIONS: { section: string; persona: string }[] = [
  ...["members", "access-requests", "recertification", "inactivity"].map((section) => ({ section, persona: "alex" })),
  ...["teams", "content-types", "channel-rules", "approval-chains", "time-zone"].map((section) => ({ section, persona: "riley" })),
];

for (const width of [320, 1280]) {
  test.describe(`Settings at ${width}px wide`, () => {
    test.use({ viewport: { width, height: width === 320 ? 720 : 800 } });

    for (const { section, persona } of SECTIONS) {
      test(`${section}: axe finds nothing${width === 320 ? ", and the dialog fits the window" : ""}`, async ({ page }) => {
        await open(page, `/${TEAM}/settings/${section}`, persona);
        const dialog = page.getByRole("dialog").filter({ has: page.getByRole("navigation", { name: "Settings sections" }) });
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(400); // the dialog fades in: axe reads its contrast once it has
        expect(await violations(page)).toEqual([]);

        const { pageOverflow, scrollers } = await sideways(page);
        expect(pageOverflow, "the page doesn't scroll sideways").toBe(0);
        expect(scrollers.filter((s) => !s.tabStop), "every box that scrolls sideways is a region with a Tab stop").toEqual([]);
        const box = await dialog.boundingBox();
        expect(box!.x, "the dialog starts inside the window").toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, "and ends inside it").toBeLessThanOrEqual(width);
      });
    }
  });
}

// ── The Tab stop ──────────────────────────────────────────────────────────────────────────────────────────────

test.describe("a table that scrolls inside its box", () => {
  test("is a labelled region with a Tab stop at 320px, and is neither at 1280px, where it fits", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await open(page, "/sim/customers");
    const region = page.getByRole("region", { name: "Customers table" });
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await expect(region).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(region).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Customers" })).toBeVisible();
  });

  test("holds in Settings too: the channel rules matrix at 320px, not at 1280px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await open(page, `/${TEAM}/settings/channel-rules`, "riley");
    const region = page.getByRole("region", { name: "Channel rules" });
    await expect(region).toHaveAttribute("tabindex", "0");

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(region).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Channel rules" })).toBeVisible();
  });
});
