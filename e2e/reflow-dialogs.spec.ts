import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { viewEveryOutput } from "./helpers/review";
import { settled } from "./helpers/settled";

// Reflow of the dialogs (WCAG 2.1 SC 1.4.10, decision 0045): at 320 CSS px wide (Chrome at 400% on a 1280px
// laptop) each dialog opens inside the window, holds nothing past its own edge, keeps its actions on screen, and the
// page doesn't scroll sideways. Submit for review, Approve, Request changes, Compare versions and Change sunset (with
// its calendar), each with an axe check. Then at 320 x 256 (the same zoom on a short window) the footer still shows.
//
// Run against the production build: E2E_GATE_PORT=3110 npx playwright test e2e/reflow-dialogs.spec.ts
// It opens the dialogs and closes them; nothing is submitted.

test.use({ trace: "off", viewport: { width: 320, height: 720 } });

const PERSONA_COOKIE = "ucomp_persona";
const COLLECT = "UC-J530DX"; // Cash Back Welcome Bonus: v3 round 2 in review (Jordan decides); v1, v2 behind it
const BALANCE = "UC-D6KSGY"; // Balance Transfer Intro: v1 Superseded with a sunset set, v2 Active
const HEADS_UP = "UC-FYN38M"; // Rate Change Heads-up: a draft (Maya's)

async function open(page: Page, url: string, persona: string) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100";
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE, value: persona, url: baseURL }]);
  const response = await page.goto(url, { waitUntil: "load" });
  expect(response?.status(), `${url} responded`).toBeLessThan(500);
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

/** The review screen's Approve and Request changes (the decision bar and the rail both carry them: this is the bar's). */
const decide = (page: Page) => page.getByRole("group", { name: "Decide" });

const AXE_EXCLUDES = ["nextjs-portal", "[data-base-ui-focus-guard]"];

async function expectNoSeriousAxe(page: Page, what: string) {
  await settled(page); // the dialog has faded in: axe reads its contrast from the colours it finds
  let builder = new AxeBuilder({ page });
  for (const selector of AXE_EXCLUDES) builder = builder.exclude(selector);
  const serious = (await builder.analyze()).violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    `${what}: axe`,
  ).toEqual([]);
}

/** Whether `box` lies inside the window (a pixel of slack for rounding). */
function expectInWindow(
  page: Page,
  box: { x: number; y: number; width: number; height: number } | null,
  what: string,
) {
  const { width, height } = page.viewportSize()!;
  expect(box, `${what} is on screen`).not.toBeNull();
  expect.soft(box!.x, `${what}: left edge`).toBeGreaterThanOrEqual(-1);
  expect.soft(box!.y, `${what}: top edge`).toBeGreaterThanOrEqual(-1);
  expect
    .soft(box!.x + box!.width, `${what}: right edge`)
    .toBeLessThanOrEqual(width + 1);
  expect
    .soft(box!.y + box!.height, `${what}: bottom edge`)
    .toBeLessThanOrEqual(height + 1);
}

/** Things inside the dialog that reach past its right or left edge, outside any box that scrolls sideways on purpose. */
function stickingOut(dialog: Locator) {
  return dialog.evaluate((root) => {
    const frame = root.getBoundingClientRect();
    const out: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width <= 1 && rect.height <= 1) continue; // sr-only
      if (rect.right <= frame.right + 1 && rect.left >= frame.left - 1)
        continue;
      // Inside a box that scrolls sideways by design (a table's region): the box's own edge is what counts.
      let scrolls = false;
      for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
        const overflowX = getComputedStyle(a).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") scrolls = true;
      }
      if (scrolls) continue;
      out.push(
        `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[${el.getAttribute("data-slot")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(rect.left)}..${Math.round(rect.right)} (dialog ${Math.round(frame.left)}..${Math.round(frame.right)})`,
      );
    }
    return out;
  });
}

/** The page and the dialog hold nothing sideways. */
async function expectFits(page: Page, dialog: Locator, what: string) {
  expectInWindow(page, await dialog.boundingBox(), `${what} dialog`);
  expect
    .soft(
      await stickingOut(dialog),
      `${what}: nothing reaches past the dialog's edges`,
    )
    .toEqual([]);
  const page_ = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect.soft(page_, `${what}: the page doesn't scroll sideways`).toBe(0);
}

/** The dialog's actions are on screen, at this window size. */
async function expectActions(
  page: Page,
  dialog: Locator,
  names: (string | RegExp)[],
  what: string,
) {
  for (const name of names) {
    const button = dialog.getByRole("button", {
      name,
      exact: typeof name === "string",
    });
    await expect(button, `${what}: ${String(name)}`).toBeVisible();
    expectInWindow(
      page,
      await button.boundingBox(),
      `${what}: ${String(name)}`,
    );
  }
}

/** Fits at 320 x 720, then at 320 x 256 with the actions still showing. */
async function expectDialogReflows(
  page: Page,
  dialog: Locator,
  actions: (string | RegExp)[],
  what: string,
) {
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await settled(page);
  await expectFits(page, dialog, what);
  await expectActions(page, dialog, actions, what);
  await expectNoSeriousAxe(page, what);

  await page.setViewportSize({ width: 320, height: 256 });
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(256);
  await settled(page);
  expectInWindow(
    page,
    await dialog.boundingBox(),
    `${what} dialog at 256px tall`,
  );
  await expectActions(page, dialog, actions, `${what} at 256px tall`);
  await page.setViewportSize({ width: 320, height: 720 });
}

test("Submit for review fits 320px wide, with its actions in view", async ({
  page,
}) => {
  await open(page, `/coral-offers/templates/${HEADS_UP}`, "maya");
  await page.getByRole("button", { name: "Submit for review" }).click();
  const dialog = page.getByRole("dialog", { name: /^Submit v\d+ for review$/ });
  await expectDialogReflows(
    page,
    dialog,
    ["Cancel", /^Submit v\d+$/],
    "Submit for review",
  );
});

test.describe("on the review screen", () => {
  test("Approve fits 320px wide, with its sunset row and calendar", async ({
    page,
  }) => {
    await open(page, `/coral-offers/review/${COLLECT}/3`, "jordan");
    await viewEveryOutput(page);
    await decide(page)
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Approve v3, round 2",
      exact: true,
    });
    await expectDialogReflows(
      page,
      dialog,
      ["Cancel", "Approve v3, round 2"],
      "Approve",
    );

    // The sunset row, with the checkbox on and the calendar open.
    await dialog.getByRole("checkbox").click();
    await dialog.getByRole("button", { name: /^Sunset date, / }).click();
    const calendar = page.locator('[data-slot="calendar"]');
    await expect(calendar).toBeVisible();
    await settled(page);
    expectInWindow(page, await calendar.boundingBox(), "Approve: the calendar");
    await expectFits(page, dialog, "Approve with the calendar open");
    await page.keyboard.press("Escape");
    await expect(calendar).toBeHidden();
    await expectActions(
      page,
      dialog,
      ["Cancel", "Approve v3, round 2"],
      "Approve with the sunset on",
    );
  });

  test("Request changes fits 320px wide, with its actions in view", async ({
    page,
  }) => {
    await open(page, `/coral-offers/review/${COLLECT}/3`, "jordan");
    await decide(page)
      .getByRole("button", { name: "Request changes", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Request changes on v3, round 2",
      exact: true,
    });
    await expectDialogReflows(
      page,
      dialog,
      ["Cancel", "Request changes"],
      "Request changes",
    );
  });
});

test.describe("on the Versions tab", () => {
  test("Compare versions fits 320px wide, with its pickers, switch and Close in view", async ({
    page,
  }) => {
    await open(page, `/coral-offers/templates/${COLLECT}/versions`, "jordan");
    await page.getByRole("button", { name: "Compare versions" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Compare versions",
      exact: true,
    });
    await expect(dialog.locator('[data-slot="compare-body"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(dialog.locator('[data-slot="skeleton"]')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expectDialogReflows(page, dialog, ["Close"], "Compare versions");

    for (const control of [
      dialog.getByRole("combobox").first(),
      dialog.getByRole("combobox").nth(1),
      dialog.getByRole("switch"),
    ]) {
      await expect(control).toBeVisible();
      expectInWindow(page, await control.boundingBox(), "Compare: a control");
    }
    const body = dialog.locator('[data-slot="compare-body"]');
    expectInWindow(page, await body.boundingBox(), "Compare: the redline");
    const overflow = await body.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect
      .soft(overflow, "the redline holds nothing sideways")
      .toBeLessThanOrEqual(0);
  });

  test("Change sunset fits 320px wide, and its calendar opens inside the window", async ({
    page,
  }) => {
    await open(page, `/coral-offers/templates/${BALANCE}/versions`, "jordan");
    await page
      .getByRole("button", { name: "Change sunset for v1", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Change sunset for v1",
      exact: true,
    });
    await expectDialogReflows(
      page,
      dialog,
      ["Cancel", "Change sunset"],
      "Change sunset",
    );

    await dialog.getByRole("button", { name: /Sunset date/ }).click();
    const calendar = page.locator('[data-slot="calendar"]');
    await expect(calendar).toBeVisible();
    await settled(page);
    expectInWindow(
      page,
      await calendar.boundingBox(),
      "Change sunset: the calendar",
    );
    await expectNoSeriousAxe(page, "Change sunset with the calendar open");
    await page.keyboard.press("Escape");
    await expect(calendar).toBeHidden();
    await expectFits(page, dialog, "Change sunset after the calendar");
  });
});
