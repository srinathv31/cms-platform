import type { Locator, Page } from "@playwright/test";
import { beat, expect, tap, untilUncovered } from "./scenario";

// Shared by the Phase 6 gate specs (scenarios 7 and 8, the two-stage approval): the persona switcher as a
// presenter uses it, the settings modal, the bell, the demo drawer's clock, and putting the demo data back.
// Additive to helpers/scenario.ts; nothing here changes what the other specs rely on.

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A human-paced click, once the page has stopped moving under the target. */
export async function click(target: Locator) {
  await target.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await untilUncovered(target);
  await tap(target);
}

// ── Personas ─────────────────────────────────────────────────────────────────

export const profileButton = (page: Page) =>
  page.getByRole("button", { name: /profile and persona/ });

/**
 * Through the persona switcher, as a presenter would: the cookie changes, the access sweep runs, and the
 * page re-reads as the new person (a person with no access anywhere lands on /request-access).
 * Resolves once the profile button names the new person.
 */
export async function switchPersona(page: Page, person: string) {
  await click(profileButton(page));
  await click(
    page.getByRole("menuitemradio", { name: new RegExp(escapeRe(person)) }),
  );
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(profileButton(page)).toHaveAccessibleName(
    new RegExp(`^${escapeRe(person)},`),
  );
}

// ── The settings modal ───────────────────────────────────────────────────────

// The dialog is named by its section's title ("Teams", "Members"), so find it by the nav it holds.
export const settingsDialog = (page: Page) =>
  page.getByRole("dialog").filter({
    has: page.getByRole("navigation", { name: "Settings sections" }),
  });

/** Opens the settings modal from the sidebar footer and goes to a section (a nav link name, or a RegExp). */
export async function openSettings(page: Page, section: string | RegExp) {
  const dialog = settingsDialog(page);
  if (!(await dialog.isVisible())) {
    await click(
      page
        .locator('[data-slot="sidebar-footer"]')
        .getByRole("link", { name: "Settings" }),
    );
    await expect(dialog).toBeVisible();
  }
  await goToSection(page, section);
  return dialog;
}

/** A section of the open modal. The count trail (Access requests 2) is in the link's name, so match loosely. */
export async function goToSection(page: Page, section: string | RegExp) {
  const dialog = settingsDialog(page);
  const name =
    typeof section === "string" ? new RegExp(`^${escapeRe(section)}`) : section;
  const link = dialog
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name });
  await click(link);
  await expect(link).toHaveAttribute("aria-current", /page|true/);
}

export async function closeSettings(page: Page) {
  const dialog = settingsDialog(page);
  await click(dialog.getByRole("button", { name: "Close settings" }));
  await expect(dialog).toBeHidden();
}

/** A person's row in a settings table. */
export const personRow = (scope: Locator | Page, userId: string): Locator =>
  scope.locator(`[role=row][data-person=${userId}]`).filter({ visible: true });

/** The consequence strip under a row, once open. */
export const strip = (scope: Locator | Page): Locator =>
  scope.locator('[data-slot="consequence-strip"]').filter({ visible: true });

// ── The bell ─────────────────────────────────────────────────────────────────

export const bell = (page: Page) =>
  page.getByRole("button", { name: /^Notifications/ });

export async function unreadCount(page: Page): Promise<number> {
  const name = (await bell(page).getAttribute("aria-label")) ?? "";
  const m = /(\d+) unread/.exec(name);
  return m ? Number(m[1]) : 0;
}

/** Opens the bell; the popover is the "Notifications" region it reveals. */
export async function openBell(page: Page): Promise<Locator> {
  await click(bell(page));
  const popover = page.getByRole("dialog", { name: "Notifications" });
  await expect(popover).toBeVisible();
  return popover;
}

// ── The demo drawer ──────────────────────────────────────────────────────────

/** Moves the demo clock forward by `days` through the drawer's custom field, then closes the drawer. */
export async function advanceClock(page: Page, days: number) {
  await click(page.getByRole("button", { name: "Demo", exact: true }));
  const drawer = page.getByRole("dialog", { name: "Demo" });
  await expect(drawer).toBeVisible();
  await beat(page);
  const field = drawer.getByRole("spinbutton", { name: "Days to advance" });
  await click(field);
  await field.fill(String(days));
  await click(drawer.getByRole("button", { name: "Advance", exact: true }));
  // The server action moves the clock, runs the sweep and refreshes; the field empties when it is submitted.
  await expect(field).toHaveValue("");
  await expect(drawer.getByRole("button", { name: "+1 day" })).toBeEnabled({
    timeout: 30_000,
  });
  await beat(page, 900);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
}

// ── Putting the data back ────────────────────────────────────────────────────

// Re-seeding the database is e2e state, so it lives in ./state; the Phase 6 specs keep importing it from here.
export { resetDemoData } from "./state";
