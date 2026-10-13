import type { Locator, Page } from "@playwright/test";
import {
  asPersona,
  expect,
  hydrated,
  liveEditor,
  tap,
  test,
  typeSlowly,
} from "./helpers/scenario";
import { settled } from "./helpers/settled";
import {
  Changes,
  addCommentThread,
  commentThread,
  commentThreads,
  commentsIn,
  findVersion,
  openDraftOf,
  versionById,
} from "./helpers/state";

// Comments belong to a draft or a version in review (docs/handoff-review.md, S7 and S9; decision 0010).
//
//   1. Jordan, an approver, opens Cash Back v3 (in review, the seed's) and comments on a block from the rail's
//      "Comment on a block" menu. The thread shows at once and is saved. He replies to it, then resolves it.
//   2. Balance Transfer v2 is Active, so its threads are a record. On its review screen and in the template's
//      workspace, a thread on it shows its comment and nothing to answer it with: no Reply, no Resolve, and no
//      "Comment on a block". (The UI has never offered them there; the server now refuses a direct call too,
//      which src/server/actions/comments.test.ts covers.)
//
// afterAll removes the threads, comments, audit rows and notifications this spec wrote.

const TEAM = "coral-offers";
const CASH_BACK = "Cash Back Welcome Bonus — Terms";
const BALANCE = "Balance Transfer Intro — Terms";
const COMMENT = "Is the bonus window still 90 days?";
const REPLY = "Checked with Product: it is.";
/** The thread this spec puts on Balance Transfer v2 (Active), and its one comment. */
const RECORD = "th_e2e_comment_record";
const RECORD_BODY = "Approved wording, kept for the record.";

const changes = new Changes();
let cashBack: { templateId: string; number: number };
let balance: { templateId: string; number: number };
/** The id of Jordan's thread on Cash Back v3, once it is saved. */
let posted: string | null = null;

/** The thread on a template that has a comment with this text, if one is saved. */
async function threadCommented(templateId: string, text: string) {
  for (const thread of await commentThreads(templateId))
    if ((await commentsIn(thread.id)).some((c) => c.body === text))
      return thread;
  return undefined;
}

test.beforeAll(async () => {
  const inReview = await findVersion({ name: CASH_BACK, state: "in_review" });
  const active = await findVersion({ name: BALANCE, state: "active" });
  if (!inReview || !active)
    throw new Error("This spec needs the fresh seed (npm run db:reset).");
  cashBack = { templateId: inReview.templateId, number: inReview.number! };
  balance = { templateId: active.templateId, number: active.number! };
  expect(
    await openDraftOf(balance.templateId),
    "Balance Transfer has no open draft: nothing on it takes comments",
  ).toBeUndefined();

  // Jordan's thread, comments, audit rows and notifications on Cash Back, and the thread put on Balance Transfer
  // below, go again: both templates are watched before anything is written.
  await changes.watchTemplate(cashBack.templateId);
  await changes.watchTemplate(balance.templateId);

  // A thread on a block of the Active version, as one left from its review would be.
  const blockIds = (active.body.content ?? [])
    .map((b) => b.attrs?.id)
    .filter((id): id is string => typeof id === "string");
  const blockId = blockIds[1]!;
  await addCommentThread({
    id: RECORD,
    templateId: balance.templateId,
    versionId: active.id,
    blockId,
    quote: null,
    authorId: "jordan",
    comment: RECORD_BODY,
  });
});

test.afterAll(() => changes.undo());

const decision = (page: Page): Locator =>
  page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const blockMenu = (scope: Locator) =>
  scope.getByRole("button", { name: "Comment on a block" });
const replyControl = (card: Locator) => card.locator('[data-slot="reply"]');
const resolveButton = (card: Locator) =>
  card.getByRole("button", { name: "Resolve", exact: true });

async function openReview(
  page: Page,
  person: string,
  templateId: string,
  number: number,
  name: string,
) {
  await asPersona(page, person);
  await page.goto(`/${TEAM}/review/${templateId}/${number}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(decision(page)).toBeVisible();
  await liveEditor(page);
  await hydrated(page);
  // The rail's controls are pressed with a held click: wait until nothing is still streaming in under them.
  await settled(page);
}

test.use({ trace: "off", screenshot: "only-on-failure" });

test("a reviewer comments on a version in review; an Active version's threads offer nothing to answer them with", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await test.step("1. Jordan comments on a block of Cash Back v3, replies and resolves", async () => {
    await openReview(
      page,
      "jordan",
      cashBack.templateId,
      cashBack.number,
      CASH_BACK,
    );
    await tap(blockMenu(decision(page)));
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await tap(menu.getByRole("menuitem").nth(1));

    const composer = decision(page).locator("article[data-compose]");
    await expect(composer).toBeVisible();
    const field = composer.getByRole("textbox", { name: "Add a comment" });
    await expect(field).toBeFocused();
    await typeSlowly(page, COMMENT);
    await tap(composer.getByRole("button", { name: "Comment", exact: true }));
    await expect(composer).toBeHidden();

    const card = decision(page)
      .locator("article[data-thread]")
      .filter({ hasText: COMMENT });
    await expect(card).toHaveAttribute("data-status", "open");
    await expect(card).toContainText("Jordan Ellis");
    await expect
      .poll(
        async () => (await threadCommented(cashBack.templateId, COMMENT))?.id,
        {
          message: "the thread is saved",
        },
      )
      .toBeTruthy();
    const saved = (await threadCommented(cashBack.templateId, COMMENT))!;
    posted = saved.id;
    expect((await versionById(saved.originVersionId))!.number).toBe(
      cashBack.number,
    );

    // Once the card carries the saved thread's id, its own Reply, then Resolve: the server takes both.
    await expect(card).toHaveAttribute("data-thread", posted);
    await tap(replyControl(card));
    const replyField = card.getByRole("textbox", { name: "Reply" });
    await expect(replyField).toBeFocused();
    await typeSlowly(page, REPLY);
    await tap(card.getByRole("button", { name: "Reply", exact: true }));
    await expect(card).toContainText(REPLY);
    await expect
      .poll(async () => (await commentsIn(posted!)).map((c) => c.body), {
        message: "the reply is saved",
      })
      .toEqual([COMMENT, REPLY]);
    await expect(card.locator('[role="alert"]')).toHaveCount(0);

    await tap(resolveButton(card));
    await expect
      .poll(async () => (await commentThread(posted!)) ?? null, {
        message: "the resolve is saved",
      })
      .toMatchObject({ status: "resolved", resolvedBy: "jordan" });
  });

  await test.step("2. On Balance Transfer v2 (Active), the review screen offers nothing to comment with", async () => {
    await openReview(
      page,
      "jordan",
      balance.templateId,
      balance.number,
      BALANCE,
    );
    const record = decision(page).locator(`article[data-thread="${RECORD}"]`);
    await expect(record).toBeVisible();
    await expect(record).toContainText(RECORD_BODY);
    await expect(replyControl(record)).toHaveCount(0);
    await expect(resolveButton(record)).toHaveCount(0);
    await expect(blockMenu(decision(page))).toHaveCount(0);
  });

  await test.step("3. The template's workspace shows the thread the same way", async () => {
    await asPersona(page, "maya");
    await page.goto(`/${TEAM}/templates/${balance.templateId}`);
    await liveEditor(page);
    await hydrated(page);
    await settled(page);
    const rail = page.locator('aside[aria-label="Comments and variables"]');
    await expect(rail).toBeVisible();
    const record = rail.locator(`article[data-thread="${RECORD}"]`);
    await expect(record).toBeVisible();
    await expect(record).toContainText(RECORD_BODY);
    await expect(replyControl(record)).toHaveCount(0);
    await expect(resolveButton(record)).toHaveCount(0);
  });
});
