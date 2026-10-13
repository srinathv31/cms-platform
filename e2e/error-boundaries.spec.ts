import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settled } from "./helpers/settled";
import { Changes, findVersion } from "./helpers/state";

// What a person sees when a page throws (docs/handoff-review.md, I7; decision 0013). Each test breaks one
// stored JSON value, so the query that reads it throws the way a corrupt row or a failing backend would,
// and nothing in the app is there only for this spec:
//
//   1. A tab of a template fails (Balance Transfer v2's body): the template's error shows in the document's
//      place, under the workspace header and the tab bar, inside the app frame.
//   2. A page fails (Cash Back v3's body, on its review screen): the page's error shows in the canvas, and the
//      sidebar and top bar stay.
//   3. The frame itself fails (the demo clock's setting, which every part of the shell reads): the global
//      error page replaces the document.
//   4. A page of the simulator fails (a customer's stored account, which only Coral's Customers page reads): Coral's
//      own error shows in its page, the strip, nav and Demo pill stay, and Back goes to /sim, not to Stencil's Library.
//
// Each shows one plain sentence, Try again and a way back, and the error's digest; never the server's
// message. The value is then put back and Try again brings the screen back. afterEach puts back anything a
// failed test left broken. On a failed tab the tab bar's Edit and Preview stay, greyed, with the reason (N9).
//
// These tests expect console errors (React and Next log the caught error), so they don't use the
// scenario fixture that fails on them.

const TEAM = "coral-offers";
const BALANCE = "Balance Transfer Intro — Terms";
const CASH_BACK = "Cash Back Welcome Bonus — Terms";

const changes = new Changes();

// Whatever a failed test left broken is put back before the next test: `undo` also covers a value the test
// already restored itself.
test.afterEach(() => changes.undo());

async function versionOf(name: string, state: string) {
  const version = await findVersion({ name, state });
  if (!version)
    throw new Error(
      `This spec needs the fresh seed (npm run db:reset): no ${state} version of ${name}.`,
    );
  return {
    id: version.id,
    templateId: version.templateId,
    number: version.number!,
  };
}

/** Visible primary (black, filled) buttons and links in the canvas: the screen's one primary rule. */
function primaryButtons(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "bg-primary";
    document.body.append(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const main = document.querySelector("main");
    return [...(main?.querySelectorAll("button, a[href]") ?? [])]
      .filter(
        (el) =>
          (el as HTMLElement).checkVisibility() &&
          getComputedStyle(el).backgroundColor === primary,
      )
      .map((el) => el.textContent?.trim() ?? "");
  });
}

/**
 * The error can show before the frame's own sections have streamed in. With the frame, wait for them (the sidebar's
 * real links, a hydrated profile button, no skeleton left) so axe looks at the screen a person ends up with.
 */
async function settle(page: Page, frame: boolean) {
  if (frame) {
    await expect(
      page
        .getByRole("navigation", { name: "Sidebar" })
        .getByRole("link", { name: "Library" }),
    ).toBeVisible();
    await page.waitForFunction(() => {
      const el = document.querySelector(
        "button[aria-label$='profile and persona']",
      );
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
    });
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('[data-slot="skeleton"]')].some((el) =>
          (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true }),
        ),
    );
  }
  // Let the streamed sections' view transitions and the fonts finish.
  await settled(page);
}

/** No serious or critical axe violation, as in helpers/principles.ts. */
async function expectNoSeriousViolations(page: Page) {
  const axe = await new AxeBuilder({ page })
    .exclude("nextjs-portal")
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  const serious = axe.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).join(" | ")})`,
    );
  expect(serious, "axe serious/critical violations").toEqual([]);
}

/** Next gives a server error a digest, the id its server log carries; the server's message never shows. */
async function expectDigestOnly(page: Page) {
  await expect(page.getByText(/^Error ID \S+$/)).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text, "the server's message stays on the server").not.toMatch(
    /JSON|SyntaxError|Unexpected|at \w+ \(/,
  );
}

/** The error's sentence, its actions and its digest, and nothing of the server's message. */
async function expectErrorScreen(
  page: Page,
  sentence: string,
  { frame }: { frame: boolean },
) {
  await expect(page.getByText(sentence, { exact: true })).toBeVisible();
  await settle(page, frame);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // A Base UI Button rendered as a link has the button role.
  await expect(
    page.getByRole("button", { name: "Back to library" }),
  ).toHaveAttribute("href", `/${TEAM}/library`);
  await expectDigestOnly(page);
  await expectNoSeriousViolations(page);
}

test("a tab that fails keeps the workspace header, the tab bar and the frame", async ({
  page,
}) => {
  const v = await versionOf(BALANCE, "active");
  const restore = await changes.breakVersionBody(v.id);

  await page.goto(`/${TEAM}/templates/${v.templateId}`);
  await expectErrorScreen(page, "This tab didn't load.", { frame: true });
  await expect(
    page.getByRole("heading", { level: 1, name: BALANCE }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-slot="tab-bar"]')
      .getByRole("link", { name: "Versions" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  // The tab bar keeps the workspace's black button (Edit, for Maya on an Active template), so Try again is outline.
  expect(await primaryButtons(page)).toEqual(["Edit"]);
  // Its actions act on the tab that didn't load, so they stay but are greyed, each with the reason at the control.
  const bar = page.locator('[data-slot="tab-bar"]');
  const action = (name: string) =>
    bar.getByRole("button", { name, exact: true });
  for (const name of ["Edit", "Preview"]) {
    await expect(action(name)).toBeVisible();
    await expect(action(name)).toBeDisabled();
    await expect(action(name)).toHaveAttribute("data-disabled", "");
    await expect(action(name)).toHaveAccessibleDescription(
      "Unavailable until this tab loads.",
    );
  }

  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.locator(".ProseMirror").filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("This tab didn't load.")).toHaveCount(0);
  // And live again.
  for (const name of ["Edit", "Preview"])
    await expect(action(name)).toBeEnabled();
});

test("a page that fails keeps the sidebar and the top bar", async ({
  page,
}) => {
  const v = await versionOf(CASH_BACK, "in_review");
  const restore = await changes.breakVersionBody(v.id);

  await page.goto(`/${TEAM}/review/${v.templateId}/${v.number}`);
  await expectErrorScreen(page, "This page didn't load", { frame: true });
  await expect(
    page.getByRole("heading", { level: 1, name: "This page didn't load" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /profile and persona$/ }),
  ).toBeVisible();
  expect(await primaryButtons(page)).toEqual(["Try again"]);

  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: CASH_BACK }),
  ).toBeVisible();
  await expect(page.getByText("This page didn't load")).toHaveCount(0);
});

test("a page of the simulator that fails keeps Coral's frame and goes back to /sim", async ({
  page,
}) => {
  const restore = await changes.breakCustomerAccount();

  await page.goto("/sim/customers");
  await expect(
    page.getByRole("heading", { level: 1, name: "This page didn't load" }),
  ).toBeVisible();
  await settle(page, false);
  // Coral's frame stays: the strip back to Stencil, its label, its nav. Not Stencil's global error page.
  await expect(
    page.getByText("Coral — simulated", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Customers", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to library" }),
  ).toHaveCount(0);
  // Back goes to Coral's home (a link: Coral draws its own buttons), not to a Stencil space's Library.
  await expect(
    page.getByRole("link", { name: "Back to offers" }),
  ).toHaveAttribute("href", "/sim");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expectDigestOnly(page);
  await expectNoSeriousViolations(page);

  await page.getByRole("link", { name: "Back to offers" }).click();
  await expect(page).toHaveURL(/\/sim$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Offers" }),
  ).toBeVisible();

  // Try again brings the page back once the value is.
  await page.goto("/sim/customers");
  await expect(
    page.getByRole("heading", { level: 1, name: "This page didn't load" }),
  ).toBeVisible();
  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Customers" }),
  ).toBeVisible();
  await expect(page.getByText("This page didn't load")).toHaveCount(0);
});

test("when the frame itself fails, the global error page replaces it", async ({
  page,
}) => {
  const restore = await changes.breakClockSetting();

  await page.goto(`/${TEAM}/library`);
  await expectErrorScreen(page, "This page didn't load", { frame: false });
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toHaveCount(
    0,
  );
  expect(await primaryButtons(page)).toEqual(["Try again"]);

  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Library" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
});
