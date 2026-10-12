import { test } from "@playwright/test";
import { WORKSPACE, describeRoutes, installCls } from "./helpers/principles";

// Phase 7 principle checks: the template workspace (Content, Versions, Usage and Activity) on every kind of template.
// The five checks, the personas and the route matrix are in e2e/helpers/principles.ts.

// The preview iframes are sandboxed: Playwright's trace injects scripts into frames and Chrome logs "Blocked script execution".
test.use({ trace: "off" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installCls);
});

describeRoutes(
  test,
  "Template workspace (Content, Versions, Usage, Activity)",
  WORKSPACE,
);
