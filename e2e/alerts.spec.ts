import type { Client } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { removeTemplate, rowsOf } from "./helpers/cleanup";
import { asPersona, beat, demoTimeout, expect, expectAutosaved, hydrated, liveField, nameField, openLibrary, tap, test, typeSlowly, untilUncovered } from "./helpers/scenario";

// Alerts end to end (decision 0033): an alert is made, written with its phone live beside it, held at
// submit until its SMS is in GSM-7, approved, changed, reviewed with its fields redlined, commented on at a
// field, approved again, and compared.
//
//   1. Maya: New template → Alert → Statement ready. The gallery has Alert's own starters, and Import a
//      file stays, greyed, with its reason. The composer opens on the push and the text message; Copilot
//      prompt is greyed with its reason.
//   2. Preview: an iPhone lock screen with the push, the sample values filled in. Typing in the body changes
//      the phone at once; past the lock screen's four lines, the field warns where the iPhone cuts it.
//   3. A subtitle shows under the title on the iPhone; Android leaves it out; back on the iPhone it is there.
//      In the Device options, Banner greys Previews with its reason, and no row of the popover moves.
//   4. The SMS: its meta line (encoding and parts, with the long values too). A curly apostrophe is flagged
//      in the text and the line turns to UCS-2 and 3 parts; the phone's Messages thread shows the text.
//   5. Submit is refused with the reason, and the dialog stays; Tab reaches the flag's Replace and goes on
//      past the field from it; Replace fixes the character (the line is back to GSM-7); submit goes through
//      and v1 is In review.
//   6. Jordan opens v1: the Document view is the alert's fields, read-only, with no Show changes (nothing to
//      compare with yet). He approves: v1 is Active.
//   7. Maya edits (v2): a word on the push title and a sentence on the SMS, and submits v2.
//   8. Jordan opens v2: Show changes counts 2 and redlines the title and the SMS, word for word; Changes only
//      leaves the unchanged fields as "Unchanged". He comments on the push title from the gutter: the thread
//      is on the field, its marker beside it. He approves: v2 is Active.
//   9. Compare versions, v1 → v2: the fields, as the composer shows them, with the same redline, and no body.
//
// Self-contained: it makes one template and afterAll removes everything it wrote. Console and page errors
// fail it.

const TEAM = "coral-offers";
const NAME = "Statement ready";
const BODY_ADDED = " Thanks for banking with Coral. Pay in the app.";
const SUBTITLE = "Coral Rewards card";
const SMS_ADDED_CURLY = " We’re here to help.";
const SMS_ADDED = " We're here to help.";
const REFUSED = "Replace ’ in the SMS message before submitting. It isn't in the SMS character set.";
const TITLE_ADDED = " now";
const SMS_ADDED_V2 = " Thanks.";
const COMMENT = "Is “now” right for a statement sent overnight?";

let db: Client;
/** Set once the template exists, so afterAll removes it even when the test fails half way. */
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

// ── The screens ──────────────────────────────────────────────────────────────

const field = (page: Page, name: string) => page.getByRole("textbox", { name }).filter({ visible: true });
/** The phone in the preview's well (the composer measures cuts on hidden phones of its own). */
const phone = (page: Page) => page.locator('[data-slot="preview-well"] figure[data-device]').filter({ visible: true });
const onPhone = (page: Page, key: "title" | "subtitle" | "body") => phone(page).locator(`[data-field="${key}"]`);
const smsMeta = (page: Page) => page.locator('[data-slot="sms-meta"]').filter({ visible: true });
const cutWarnings = (page: Page) => page.locator('[data-slot="cut-warning"]').filter({ visible: true });
const flags = (page: Page) => page.locator(".ucomp-flag").filter({ visible: true });
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });
const decision = (page: Page) => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
/** A field of the version on the review screen or in Compare, by its id ("push.title"). */
const fieldFrame = (scope: Page | Locator, id: string) => scope.locator(`[data-fields-document] .ucomp-doc > [data-block-id="${id}"]`);
const gutterMarkers = (page: Page) => page.locator('[data-slot="gutter-markers"] [data-marker]').filter({ visible: true });

/** The end of a field's text, then the words, as an author types them. */
async function typeAtEnd(page: Page, target: Locator, text: string) {
  await liveField(target);
  await tap(target);
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await typeSlowly(page, text);
}

/** The template's Content tab as `persona`, hydrated. */
async function openTemplate(page: Page, persona: string) {
  await asPersona(page, persona);
  await page.goto(`/${TEAM}/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: NAME }).or(nameField(page))).toBeVisible();
  await hydrated(page);
}

/** The review screen of version `n` as `persona`, on its Document view. */
async function openReview(page: Page, persona: string, n: number) {
  await asPersona(page, persona);
  await page.goto(`/${TEAM}/review/${templateId}/${n}`);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await hydrated(page);
  await expect(page.getByRole("tab", { name: "Document" }), "an alert's review opens on what was written").toHaveAttribute("aria-selected", "true");
}

/** Submit for review → Submit vN, through. */
async function submit(page: Page, n: number) {
  await tap(page.getByRole("button", { name: "Submit for review" }));
  const dialog = page.getByRole("dialog", { name: `Submit v${n} for review` });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await tap(dialog.getByRole("button", { name: `Submit v${n}`, exact: true }));
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(statusBadge(page)).toHaveText("In review", { timeout: 20_000 });
}

/** Approve → Approve vN, as the decision rail offers it: the version goes Active. */
async function approve(page: Page, n: number) {
  await tap(decision(page).getByRole("button", { name: "Approve", exact: true }));
  const dialog = page.getByRole("dialog", { name: `Approve v${n}` });
  await expect(dialog).toBeVisible();
  await tap(dialog.getByRole("button", { name: `Approve v${n}`, exact: true }));
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(statusBadge(page)).toHaveText("Active", { timeout: 20_000 });
}

const storedSms = async (n: number) => {
  const [row] = await rowsOf(db, "SELECT channel_fields FROM versions WHERE template_id = ? AND number = ?", [templateId, n]);
  return JSON.stringify(JSON.parse(String(row.channel_fields)).sms.text);
};

// ── The spec ─────────────────────────────────────────────────────────────────

test.use({ trace: "off", screenshot: "only-on-failure" });

test.describe("alerts", () => {
  test("an alert is composed with its phone live, held at submit for a character, reviewed with its fields redlined, commented on and compared", async ({ page }) => {
    test.setTimeout(demoTimeout(240_000));

    await asPersona(page, "maya");
    await openLibrary(page, TEAM);

    await test.step("1. New template → Alert → Statement ready: Alert's own starters, Import greyed, the composer", async () => {
      await tap(page.getByRole("button", { name: "New template" }));
      const gallery = page.getByRole("dialog");
      await expect(gallery).toBeVisible();
      const alert = gallery.getByRole("button", { name: "Alert", exact: true });
      await tap(alert);
      await expect(alert).toHaveAttribute("aria-pressed", "true");
      for (const starter of ["Blank", "Payment reminder", "Card activity", "Statement ready"]) {
        await expect(gallery.getByRole("button", { name: new RegExp(`^${starter}`) })).toBeVisible();
      }
      await expect(gallery.getByRole("button", { name: /^Card offer terms/ }), "a document's starter isn't an alert's").toHaveCount(0);
      const importRow = gallery.getByRole("button", { name: /^Import a file/ });
      await expect(importRow, "Import stays in place").toBeVisible();
      await expect(importRow).toHaveAttribute("aria-disabled", "true");
      await expect(gallery).toContainText("Only documents can be imported.");

      await tap(gallery.getByRole("button", { name: /^Statement ready/ }));
      await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
      templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1];
      await expect(nameField(page)).toHaveValue(NAME);
      await expect(page.getByRole("heading", { name: "Push notification" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Text message" })).toBeVisible();
      for (const name of ["Push title", "Push subtitle", "Push body", "SMS message"]) await expect(field(page, name)).toBeVisible();
      await expect(page.locator('[data-slot="sms-footer"]').filter({ visible: true })).toHaveText("Coral Offers: Reply STOP to opt out, HELP for help.");
      // Copilot writes a document's body: on an alert the row stays, greyed, with why.
      const copilot = page.getByRole("button", { name: "Copilot prompt" });
      await expect(copilot).toHaveAttribute("aria-disabled", "true");
      await expect(copilot).toHaveAccessibleDescription("Copilot drafts documents only.");
    });

    await test.step("2. Preview: the push on an iPhone lock screen; the body changes on the phone as it is typed, and warns where the lock screen cuts it", async () => {
      await tap(page.getByRole("button", { name: "Preview", exact: true }));
      await expect(phone(page)).toHaveAttribute("data-device", "ios");
      await expect(onPhone(page, "title")).toHaveText("Your statement is ready");
      // The sample values, filled in: no chip and no key on the phone.
      await expect(onPhone(page, "body")).toContainText("Hi Maya, your new statement is ready.");
      await expect(cutWarnings(page)).toHaveCount(0);

      await typeAtEnd(page, field(page, "Push body"), BODY_ADDED);
      // Before any save: the phone renders what is typed, in the browser (decision 0035).
      await expect(onPhone(page, "body")).toContainText(BODY_ADDED.trim());
      await expect(cutWarnings(page)).toHaveCount(1);
      await expect(cutWarnings(page)).toHaveText(/^iPhone lock screen cuts after “…[^”]+”\.$/);
      await expectAutosaved(page);
    });

    await test.step("3. The subtitle shows under the title on the iPhone, and Android leaves it out", async () => {
      await typeAtEnd(page, field(page, "Push subtitle"), SUBTITLE);
      await expect(onPhone(page, "subtitle")).toHaveText(SUBTITLE);

      const platforms = page.getByRole("group", { name: "Phone" });
      await tap(platforms.getByRole("button", { name: "Android", exact: true }));
      await expect(phone(page)).toHaveAttribute("data-device", "android");
      await expect(onPhone(page, "title")).toContainText("Your statement is ready");
      await expect(phone(page), "Android never shows the iPhone's subtitle").not.toContainText(SUBTITLE);
      await expect(onPhone(page, "subtitle")).toHaveCount(0);

      await tap(platforms.getByRole("button", { name: "iPhone", exact: true }));
      await expect(phone(page)).toHaveAttribute("data-device", "ios");
      await expect(onPhone(page, "subtitle")).toHaveText(SUBTITLE);

      // The Device options hold still: Banner greys Previews with its reason under it, and no row moves.
      await tap(page.locator('[data-slot="preview-controls"]').getByRole("button", { name: "Device options" }));
      const options = page.getByRole("dialog", { name: "Device options" });
      await expect(options).toBeVisible();
      // Measured once the popover has finished opening (it zooms in from 95%).
      const geometry = () =>
        options.evaluate(async (el) => {
          await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished));
          return [el.getBoundingClientRect().height, ...[...el.querySelectorAll('[role="group"]')].map((g) => g.getBoundingClientRect().y)];
        });
      const before = await geometry();
      await tap(options.getByRole("group", { name: "Screen" }).getByRole("button", { name: "Banner", exact: true }));
      await expect(phone(page).locator("figcaption")).toHaveText("Banner, iOS-style preview");
      await expect(options.locator('[role="group"][aria-disabled="true"]')).toHaveAccessibleDescription("Lock screen only");
      expect(await geometry(), "picking Banner moves no row of the popover").toEqual(before);
      await tap(options.getByRole("group", { name: "Screen" }).getByRole("button", { name: "Lock screen", exact: true }));
      await page.keyboard.press("Escape");
      await expect(options).toBeHidden();
    });

    await test.step("4. The SMS meta line, and a curly apostrophe flagged where it was typed: UCS-2, 3 parts", async () => {
      await expect(smsMeta(page)).toHaveText(/^GSM-7 · 1 part\s*,?\s*· Long values: 1 part$/);
      await typeAtEnd(page, field(page, "SMS message"), SMS_ADDED_CURLY);
      await expect(flags(page)).toHaveCount(1);
      await expect(flags(page)).toHaveText("’");
      await expect(smsMeta(page)).toHaveText(/^UCS-2 · 3 parts/);

      // The phone's Messages thread shows the text as the customer gets it, with the footer.
      await tap(page.getByRole("group", { name: "Channel" }).getByRole("button", { name: "SMS", exact: true }));
      const bubble = phone(page).locator('[data-slot="sms-bubble"]');
      await expect(bubble).toContainText("We’re here to help.");
      await expect(bubble).toContainText("Reply STOP to opt out");
      await expectAutosaved(page);
    });

    await test.step("5. Submit is refused with the reason; Replace fixes the character; then v1 goes to review", async () => {
      await tap(page.getByRole("button", { name: "Submit for review" }));
      const dialog = page.getByRole("dialog", { name: "Submit v1 for review" });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await expect(dialog).toContainText("Push");
      await expect(dialog).toContainText("SMS");
      await tap(dialog.getByRole("button", { name: "Submit v1", exact: true }));
      await expect(dialog.getByRole("alert")).toHaveText(REFUSED);
      await expect(dialog, "a refusal keeps the dialog open").toBeVisible();
      await tap(dialog.getByRole("button", { name: "Cancel", exact: true }));
      await expect(dialog).toBeHidden();
      await expect(statusBadge(page)).toHaveText("Draft");

      await untilUncovered(flags(page).first());
      await tap(flags(page).first());
      await expect(page.getByRole("heading", { name: "’ isn't in the SMS character set." }), "the flag says why").toBeVisible();
      // The fix stands in the field's place in the Tab order: Tab reaches it and Shift+Tab goes back; Tab
      // from it closes the popover and goes on past the field, never round to the field again.
      const fix = page.getByRole("button", { name: "Replace with '" });
      await page.keyboard.press("Tab");
      await expect(fix).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(field(page, "SMS message")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(fix).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(fix).toBeHidden();
      await expect(field(page, "SMS message")).not.toBeFocused();
      expect(await page.evaluate(() => document.activeElement !== document.body), "Tab lands on a control").toBe(true);
      // Tab landed in the rail, which scrolled the canvas: bring the flag back into view, as a person would,
      // since a popover whose flag is clipped at the canvas's edge stays hidden.
      await flags(page).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await untilUncovered(flags(page).first());
      await tap(flags(page).first());
      await tap(fix);
      await expect(flags(page)).toHaveCount(0);
      await expect(smsMeta(page)).toHaveText(/^GSM-7 · 2 parts/);
      await expectAutosaved(page);

      await submit(page, 1);
      const [v1] = await rowsOf(db, "SELECT state, submitted_by FROM versions WHERE template_id = ? AND number = 1", [templateId]);
      expect(v1).toEqual({ state: "in_review", submitted_by: "maya" });
      expect(await storedSms(1)).toContain(SMS_ADDED.trim());
      await beat(page);
    });

    await test.step("6. Jordan reviews v1: the alert's fields, read-only, nothing to compare with yet; he approves it", async () => {
      await openReview(page, "jordan", 1);
      await expect(fieldFrame(page, "push.title")).toContainText("Your statement is ready");
      await expect(fieldFrame(page, "push.subtitle")).toContainText(SUBTITLE);
      await expect(fieldFrame(page, "sms.text")).toContainText(SMS_ADDED.trim());
      await expect(fieldFrame(page, "sms.text").locator('[data-slot="sms-footer"]')).toContainText("Reply STOP to opt out");
      await expect(page.getByRole("switch", { name: "Show changes" }), "a first version has nothing to redline against").toHaveCount(0);
      await approve(page, 1);
    });

    await test.step("7. Maya edits: a word on the push title, a sentence on the SMS; she submits v2", async () => {
      await openTemplate(page, "maya");
      await tap(page.getByRole("button", { name: "Edit", exact: true }));
      await expect(statusBadge(page)).toHaveText("Draft", { timeout: 20_000 });
      await typeAtEnd(page, field(page, "Push title"), TITLE_ADDED);
      await typeAtEnd(page, field(page, "SMS message"), SMS_ADDED_V2);
      await expectAutosaved(page);
      await submit(page, 2);
    });

    await test.step("8. Jordan reviews v2: the fields redlined against v1, a comment on the push title, and his approval", async () => {
      await openReview(page, "jordan", 2);
      const show = page.getByRole("switch", { name: "Show changes" });
      await expect(show).toBeVisible();
      await expect(page.locator('[data-change-toggles] [title="2 changed"]'), "two fields changed").toHaveText("2");
      await tap(show);
      await expect(page.locator('[data-slot="baseline-label"]')).toHaveText("vs v1");

      const title = fieldFrame(page, "push.title");
      await expect(title).toHaveAttribute("data-redline", "changed");
      await expect(title).toHaveAccessibleName("Push title, changed");
      await expect(title.locator('ins[data-redline-op="insert"]')).toHaveText(TITLE_ADDED);
      await expect(fieldFrame(page, "sms.text")).toHaveAttribute("data-redline", "changed");
      await expect(fieldFrame(page, "sms.text").locator('ins[data-redline-op="insert"]')).toHaveText(SMS_ADDED_V2);
      await expect(fieldFrame(page, "push.subtitle")).toHaveAttribute("data-redline", "unchanged");

      await tap(page.getByRole("switch", { name: "Changes only" }));
      await expect(fieldFrame(page, "push.subtitle")).toContainText("Unchanged");
      await expect(fieldFrame(page, "push.title").locator('ins[data-redline-op="insert"]')).toHaveText(TITLE_ADDED);
      await tap(page.getByRole("switch", { name: "Changes only" }));

      // A comment on the push title, from the gutter beside it.
      await title.hover();
      const add = page.getByRole("button", { name: "Comment on this field" });
      await expect(add).toBeVisible();
      await tap(add);
      const composer = decision(page).locator("article[data-compose]");
      await expect(composer).toContainText("Push title: Your statement is ready now");
      await expect(composer.getByRole("textbox", { name: "Add a comment" })).toBeFocused();
      await typeSlowly(page, COMMENT);
      await tap(composer.getByRole("button", { name: "Comment", exact: true }));
      const thread = decision(page).locator("article[data-thread]").filter({ hasText: COMMENT });
      await expect(thread).toBeVisible();
      await expect(thread).toHaveAccessibleName("Comment on the push title");
      await expect(gutterMarkers(page)).toHaveCount(1);
      await expect(gutterMarkers(page).first()).toHaveAttribute("data-marker", "push.title");
      await expect(gutterMarkers(page).first()).toHaveAccessibleName("1 comment on this field");
      await expect
        .poll(async () => (await rowsOf(db, "SELECT block_id, quote FROM comment_threads WHERE template_id = ?", [templateId])).map((r) => `${r.block_id}:${r.quote}`))
        .toEqual(["push.title:null"]);

      await approve(page, 2);
    });

    await test.step("9. Compare versions, v1 → v2: the alert's fields with the same redline, and no body", async () => {
      await asPersona(page, "maya");
      await page.goto(`/${TEAM}/templates/${templateId}/versions`);
      await hydrated(page);
      await tap(page.getByRole("button", { name: "Compare versions" }));
      const dialog = page.getByRole("dialog", { name: "Compare versions" });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[data-slot="redline-summary"]')).toHaveText("2 changed");
      await expect(dialog.getByRole("heading", { name: "Push notification" })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Text message" })).toBeVisible();
      await expect(fieldFrame(dialog, "push.title").locator('ins[data-redline-op="insert"]')).toHaveText(TITLE_ADDED);
      await expect(fieldFrame(dialog, "sms.text").locator('ins[data-redline-op="insert"]')).toHaveText(SMS_ADDED_V2);
      await expect(fieldFrame(dialog, "push.body")).toHaveAttribute("data-redline", "unchanged");
      await expect(dialog.locator("[data-redline-document]"), "an alert has no body to redline").toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });
  });
});
