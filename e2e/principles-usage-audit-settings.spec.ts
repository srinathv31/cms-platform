import { expect, test } from "@playwright/test";
import {
  AUDIT,
  PLATFORM_SECTIONS,
  SETTINGS_HARD,
  TEAM_SECTIONS,
  USAGE,
  checkScreen,
  describeRoutes,
  installCls,
  open,
  settle,
} from "./helpers/principles";

// Phase 7 principle checks: the usage dashboard, the audit log, and the settings sections (hard and soft navigation).
// The five checks, the personas and the route matrix are in e2e/helpers/principles.ts.

// The preview iframes are sandboxed: Playwright's trace injects scripts into frames and Chrome logs "Blocked script execution".
test.use({ trace: "off" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installCls);
});

describeRoutes(test, "Usage dashboard", USAGE);
describeRoutes(test, "Audit", AUDIT);
describeRoutes(test, "Settings (hard navigation)", SETTINGS_HARD);

// ── The settings modal (soft navigation, through the sidebar footer) ─────────

test.describe("Settings modal", () => {
  const cases: { persona: string; space: string; sections: string[] }[] = [
    { persona: "alex", space: "coral-offers", sections: TEAM_SECTIONS },
    { persona: "riley", space: "coral-offers", sections: PLATFORM_SECTIONS },
  ];
  for (const { persona, space, sections } of cases) {
    test(`modal sections as ${persona}`, async ({ page }) => {
      await open(page, `/${space}/library`, persona);
      await page
        .locator('[data-slot="sidebar-footer"]')
        .getByRole("link", { name: "Settings" })
        .click({ delay: 90 });
      const dialog = page.getByRole("dialog").filter({
        has: page.getByRole("navigation", { name: "Settings sections" }),
      });
      await expect(dialog).toBeVisible();
      await settle(page);
      for (const section of sections) {
        const link = dialog
          .getByRole("navigation", { name: "Settings sections" })
          .getByRole("link", {
            name: new RegExp(`^${section.replace("-", "[ -]")}`, "i"),
          });
        await link.click({ delay: 90 });
        await expect(link).toHaveAttribute("aria-current", /page|true/);
        await settle(page);
        await checkScreen(page, `settings modal "${section}" as ${persona}`);
      }
    });
  }
});
