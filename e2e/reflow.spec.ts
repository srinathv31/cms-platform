import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settled } from "./helpers/settled";

// Reflow (WCAG 2.1 SC 1.4.10, decision 0045): Chrome at 400% on a 1280px laptop is a 320 CSS px window, and nothing
// may need a horizontal scroll there except what scrolls inside its own box (a table, a chart, a tab strip).
//
//   - At 320px wide the Library, a template's Usage tab and the review screen don't scroll sideways, the canvas takes
//     the window (the sidebar is not a column beside it), and axe finds nothing serious.
//   - The sidebar opens as a drawer from its button in the top bar, names itself, closes on Escape and on a link, and
//     gives focus back.
//   - The shell's one breakpoint is 800px: the drawer's button is there at 799px and gone at 800px, where the sidebar
//     is the 264px column it always was.
//
// Read-only. Run against the production build: E2E_GATE_PORT=3110 npx playwright test e2e/reflow.spec.ts

test.use({ trace: "off" });

const PERSONA_COOKIE = "ucomp_persona";
const COLLECT = "UC-J530DX"; // Cash Back Welcome Bonus: v3 in review, so it has a review screen (seed ids: see helpers/principles.ts)

const SCREENS: { name: string; url: string; persona: string }[] = [
  { name: "the Library", url: "/coral-offers/library", persona: "maya" },
  {
    name: "a template's Usage tab",
    url: `/coral-offers/templates/${COLLECT}/usage`,
    persona: "maya",
  },
  {
    name: "the review screen",
    url: `/coral-offers/review/${COLLECT}/3`,
    persona: "jordan",
  },
];

async function open(page: Page, url: string, persona: string) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100";
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE, value: persona, url: baseURL }]);
  const response = await page.goto(url, { waitUntil: "load" });
  expect(response?.status(), `${url} responded`).toBeLessThan(500);
  // Hydrated (the profile button has React's props), and every skeleton has gone.
  await page.waitForFunction(() => {
    const el = document.querySelector(
      "button[aria-label$='profile and persona']",
    );
    return (
      !!el &&
      Object.keys(el).some((k) => k.startsWith("__reactProps")) &&
      !document.querySelector('[data-slot="skeleton"]')
    );
  });
  await settled(page);
}

/** What the canvas (the shell's scroll area) and the page hold sideways, and how wide the canvas is. */
function measure(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    const canvas = main
      ? [...main.children].find(
          (child) => getComputedStyle(child).overflowY === "auto",
        )
      : undefined;
    const column = document.querySelector(
      '[data-slot="sidebar"]:not([data-mobile])',
    ) as HTMLElement | null;
    const doc = document.documentElement;
    return {
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      canvasWidth: canvas
        ? Math.round(canvas.getBoundingClientRect().width)
        : null,
      canvasOverflow: canvas ? canvas.scrollWidth - canvas.clientWidth : null,
      columnShown:
        !!column &&
        column.checkVisibility({ checkVisibilityCSS: true }) &&
        column.getBoundingClientRect().width > 0,
    };
  });
}

test.describe("320px wide", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  for (const { name, url, persona } of SCREENS) {
    test(`${name} has no horizontal scroll, and its canvas takes the window`, async ({
      page,
    }) => {
      await open(page, url, persona);
      const m = await measure(page);

      expect(
        m.columnShown,
        "the sidebar is not a column beside the canvas",
      ).toBe(false);
      expect(
        m.canvasWidth,
        "the canvas is the window less the panel's margins",
      ).toBeGreaterThanOrEqual(290);
      expect.soft(m.pageOverflow, "the page doesn't scroll sideways").toBe(0);
      expect
        .soft(m.canvasOverflow, "the canvas doesn't scroll sideways")
        .toBe(0);
    });

    test(`${name} has no serious axe violations`, async ({ page }) => {
      await open(page, url, persona);
      const results = await new AxeBuilder({ page })
        .exclude("nextjs-portal")
        .exclude("[data-base-ui-focus-guard]")
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map(
          (v) =>
            `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        ),
      ).toEqual([]);
    });
  }

  test("a template's Usage tab gives its section the canvas's width (it was 0px behind the sidebar)", async ({
    page,
  }) => {
    await open(page, `/coral-offers/templates/${COLLECT}/usage`, "maya");
    const width = await page
      .locator('section[data-slot="usage"]')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(width).toBeGreaterThanOrEqual(200);
  });

  test("the sidebar opens from its button as a drawer, and the button names it", async ({
    page,
  }) => {
    await open(page, "/coral-offers/library", "maya");
    // By its label, not its role: an open modal hides the rest of the page from the accessibility tree.
    const button = page.locator('button[aria-label="Open navigation"]');
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    for (const label of ["Library", "Review", "Usage"])
      await expect(drawer.getByRole("link", { name: label })).toBeVisible();

    const box = await drawer.boundingBox();
    expect(box?.x, "the drawer opens from the left edge").toBeLessThanOrEqual(
      1,
    );
    expect(box?.width, "and leaves some of the page showing").toBeLessThan(320);

    await settled(page); // the sheet has faded in: axe reads its contrast from the colours it finds
    const serious = (
      await new AxeBuilder({ page })
        .exclude("nextjs-portal")
        .exclude("[data-base-ui-focus-guard]")
        .analyze()
    ).violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => v.id),
      "the open drawer has no serious axe violations",
    ).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(button, "focus goes back to the button").toBeFocused();
  });

  test("following a link in the drawer goes there and closes it", async ({
    page,
  }) => {
    await open(page, "/coral-offers/library", "jordan");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("link", { name: "Review" }).click();

    await expect(page).toHaveURL(/\/coral-offers\/review$/);
    await expect(drawer).toBeHidden();
    expect((await measure(page)).canvasOverflow).toBe(0);
  });
});

test.describe("the breakpoint", () => {
  test("799px has the drawer's button and no sidebar column", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 799, height: 700 });
    await open(page, "/coral-offers/library", "maya");
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeVisible();
    expect((await measure(page)).columnShown).toBe(false);
  });

  test("800px has the 264px column and no button", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await open(page, "/coral-offers/library", "maya");
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeHidden();
    const column = page.locator('[data-slot="sidebar"]:not([data-mobile])');
    await expect(column).toBeVisible();
    expect((await column.boundingBox())?.width).toBe(264);
    expect((await measure(page)).canvasOverflow).toBe(0);
  });

  test("a window widened past it closes a drawer left open", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 600, height: 700 });
    await open(page, "/coral-offers/library", "maya");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      page.locator('[data-slot="sidebar"]:not([data-mobile])'),
    ).toBeVisible();

    await page.setViewportSize({ width: 600, height: 700 });
    await expect(
      page.getByRole("dialog"),
      "narrowing again doesn't bring it back",
    ).toBeHidden();
  });
});
