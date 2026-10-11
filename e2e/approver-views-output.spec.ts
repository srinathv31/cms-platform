import type { Client, InValue } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { removeTemplate, rowsOf } from "./helpers/cleanup";
import { channelControl, expectViewed, phoneControl, reviewTabs } from "./helpers/review";
import { asPersona, expect, hydrated, tap, test } from "./helpers/scenario";

// An approver views every output before approving (decision 0037). Approve waits until each output of the
// round has rendered on the approver's screen in the Preview: each channel, and Push on both phones. It is
// greyed meanwhile, with the sentence the server refuses with, and the Preview's controls check off what
// has been viewed. Request changes never waits. What was viewed lasts a reload in the same tab, and the
// approval's audit row records it.
//
//   1. A document (PDF and Web): Approve greyed with "Preview PDF and Web first."; Request
//      changes is Jordan's to press. The Preview opens on PDF; once it is drawn, PDF is checked and the
//      reason names Web alone. Web: checked, and Approve is available. A reload keeps it. Approve: v1 is
//      Active, and the audit row says ["pdf", "web"].
//   2. An alert (Push and SMS): Push on the iPhone, then SMS, then Push on Android. The phone control checks
//      each phone, the channel control checks Push once both are, and nothing moves as a check appears.
//      Approve: v1 is Active, and the audit row says ["push.ios", "push.android", "sms"].
//
// Self-contained: each test copies a seeded round in review into a template of its own (v1, in review,
// submitted by Maya), and afterAll removes them. Console and page errors fail it.

// The preview frames are sandboxed: Playwright's trace injects scripts into them ("Blocked script execution").
test.use({ trace: "off" });

const TEAM = "coral-offers";
const DOCUMENT = { id: "UC-E2EVD1", from: "Cash Back Welcome Bonus — Terms", name: "Viewed outputs — Terms" };
const ALERT = { id: "UC-E2EVA1", from: "Card Used Abroad", name: "Viewed outputs — Alert" };

let db: Client;
const made: string[] = [];

test.beforeAll(async () => {
  db = openDb();
  // A run that died half way leaves its copies: start clean.
  for (const id of [DOCUMENT.id, ALERT.id]) await removeTemplate(db, id);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    for (const id of made) await removeTemplate(db, id);
  } finally {
    db.close();
  }
});

async function insert(table: "templates" | "versions", row: Record<string, InValue>) {
  const columns = Object.keys(row);
  await rowsOf(db, `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((c) => row[c]));
}

/** A seeded round in review, copied as the first version of a template of its own, waiting on its first stage. */
async function copyInReview(copy: { id: string; from: string; name: string }) {
  const [version] = await rowsOf(db, "SELECT * FROM versions WHERE name = ? AND state = 'in_review'", [copy.from]);
  expect(version, `the seed has ${copy.from} in review`).toBeTruthy();
  const [template] = await rowsOf(db, "SELECT * FROM templates WHERE id = ?", [version!.template_id]);
  await insert("templates", { ...template!, id: copy.id });
  made.push(copy.id);
  await insert("versions", {
    ...version!,
    id: `ver_e2e_${copy.id}`,
    template_id: copy.id,
    name: copy.name,
    number: 1,
    round: 1,
    based_on_version_id: null,
    contract_changes: null,
    current_stage: 0,
    submitted_by: "maya",
    created_by: "maya",
    writers: JSON.stringify(["maya"]),
  });
}

const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) => decision(page).getByRole("button", { name: "Approve", exact: true });
const requestButton = (page: Page) => decision(page).getByRole("button", { name: "Request changes", exact: true });
const stageLine = (page: Page) => decision(page).locator('[data-step="current"]');
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const segment = (group: Locator, name: string) => group.getByRole("button", { name, exact: true });

/** Approve is greyed (focusable, `aria-disabled`), its reason the stage's line and its description. */
async function expectApproveWaits(page: Page, reason: string) {
  await expect(approveButton(page)).toBeDisabled();
  await expect(approveButton(page)).toHaveAccessibleDescription(reason);
  await expect(stageLine(page)).toContainText(reason);
  await expect(requestButton(page), "Request changes never waits on the outputs").toBeEnabled();
}

async function openReview(page: Page, id: string) {
  await asPersona(page, "jordan");
  await page.goto(`/${TEAM}/review/${id}/1`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await hydrated(page);
}

/** Approve → Approve v1: the version goes Active. */
async function approve(page: Page) {
  await tap(approveButton(page));
  const dialog = page.getByRole("dialog", { name: "Approve v1" });
  await expect(dialog).toBeVisible();
  await tap(dialog.getByRole("button", { name: "Approve v1", exact: true }));
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(statusBadge(page)).toHaveText("Active", { timeout: 20_000 });
}

async function auditedOutputs(templateId: string): Promise<unknown> {
  const [row] = await rowsOf(db, "SELECT details FROM audit_events WHERE template_id = ? AND action = 'version.activated'", [templateId]);
  return JSON.parse(String(row!.details)).outputsViewed;
}

test("a document: Approve waits until PDF and Web have rendered on screen, and the approval records them", async ({ page }) => {
  await copyInReview(DOCUMENT);
  await openReview(page, DOCUMENT.id);

  await test.step("1.1 Jordan arrives on the Document view: Approve waits on both outputs", async () => {
    await expect(reviewTabs(page).getByRole("tab", { name: "Document" })).toHaveAttribute("aria-selected", "true");
    await expectApproveWaits(page, "Preview PDF and Web first.");
  });

  await test.step("1.2 The Preview opens on PDF: once drawn it is checked, and Web alone is left", async () => {
    await tap(reviewTabs(page).getByRole("tab", { name: "Preview", exact: true }));
    const pdf = segment(channelControl(page), "PDF");
    const web = segment(channelControl(page), "Web");
    await expect(pdf).toHaveAttribute("aria-pressed", "true");
    const widthBefore = (await web.boundingBox())!.width;
    await expectViewed(pdf);
    await expect(pdf).toHaveAccessibleDescription("Viewed");
    await expect(web, "picked, never shown: not viewed").not.toHaveAttribute("data-done", "");
    await expectApproveWaits(page, "Preview Web first.");

    await tap(web);
    await expectViewed(web);
    expect((await web.boundingBox())!.width, "the check had its room before it appeared").toBe(widthBefore);
    await expect(approveButton(page)).toBeEnabled();
    await expect(stageLine(page)).toContainText("Waiting for a decision");
  });

  await test.step("1.3 A reload in the same tab keeps what was viewed", async () => {
    await page.reload();
    await hydrated(page);
    await expect(approveButton(page)).toBeEnabled();
  });

  await test.step("1.4 He approves: v1 is Active, and the audit row records the outputs he viewed", async () => {
    await approve(page);
    expect(await auditedOutputs(DOCUMENT.id)).toEqual(["pdf", "web"]);
  });
});

test("an alert: Push counts on each phone, then SMS; the controls check off what was viewed", async ({ page }) => {
  await copyInReview(ALERT);
  await openReview(page, ALERT.id);
  await expectApproveWaits(page, "Preview Push (iPhone, Android) and SMS first.");

  await tap(reviewTabs(page).getByRole("tab", { name: "Preview", exact: true }));
  const push = segment(channelControl(page), "Push");
  const sms = segment(channelControl(page), "SMS");
  const iphone = segment(phoneControl(page), "iPhone");
  const android = segment(phoneControl(page), "Android");

  await test.step("2.1 Push on the iPhone: that phone is checked; Push itself waits for Android", async () => {
    await expect(push).toHaveAttribute("aria-pressed", "true");
    await expect(iphone).toHaveAttribute("aria-pressed", "true");
    await expectViewed(iphone);
    await expect(android).not.toHaveAttribute("data-done", "");
    await expect(push).not.toHaveAttribute("data-done", "");
    await expectApproveWaits(page, "Preview Push (Android) and SMS first.");
  });

  await test.step("2.2 SMS: checked, and Push on Android is all that's left", async () => {
    await tap(sms);
    await expectViewed(sms);
    await expectApproveWaits(page, "Preview Push (Android) first.");
  });

  await test.step("2.3 Push on Android: both phones and Push are checked, and Approve is his", async () => {
    await tap(push);
    const widthBefore = (await android.boundingBox())!.width;
    await tap(android);
    await expectViewed(android);
    await expectViewed(push);
    expect((await android.boundingBox())!.width, "nothing moves as the check appears").toBe(widthBefore);
    await expect(approveButton(page)).toBeEnabled();
  });

  await test.step("2.4 He approves: v1 is Active, and the audit row records all three outputs", async () => {
    await approve(page);
    expect(await auditedOutputs(ALERT.id)).toEqual(["push.ios", "push.android", "sms"]);
  });
});
