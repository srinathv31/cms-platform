import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { expectError, longDate, openDb } from "./api/helpers";
import {
  SPRING_NAME,
  TEAM,
  click,
  coralRender,
  createSpringTravel,
  json,
  restore,
  rows,
  run,
  takeSnapshot,
  type Row,
  type Snapshot,
  type SpringFixture,
} from "./helpers/golive";
import {
  asPersona,
  caret,
  documentEditor,
  expect,
  expectAutosaved,
  hydrated,
  liveEditor,
  panelRow,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";

// After the Active version is revoked, the template can still be corrected (handoff review D1, decision 0009).
//
//   Spring Travel Rewards: v1 Superseded with no sunset (it still renders; `offer_end_date` was required
//   then), v2 Active (it made `offer_end_date` optional), and Coral renders v2.
//   1. Jordan starts revoking v2 on the Versions tab; the dialog says no version will be Active. Alex confirms
//      it. v2 is Revoked and Coral's renders of it fail; v1 still renders.
//   2. Maya opens the template: Revoked, with Edit. Edit opens a draft Based on v2, with v2's content. The
//      variable flags compare with v1, the newest version that still renders. She fixes the sentence.
//   3. The submit dialog lists the contract change against v1 ("v3 makes `offer_end_date` optional."), not
//      "No contract changes from v2". She submits v3.
//   4. Jordan approves v3 on the review screen: it goes live over nothing (no sunset to set), v2 stays
//      Revoked, v1 stays Superseded, and Coral gets the usual new-version notice. v3 renders with the fix.
//
// Self-contained: the fixture template and every row that points at it are removed in afterAll.

const REASON = "Wrong intro APR in the legal notices.";
const GREETING = "spend $1,000 on travel";
const FIX = " The intro APR lasts 12 months.";
const DAY = 86_400_000;

let db: Client;
let snapshot: Snapshot | undefined;
let fixture: SpringFixture | null = null;
let v1Id = "";

/**
 * v1, as it was before v2: the same content with `offer_end_date` required, Superseded when v2 went live
 * and with no sunset, so it still renders.
 */
async function insertV1(spring: SpringFixture): Promise<string> {
  const [v2] = await rows(db, "SELECT * FROM versions WHERE id = ?", [spring.v2Id]);
  const live = Number(v2.activated_at);
  const id = `v_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`;
  const variables = spring.variables.map((v) => (v.key === "offer_end_date" ? { ...v, required: true } : v));
  const row: Row = {
    ...v2,
    id,
    number: 1,
    state: "superseded",
    variables: JSON.stringify(variables),
    created_at: live - 20 * DAY,
    updated_at: live - 19 * DAY,
    submitted_at: live - 19 * DAY,
    activated_at: live - 18 * DAY,
    superseded_at: live,
  };
  const columns = Object.keys(row);
  await run(db, `INSERT INTO versions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((c) => row[c]));
  return id;
}

test.beforeAll(async () => {
  db = openDb();
  snapshot = await takeSnapshot(db);
  fixture = await createSpringTravel(db);
  v1Id = await insertV1(fixture);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (snapshot) await restore(db, snapshot, { templates: fixture ? [fixture.templateId] : [], clock: false });
  } finally {
    db.close();
  }
});

// ── The screens ──────────────────────────────────────────────────────────────

const versionEntry = (page: Page, number: number): Locator =>
  page.locator(`[data-slot="version-entry"][data-version="${number}"]`).filter({ visible: true });
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });

async function openVersions(page: Page, persona: string, templateId: string) {
  await asPersona(page, persona);
  await page.goto(`/${TEAM}/templates/${templateId}/versions`);
  await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
  await hydrated(page);
}

async function openWorkspace(page: Page, persona: string, templateId: string) {
  await asPersona(page, persona);
  await page.goto(`/${TEAM}/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
  await liveEditor(page);
  await hydrated(page);
}

test("after the Active version is revoked, an author corrects it from its content, and the correction goes live", async ({ page, request }) => {
  test.setTimeout(180_000);
  const spring = fixture!;
  const { templateId } = spring;

  await test.step("0. Before: Coral renders v2 (Active) and v1 (Superseded, newer version 2)", async () => {
    const v2 = await coralRender(request, spring, 2, "revoke-recovery-v2");
    expect(v2.res.status()).toBe(200);
    const v1 = await coralRender(request, spring, 1, "revoke-recovery-v1");
    expect(v1.res.status()).toBe(200);
    expect(v1.res.headers()["x-stencil-newer-version"]).toBe("2");
  });

  // ── 1. The revoke ──────────────────────────────────────────────────────────

  await test.step("1.1 Jordan starts revoking v2: the dialog says nothing will be Active until a new version is approved", async () => {
    await openVersions(page, "jordan", templateId);
    const v2 = versionEntry(page, 2);
    await expect(v2).toHaveAttribute("data-state", "active");
    await click(v2.getByRole("button", { name: "Revoke v2", exact: true }));

    const dialog = page.getByRole("dialog", { name: "Revoke v2" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-slot="consequences"]')).toContainText("Once confirmed, no version will be Active until a new one is approved.");
    await expect(dialog.getByLabel("Reason")).toBeFocused();
    await typeSlowly(page, REASON);
    await click(dialog.getByRole("button", { name: "Start revoke", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(v2.locator('[data-slot="revoke"]')).toHaveAttribute("data-pending", "", { timeout: 20_000 });
  });

  await test.step("1.2 Alex confirms: v2 is Revoked, and Coral's renders of it fail while v1 still renders", async () => {
    await openVersions(page, "alex", templateId);
    const v2 = versionEntry(page, 2);
    await click(v2.locator('[data-slot="revoke"]').getByRole("button", { name: "Confirm revoke", exact: true }));
    const dialog = page.getByRole("dialog", { name: "Confirm revoke of v2" });
    await expect(dialog).toBeVisible();
    await click(dialog.getByRole("button", { name: "Confirm revoke", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(v2).toHaveAttribute("data-state", "revoked", { timeout: 20_000 });
    await expect(versionEntry(page, 1)).toHaveAttribute("data-state", "superseded");

    const [row] = await rows(db, "SELECT revoke FROM versions WHERE id = ?", [spring.v2Id]);
    const day = longDate(json(row.revoke).confirmedAt);
    const revoked = await coralRender(request, spring, 2, "revoke-recovery-v2-revoked");
    await expectError(revoked.res, 410, "version_revoked", `Version 2 was revoked on ${day}. No version is active.`);
    const v1 = await coralRender(request, spring, 1, "revoke-recovery-v1-after");
    expect(v1.res.status(), "v1 still renders").toBe(200);
  });

  // ── 2. The correction ──────────────────────────────────────────────────────

  await test.step("2.1 Maya opens the template: Revoked, and Edit is hers to press", async () => {
    await openWorkspace(page, "maya", templateId);
    await expect(statusBadge(page)).toHaveText("Revoked");
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "false");
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
  });

  await test.step("2.2 Edit opens a draft Based on v2, with v2's content; the variable flags compare with v1", async () => {
    await tap(page.getByRole("button", { name: "Edit", exact: true }));
    await expect(statusBadge(page)).toHaveText("Draft", { timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`/${TEAM}/templates/${templateId}$`));
    await expect(page.locator("header").filter({ visible: true }).getByText("Based on v2", { exact: true })).toBeVisible();
    await liveEditor(page);
    await expect(documentEditor(page)).toHaveAttribute("contenteditable", "true");
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeEnabled();

    const [draft] = await rows(db, "SELECT * FROM versions WHERE template_id = ? AND state = 'draft'", [templateId]);
    const [v2] = await rows(db, "SELECT * FROM versions WHERE id = ?", [spring.v2Id]);
    expect(draft.based_on_version_id, "based on the revoked version").toBe(spring.v2Id);
    expect(json(draft.body), "v2's body, block ids and all").toEqual(json(v2.body));
    expect(json(draft.variables)).toEqual(json(v2.variables));

    // Against v1, offer_end_date is no longer required; against the revoked v2 nothing would be flagged.
    await expect(panelRow(page, "offer_end_date")).toContainText("Now optional");
    await expect(panelRow(page, "first_name")).not.toContainText("Now optional");
  });

  await test.step("2.3 She fixes the sentence", async () => {
    const paragraph = documentEditor(page).locator("p", { hasText: GREETING });
    await paragraph.scrollIntoViewIfNeeded();
    const box = (await paragraph.boundingBox())!;
    const end = { x: box.width - 4, y: box.height - 10 };
    await untilUncovered(paragraph, end);
    await tap(paragraph, { position: end });
    await page.keyboard.press("End");
    await expect.poll(async () => (await caret(page)).focused).toBe(true);
    await typeSlowly(page, FIX);
    await expect(paragraph).toContainText(FIX.trim());
    await expectAutosaved(page);
  });

  // ── 3. Submit ──────────────────────────────────────────────────────────────

  await test.step("3. The submit dialog lists the change against v1, and she submits v3", async () => {
    await tap(page.getByRole("button", { name: "Submit for review" }));
    const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText("Contract changes");
    await expect(dialog).toContainText("v3 makes offer_end_date optional.");
    await expect(dialog).not.toContainText("No contract changes from v2");
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });

    const [v3] = await rows(db, "SELECT * FROM versions WHERE template_id = ? AND number = 3", [templateId]);
    expect(v3).toMatchObject({ state: "in_review", submitted_by: "maya", based_on_version_id: spring.v2Id });
    expect(json(v3.contract_changes)).toEqual([{ kind: "made_optional", key: "offer_end_date", breaking: false, required: false }]);
  });

  // ── 4. Approve and render ──────────────────────────────────────────────────

  await test.step("4.1 Jordan approves v3: it goes live over nothing, with no sunset to set", async () => {
    await asPersona(page, "jordan");
    await page.goto(`/${TEAM}/review/${templateId}/3`);
    await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
    await liveEditor(page);
    await hydrated(page);
    await expect(decision(page).getByRole("region", { name: "Contract changes" })).toContainText("v3 makes offer_end_date optional.");
    await expect(documentEditor(page)).toContainText(FIX.trim());

    await click(decision(page).getByRole("button", { name: "Approve", exact: true }));
    const dialog = page.getByRole("dialog", { name: "Approve v3" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText("v3 becomes Active.");
    await expect(dialog.getByRole("checkbox"), "no previous Active version to sunset").toHaveCount(0);
    await expect(dialog.getByText(/sunset/i)).toHaveCount(0);
    await tap(dialog.getByRole("button", { name: "Approve v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("Active", { timeout: 20_000 });
  });

  await test.step("4.2 The database: v3 Active, v2 still Revoked, v1 still Superseded; Coral is told about v3", async () => {
    const list = await rows(db, "SELECT id, number, state, sunset_at FROM versions WHERE template_id = ? ORDER BY number", [templateId]);
    expect(list).toEqual([
      { id: v1Id, number: 1, state: "superseded", sunset_at: null },
      { id: spring.v2Id, number: 2, state: "revoked", sunset_at: null },
      { id: expect.any(String), number: 3, state: "active", sunset_at: null },
    ]);
    const [activated] = await rows(db, "SELECT details FROM audit_events WHERE template_id = ? AND action = 'version.activated' ORDER BY at DESC LIMIT 1", [templateId]);
    expect(json(activated.details)).toMatchObject({ number: 3, supersedes: null });
    expect(await rows(db, "SELECT id FROM audit_events WHERE template_id = ? AND action IN ('version.superseded', 'version.sunset_set')", [templateId])).toEqual([]);

    const notices = await rows(db, "SELECT consumer_id, kind, payload FROM consumer_notices WHERE template_id = ? ORDER BY created_at, id", [templateId]);
    expect(notices.map((n) => [n.consumer_id, n.kind])).toEqual([
      ["coral", "revoked"],
      ["coral", "new_version"],
    ]);
    expect(json(notices[0].payload)).toMatchObject({ versionNumber: 2, activeVersion: null, reason: REASON });
    expect(json(notices[1].payload)).toMatchObject({
      versionNumber: 3,
      activeVersion: 3,
      contractLines: ["v3 makes `offer_end_date` optional."],
    });
  });

  await test.step("4.3 Coral renders v3, with the fix; v2 stays refused", async () => {
    const v3 = await coralRender(request, spring, 3, "revoke-recovery-v3");
    expect(v3.res.status()).toBe(200);
    expect(v3.res.headers()["x-stencil-version"]).toBe("3");
    expect(await v3.res.text()).toContain(FIX.trim());

    const [row] = await rows(db, "SELECT revoke FROM versions WHERE id = ?", [spring.v2Id]);
    const v2 = await coralRender(request, spring, 2, "revoke-recovery-v2-final");
    await expectError(v2.res, 410, "version_revoked", `Version 2 was revoked on ${longDate(json(row.revoke).confirmedAt)}. Version 3 is active.`);
  });
});
