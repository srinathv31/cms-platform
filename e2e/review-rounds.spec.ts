import type { Client } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { removeTemplate, rowsOf } from "./helpers/cleanup";
import { asPersona, expect, expectAutosaved, hydrated, liveEditor, nameField, openLibrary, tap, test, typeSlowly } from "./helpers/scenario";

// A resubmission is the next round of the same version (decision 0033), walked once through the UI:
//
//   1. Maya makes a template and submits it: "v1", no round yet.
//   2. Jordan sends it back: "You returned v1, round 1", and the header reads "v1 · Round 1".
//   3. Maya's draft is "Based on v1 · Round 1", and submitting it is "Submit v1, round 2", not v2.
//   4. Jordan's queue: Waiting on me reads "v1 · Round 2" and links `?round=2`; Recently decided holds
//      "v1 · Round 1" at `?round=1`. He opens round 2 from the row and approves "v1, round 2": v1 is Active.
//   5. The Versions tab has one entry for v1, "Approved on round 2", with its two rounds folded under
//      "Review history (2 rounds)". Unfolded, round 1 holds Jordan's reason and links to its own review
//      screen, a read-only record.
//
// Self-contained: afterAll removes the template and everything it wrote. Console and page errors fail it.

const TEAM = "coral-offers";
const NAME = "Review rounds — Terms";
const REASON = "Say when the intro rate ends.";

let db: Client;
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

const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) => decision(page).getByRole("button", { name: "Approve", exact: true });
const requestButton = (page: Page) => decision(page).getByRole("button", { name: "Request changes", exact: true });
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
/** The page's own header (the review screen's or the workspace's): the one holding the template's name. */
const header = (page: Page) =>
  page.locator("main header").filter({ visible: true }).filter({ has: page.getByRole("heading", { level: 1, name: NAME }) });
const queueTab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
/** A queue row by its exact link: the bare number, or the number and its round. */
const queueRow = (page: Page, id: string, round?: number): Locator =>
  page.locator(`a[href="/${TEAM}/review/${id}/1${round ? `?round=${round}` : ""}"]`).filter({ visible: true });

async function openReview(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(decision(page)).toBeVisible();
  await liveEditor(page);
  await hydrated(page);
}

async function openWorkspace(page: Page, id: string, tab = "") {
  await page.goto(`/${TEAM}/templates/${id}${tab}`);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await hydrated(page);
}

test.use({ trace: "off", screenshot: "only-on-failure" });

test("a send-back keeps the version number: v1 goes back, returns as v1, round 2, and goes live as v1 approved on round 2", async ({ page }) => {
  test.setTimeout(150_000);

  await test.step("1. Maya makes a template and submits it as v1", async () => {
    await asPersona(page, "maya");
    await openLibrary(page, TEAM);
    await tap(page.getByRole("button", { name: "New template" }));
    const gallery = page.getByRole("dialog");
    await expect(gallery).toBeVisible();
    await tap(gallery.getByRole("button", { name: /Card offer terms/ }));
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
    templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1]!;
    await expect(nameField(page)).toBeFocused();
    await page.waitForTimeout(300);
    await page.keyboard.press("ControlOrMeta+a");
    await typeSlowly(page, NAME);
    await expect(nameField(page)).toHaveValue(NAME);
    await expectAutosaved(page);

    await liveEditor(page);
    await hydrated(page);
    await tap(page.getByRole("button", { name: "Submit for review" }));
    const dialog = page.getByRole("dialog", { name: "Submit v1 for review", exact: true });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await tap(dialog.getByRole("button", { name: "Submit v1", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
    await expect(header(page).getByText("v1", { exact: true }), "a first round names no round").toBeVisible();
  });
  const id = templateId!;

  await test.step("2. Jordan sends v1 back: from now on it reads as round 1", async () => {
    await asPersona(page, "jordan");
    await openReview(page, `/${TEAM}/review/${id}/1`);
    await expect(header(page)).toContainText("v1 by Maya Chen");
    await tap(requestButton(page));
    const dialog = page.getByRole("dialog", { name: "Request changes on v1", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Reason" })).toBeFocused();
    await typeSlowly(page, REASON);
    await tap(dialog.getByRole("button", { name: "Request changes", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("Changes requested", { timeout: 20_000 });
    await expect(decision(page).locator("[data-decided]")).toHaveText("You returned v1, round 1 to Maya Chen.");
    await expect(header(page)).toContainText("v1 · Round 1 by Maya Chen");
  });

  await test.step("3. Maya's draft is based on v1 · Round 1, and submitting it is v1, round 2", async () => {
    await asPersona(page, "maya");
    await openWorkspace(page, id);
    await liveEditor(page);
    await expect(statusBadge(page)).toHaveText("Draft");
    await expect(header(page).getByText("Based on v1 · Round 1", { exact: true })).toBeVisible();
    await tap(page.getByRole("button", { name: "Submit for review" }));
    const dialog = page.getByRole("dialog", { name: "Submit v1, round 2 for review", exact: true });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await tap(dialog.getByRole("button", { name: "Submit v1, round 2", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
    await expect(header(page).getByText("v1 · Round 2", { exact: true })).toBeVisible();

    const list = await rowsOf(db, "SELECT number, round, state FROM versions WHERE template_id = ? ORDER BY number, round", [id]);
    expect(list).toEqual([
      { number: 1, round: 1, state: "changes_requested" },
      { number: 1, round: 2, state: "in_review" },
    ]);
  });

  await test.step("4. Jordan's queue names the round and links to it; he approves v1, round 2 and v1 goes Active", async () => {
    await asPersona(page, "jordan");
    await page.goto(`/${TEAM}/review`);
    await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
    await hydrated(page);
    await tap(queueTab(page, "Recently decided"));
    await expect(queueTab(page, "Recently decided")).toHaveAttribute("aria-selected", "true");
    await expect(queueRow(page, id, 1), "the round he sent back, by its own link").toContainText("v1 · Round 1");
    await expect(queueRow(page, id, 1)).toContainText("Changes requested");

    await tap(queueTab(page, "Waiting on me"));
    await expect(queueTab(page, "Waiting on me")).toHaveAttribute("aria-selected", "true");
    const row = queueRow(page, id, 2);
    await expect(row).toContainText("v1 · Round 2");
    await expect(row).toContainText("Maya Chen");
    await expect(queueRow(page, id), "no bare link: the label names the round, so the link does").toHaveCount(0);
    await tap(row);
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/review/${id}/1\\?round=2$`));
    await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
    await liveEditor(page);
    await hydrated(page);
    await expect(header(page)).toContainText("v1 · Round 2 by Maya Chen");

    await tap(approveButton(page));
    const dialog = page.getByRole("dialog", { name: "Approve v1, round 2", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-slot="dialog-description"]'), "consumers get v1: they never see a round").toHaveText("v1 becomes Active.");
    await tap(dialog.getByRole("button", { name: "Approve v1, round 2", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(page.locator("[data-go-live]")).toHaveCount(0, { timeout: 25_000 });
    await expect(statusBadge(page)).toHaveText("Active");
    await expect(decision(page).locator("[data-decided]")).toHaveText("You approved v1.");
    await expect(header(page)).toContainText("Approved on round 2");
  });

  await test.step("5. Versions: one v1 entry, approved on round 2, its rounds folded under Review history (2 rounds)", async () => {
    await openWorkspace(page, id, "/versions");
    const entries = page.locator('[data-slot="version-entry"]').filter({ visible: true });
    await expect(entries, "one entry per number, not one per round").toHaveCount(1);
    const v1 = entries.first();
    await expect(v1).toHaveAttribute("data-version", "1");
    await expect(v1).toHaveAttribute("data-round", "2");
    await expect(v1).toHaveAttribute("data-state", "active");
    await expect(v1.getByRole("heading", { level: 2 })).toHaveText("v1");
    await expect(v1.locator('[data-slot="approved-on-round"]')).toHaveText("Approved on round 2");

    const fold = v1.getByRole("button", { name: "v1 review history (2 rounds)", exact: true });
    await expect(fold).toHaveText("Review history (2 rounds)");
    await expect(fold, "folded at first paint").toHaveAttribute("aria-expanded", "false");
    const rounds = v1.locator('[data-slot="review-history"] li[data-round]');
    await expect(rounds.filter({ visible: true })).toHaveCount(0);
    await tap(fold);
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(rounds).toHaveCount(2);
    await expect(rounds.nth(0), "newest first").toHaveAttribute("data-round", "2");

    const round2 = rounds.nth(0);
    await expect(round2).toHaveAttribute("data-state", "active");
    await expect(round2.locator("[data-status]")).toHaveText("Active");
    await expect(round2).toContainText("Approved by Jordan Ellis on");
    // Released, v1 is its number's head: the bare link reaches it.
    await expect(round2.getByRole("link", { name: "v1, round 2", exact: true })).toHaveAttribute("href", `/${TEAM}/review/${id}/1`);
    await expect(round2.getByRole("link")).toHaveText("Round 2");

    const round1 = rounds.nth(1);
    await expect(round1).toHaveAttribute("data-round", "1");
    await expect(round1.locator("[data-status]")).toHaveText("Changes requested");
    await expect(round1).toContainText("Jordan Ellis requested changes on");
    await expect(round1).toContainText(`“${REASON}”`);
    const link = round1.getByRole("link", { name: "v1, round 1", exact: true });
    await expect(link).toHaveAttribute("href", `/${TEAM}/review/${id}/1?round=1`);

    // Round 1's own review screen: a read-only record.
    await tap(link);
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/review/${id}/1\\?round=1$`));
    await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
    await expect(decision(page)).toBeVisible();
    await hydrated(page);
    await expect(header(page)).toContainText("v1 · Round 1 by Maya Chen");
    await expect(statusBadge(page)).toHaveText("Changes requested");
    await expect(approveButton(page), "a sent-back round is decided").toHaveCount(0);
    // Who sent it back is the returned stage's line; the row under it only says where its work went:
    // v1, released since, at its bare link.
    const returned = decision(page).locator('[data-step="returned"]');
    await expect(returned).toContainText(/Jordan Ellis · /);
    await expect(returned.getByRole("img", { name: "Changes requested", exact: true })).toBeVisible();
    await expect(decision(page).locator("[data-decided]")).toHaveText("Open v1");
    await expect(decision(page).getByRole("link", { name: "Open v1", exact: true })).toHaveAttribute("href", `/${TEAM}/review/${id}/1`);

    const list = await rowsOf(db, "SELECT number, round, state FROM versions WHERE template_id = ? ORDER BY number, round", [id]);
    expect(list).toEqual([
      { number: 1, round: 1, state: "changes_requested" },
      { number: 1, round: 2, state: "active" },
    ]);
  });
});
