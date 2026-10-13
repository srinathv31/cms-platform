import type { Locator, Page } from "@playwright/test";
import {
  asPersona,
  caret,
  documentEditor,
  expect,
  expectAutosaved,
  hydrated,
  liveEditor,
  nameField,
  openLibrary,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";
import { viewEveryOutput } from "./helpers/review";
import {
  Changes,
  decisionsOnTemplate,
  membershipOf,
  openDraftOf,
  teamIdOf,
  versionNumbered,
} from "./helpers/state";

// Maker-checker reaches everyone who wrote a version, not only whoever pressed Submit
// (docs/handoff-review.md, S3). Holding Author and Approver on one team is normal: approving an access
// request can add the role. The seed gives nobody both, and the other specs rely on its roles, so Priya
// gets Approver on Coral Offers for this spec only and afterAll takes it away again.
//
//   1. Maya makes a template.
//   2. Priya adds a sentence to Maya's draft; it autosaves.
//   3. Maya submits it as v1.
//   4. Priya opens v1: Approve and Request changes are disabled, the reason says why (Tab reaches both, and
//      each is described by it), and v1 doesn't wait on her in the queue.
//   5. Jordan, who wrote none of it, may decide it.
//
// Self-contained: afterAll removes the template and everything it wrote.

const TEAM = "coral-offers";
const NAME = "Maker-checker — Terms";
/** A paragraph of the "Card offer terms" starter, under "Rates and fees". */
const INTEREST_STARTS = "Interest on purchases starts on the transaction date";
const SENTENCE = " Priya wrote this sentence.";
const WROTE = "You wrote part of this version.";

const changes = new Changes();
let templateId: string | null = null;

test.beforeAll(async () => {
  const teamId = await teamIdOf(TEAM);
  expect(
    (await membershipOf("priya", teamId))?.roles,
    "the seed makes Priya an author on Coral Offers",
  ).toEqual(["author"]);
  // Priya's Approver role, and the template Maya makes below, are taken away again in afterAll.
  await changes.grantRole("priya", teamId, "approver");
});

test.afterAll(() => changes.undo());

const decision = (page: Page) =>
  page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) =>
  decision(page).getByRole("button", { name: "Approve", exact: true });
const requestButton = (page: Page) =>
  decision(page).getByRole("button", { name: "Request changes", exact: true });
const statusBadge = (page: Page) =>
  page
    .locator('header [data-slot="badge"][data-status]')
    .filter({ visible: true });
const block = (page: Page, text: string): Locator =>
  documentEditor(page).locator("p", { hasText: text });

async function openWorkspace(page: Page, person: string, id: string) {
  await asPersona(page, person);
  await page.goto(`/${TEAM}/templates/${id}`);
  await liveEditor(page);
  await hydrated(page);
}

async function openReview(page: Page, person: string, id: string) {
  await asPersona(page, person);
  await page.goto(`/${TEAM}/review/${id}/1`);
  await expect(
    page.getByRole("heading", { level: 1, name: NAME }),
  ).toBeVisible();
  await expect(decision(page)).toBeVisible();
  await liveEditor(page);
  await hydrated(page);
}

test.use({ trace: "off", screenshot: "only-on-failure" });

test("someone who edited a draft another author submitted can't approve it or send it back", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await test.step("1. Maya makes a template", async () => {
    await asPersona(page, "maya");
    await openLibrary(page, TEAM);
    await tap(page.getByRole("button", { name: "New template" }));
    const gallery = page.getByRole("dialog");
    await expect(gallery).toBeVisible();
    await tap(gallery.getByRole("button", { name: /Card offer terms/ }));
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-[0-9A-Z]{6}/);
    templateId = /\/templates\/(UC-[0-9A-Z]{6})/.exec(page.url())![1]!;
    changes.ownTemplate(templateId);

    await expect(nameField(page)).toBeFocused();
    // The page is live (the document's editor has taken over from the server's markup) before the first keystroke.
    await liveEditor(page);
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await typeSlowly(page, NAME);
    await expect(nameField(page)).toHaveValue(NAME);
    await expectAutosaved(page);
  });
  const id = templateId!;

  await test.step("2. Priya adds a sentence to Maya's draft", async () => {
    await openWorkspace(page, "priya", id);
    const paragraph = block(page, INTEREST_STARTS);
    await paragraph.scrollIntoViewIfNeeded();
    const box = (await paragraph.boundingBox())!;
    const end = { x: box.width - 4, y: box.height - 10 };
    await untilUncovered(paragraph, end);
    await tap(paragraph, { position: end });
    await page.keyboard.press("End");
    await expect
      .poll(async () => (await caret(page)).block.startsWith(INTEREST_STARTS), {
        message: "the caret is in that paragraph",
      })
      .toBe(true);
    await typeSlowly(page, SENTENCE);
    await expect(paragraph).toContainText(SENTENCE.trim());
    await expectAutosaved(page);

    const draft = await openDraftOf(id);
    expect(draft).toMatchObject({ createdBy: "maya" });
    expect(draft!.writers).toEqual(["maya", "priya"]);
  });

  await test.step("3. Maya submits it as v1", async () => {
    await openWorkspace(page, "maya", id);
    await expect(documentEditor(page)).toContainText(SENTENCE.trim());
    await tap(page.getByRole("button", { name: "Submit for review" }));
    const dialog = page.getByRole("dialog", { name: "Submit v1 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await tap(dialog.getByRole("button", { name: "Submit v1", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", {
      timeout: 20_000,
    });

    const v1 = await versionNumbered(id, 1);
    expect(v1).toMatchObject({ state: "in_review", submittedBy: "maya" });
    expect(v1!.writers).toEqual(["maya", "priya"]);
  });

  await test.step("4. Priya opens v1: Approve and Request changes are disabled, and the reason says why", async () => {
    await openReview(page, "priya", id);
    await expect(approveButton(page)).toBeVisible();
    await expect(approveButton(page), "she wrote part of it").toBeDisabled();
    await expect(requestButton(page)).toBeDisabled();
    await expect(decision(page).getByText(WROTE)).toBeVisible();
    await expect(approveButton(page)).toHaveAccessibleDescription(WROTE);

    // From the keyboard (I13): the blocked pair stays in the Tab order, and each announces why. A click on
    // the stepper's stage starts keyboard navigation there; Approve is the next stop.
    await decision(page).locator('[data-step="current"]').click();
    await page.keyboard.press("Tab");
    await expect(
      approveButton(page),
      "Tab reaches the blocked Approve",
    ).toBeFocused();
    await expect(approveButton(page)).toHaveAttribute(
      "aria-describedby",
      "decision-blocked",
    );
    await expect(page.locator("#decision-blocked")).toHaveText(WROTE);
    await expect(
      page.locator('[data-slot="tooltip-content"]').filter({ visible: true }),
      "and shows why",
    ).toHaveText(WROTE);
    await page.keyboard.press("Tab");
    await expect(requestButton(page)).toBeFocused();
    await expect(requestButton(page)).toHaveAccessibleDescription(WROTE);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog"),
      "pressing it opens nothing",
    ).toHaveCount(0);

    await page.goto(`/${TEAM}/review`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Review" }),
    ).toBeVisible();
    await hydrated(page);
    const waiting = page.getByRole("tab", { name: /^Waiting on me/ });
    await tap(waiting);
    await expect(waiting).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel").filter({ visible: true });
    await expect(
      panel
        .locator("ul > li")
        .first()
        .or(panel.getByText("Nothing waiting on you.")),
    ).toBeVisible();
    await expect(
      panel.locator(`a[href="/${TEAM}/review/${id}/1"]`),
      "v1 doesn't wait on Priya",
    ).toHaveCount(0);
    expect(await decisionsOnTemplate(id)).toEqual([]);
  });

  await test.step("5. Jordan wrote none of it: Approve and Request changes are his to press", async () => {
    await openReview(page, "jordan", id);
    await viewEveryOutput(page);
    await expect(approveButton(page)).toBeEnabled();
    await expect(requestButton(page)).toBeEnabled();
    await expect(decision(page).getByText(WROTE)).toHaveCount(0);
  });
});
