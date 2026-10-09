import type { Page, Response } from "@playwright/test";
import { profileButton, switchPersona } from "./helpers/access";
import { asPersona, expect, hydrated, PERSONA_COOKIE, test } from "./helpers/scenario";

// The ⌘K palette searches on the server, and keeps nothing of one viewer's for the next (handoff review
// I12, docs/decisions/0024-the-palette-searches-on-the-server.md):
//
//   1. No page carries the template catalog: the top bar's streamed payload names no template the page
//      doesn't list itself, and nothing is asked of /api/palette until the palette opens.
//   2. Typing asks the server, which finds templates past the resting first page.
//   3. After a persona switch the palette lists the new viewer's answer, none of the last viewer's.
//
// Read-only: it switches personas, which only stamps the persona's last sign-in.

const CORAL = [
  "Annual Fee Waiver — Terms",
  "Balance Transfer Intro — Terms",
  "Cash Back Welcome Bonus — Terms",
  "Holiday Points Promo — Terms",
  "Rate Change Notice",
];
const DEPOSITS = ["Everyday Checking — Fee Schedule", "High-Yield Savings — Rate Disclosure", "Overdraft Protection — Terms"];

const palette = (page: Page) => page.getByRole("dialog", { name: "Search" });
const option = (page: Page, name: string) => palette(page).getByRole("option", { name: new RegExp(`^${name}`) });
const group = (page: Page, heading: string) => palette(page).getByRole("group", { name: heading });

/** The palette route's answer for this space (and search), as the page receives it. */
function answerFor(page: Page, space: string, query?: string): Promise<Response> {
  return page.waitForResponse((res) => {
    const url = new URL(res.url());
    return url.pathname === `/api/palette/${space}` && (url.searchParams.get("q") ?? "") === (query ?? "");
  });
}

async function openPalette(page: Page, space: string) {
  const answered = answerFor(page, space);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  const response = await answered;
  expect(response.status()).toBe(200);
  await expect(palette(page).locator("input")).toBeFocused();
  return (await response.json()) as { viewerId: string; templates: { name: string }[]; recent: { name: string }[] };
}

async function closePalette(page: Page) {
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
}

test("no page carries the catalog, and nothing is asked until the palette opens", async ({ page, request }) => {
  // Riley sees every team. Card Statements' Library lists that team's templates and no others; before,
  // the top bar's streamed props carried every template Riley can see, on every page.
  const html = await (await request.get("/card-statements/library", { headers: { Cookie: `${PERSONA_COOKIE}=riley` } })).text();
  expect(html).toContain("Statement Insert — Paperless Enrollment");
  for (const name of [...CORAL, ...DEPOSITS]) expect(html, `${name} is not on this page`).not.toContain(name);

  const asked: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/palette/")) asked.push(req.url());
  });
  await asPersona(page, "riley");
  await page.goto("/card-statements/library");
  await hydrated(page);
  await page.getByRole("navigation", { name: "Sidebar" }).getByRole("link", { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/card-statements\/review$/);
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  expect(asked).toEqual([]);

  await openPalette(page, "card-statements");
  expect(asked).toHaveLength(1);
});

test("typing searches on the server, past the resting first page", async ({ page }) => {
  await asPersona(page, "riley");
  await page.goto("/all/library");
  await hydrated(page);
  const atRest = await openPalette(page, "all");
  expect(atRest.viewerId).toBe("riley");
  expect(atRest.templates.length).toBeLessThanOrEqual(8);
  await expect(option(page, "Annual Fee Waiver")).toBeVisible();

  const found = answerFor(page, "all", "paperless");
  await page.keyboard.type("paperless");
  const response = await found;
  expect(((await response.json()) as { templates: { name: string }[] }).templates.map((t) => t.name)).toEqual([
    "Statement Insert — Paperless Enrollment",
  ]);
  await expect(palette(page).getByRole("option")).toHaveCount(1);
  await expect(option(page, "Statement Insert — Paperless Enrollment")).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/all\/templates\/UC-/);
  await expect(page.getByRole("heading", { level: 1, name: "Statement Insert — Paperless Enrollment" })).toBeVisible();
});

test("after a persona switch the palette lists the new viewer's templates, none of the last one's", async ({ page }) => {
  // Priya works in Coral Offers and reads Deposits.
  await asPersona(page, "priya");
  await page.goto("/deposits/library");
  await hydrated(page);
  await openPalette(page, "deposits");
  await expect(option(page, "Everyday Checking")).toBeVisible();
  await closePalette(page);

  // Maya can't see Deposits: the switch takes her to Coral Offers.
  await switchPersona(page, "Maya Chen");
  await expect(page).toHaveURL(/\/coral-offers\/library$/);
  const maya = await openPalette(page, "coral-offers");
  expect(maya.viewerId).toBe("maya");
  await expect(option(page, "Cash Back Welcome Bonus")).toBeVisible();
  await expect(group(page, "Actions")).toBeVisible();
  await expect(group(page, "Recent")).toBeVisible();
  for (const name of DEPOSITS) await expect(option(page, name)).toHaveCount(0);
  await closePalette(page);

  // Same space, another viewer: Taylor (the Auditor) creates nothing and has touched nothing, so neither
  // Maya's Actions nor her Recent may stay.
  await switchPersona(page, "Taylor Nguyen");
  await expect(profileButton(page)).toHaveAccessibleName(/^Taylor Nguyen,/);
  const taylor = await openPalette(page, "coral-offers");
  expect(taylor.viewerId).toBe("taylor");
  await expect(option(page, "Cash Back Welcome Bonus")).toBeVisible();
  await expect(group(page, "Actions")).toHaveCount(0);
  await expect(group(page, "Recent")).toHaveCount(0);
  expect(taylor.templates.map((t) => t.name)).toEqual(CORAL);
});
