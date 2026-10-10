import type { Client } from "@libsql/client";
import type { Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { SPRING_NAME, TEAM, click, createSpringTravel, json, reactReady, removeTemplate, rows, type SpringFixture } from "./helpers/golive";
import { asPersona, documentEditor, expect, expectAutosaved, hydrated, liveEditor, liveField, panelRow, tap, test } from "./helpers/scenario";

// Renaming a variable while Email is off (handoff review I3). The subject and preheader stay in the editor
// root while Email is off, only hidden: the subject's chip still counts in the panel, the rename reaches it and
// saves it, and with Email back on the subject shows the renamed variable and the draft submits.
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

/** The keys of the chips in a saved one-line field. */
const keysIn = (doc: { content?: unknown[] } | null): string[] =>
  ((doc?.content ?? []) as { type: string; attrs?: { key?: string }; content?: unknown[] }[]).flatMap((node) =>
    node.type === "variable" ? [String(node.attrs?.key)] : keysIn(node),
  );

const savedSubjectKeys = async (templateId: string) => {
  const [draft] = await rows(db, "SELECT channel_fields FROM versions WHERE template_id = ? AND state = 'draft'", [templateId]);
  return keysIn(json(draft.channel_fields)?.email?.subject ?? null);
};

test("a variable renamed while Email is off is renamed in the subject too, and the draft submits", async ({ page }) => {
  const { templateId } = fixture!;
  await asPersona(page, "maya");
  await page.goto(`/${TEAM}/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
  await hydrated(page);

  await test.step("Maya opens a draft: First name is in the greeting and the subject", async () => {
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await reactReady(edit);
    await click(edit);
    await expect(statusBadge(page)).toHaveText("Draft");
    await liveEditor(page);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "true");
    const subject = page.getByRole("textbox", { name: "Email subject" });
    await liveField(subject);
    await expect(subject.locator('[data-variable="first_name"]')).toHaveText("First name");
    await expect(panelRow(page, "first_name")).toContainText("2 uses");
  });

  const email = page.getByRole("group", { name: "Channels", exact: true }).getByRole("button", { name: "Email" });

  await test.step("Email off: the details go, and the subject's chip still counts", async () => {
    await tap(email);
    await expect(email).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("heading", { name: "Email details" })).toHaveCount(0);
    await expect(panelRow(page, "first_name")).toContainText("2 uses");
  });

  await test.step("She renames First name to Given name (given_name): the saved subject follows", async () => {
    const row = panelRow(page, "first_name");
    await tap(row.getByRole("button", { name: "Edit First name" }));
    const form = page.getByRole("form", { name: "Edit First name" });
    await expect(form).toBeVisible();
    await form.getByLabel("Label").fill("Given name");
    await form.getByLabel("Key").fill("given_name");
    await form.getByLabel("Key").press("Enter");
    await expect(form).toBeHidden();
    await expect(panelRow(page, "given_name")).toContainText("2 uses");
    await expect(documentEditor(page).locator('[data-variable="given_name"]')).toHaveText("Given name");
    await expectAutosaved(page);
    expect(await savedSubjectKeys(templateId), "the saved subject carries the new key").toEqual(["given_name"]);
  });

  await test.step("Email back on: the subject shows Given name, not an unknown first_name", async () => {
    await tap(email);
    await expect(email).toHaveAttribute("aria-pressed", "true");
    const subject = page.getByRole("textbox", { name: "Email subject" });
    await expect(subject).toBeVisible();
    await expect(subject.locator('[data-variable="given_name"]')).toHaveText("Given name");
    await expect(subject.locator('[data-variable="first_name"], [data-unknown]')).toHaveCount(0);
    await expectAutosaved(page);
  });

  await test.step("Submit: no \"Define or remove\", and v3 is in review with the renamed subject", async () => {
    const submit = page.getByRole("button", { name: "Submit for review" });
    await expect(submit).toBeEnabled();
    await tap(submit);
    const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    // Refused, the dialog would stay open with "Define or remove {{first_name}} before submitting." at its button.
    await expect(dialog, "the submit goes through").toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(/Define or remove/)).toHaveCount(0);
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });

    const [v3] = await rows(db, "SELECT state, channel_fields FROM versions WHERE template_id = ? AND number = 3", [templateId]);
    expect(v3.state).toBe("in_review");
    expect(keysIn(json(v3.channel_fields)?.email?.subject ?? null)).toEqual(["given_name"]);
  });
});
