import AxeBuilder from "@axe-core/playwright";
import type { Client, InValue } from "@libsql/client";
import { expect, test, type Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { rowsOf } from "./helpers/cleanup";

// What a person sees when a page throws (docs/handoff-review.md, I7; decision 0013). Each test breaks one
// stored JSON value, so the query that reads it throws the way a corrupt row or a failing backend would,
// and nothing in the app is there only for this spec:
//
//   1. A tab of a template fails (Balance Transfer v2's body): the template's error shows in the document's
//      place, under the workspace header and the tab bar, inside the app frame.
//   2. A page fails (Cash Back v3's body, on its review screen): the page's error shows in the canvas, and the
//      sidebar and top bar stay.
//   3. The frame itself fails (the demo clock's setting, which every part of the shell reads): the global
//      error page replaces the document.
//
// Each shows one plain sentence, Try again and Back to library, and the error's digest; never the server's
// message. The value is then put back and Try again brings the screen back. afterEach puts back anything a
// failed test left broken.
//
// These tests expect console errors (React and Next log the caught error), so they don't use the
// scenario fixture that fails on them.

const TEAM = "coral-offers";
const BALANCE = "Balance Transfer Intro — Terms";
const CASH_BACK = "Cash Back Welcome Bonus — Terms";
/** Not JSON: drizzle's JSON.parse throws on it. */
const BROKEN = "{";

let db: Client;
const restores: (() => Promise<void>)[] = [];

test.beforeAll(() => {
  db = openDb();
});

test.afterEach(async () => {
  while (restores.length) await restores.pop()!();
});

test.afterAll(() => {
  db.close();
});

/** Breaks one stored value until the returned function (or afterEach) puts back exactly what was there. */
async function breakValue(table: "versions" | "settings", keyColumn: "id" | "key", key: string, column: string) {
  const [before] = await rowsOf(db, `SELECT ${column} FROM ${table} WHERE ${keyColumn} = ?`, [key]);
  if (!before) throw new Error(`${table} row ${key} doesn't exist.`);
  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    await rowsOf(db, `UPDATE ${table} SET ${column} = ? WHERE ${keyColumn} = ?`, [before[column] as InValue, key]);
  };
  restores.push(restore);
  await rowsOf(db, `UPDATE ${table} SET ${column} = ? WHERE ${keyColumn} = ?`, [BROKEN, key]);
  return restore;
}

async function versionOf(name: string, state: string) {
  const [row] = await rowsOf(
    db,
    "SELECT v.id, v.template_id, v.number FROM versions v JOIN templates t ON t.id = v.template_id WHERE v.name = ? AND v.state = ?",
    [name, state],
  );
  if (!row) throw new Error(`This spec needs the fresh seed (npm run db:reset): no ${state} version of ${name}.`);
  return { id: String(row.id), templateId: String(row.template_id), number: Number(row.number) };
}

/** Visible primary (black, filled) buttons and links in the canvas: the screen's one primary rule. */
function primaryButtons(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "bg-primary";
    document.body.append(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const main = document.querySelector("main");
    return [...(main?.querySelectorAll("button, a[href]") ?? [])]
      .filter((el) => (el as HTMLElement).checkVisibility() && getComputedStyle(el).backgroundColor === primary)
      .map((el) => el.textContent?.trim() ?? "");
  });
}

/**
 * The error can show before the frame's own sections have streamed in. With the frame, wait for them (the sidebar's
 * real links, a hydrated profile button, no skeleton left) so axe looks at the screen a person ends up with.
 */
async function settle(page: Page, frame: boolean) {
  if (frame) {
    await expect(page.getByRole("navigation", { name: "Sidebar" }).getByRole("link", { name: "Library" })).toBeVisible();
    await page.waitForFunction(() => {
      const el = document.querySelector("button[aria-label$='profile and persona']");
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
    });
    await page.waitForFunction(
      () => ![...document.querySelectorAll('[data-slot="skeleton"]')].some((el) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true })),
    );
  }
  // Let the streamed sections' view transitions finish.
  await page.waitForTimeout(800);
  await page.evaluate(() => document.fonts.ready);
}

/** The error's sentence, its actions and its digest, and nothing of the server's message. */
async function expectErrorScreen(page: Page, sentence: string, { frame }: { frame: boolean }) {
  await expect(page.getByText(sentence, { exact: true })).toBeVisible();
  await settle(page, frame);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // A Base UI Button rendered as a link has the button role.
  await expect(page.getByRole("button", { name: "Back to library" })).toHaveAttribute("href", `/${TEAM}/library`);
  // Next gives a server error a digest, the id its server log carries.
  await expect(page.getByText(/^Error ID \S+$/)).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text, "the server's message stays on the server").not.toMatch(/JSON|SyntaxError|Unexpected|at \w+ \(/);
  // As in principles.spec.ts: no serious or critical axe violation.
  const axe = await new AxeBuilder({ page }).exclude("nextjs-portal").exclude("[data-base-ui-focus-guard]").analyze();
  const serious = axe.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).join(" | ")})`);
  expect(serious, "axe serious/critical violations").toEqual([]);
}

test("a tab that fails keeps the workspace header, the tab bar and the frame", async ({ page }) => {
  const v = await versionOf(BALANCE, "active");
  const restore = await breakValue("versions", "id", v.id, "body");

  await page.goto(`/${TEAM}/templates/${v.templateId}`);
  await expectErrorScreen(page, "This tab didn't load.", { frame: true });
  await expect(page.getByRole("heading", { level: 1, name: BALANCE })).toBeVisible();
  await expect(page.locator('[data-slot="tab-bar"]').getByRole("link", { name: "Versions" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  // The tab bar keeps the workspace's black button (Edit, for Maya on an Active template), so Try again is outline.
  expect(await primaryButtons(page)).toEqual(["Edit"]);

  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".ProseMirror").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("This tab didn't load.")).toHaveCount(0);
});

test("a page that fails keeps the sidebar and the top bar", async ({ page }) => {
  const v = await versionOf(CASH_BACK, "in_review");
  const restore = await breakValue("versions", "id", v.id, "body");

  await page.goto(`/${TEAM}/review/${v.templateId}/${v.number}`);
  await expectErrorScreen(page, "This page didn't load", { frame: true });
  await expect(page.getByRole("heading", { level: 1, name: "This page didn't load" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  await expect(page.getByRole("button", { name: /profile and persona$/ })).toBeVisible();
  expect(await primaryButtons(page)).toEqual(["Try again"]);

  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: CASH_BACK })).toBeVisible();
  await expect(page.getByText("This page didn't load")).toHaveCount(0);
});

test("when the frame itself fails, the global error page replaces it", async ({ page }) => {
  const restore = await breakValue("settings", "key", "clock_offset_days", "value");

  await page.goto(`/${TEAM}/library`);
  await expectErrorScreen(page, "This page didn't load", { frame: false });
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toHaveCount(0);
  expect(await primaryButtons(page)).toEqual(["Try again"]);

  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
});
