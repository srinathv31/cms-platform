import type { Client, InValue } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { openDb } from "./api/helpers";
import { click, closeSettings, escapeRe, openBell, openSettings, resetDemoData, settingsDialog, strip, switchPersona } from "./helpers/access";
import { asPersona, beat, demoTimeout, expect, hydrated, liveEditor, openLibrary, shoot, test } from "./helpers/scenario";

// Phase 6 gate: the two-stage approval, end to end in the UI.
//
//   1. Riley (Platform Admin) adds a "Legal reviewer" stage to the Disclosure approval chain, naming Dana
//      Park. The strip shows the chain Now and After and says Dana will review every team's submissions.
//      Cash Back Welcome Bonus v3 (seeded, in review, submitted by Maya) keeps waiting on stage 1.
//   2. Jordan (Approver) opens it from his queue: the stepper has two stages and he is on the first. He
//      approves: the dialog says it moves on to the Legal reviewer and is not Active yet. Afterwards the
//      stepper shows his approval, Dana's stage is current, his queue no longer holds it, and he has no say
//      on the next stage.
//   3. Alex (the team's other Approver) sees it waiting on Dana and can't decide it.
//   4. Dana, who is only a Viewer of the team, has the bell item and the Review badge for it, opens it from
//      her queue, and approves: the version goes Active (the go-live moment), the previous Active version is
//      Superseded, and the stepper shows both approvals.
//   5. The database holds both approvals, in order, by who and at which stage.
//
// Cash Back v3 is the seed's own in-review version, so nothing here creates a template; it changes the
// approval chain, the version's state and the access it grants, so afterAll re-seeds the database.
// Console and page errors fail it.
//
// The last test is the chain editor's own check (domain validateChain): naming one person on two stages
// shows the reason at the later stage and keeps Save disabled, and nothing is sent.

const TEAM = "coral-offers";
const NAME = "Cash Back Welcome Bonus — Terms";
const STAGE = "Legal reviewer";
const EVERY_TEAM = "Dana Park will review Disclosure submissions from every team, including teams they aren't a member of.";

type Row = Record<string, InValue>;

let db: Client;

test.beforeAll(() => {
  db = openDb();
});

// Each test changes the chain and the version in review: put the seed back after each, and the last one closes the database.
test.afterEach(() => {
  test.setTimeout(90_000);
  resetDemoData();
});

test.afterAll(() => {
  db?.close();
});

async function rows(sql: string, args: InValue[] = []): Promise<Row[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await db.execute({ sql, args });
      return result.rows.map((row) => Object.fromEntries(result.columns.map((column) => [column, row[column] as InValue])));
    } catch (error) {
      const text = String((error as { code?: unknown }).code ?? "") + String((error as Error).message ?? "");
      if (attempt >= 8 || !/SQLITE_BUSY|database is locked/i.test(text)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    }
  }
}

// ── The screens ──────────────────────────────────────────────────────────────

const decision = (page: Page): Locator => page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) => decision(page).getByRole("button", { name: "Approve", exact: true });
const step = (page: Page, status: "done" | "current" | "waiting") => decision(page).locator(`[data-step="${status}"]`);
const reviewNav = (page: Page) => page.locator('[data-slot="sidebar-menu-button"][href$="/review"]').filter({ visible: true });
const reviewBadge = (page: Page) => reviewNav(page).locator('[aria-label$=" waiting"]');
const statusBadge = (page: Page) => page.locator('header [data-slot="badge"][data-status]').filter({ visible: true });

/** The queue row of this template's in-review version (whatever its number). */
const queueRow = (page: Page) =>
  page
    .locator(`a[href^="/${TEAM}/review/"]`)
    .filter({ visible: true })
    .filter({ hasText: NAME });

async function openQueue(page: Page, tab = "Waiting on me") {
  await click(reviewNav(page));
  await expect(page).toHaveURL(new RegExp(`/${TEAM}/review$`));
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  const queueTab = page.getByRole("tab", { name: new RegExp(`^${escapeRe(tab)}`) });
  await click(queueTab);
  await expect(queueTab).toHaveAttribute("aria-selected", "true");
}

/** The review screen, once the document is live. */
async function expectReviewScreen(page: Page, number: number) {
  await expect(page).toHaveURL(new RegExp(`/${TEAM}/review/[^/]+/${number}$`));
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(decision(page)).toBeVisible();
  await liveEditor(page);
  await hydrated(page);
}

test.describe("phase 6: two-stage approval", () => {
  test("Riley adds Dana's Legal reviewer stage; Jordan approves stage 1, Dana approves stage 2, the version goes Active", async ({ page }) => {
    test.setTimeout(demoTimeout(240_000));

    const [seeded] = await rows(
      `SELECT v.id, v.template_id, v.number, v.state, v.current_stage FROM versions v JOIN templates t ON t.id = v.template_id
       WHERE t.name = ? AND v.state = 'in_review'`,
      [NAME],
    );
    if (!seeded) throw new Error(`This spec needs the fresh seed (npm run db:reset): ${NAME} in review.`);
    const versionId = String(seeded.id);
    const templateId = String(seeded.template_id);
    const number = Number(seeded.number);
    const [previous] = await rows("SELECT number FROM versions WHERE template_id = ? AND state = 'active'", [templateId]);
    expect(previous, "something is Active for v3 to replace").toBeDefined();

    // ── 1. Riley adds the stage ──────────────────────────────────────────────

    await asPersona(page, "riley");
    await openLibrary(page, "all");
    await beat(page, 900);

    await test.step("1.1 Riley opens Approval chains: one stage, Team approver", async () => {
      const dialog = await openSettings(page, "Approval chains");
      await expect(page).toHaveURL(/\/all\/settings\/approval-chains$/);
      const chain = dialog.getByRole("region", { name: "Disclosure approval chain" });
      await expect(chain).toBeVisible();
      const stages = chain.getByRole("list", { name: "Disclosure stages" }).getByRole("listitem");
      await expect(stages).toHaveCount(1);
      await expect(stages.first()).toContainText("Team approver");
      await beat(page, 900);
      await shoot(page, "riley-chain-before");
    });

    await test.step("1.2 Add stage: the name, Dana Park as the reviewer; the strip shows Now and After", async () => {
      const dialog = settingsDialog(page);
      const chain = dialog.getByRole("region", { name: "Disclosure approval chain" });
      await click(chain.getByRole("button", { name: "Add stage", exact: true }));
      const name = chain.getByRole("textbox", { name: "Stage name" });
      await expect(name).toBeFocused();
      await page.keyboard.type(STAGE, { delay: 40 });
      await expect(name).toHaveValue(STAGE);
      const reviewer = chain.getByRole("combobox", { name: "Reviewer" });
      await expect(reviewer.locator('option[value="role:approver"]')).toHaveCount(1);
      await expect(reviewer.locator('option[value="user:dana"]')).toHaveText("Dana Park · Coral Offers");
      await reviewer.selectOption("user:dana");
      await expect(reviewer).toHaveValue("user:dana");

      const consequence = strip(chain);
      await expect(consequence).toBeVisible();
      const now = consequence.getByRole("region", { name: "Now" });
      const after = consequence.getByRole("region", { name: "After" });
      await expect(now.getByRole("listitem")).toHaveCount(1);
      await expect(now).toContainText("Team approver");
      await expect(after.getByRole("listitem")).toHaveCount(2);
      await expect(after).toContainText("Team approver");
      await expect(after).toContainText(STAGE);
      await expect(after).toContainText("Dana Park");
      await expect(consequence).toContainText(EVERY_TEAM);
      await beat(page, 900);
      await shoot(page, "riley-chain-add-stage");

      await click(consequence.getByRole("button", { name: `Add ${STAGE} stage`, exact: true }));
      await expect(consequence).toBeHidden({ timeout: 20_000 });
      await expect(chain.getByRole("list", { name: "Disclosure stages" }).getByRole("listitem")).toHaveCount(2);
      await expect(chain.getByRole("list", { name: "Disclosure stages" }).getByRole("listitem").nth(1)).toContainText(STAGE);
      await beat(page, 900);
      await shoot(page, "riley-chain-after");
      await closeSettings(page);
    });

    await test.step("1.3 The version in review is still on stage 1 (the stage kept its id)", async () => {
      const stages = await rows("SELECT id, position, name, approver_rule FROM approval_stages WHERE content_type_id = 'ct_disclosure' ORDER BY position");
      expect(stages.map((s) => [s.position, s.name])).toEqual([
        [0, "Team approver"],
        [1, STAGE],
      ]);
      expect(stages[0].id, "the first stage kept its id").toBe("stage_disclosure_0");
      expect(JSON.parse(String(stages[1].approver_rule))).toEqual({ kind: "user", userId: "dana" });
      const [version] = await rows("SELECT state, current_stage FROM versions WHERE id = ?", [versionId]);
      expect(version.state).toBe("in_review");
      expect(Number(version.current_stage), "still waiting on the first stage").toBe(0);
    });

    // ── 2. Jordan approves stage 1 ───────────────────────────────────────────

    await test.step("2.1 Jordan opens the version from his queue: two stages, he is on the first", async () => {
      await switchPersona(page, "Jordan Ellis");
      await expect(page).toHaveURL(/\/all\/library$|\/coral-offers\//);
      await page.goto(`/${TEAM}/library`);
      await hydrated(page);
      await expect(reviewBadge(page)).toHaveText("1");
      await openQueue(page);
      const row = queueRow(page);
      await expect(row).toBeVisible();
      await beat(page, 900);
      await click(row);
      await expectReviewScreen(page, number);

      await expect(statusBadge(page)).toHaveText("In review");
      await expect(decision(page)).toContainText("Stage 1 of 2");
      await expect(step(page, "current")).toContainText("Team approver");
      await expect(step(page, "waiting")).toContainText(STAGE);
      await expect(step(page, "waiting")).toContainText("After Team approver");
      await expect(approveButton(page)).toBeEnabled();
      await beat(page, 900);
      await shoot(page, "jordan-stage-1");
    });

    await test.step("2.2 Approve: the dialog says it moves to the Legal reviewer and is not Active yet", async () => {
      await click(approveButton(page));
      const dialog = page.getByRole("dialog", { name: `Approve v${number}` });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText(
        `v${number} moves to ${STAGE} for approval. It isn't Active until the last stage approves.`,
      );
      await expect(dialog.getByRole("checkbox"), "an earlier stage sets no sunset").toHaveCount(0);
      await beat(page, 900);
      await shoot(page, "jordan-approve-dialog");

      await click(dialog.getByRole("button", { name: `Approve v${number}`, exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      // Not Active: no go-live moment, no ring. His approval is on the stepper and the next stage is current.
      await expect(decision(page).locator("[data-decided]")).toHaveText(`You approved this stage. ${STAGE} is next.`);
      await expect(step(page, "done")).toContainText("Team approver");
      await expect(step(page, "done")).toContainText("Jordan Ellis");
      await expect(step(page, "current")).toContainText(STAGE);
      await expect(statusBadge(page)).toHaveText("In review");
      await expect(approveButton(page)).toHaveCount(0);
      await expect(page.locator("[data-go-live]")).toHaveCount(0);
      await beat(page, 1200);
      await shoot(page, "jordan-approved-stage-1");
    });

    await test.step("2.3 It has left Jordan's Waiting on me, and the version is still in review", async () => {
      await openQueue(page);
      await expect(reviewBadge(page), "nothing waits on him now").toHaveCount(0);
      await expect(queueRow(page), "it moved on, so it isn't in his Waiting on me").toHaveCount(0);
      const [version] = await rows("SELECT state, current_stage FROM versions WHERE id = ?", [versionId]);
      expect(version.state).toBe("in_review");
      expect(Number(version.current_stage)).toBe(1);
    });

    // ── 3. Alex can only watch ───────────────────────────────────────────────

    await test.step("2.4 Jordan opening it again has no say on the Legal stage: Approve is disabled and says who it waits on", async () => {
      await page.goto(`/${TEAM}/review/${templateId}/${number}`);
      await expectReviewScreen(page, number);
      await expect(step(page, "done")).toContainText("Jordan Ellis");
      await expect(step(page, "current")).toContainText(STAGE);
      await expect(approveButton(page)).toBeDisabled();
      await expect(step(page, "current")).toContainText(`Waiting on ${STAGE}.`);
      await beat(page, 900);
      await shoot(page, "jordan-waiting-on-legal");
    });

    await test.step("3. Alex, the team's other Approver, sees it waiting on the Legal reviewer and can't decide it", async () => {
      await switchPersona(page, "Alex Kim");
      await page.goto(`/${TEAM}/review/${templateId}/${number}`);
      await expectReviewScreen(page, number);
      await expect(step(page, "done")).toContainText("Jordan Ellis");
      await expect(step(page, "current")).toContainText(STAGE);
      await expect(statusBadge(page)).toHaveText("In review");
      await expect(approveButton(page), "a named stage is the named person's alone").toBeDisabled();
      await expect(step(page, "current")).toContainText(`Waiting on ${STAGE}.`);
      await beat(page, 900);
      await shoot(page, "alex-waiting-on-dana");
    });

    // ── 4. Dana approves stage 2 ─────────────────────────────────────────────

    await test.step("4.1 Dana: the bell and the Review badge hold it, though she is only a Viewer", async () => {
      await switchPersona(page, "Dana Park");
      await page.goto(`/${TEAM}/library`);
      await hydrated(page);
      await expect(reviewBadge(page)).toHaveText("1");
      const popover = await openBell(page);
      const item = popover.getByRole("link", { name: new RegExp(escapeRe(NAME)) }).first();
      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute("data-unread", "true");
      await beat(page, 900);
      await shoot(page, "dana-bell");
      await page.keyboard.press("Escape");
      await expect(popover).toBeHidden();
    });

    await test.step("4.2 She opens it from her queue (her own space's review route) and sees stage 2 of 2", async () => {
      await openQueue(page);
      const row = queueRow(page);
      await expect(row).toBeVisible();
      await click(row);
      await expectReviewScreen(page, number);
      await expect(decision(page)).toContainText("Stage 2 of 2");
      await expect(step(page, "done")).toContainText("Team approver");
      await expect(step(page, "done")).toContainText("Jordan Ellis");
      await expect(step(page, "current")).toContainText(STAGE);
      await expect(approveButton(page)).toBeEnabled();
      await beat(page, 900);
      await shoot(page, "dana-stage-2");
    });

    await test.step("4.3 Approve: the last stage makes it Active, and the go-live moment plays", async () => {
      await click(approveButton(page));
      const dialog = page.getByRole("dialog", { name: `Approve v${number}` });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[data-slot="dialog-description"]')).toContainText(`v${number} becomes Active.`);
      await beat(page, 900);
      await shoot(page, "dana-approve-dialog");

      await click(dialog.getByRole("button", { name: `Approve v${number}`, exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      const moment = page.locator("[data-go-live]");
      await expect(moment, "the go-live moment plays").toBeVisible({ timeout: 10_000 });
      await expect(moment.getByRole("status")).toHaveText(`v${number} is Active`);
      await expect(moment).toHaveCount(0, { timeout: 15_000 });
      await expect(statusBadge(page)).toHaveText("Active");
      await expect(decision(page).locator("[data-decided]")).toHaveText(`You approved v${number}.`);
      await expect(step(page, "done")).toHaveCount(2);
      await expect(approveButton(page)).toHaveCount(0);
      await expect(reviewBadge(page), "her queue is empty again").toHaveCount(0);
      await beat(page, 1200);
      await shoot(page, "dana-approved");
    });

    // ── 5. The trail ─────────────────────────────────────────────────────────

    await test.step("5. The database: both approvals in order, v3 Active, the previous version Superseded", async () => {
      const approvals = await rows("SELECT * FROM approvals WHERE version_id = ? ORDER BY decided_at, stage_position", [versionId]);
      expect(approvals.map((a) => [a.actor_id, a.decision, Number(a.stage_position), a.stage_name])).toEqual([
        ["jordan", "approved", 0, "Team approver"],
        ["dana", "approved", 1, STAGE],
      ]);
      const [version] = await rows("SELECT state, activated_at FROM versions WHERE id = ?", [versionId]);
      expect(version.state).toBe("active");
      expect(version.activated_at).not.toBeNull();
      const [before] = await rows("SELECT state FROM versions WHERE template_id = ? AND number = ?", [templateId, Number(previous.number)]);
      expect(before.state, "the version it replaced").toBe("superseded");
      const audit = await rows("SELECT actor_id, action FROM audit_events WHERE version_id = ? ORDER BY at, id", [versionId]);
      expect(audit.filter((a) => /approved|activated/.test(String(a.action))).map((a) => a.actor_id)).toContain("dana");
    });
  });

  test("nobody approves two stages: with a second Approver stage, Jordan can't approve it too; Alex does and it goes Active", async ({ page }) => {
    test.setTimeout(demoTimeout(180_000));
    const SECOND = "Second approver";

    const [seeded] = await rows(
      `SELECT v.id, v.template_id, v.number FROM versions v JOIN templates t ON t.id = v.template_id
       WHERE t.name = ? AND v.state = 'in_review'`,
      [NAME],
    );
    if (!seeded) throw new Error(`This spec needs the fresh seed (npm run db:reset): ${NAME} in review.`);
    const versionId = String(seeded.id);
    const templateId = String(seeded.template_id);
    const number = Number(seeded.number);

    await test.step("1. Riley adds a second stage that any Approver may decide", async () => {
      await asPersona(page, "riley");
      await openLibrary(page, "all");
      const dialog = await openSettings(page, "Approval chains");
      const chain = dialog.getByRole("region", { name: "Disclosure approval chain" });
      await click(chain.getByRole("button", { name: "Add stage", exact: true }));
      await expect(chain.getByRole("textbox", { name: "Stage name" })).toBeFocused();
      await page.keyboard.type(SECOND, { delay: 40 });
      const consequence = strip(chain);
      await expect(consequence.getByRole("region", { name: "After" }).getByRole("listitem")).toHaveCount(2);
      await beat(page, 900);
      await click(consequence.getByRole("button", { name: `Add ${SECOND} stage`, exact: true }));
      await expect(consequence).toBeHidden({ timeout: 20_000 });
      await expect(chain.getByRole("list", { name: "Disclosure stages" }).getByRole("listitem")).toHaveCount(2);
      await closeSettings(page);
    });

    await test.step("2. Jordan approves stage 1; the version moves on, and he can't approve stage 2", async () => {
      await switchPersona(page, "Jordan Ellis");
      await page.goto(`/${TEAM}/review/${templateId}/${number}`);
      await expectReviewScreen(page, number);
      await expect(decision(page)).toContainText("Stage 1 of 2");
      await click(approveButton(page));
      const dialog = page.getByRole("dialog", { name: `Approve v${number}` });
      await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText(
        `v${number} moves to ${SECOND} for approval. It isn't Active until the last stage approves.`,
      );
      await click(dialog.getByRole("button", { name: `Approve v${number}`, exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(step(page, "done")).toContainText("Jordan Ellis");
      await expect(step(page, "current")).toContainText(SECOND);

      // Opening it again: the second stage is one he could decide by role, but he already approved the first.
      await page.goto(`/${TEAM}/review/${templateId}/${number}`);
      await expectReviewScreen(page, number);
      await expect(step(page, "current")).toContainText(SECOND);
      await expect(approveButton(page)).toBeDisabled();
      await expect(decision(page)).toContainText("You approved an earlier stage.");
      await beat(page, 900);
      await shoot(page, "jordan-approved-an-earlier-stage");
    });

    await test.step("3. Alex, a different Approver, approves stage 2 and the version goes Active", async () => {
      await switchPersona(page, "Alex Kim");
      await page.goto(`/${TEAM}/review/${templateId}/${number}`);
      await expectReviewScreen(page, number);
      await expect(decision(page)).toContainText("Stage 2 of 2");
      await expect(approveButton(page)).toBeEnabled();
      await click(approveButton(page));
      const dialog = page.getByRole("dialog", { name: `Approve v${number}` });
      await expect(dialog.locator('[data-slot="dialog-description"]')).toContainText(`v${number} becomes Active.`);
      await click(dialog.getByRole("button", { name: `Approve v${number}`, exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page.locator("[data-go-live]")).toHaveCount(0, { timeout: 20_000 });
      await expect(statusBadge(page)).toHaveText("Active");
      await expect(step(page, "done")).toHaveCount(2);
      await beat(page, 900);
      await shoot(page, "alex-second-stage-active");

      const approvals = await rows("SELECT actor_id, stage_position, stage_name FROM approvals WHERE version_id = ? ORDER BY stage_position", [versionId]);
      expect(approvals.map((a) => [a.actor_id, Number(a.stage_position), a.stage_name])).toEqual([
        ["jordan", 0, "Team approver"],
        ["alex", 1, SECOND],
      ]);
    });
  });

  test("one person on two stages: the later stage says why, and Save stays disabled until it's fixed", async ({ page }) => {
    test.setTimeout(demoTimeout(120_000));
    const REASON = "Dana Park already reviews stage 2.";
    const chainRows = () => rows("SELECT id, position, name, approver_rule FROM approval_stages WHERE content_type_id = 'ct_disclosure' ORDER BY position");
    const before = await chainRows();

    await asPersona(page, "riley");
    await openLibrary(page, "all");
    const dialog = await openSettings(page, "Approval chains");
    const chain = dialog.getByRole("region", { name: "Disclosure approval chain" });
    const stages = chain.getByRole("list", { name: "Disclosure stages" }).getByRole("listitem");
    const reviewer = chain.getByRole("combobox", { name: "Reviewer" });
    const consequence = strip(chain);
    const save = consequence.getByRole("button", { name: "Save chain", exact: true });

    await test.step("1. Riley adds a Legal reviewer and a Final sign-off stage, both naming Dana Park", async () => {
      for (const name of [STAGE, "Final sign-off"]) {
        await click(chain.getByRole("button", { name: "Add stage", exact: true }));
        await expect(chain.getByRole("textbox", { name: "Stage name" })).toBeFocused();
        await page.keyboard.type(name, { delay: 20 });
        await reviewer.selectOption("user:dana");
        await expect(reviewer).toHaveValue("user:dana");
      }
      await expect(stages).toHaveCount(3);
    });

    await test.step("2. The reason shows at the later stage, and Save is disabled with it beside", async () => {
      await expect(stages.nth(2).locator('[data-problem="reviewer"]')).toHaveText(REASON);
      await expect(reviewer).toHaveAttribute("aria-invalid", "true");
      await expect(stages.nth(1).locator("[data-problem]"), "the first stage naming her is fine").toHaveCount(0);
      await expect(save).toHaveAttribute("aria-disabled", "true");
      await expect(consequence).toContainText(REASON);
      await beat(page, 900);
      await shoot(page, "riley-chain-same-person-twice");

      await click(chain.getByRole("button", { name: "Done", exact: true }));
      await expect(stages.nth(2).locator('[data-problem="reviewer"]'), "still said once the editor closes").toHaveText(REASON);
      await expect(save).toHaveAttribute("aria-disabled", "true");
    });

    await test.step("3. Naming someone else clears it; Discard leaves the saved chain as it was", async () => {
      await click(chain.getByRole("button", { name: "Edit Final sign-off", exact: true }));
      await reviewer.selectOption("user:jordan");
      await expect(chain.locator("[data-problem]")).toHaveCount(0);
      await expect(save).not.toHaveAttribute("aria-disabled", "true");

      await click(consequence.getByRole("button", { name: "Discard", exact: true }));
      await expect(consequence).toBeHidden();
      await expect(stages).toHaveCount(1);
      expect(await chainRows(), "nothing was saved").toEqual(before);
      await closeSettings(page);
    });
  });
});
