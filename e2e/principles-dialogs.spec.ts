import { expect, test } from "@playwright/test";
import { viewEveryOutput } from "./helpers/review";
import {
  COLLECT,
  FEE_WAIVER,
  HIGH_YIELD,
  RATE_CHANGE,
  checkOpened,
  click,
  installCls,
  open,
  profileButton,
} from "./helpers/principles";

// Phase 7 principle checks: dialogs, sheets, strips and popovers, each with a confirm, for at most one primary button.
// The five checks, the personas and the route matrix are in e2e/helpers/principles.ts.

// The preview iframes are sandboxed: Playwright's trace injects scripts into frames and Chrome logs "Blocked script execution".
test.use({ trace: "off" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installCls);
});

// ── Dialogs, sheets, strips, popovers: each with a confirm is checked for at most one primary ──

test.describe("Dialogs, sheets, strips and popovers", () => {
  test("New template gallery (Library, Maya)", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    await click(page.getByRole("button", { name: "New template" }));
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkOpened(page, "New template gallery as maya");
  });

  test("Submit for review dialog (a draft, Maya)", async ({ page }) => {
    await open(page, `/coral-offers/templates/${FEE_WAIVER}`, "maya");
    await click(page.getByRole("button", { name: "Submit for review" }));
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkOpened(page, "Submit for review dialog as maya");
  });

  test("Approve and Request changes dialogs (review screen, Jordan)", async ({ page }) => {
    await open(page, `/coral-offers/review/${COLLECT}/3`, "jordan");
    const decision = page.locator('aside[aria-label="Decision"]').filter({ visible: true });
    await viewEveryOutput(page);
    await click(decision.getByRole("button", { name: "Approve", exact: true }));
    await expect(page.getByRole("dialog", { name: /^Approve v3/ })).toBeVisible();
    await checkOpened(page, "Approve dialog as jordan");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /^Approve v3/ })).toBeHidden();
    await click(decision.getByRole("button", { name: "Request changes", exact: true }));
    await expect(page.getByRole("dialog", { name: /Request changes/ })).toBeVisible();
    await checkOpened(page, "Request changes dialog as jordan");
  });

  test("Review history, unfolded (Versions, Priya)", async ({ page }) => {
    await open(page, `/deposits/templates/${HIGH_YIELD}/versions`, "priya");
    const entry = page.locator('[data-slot="version-entry"][data-version="2"]').filter({ visible: true });
    await expect(entry.locator('[data-slot="approved-on-round"]')).toHaveText("Approved on round 3");
    const fold = entry.getByRole("button", { name: "v2 review history (3 rounds)", exact: true });
    await expect(fold).toHaveText("Review history (3 rounds)");
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await click(fold);
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(entry.locator('[data-slot="review-history"] li[data-round]')).toHaveCount(3);
    await checkOpened(page, "Review history unfolded as priya");
  });

  test("Revoke dialog (Versions, Jordan)", async ({ page }) => {
    await open(page, `/coral-offers/templates/${COLLECT}/versions`, "jordan");
    const revoke = page.getByRole("button", { name: /^Revoke v\d/ }).filter({ visible: true }).first();
    test.skip((await revoke.count()) === 0, "no version can be revoked in the current data");
    await click(revoke);
    await expect(page.getByRole("dialog", { name: /^Revoke v\d/ })).toBeVisible();
    await checkOpened(page, "Revoke dialog as jordan");
  });

  test("Integration sheet (Jordan and Maya)", async ({ page }) => {
    for (const persona of ["jordan", "maya"]) {
      await open(page, `/coral-offers/templates/${RATE_CHANGE}`, persona);
      await click(page.getByRole("button", { name: /^Share .* — integration details$/ }).filter({ visible: true }));
      await expect(page.getByRole("dialog").filter({ hasText: "Integration" })).toBeVisible();
      await checkOpened(page, `Integration sheet as ${persona}`);
    }
  });

  test("Copilot prompt (Variables, Maya)", async ({ page }) => {
    await open(page, `/coral-offers/templates/${FEE_WAIVER}`, "maya");
    await click(page.getByRole("tab", { name: "Variables", exact: true }).filter({ visible: true }));
    await click(page.getByRole("button", { name: "Copilot prompt" }).filter({ visible: true }));
    await expect(page.getByRole("dialog", { name: "Prompt for Copilot" })).toBeVisible();
    await checkOpened(page, "Copilot prompt as maya");
  });

  test("Preview mode (the rail widens, Maya)", async ({ page }) => {
    await open(page, `/coral-offers/templates/${COLLECT}`, "maya");
    await click(page.getByRole("button", { name: "Preview", exact: true }));
    // The render streams into the frame: the output is there once the well has stopped being busy and holds a frame.
    const well = page.locator('[data-slot="preview-well"]');
    await expect(well.locator("iframe, canvas").first()).toBeAttached({ timeout: 20_000 });
    await expect(well).not.toHaveAttribute("aria-busy", "true", { timeout: 20_000 });
    await checkOpened(page, "Preview mode as maya");
  });

  test("Command palette (Maya)", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
    await checkOpened(page, "Command palette as maya");
  });

  test("Settings consequence strips (Alex: remove a member; Riley: a channel rule)", async ({ page }) => {
    await open(page, "/coral-offers/settings/members", "alex");
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("navigation", { name: "Settings sections" }) });
    await expect(dialog).toBeVisible();
    await click(dialog.getByRole("button", { name: "Remove", exact: true }).filter({ visible: true }).first());
    await expect(dialog.locator('[data-slot="consequence-strip"]').filter({ visible: true })).toBeVisible();
    await checkOpened(page, "Remove-member strip as alex");

    await open(page, "/coral-offers/settings/channel-rules", "riley");
    await click(dialog.getByRole("switch", { name: "Disclosure on Email" }));
    await expect(dialog.locator('[data-slot="consequence-strip"]').filter({ visible: true })).toBeVisible();
    await checkOpened(page, "Channel-rule strip as riley");
  });

  test("The Demo drawer and its Reset confirm", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    await click(page.getByRole("button", { name: "Demo", exact: true }));
    const drawer = page.getByRole("dialog", { name: "Demo" });
    await expect(drawer).toBeVisible();
    await checkOpened(page, "Demo drawer as maya");
    await click(drawer.getByRole("button", { name: "Reset demo" }));
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await checkOpened(page, "Reset demo confirm as maya");
    // Nothing is reset: the confirm is only looked at, then cancelled.
    await click(page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }));
  });

  test("Bell, Help, profile menu and team switcher", async ({ page }) => {
    await open(page, "/coral-offers/library", "jordan");
    await click(page.getByRole("button", { name: /^Notifications/ }));
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await checkOpened(page, "Notifications popover as jordan");
    await page.keyboard.press("Escape");
    await click(page.getByRole("button", { name: "Help" }));
    await checkOpened(page, "Help popover as jordan");
    await page.keyboard.press("Escape");
    await click(profileButton(page));
    await expect(page.getByRole("menu")).toBeVisible();
    await checkOpened(page, "Profile and persona menu as jordan");
    await page.keyboard.press("Escape");
    await open(page, "/all/library", "riley");
    await click(page.getByRole("button", { name: "Switch team" }));
    await expect(page.getByRole("menu")).toBeVisible();
    await checkOpened(page, "Team switcher as riley");
  });
});
