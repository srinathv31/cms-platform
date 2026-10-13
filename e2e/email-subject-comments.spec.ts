import type { Locator, Page } from "@playwright/test";
import { SPRING_NAME, TEAM, type SpringFixture } from "./helpers/golive";
import {
  asPersona,
  expect,
  hydrated,
  liveEditor,
  liveField,
  tap,
  test,
  typeSlowly,
} from "./helpers/scenario";
import { Changes, commentThreads } from "./helpers/state";

// An email's subject and preheader take review comments, as the body's blocks do (docs/handoff-review.md, N25).
//
//   1. Maya edits Spring Travel Rewards (v2 Active, Email on) and, from the Email details in the rail, starts a
//      comment on the preheader. It shows in the rail's list, and the field carries its marker. She submits v3.
//   2. Jordan opens the review. Maya's thread is in the list with a marker in the gutter beside the preheader.
//      The rail's comment menu lists the email subject and preheader before the body's blocks.
//   3. He comments on the subject from the hover button in the gutter: the card is named for the field and quotes
//      the subject, a second marker appears. He resolves the thread (its marker goes) and reopens it (it returns).
//
// Standalone: the fixture inserts the template; afterAll removes it and every row this run wrote for it.

const SUBJECT_AS_TYPED =
  "Email subject: First name, your Spring Travel Rewards terms";
const PREHEADER_AS_TYPED = "Email preheader: What to know before you spend.";
const MAYA_COMMENT = "Is “before you spend” too pushy for a preheader?";
const JORDAN_COMMENT = "Say what changed in these terms.";

const changes = new Changes();
let fixture: SpringFixture | null = null;

test.beforeAll(async () => {
  fixture = await changes.createSpringTravel();
});

test.afterAll(() => changes.undo());

const statusBadge = (page: Page) =>
  page
    .locator('header [data-slot="badge"][data-status]')
    .filter({ visible: true });
const rail = (page: Page) =>
  page.locator('aside[data-slot="rail"]').filter({ visible: true });
const decision = (page: Page) =>
  page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const gutterMarkers = (page: Page) =>
  page
    .locator('[data-slot="gutter-markers"] [data-marker]')
    .filter({ visible: true });
/** A field of the version on the review screen, by its id ("email.subject"). */
const fieldFrame = (page: Page, id: string) =>
  page.locator(`[data-fields-document] .ucomp-doc > [data-block-id="${id}"]`);
/** The template's threads as "block:quote:status", ordered by block. */
const threadRows = async () =>
  (await commentThreads(fixture!.templateId))
    .sort((a, b) =>
      a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : 0,
    )
    .map((r) => `${r.blockId}:${r.quote}:${r.status}`);

/** Posts the comment box that is open in `scope`: the text typed, then Comment. */
async function post(page: Page, scope: Locator, text: string) {
  const composer = scope.locator("article[data-compose]");
  await expect(composer).toBeVisible();
  await expect(
    composer.getByRole("textbox", { name: "Add a comment" }),
  ).toBeFocused();
  await typeSlowly(page, text);
  await tap(composer.getByRole("button", { name: "Comment", exact: true }));
  await expect(composer).toBeHidden();
}

test.use({ trace: "off", screenshot: "only-on-failure" });

test("the email subject and preheader take comments: started, listed, marked, resolved and reopened", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { templateId } = fixture!;

  await test.step("1. Maya comments on the preheader from the Email details; the list and the field show it", async () => {
    await asPersona(page, "maya");
    await page.goto(`/${TEAM}/templates/${templateId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: SPRING_NAME }),
    ).toBeVisible();
    await hydrated(page);
    await tap(page.getByRole("button", { name: "Edit", exact: true }));
    await expect(statusBadge(page)).toHaveText("Draft");
    await liveEditor(page);
    const preheader = page.getByRole("textbox", { name: "Email preheader" });
    await liveField(preheader);

    await preheader.hover();
    await tap(
      page.getByRole("button", { name: "Comment on the email preheader" }),
    );
    await post(page, rail(page), MAYA_COMMENT);

    // In the list, named for the field, with the preheader as typed.
    const card = rail(page)
      .locator("article[data-thread]")
      .filter({ hasText: MAYA_COMMENT });
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName("Comment on the email preheader");
    await expect(card.locator('[data-slot="block-snippet"]')).toHaveText(
      PREHEADER_AS_TYPED,
    );
    await expect
      .poll(threadRows, { message: "the thread is saved on the field" })
      .toEqual(["email.preheader:null:open"]);

    // Back in the Email details, the field carries its marker.
    await tap(rail(page).getByRole("tab", { name: "Variables" }));
    await expect(
      page.getByRole("button", { name: "1 comment on the email preheader" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "1 comment on the email subject" }),
    ).toHaveCount(0);

    await tap(page.getByRole("button", { name: "Submit for review" }));
    const dialog = page.getByRole("dialog", { name: "Submit v3 for review" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await tap(dialog.getByRole("button", { name: "Submit v3", exact: true }));
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(statusBadge(page)).toHaveText("In review", {
      timeout: 20_000,
    });
  });

  await test.step("2. Jordan's review lists Maya's thread, marks the preheader, and offers both fields in the comment menu", async () => {
    await asPersona(page, "jordan");
    await page.goto(`/${TEAM}/review/${templateId}/3`);
    await expect(
      page.getByRole("heading", { level: 1, name: SPRING_NAME }),
    ).toBeVisible();
    await expect(decision(page)).toBeVisible();
    await liveEditor(page);
    await hydrated(page);

    const card = decision(page)
      .locator("article[data-thread]")
      .filter({ hasText: MAYA_COMMENT });
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName("Comment on the email preheader");
    await expect(gutterMarkers(page)).toHaveCount(1);
    await expect(gutterMarkers(page).first()).toHaveAttribute(
      "data-marker",
      "email.preheader",
    );
    await expect(gutterMarkers(page).first()).toHaveAccessibleName(
      "1 comment on this field",
    );

    // Choosing the marker makes the card the active one.
    await tap(gutterMarkers(page).first());
    await expect(card).toHaveAttribute("data-active", "");

    await tap(
      decision(page).getByRole("button", { name: "Comment on a block" }),
    );
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").nth(0)).toHaveText("Email subject");
    await expect(menu.getByRole("menuitem").nth(1)).toHaveText(
      "Email preheader",
    );
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  await test.step("3. He comments on the subject from the gutter, then resolves and reopens the thread", async () => {
    await fieldFrame(page, "email.subject").hover();
    const add = page.getByRole("button", {
      name: "Comment on this field",
      exact: true,
    });
    await expect(add).toBeVisible();
    await tap(add);
    const composer = decision(page).locator("article[data-compose]");
    await expect(composer).toContainText(SUBJECT_AS_TYPED);
    await post(page, decision(page), JORDAN_COMMENT);

    const card = decision(page)
      .locator("article[data-thread]")
      .filter({ hasText: JORDAN_COMMENT });
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName("Comment on the email subject");
    await expect(card.locator('[data-slot="block-snippet"]')).toHaveText(
      SUBJECT_AS_TYPED,
    );
    await expect(gutterMarkers(page)).toHaveCount(2);
    expect(
      await gutterMarkers(page).evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-marker")),
      ),
    ).toEqual(["email.subject", "email.preheader"]);
    await expect
      .poll(threadRows)
      .toEqual(["email.preheader:null:open", "email.subject:null:open"]);

    // Resolve: the card moves to the collapsed group and the subject loses its marker.
    await tap(card.getByRole("button", { name: "Resolve", exact: true }));
    await expect
      .poll(threadRows, { message: "the resolve is saved" })
      .toEqual(["email.preheader:null:open", "email.subject:null:resolved"]);
    await expect(gutterMarkers(page)).toHaveCount(1);
    await expect(gutterMarkers(page).first()).toHaveAttribute(
      "data-marker",
      "email.preheader",
    );

    // Reopen it from Resolved: it is open again, and its marker returns.
    const resolved = decision(page).getByRole("region", {
      name: "Resolved comments",
    });
    await tap(resolved.getByRole("button", { name: "Resolved (1)" }));
    const closed = resolved
      .locator("article[data-thread]")
      .filter({ hasText: JORDAN_COMMENT });
    await expect(closed).toContainText("Resolved by Jordan Ellis");
    await tap(closed.getByRole("button", { name: "Reopen", exact: true }));
    await expect
      .poll(threadRows, { message: "the reopen is saved" })
      .toEqual(["email.preheader:null:open", "email.subject:null:open"]);
    await expect(gutterMarkers(page)).toHaveCount(2);
  });
});
