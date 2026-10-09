import type { Client } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { demoNow, openDb } from "./api/helpers";
import { click, closeSettings, openSettings, settingsDialog, strip, switchPersona } from "./helpers/access";
import { asPersona, beat, demoTimeout, documentEditor, expect, hydrated, liveEditor, openLibrary, shoot, test } from "./helpers/scenario";

// Phase 6 gate: demo scenario 7 ("Teams and roles"), each persona through the persona switcher or its own cookie.
//
//   1. Priya edits on Coral Offers (Author: the document takes typing, New template is there) and, through
//      the team switcher, is View only on Deposits (Viewer: no editor chrome, no New template).
//   2. Sam (Viewer on Coral) opens an Active template: View only, and the SHARE ring opens the integration
//      sheet. Nothing in it lets him edit, and there is no Settings.
//   3. Riley (Platform Admin) turns Email off for Disclosure in Settings > Channel rules: the consequence
//      names the Active versions that stop rendering, only the confirm commits it. Turns it back on (that is
//      immediate). Then opens a template: View only, since a Platform Admin never edits.
//   4. Taylor (Auditor) sees All teams, and in the Audit page both of Riley's events, by Riley, with times
//      on the demo clock. Filtering by person narrows it, and Export follows the filter.
//
// The only thing it changes is Disclosure's Email rule, which it puts back; the audit events stay (the log
// is append-only). Console and page errors fail it.

const CORAL_DRAFT = "Annual Fee Waiver — Terms";
const DEPOSITS_ACTIVE = "Everyday Checking — Fee Schedule";
const CORAL_ACTIVE = "Rate Change Notice";

const rowLink = (page: Page, name: string): Locator =>
  page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })
    .filter({ visible: true });

/** Opens a template from the Library and waits for it to be on screen. */
async function openTemplate(page: Page, name: string) {
  await click(rowLink(page, name));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await hydrated(page);
}

const viewOnly = (page: Page) => page.getByText("View only", { exact: true });
const newTemplate = (page: Page) => page.getByRole("button", { name: "New template" });

let db: Client;

test.beforeAll(() => {
  db = openDb();
});

test.afterAll(() => {
  db?.close();
});

test.describe("scenario 7: teams and roles", () => {
  test("Priya edits in Coral and is View only in Deposits; Sam can use SHARE but not edit; Riley changes a channel rule; Taylor sees it in the audit log", async ({
    page,
  }) => {
    test.setTimeout(demoTimeout(180_000));

    // ── 1. Priya ─────────────────────────────────────────────────────────────

    await asPersona(page, "priya");
    await openLibrary(page, "coral-offers");
    await beat(page, 900);

    await test.step("1.1 Priya on Coral Offers: an Author edits (the document takes typing)", async () => {
      await expect(page.getByRole("button", { name: "Switch team" })).toContainText("Coral Offers");
      await expect(newTemplate(page), "an Author can start a template").toBeVisible();
      await openTemplate(page, CORAL_DRAFT);
      await expect(viewOnly(page)).toHaveCount(0);
      await liveEditor(page);
      const ed = documentEditor(page);
      await expect(ed).toHaveAttribute("contenteditable", "true");
      await expect(ed).toHaveAttribute("aria-readonly", "false");
      await beat(page, 900);
      await shoot(page, "priya-coral-editing");
    });

    await test.step("1.2 Through the team switcher to Deposits: View only, with no toolbar", async () => {
      await click(page.getByRole("button", { name: "Switch team" }));
      await click(page.getByRole("menuitem", { name: "Deposits" }));
      await expect(page).toHaveURL(/\/deposits\/library$/);
      await expect(page.getByRole("button", { name: "Switch team" })).toContainText("Deposits");
      await expect(newTemplate(page), "a Viewer can't start one").toHaveCount(0);
      await openTemplate(page, DEPOSITS_ACTIVE);
      await expect(viewOnly(page)).toBeVisible();
      await liveEditor(page);
      const ed = documentEditor(page);
      await expect(ed).toHaveAttribute("contenteditable", "false");
      await expect(ed).toHaveAttribute("aria-readonly", "true");
      // Selecting text brings up no format toolbar and typing changes nothing.
      await ed.locator("p").first().click({ clickCount: 3 });
      await page.mouse.move(400, 400);
      await expect(page.getByRole("toolbar", { name: "Format text" })).toHaveCount(0);
      await expect(page.locator(".ucomp-block-handle")).toHaveCount(0);
      await beat(page, 900);
      await shoot(page, "priya-deposits-view-only");
    });

    // ── 2. Sam ───────────────────────────────────────────────────────────────

    await test.step("2. Sam: View only on an Active template, SHARE opens the integration sheet, no Settings", async () => {
      await asPersona(page, "sam");
      await openLibrary(page, "coral-offers");
      await expect(page.locator('[data-slot="sidebar-footer"]').getByRole("link", { name: "Settings" })).toHaveCount(0);
      await openTemplate(page, CORAL_ACTIVE);
      await expect(viewOnly(page)).toBeVisible();
      await liveEditor(page);
      const ed = documentEditor(page);
      await expect(ed).toHaveAttribute("contenteditable", "false");
      await expect(page.getByRole("toolbar", { name: "Format text" })).toHaveCount(0);
      await beat(page, 900);

      const share = page.getByRole("button", { name: new RegExp(`^Share ${CORAL_ACTIVE}`) });
      await expect(share, "an Active template has the SHARE ring, for a Viewer too").toBeVisible();
      await click(share);
      const sheet = page.getByRole("dialog").filter({ hasText: "Integration" });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(CORAL_ACTIVE);
      await expect(sheet, "the sheet has the Template ID").toContainText(/UC-[0-9A-Z]{6}/);
      await beat(page, 900);
      await shoot(page, "sam-share-sheet");

      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(ed, "still read-only behind it").toHaveAttribute("contenteditable", "false");
    });

    // ── 3. Riley ─────────────────────────────────────────────────────────────

    const before = await demoNow(db);

    await test.step("3.1 Riley: Settings > Channel rules; Email off names what it stops, and only the confirm commits it", async () => {
      await asPersona(page, "riley");
      await openLibrary(page, "all");
      await beat(page, 900);
      const dialog = await openSettings(page, "Channel rules");
      await expect(page).toHaveURL(/\/all\/settings\/channel-rules$/);

      const email = dialog.getByRole("switch", { name: "Disclosure on Email" });
      await expect(email).toBeChecked();
      await beat(page);
      await click(email);

      const consequence = strip(dialog);
      await expect(consequence).toBeVisible();
      await expect(consequence).toContainText(/\d+ Active Disclosure versions? stops? rendering to Email\./);
      await expect(consequence).toContainText("New Disclosure templates can't turn Email on.");
      await expect(email, "nothing is committed until the confirm").toBeChecked();
      await beat(page, 900);
      await shoot(page, "riley-email-off-consequence");

      await click(consequence.getByRole("button", { name: "Turn off Email", exact: true }));
      await expect(consequence).toBeHidden({ timeout: 20_000 });
      await expect(email).not.toBeChecked();
      await beat(page, 900);
      await shoot(page, "riley-email-off");
    });

    await test.step("3.2 Turning it back on is immediate", async () => {
      const dialog = settingsDialog(page);
      const email = dialog.getByRole("switch", { name: "Disclosure on Email" });
      await click(email);
      await expect(email).toBeChecked({ timeout: 20_000 });
      await expect(strip(dialog)).toHaveCount(0);
      await beat(page, 900);
      await closeSettings(page);
      await expect(page).toHaveURL(/\/all\/library$/);
    });

    await test.step("3.3 Riley can open a template, but not edit it", async () => {
      await openTemplate(page, CORAL_ACTIVE);
      await expect(viewOnly(page)).toBeVisible();
      await liveEditor(page);
      const ed = documentEditor(page);
      await expect(ed).toHaveAttribute("contenteditable", "false");
      await beat(page, 900);
      await shoot(page, "riley-view-only");
    });

    const after = await demoNow(db);

    // ── 4. Taylor ────────────────────────────────────────────────────────────

    await test.step("4.1 Taylor sees all teams, and Riley's two changes in the Audit page, on the demo clock", async () => {
      await switchPersona(page, "Taylor Nguyen");
      await openLibrary(page, "all");
      await click(page.locator('[data-slot="sidebar-content"]').getByRole("link", { name: "Audit" }));
      await expect(page).toHaveURL(/\/all\/audit$/);
      await expect(page.getByRole("heading", { level: 1, name: "Audit" })).toBeVisible();
      const table = page.getByRole("table", { name: "Audit events" });
      await expect(table).toBeVisible();
      // All teams shows the Team column.
      await expect(table.getByRole("columnheader", { name: "Team" })).toBeVisible();

      const off = table.getByRole("row").filter({ hasText: /Turned off Email for Disclosure/i }).first();
      const on = table.getByRole("row").filter({ hasText: /Turned on Email for Disclosure/i }).first();
      await expect(off).toBeVisible();
      await expect(on).toBeVisible();
      await expect(off).toContainText("Riley Brooks");
      await expect(on).toContainText("Riley Brooks");

      // The times are the demo clock's, not some other clock's: both fall inside Riley's step.
      for (const row of [off, on]) {
        const at = Date.parse((await row.locator("time").getAttribute("datetime")) ?? "");
        expect(at, "an audit time").toBeGreaterThanOrEqual(before - 1000);
        expect(at, "no later than the end of Riley's step").toBeLessThanOrEqual(after + 1000);
      }
      const offAt = Date.parse((await off.locator("time").getAttribute("datetime")) ?? "");
      const onAt = Date.parse((await on.locator("time").getAttribute("datetime")) ?? "");
      expect(onAt, "turned back on after it was turned off").toBeGreaterThan(offAt);
      await beat(page, 900);
      await shoot(page, "taylor-audit-all-teams");
    });

    await test.step("4.2 Filtering by person narrows the log to Riley; the export follows", async () => {
      await click(page.getByRole("button", { name: /^Person/ }));
      await click(page.getByRole("checkbox", { name: "Riley Brooks" }));
      await page.keyboard.press("Escape");
      const chips = page.getByRole("list", { name: "Active filters" });
      await expect(chips).toContainText("Person: Riley Brooks");
      await expect(page).toHaveURL(/person=riley/);

      const table = page.getByRole("table", { name: "Audit events" });
      const rows = table.getByRole("row");
      // Riley's events and nobody else's (the gate-media runs leave their own pairs behind, so "at least" these two).
      await expect(rows.filter({ hasText: /Turned off Email for Disclosure/i }).first()).toBeVisible({ timeout: 20_000 });
      await expect(rows.filter({ hasText: /Turned on Email for Disclosure/i }).first()).toBeVisible();
      for (const row of await rows.all().then((all) => all.slice(1))) await expect(row).toContainText("Riley Brooks");

      // A download anchor: Base UI gives it role "button", so find it by what it is.
      const exportLink = page.locator('a[href*="/audit/export"]').filter({ hasText: /^Export \d{1,3}(,\d{3})* events?$/ });
      await expect(exportLink).toHaveAttribute("href", /\/all\/audit\/export\?.*person=riley/);
      await beat(page, 900);
      await shoot(page, "taylor-audit-riley");

      await click(page.getByRole("button", { name: "Remove Person: Riley Brooks" }));
      await expect(chips).toHaveCount(0);
      await expect(page).not.toHaveURL(/person=/);
    });
  });
});
