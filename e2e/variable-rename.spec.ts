import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { SPRING_NAME, TEAM, click, createSpringTravel, json, reactReady, removeTemplate, rows, type SpringFixture } from "./helpers/golive";
import { asPersona, documentEditor, expect, expectAutosaved, hydrated, liveEditor, panelRow, tap, test } from "./helpers/scenario";

// A renamed variable is one contract change (handoff review D8, decision 0022). The draft saves the rename with
// the variable (its old key kept as its id), so after a reload the panel still flags it, the submit dialog lists
// "v3 renames first_name to given_name." rather than a removal plus a new required variable, and submit stores one
// key_renamed change.
//
// Standalone: the fixture inserts Spring Travel v2 Active (first_name in the greeting and in the email subject);
// afterAll removes the template and every row this run wrote for it.

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

test("a renamed variable reaches the submit dialog and the stored contract as one rename", async ({ page }) => {
  const { templateId } = fixture!;
  await asPersona(page, "maya");
  await page.goto(`/${TEAM}/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
  await hydrated(page);

  await test.step("Maya opens a draft of v2", async () => {
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await reactReady(edit);
    await click(edit);
    await expect(statusBadge(page)).toHaveText("Draft");
    await liveEditor(page);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "true");
  });

  await test.step("She changes First name's key to given_name: the row flags the rename", async () => {
    const row = panelRow(page, "first_name");
    await tap(row.getByRole("button", { name: "Edit First name" }));
    const form = page.getByRole("form", { name: "Edit First name" });
    await expect(form).toBeVisible();
    await form.getByLabel("Key").fill("given_name");
    await form.getByLabel("Key").press("Enter");
    await expect(form).toBeHidden();
    await expect(panelRow(page, "given_name")).toContainText("Key changed");
    await expectAutosaved(page);

    const [draft] = await rows(db, "SELECT variables FROM versions WHERE template_id = ? AND state = 'draft'", [templateId]);
    const saved = (json(draft.variables) as { id?: string; key: string }[]).find((v) => v.key === "given_name");
    expect(saved, "the draft keeps the variable's old key as its id").toMatchObject({ id: "first_name" });
  });

  await test.step("After a reload the panel still knows it was renamed", async () => {
    await page.reload();
    await hydrated(page);
    await liveEditor(page);
    await expect(panelRow(page, "given_name")).toContainText("Key changed");
    await expect(panelRow(page, "first_name")).toHaveCount(0);
  });

  const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });

  await test.step("Submit lists the rename, old → new, not a removal and an addition", async () => {
    const submit = page.getByRole("button", { name: "Submit for review" });
    await expect(submit).toBeEnabled();
    await tap(submit);
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText("v3 renames first_name to given_name.");
    await expect(dialog).not.toContainText("removes");
    await expect(dialog).not.toContainText("adds required");
  });

  await test.step("Submitted, v3 stores one key_renamed change", async () => {
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });

    const [v3] = await rows(db, "SELECT state, contract_changes FROM versions WHERE template_id = ? AND number = 3", [templateId]);
    expect(v3.state).toBe("in_review");
    expect(json(v3.contract_changes)).toEqual([
      { kind: "key_renamed", key: "given_name", breaking: true, from: "first_name", to: "given_name" },
    ]);
  });
});
