import { expect, test, type Page } from "@playwright/test";
import { settled } from "./helpers/settled";

// Reflow (WCAG 2.1 SC 1.4.10, decision 0045): at 320px wide the review screen's decision bar (Approve, Request changes)
// wraps to a few lines and sticks to the bottom of the main pane, resting over the last rows of the document's cell.
// The cell pads its bottom by the bar's height (--decision-bar-h, published by the bar), so scrolled to the end:
//
//   - the document's last block sits above the bar, never under it, even in a window as short as 320x256 (the size
//     WCAG's reference zoom gives), where the bar covered the last lines;
//   - the bar's two actions are on screen; and in a window with room for both, the last block is fully visible.
//
// Read-only. Run against the production build: E2E_GATE_PORT=3130 npx playwright test e2e/reflow-review-bar.spec.ts

test.use({ trace: "off" });

const COLLECT = "UC-J530DX"; // Cash Back Welcome Bonus: v3 in review, so it has a review screen (seed ids: see helpers/principles.ts)

async function open(page: Page) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100";
  await page
    .context()
    .addCookies([{ name: "ucomp_persona", value: "jordan", url: baseURL }]);
  await page.goto(`/coral-offers/review/${COLLECT}/3`, { waitUntil: "load" });
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

/** Scrolls the canvas until the document's cell ends at the canvas's bottom edge (the bar is at its resting place), then measures. */
function scrollToDocumentEnd(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main[data-slot="sidebar-inset"]');
    const canvas =
      main &&
      ([...main.children].find(
        (child) => getComputedStyle(child).overflowY === "auto",
      ) as HTMLElement | undefined);
    const doc = document.querySelector("#review-panel-document") as HTMLElement;
    const last = doc.querySelector(".ProseMirror")?.lastElementChild as
      HTMLElement | null | undefined;
    if (!canvas || !last)
      throw new Error("the review screen's canvas or document is missing");
    canvas.scrollTop +=
      doc.getBoundingClientRect().bottom -
      canvas.getBoundingClientRect().bottom;
    const rect = (el: Element) => {
      const { top, bottom } = el.getBoundingClientRect();
      return { top, bottom };
    };
    return {
      canvas: rect(canvas),
      last: rect(last),
      bar: rect(document.querySelector('[data-slot="decision-bar"]')!),
    };
  });
}

for (const { height, fits } of [
  { height: 256, fits: false },
  { height: 360, fits: true },
]) {
  test.describe(`320x${height}`, () => {
    test.use({ viewport: { width: 320, height } });

    test("scrolled to the end of the document, its last block is not under the decision bar", async ({
      page,
    }) => {
      await open(page);
      const bar = page.locator('[data-slot="decision-bar"]');
      await expect(bar.getByRole("button", { name: "Approve" })).toBeVisible();

      const m = await scrollToDocumentEnd(page);
      expect(
        m.last.bottom,
        "the last block ends above the bar",
      ).toBeLessThanOrEqual(m.bar.top);

      for (const name of ["Approve", "Request changes"]) {
        const box = await bar.getByRole("button", { name }).boundingBox();
        expect(box, `${name} is on screen`).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(m.canvas.top);
        expect(box!.y + box!.height).toBeLessThanOrEqual(m.canvas.bottom);
      }
      if (fits)
        expect(
          m.last.top,
          "the last block is fully in view",
        ).toBeGreaterThanOrEqual(m.canvas.top);
    });
  });
}
