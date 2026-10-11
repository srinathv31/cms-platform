import { expect, test, type Locator, type Page } from "@playwright/test";

// Reflow of two screens #66's reflow.spec.ts doesn't reach (WCAG 2.1 SC 1.4.10, decision 0045): a 320px window is
// Chrome at 400% on a 1280px laptop.
//
//   - A draft's Content tab: the block handle (+ and the ⋮⋮ grip) hangs in the document's left gutter, which is 2.25rem
//     wide at 320px. Both buttons are on screen, beside the text and not over it, the grip's block menu opens inside
//     the window, and the canvas still doesn't scroll sideways. From 800px up the handle is the one row it always was.
//   - The review header: the template's name and the byline wrap below 800px instead of ending in an ellipsis, and keep
//     their single line (and its ellipsis, with the full text in `title`) from 800px up.
//
// Read-only. Run against the production build: E2E_GATE_PORT=3130 npx playwright test e2e/reflow-editor-review.spec.ts

test.use({ trace: "off" });

const PERSONA_COOKIE = "ucomp_persona";
const FEE_WAIVER = "UC-NYP7F0"; // Annual Fee Waiver: v1 changes requested, and an editable draft with a rates table
const COLLECT = "UC-J530DX"; // Cash Back Welcome Bonus: v3 in review, so it has a review screen
const COLLECT_NAME = "Cash Back Welcome Bonus — Terms";

async function open(page: Page, url: string, persona: string) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100";
  await page.context().addCookies([{ name: PERSONA_COOKIE, value: persona, url: baseURL }]);
  const response = await page.goto(url, { waitUntil: "load" });
  expect(response?.status(), `${url} responded`).toBeLessThan(500);
  // Hydrated (the profile button has React's props), and every skeleton has gone.
  await page.waitForFunction(() => {
    const el = document.querySelector("button[aria-label$='profile and persona']");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")) && !document.querySelector('[data-slot="skeleton"]');
  });
  await page.waitForTimeout(800);
}

/** What the page and the canvas (the shell's scroll area) hold sideways. */
function overflow(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    const canvas = main ? [...main.children].find((child) => getComputedStyle(child).overflowY === "auto") : undefined;
    const doc = document.documentElement;
    return { page: doc.scrollWidth - doc.clientWidth, canvas: canvas ? canvas.scrollWidth - canvas.clientWidth : null };
  });
}

const PLUS = (page: Page) => page.getByRole("button", { name: "Insert block below" });
const GRIP = (page: Page) => page.getByLabel("Drag to move block, or click for options", { exact: true });

/** Moves the pointer onto `target`'s first line from above, the way a reader comes to a block, until its handle shows. */
async function hoverBlock(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await expect(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y - 30);
    await page.mouse.move(box.x + 10, box.y + Math.min(box.height / 2, 14), { steps: 8 });
    await page.mouse.move(box.x + 14, box.y + Math.min(box.height / 2, 14) + 1, { steps: 4 });
    await expect(PLUS(page)).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 10_000 });
  await expect(GRIP(page)).toBeVisible();
  return box;
}

async function openDraft(page: Page) {
  await open(page, `/coral-offers/templates/${FEE_WAIVER}`, "maya");
  const doc = page.locator(".ucomp-doc[contenteditable='true']");
  await expect(doc).toBeVisible();
  await page.waitForTimeout(800); // the handle attaches a moment after the editor does
  return doc;
}

test.describe("the block handle at 320px", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  for (const [name, block] of [
    ["a paragraph", (doc: Locator) => doc.locator("p").first()],
    ["a table's header row", (doc: Locator) => doc.locator("table th").first()],
  ] as const) {
    test(`on ${name}, + and ⋮⋮ are on screen and beside the text, not over it`, async ({ page }) => {
      const doc = await openDraft(page);
      const text = await hoverBlock(page, block(doc));
      const plus = (await PLUS(page).boundingBox())!;
      const grip = (await GRIP(page).boundingBox())!;

      for (const [what, box] of [["+", plus], ["⋮⋮", grip]] as const) {
        expect(box.x, `${what} isn't off the window's left edge`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${what} is clear of the text`).toBeLessThanOrEqual(text.x + 0.5);
        expect(box.y, `${what} is on screen`).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, `${what} is on screen`).toBeLessThanOrEqual(720);
      }
      // Both are whole 24px targets, and they don't overlap each other.
      expect(Math.round(plus.width)).toBe(24);
      expect(Math.round(grip.width)).toBe(24);
      const apart = Math.abs(plus.y - grip.y) >= 24 || Math.abs(plus.x - grip.x) >= 24;
      expect(apart, "the two buttons don't overlap").toBe(true);

      // The pointer can reach each one: what is at its middle is the button itself.
      for (const [what, button, box] of [["+", PLUS(page), plus], ["⋮⋮", GRIP(page), grip]] as const) {
        const hit = await page.evaluate(
          ([x, y]) => document.elementFromPoint(x, y)?.closest("[aria-label]")?.getAttribute("aria-label") ?? null,
          [box.x + box.width / 2, box.y + box.height / 2],
        );
        expect(hit, `the pointer finds ${what} at its middle`).toBe(await button.getAttribute("aria-label"));
      }
      const o = await overflow(page);
      expect.soft(o.page, "the page doesn't scroll sideways").toBe(0);
      expect.soft(o.canvas, "the canvas doesn't scroll sideways").toBe(0);
    });
  }

  test("the grip's block menu opens inside the window, and nothing scrolls sideways", async ({ page }) => {
    const doc = await openDraft(page);
    await hoverBlock(page, doc.locator("p").first());
    await GRIP(page).click();
    const menu = page.locator("[data-block-menu]");
    await expect(menu).toBeVisible();
    await page.waitForTimeout(400); // it fades in; its position has settled
    const box = (await menu.boundingBox())!;
    expect(box.x, "the menu's left edge is on screen").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "the menu's right edge is on screen").toBeLessThanOrEqual(320);
    expect(box.y, "its top is on screen").toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, "its bottom is on screen").toBeLessThanOrEqual(720);
    await expect(page.getByRole("menuitem", { name: "Numbering" })).toBeInViewport({ ratio: 1 });

    const o = await overflow(page);
    expect.soft(o.page, "the page doesn't scroll sideways").toBe(0);
    expect.soft(o.canvas, "the canvas doesn't scroll sideways").toBe(0);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});

test.describe("the block handle from 800px up is the row it always was", () => {
  for (const width of [800, 1280]) {
    test(`at ${width}px the + sits left of the ⋮⋮ on one line`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const doc = await openDraft(page);
      const text = await hoverBlock(page, doc.locator("p").first());
      const plus = (await PLUS(page).boundingBox())!;
      const grip = (await GRIP(page).boundingBox())!;
      expect(plus.y, "the two are level").toBeCloseTo(grip.y, 0);
      expect(grip.x, "the grip is the one beside the text").toBeGreaterThan(plus.x);
      expect(grip.x + grip.width, "and clear of it").toBeLessThanOrEqual(text.x + 0.5);
      expect(plus.x, "on screen").toBeGreaterThanOrEqual(0);
    });
  }
});

/** The element's text is all there to read: nothing clipped by an ellipsis, and every line inside the window. */
async function expectWhole(page: Page, el: Locator, what: string) {
  const m = await el.evaluate((node) => {
    const style = getComputedStyle(node);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    return {
      clipped: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
      overflow: `${style.overflow} ${style.textOverflow}`,
      whiteSpace: style.whiteSpace,
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      lines: new Set(rects.map((r) => Math.round(r.top))).size,
      height: node.getBoundingClientRect().height,
    };
  });
  expect(m.clipped, `${what} is not clipped`).toBe(false);
  expect(m.overflow, `${what} doesn't end in an ellipsis`).not.toContain("ellipsis");
  expect(m.whiteSpace, `${what} wraps`).not.toBe("nowrap");
  expect(m.left, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
  expect(m.right, `${what} ends inside the window`).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 0.5);
  return m;
}

test.describe("the review header's name and byline", () => {
  const title = (page: Page) => page.locator("main header h1").filter({ visible: true });
  const byline = (page: Page) => page.locator("main header [data-slot='byline']").filter({ visible: true });

  test.describe("at 320px", () => {
    test.use({ viewport: { width: 320, height: 720 } });

    test("wrap, so the whole name and the whole byline can be read", async ({ page }) => {
      await open(page, `/coral-offers/review/${COLLECT}/3`, "jordan");
      await expect(title(page)).toHaveText(COLLECT_NAME);
      const name = await expectWhole(page, title(page), "the name");
      expect(name.lines, "the name takes two lines here").toBeGreaterThan(1);
      const line = await expectWhole(page, byline(page), "the byline");
      expect(line.lines, "the byline takes more than one line beside its badge").toBeGreaterThan(1);
      expect(await byline(page).textContent()).toMatch(/^v3 .* by .* · /);

      const o = await overflow(page);
      expect.soft(o.page, "the page doesn't scroll sideways").toBe(0);
      expect.soft(o.canvas, "the canvas doesn't scroll sideways").toBe(0);
    });
  });

  test.describe("at 800px and wider", () => {
    for (const width of [800, 1440]) {
      test(`${width}px keeps the name and byline on one line, ending in an ellipsis when short of room`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page, `/coral-offers/review/${COLLECT}/3`, "jordan");
        for (const [what, el] of [["the name", title(page)], ["the byline", byline(page)]] as const) {
          const style = await el.evaluate((node) => {
            const s = getComputedStyle(node);
            return { whiteSpace: s.whiteSpace, textOverflow: s.textOverflow, overflow: s.overflow };
          });
          expect(style, `${what} is the one truncating line it was`).toEqual({ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" });
        }
        await expect(title(page), "with its full text in title").toHaveAttribute("title", COLLECT_NAME);
      });
    }
  });
});
