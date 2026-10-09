import type { Client } from "@libsql/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { openDb, render, validValues } from "./api/helpers";
import { SPRING_NAME, TEAM, click, createSpringTravel, reactReady, removeTemplate, rows, type SpringFixture } from "./helpers/golive";
import { asPersona, expect, expectAutosaved, hydrated, liveEditor, nameField, tap, test } from "./helpers/scenario";

// A draft rename goes live only with its version (handoff review I5; docs/decisions/0016-the-name-is-versioned.md).
//
//   1. Maya opens a draft of Spring Travel v2 (Active) and renames it. Coral's render of v2 keeps the old <title>,
//      and the API still names the template as before.
//   2. She submits: the dialog lists the rename, the old name struck and the new one inserted.
//   3. Jordan opens v3 to review it: the header has the new name, and the rail shows the rename. Customers still
//      see the old name.
//   4. He approves: v3 renders with the new <title> and the API names the template by it. v2, Superseded, keeps
//      the name it went live with.
//
// Standalone: the fixture inserts Spring Travel v2 Active; afterAll removes the template and every row this run
// wrote for it.

const RENAMED = "Spring Travel Rewards — Card Terms";

let db: Client;
let fixture: SpringFixture | null = null;

test.beforeAll(async () => {
  db = openDb();
  fixture = await createSpringTravel(db);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (fixture) await removeTemplate(db, fixture.templateId);
  } finally {
    db.close();
  }
});

const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });

/** Coral's web render of a version, by its <title>: what a customer's browser shows as the page's name. */
async function webTitle(request: APIRequestContext, version: number) {
  const { templateId, variables } = fixture!;
  const { res } = await render(request, { templateId, body: { version, channel: "web", values: validValues(variables) } });
  expect(res.status(), `v${version} renders`).toBe(200);
  return /<title>([^<]*)<\/title>/.exec(await res.text())?.[1];
}

/** What the API calls the template. */
async function apiName(request: APIRequestContext) {
  const res = await request.get(`/api/v1/templates/${fixture!.templateId}`, { headers: { "X-Consumer-Id": "coral" } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { name: string }).name;
}

const savedNames = async () =>
  (await rows(db, "SELECT number, state, name FROM versions WHERE template_id = ? ORDER BY number IS NULL, number", [fixture!.templateId])).map(
    (v) => [v.number, v.state, v.name],
  );

test("a draft rename reaches customers only when its version is approved, and the review shows it", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { templateId } = fixture!;

  await test.step("1. Maya renames a draft of v2: the Active version's title and the API's name stay as they were", async () => {
    await asPersona(page, "maya");
    await page.goto(`/${TEAM}/templates/${templateId}`);
    await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
    await hydrated(page);
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await reactReady(edit);
    await click(edit);
    await expect(statusBadge(page)).toHaveText("Draft");
    await liveEditor(page);

    const field = nameField(page);
    await expect(field).toHaveValue(SPRING_NAME);
    await field.fill(RENAMED);
    await field.press("Enter");
    await expectAutosaved(page);
    expect(await savedNames()).toEqual([
      [2, "active", SPRING_NAME],
      [null, "draft", RENAMED],
    ]);

    expect(await webTitle(request, 2), "v2's <title> is the name it went live with").toBe(SPRING_NAME);
    expect(await apiName(request), "the API names the template by its Active version").toBe(SPRING_NAME);
  });

  await test.step("2. She submits: the dialog lists the rename against the Active version", async () => {
    const submit = page.getByRole("button", { name: "Submit for review" });
    await expect(submit).toBeEnabled();
    await tap(submit);
    const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const rename = dialog.locator('[data-slot="name-change"]');
    await expect(rename.locator("del")).toHaveText(SPRING_NAME);
    await expect(rename.locator("ins")).toHaveText(RENAMED);
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
  });

  await test.step("3. Jordan reviews v3 under its new name, with the rename in the rail; customers still see the old name", async () => {
    await asPersona(page, "jordan");
    await page.goto(`/${TEAM}/review/${templateId}/3`);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: RENAMED })).toBeVisible();
    const name = decision(page).getByRole("region", { name: "Name" });
    await expect(name.locator("del")).toHaveText(SPRING_NAME);
    await expect(name.locator("ins")).toHaveText(RENAMED);

    expect(await webTitle(request, 2)).toBe(SPRING_NAME);
    expect(await apiName(request)).toBe(SPRING_NAME);
  });

  await test.step("4. He approves: v3 goes live under the new name; v2 keeps the old one", async () => {
    const approve = decision(page).getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeEnabled();
    await tap(approve);
    const dialog = page.getByRole("dialog", { name: "Approve v3" });
    await expect(dialog).toBeVisible();
    await tap(dialog.getByRole("button", { name: "Approve v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("Active", { timeout: 20_000 });

    expect(await savedNames()).toEqual([
      [2, "superseded", SPRING_NAME],
      [3, "active", RENAMED],
    ]);
    expect(await webTitle(request, 3), "v3's <title> is its new name").toBe(RENAMED);
    expect(await webTitle(request, 2), "v2, Superseded, keeps the name it went live with").toBe(SPRING_NAME);
    expect(await apiName(request)).toBe(RENAMED);
  });

  await test.step("5. Compare v2 → v3 on the Versions tab: the rename is the change", async () => {
    await page.goto(`/${TEAM}/templates/${templateId}/versions`);
    await hydrated(page);
    const compare = page.getByRole("button", { name: "Compare versions" });
    await reactReady(compare);
    await tap(compare);
    const dialog = page.getByRole("dialog", { name: "Compare versions" });
    const rename = dialog.locator('[data-slot="name-change"]');
    await expect(rename.locator("del")).toHaveText(SPRING_NAME, { timeout: 20_000 });
    await expect(rename.locator("ins")).toHaveText(RENAMED);
    await expect(dialog.locator('[data-slot="redline-summary"]')).toHaveText("Renamed");
  });
});
