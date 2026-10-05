import type { Page } from "@playwright/test";
import { advanceClock, bell, click, openBell, openSettings, personRow, profileButton, resetDemoData, settingsDialog, strip, switchPersona, unreadCount } from "./helpers/access";
import { asPersona, beat, demoTimeout, expect, hydrated, shoot, test, typeSlowly } from "./helpers/scenario";

// Phase 6 gate: demo scenario 8 ("Access"), start to finish from a fresh reset, each person through the
// persona switcher as a presenter would.
//
//   1. Morgan (no team yet) lands on Request access. He asks Coral Offers for Author with a reason; the
//      form is replaced by "Your request for Author access is waiting on Alex Kim." and the sidebar says
//      "Your request is waiting".
//   2. Alex: the sidebar card says access requests are pending and the bell has Morgan's request, unread.
//      The bell item opens Settings > Access requests; Alex approves Morgan as Author.
//   3. Morgan now lands on the Coral Offers Library, and the bell tells him he was approved.
//   4. Alex runs the recertification (the seeded Q4 2026 review, 0 of 6): he keeps everyone but Sam.
//   5. The clock goes 31 days forward (past the review's deadline, 30 days out): the access sweep runs.
//   6. Sam, switched to, has no team: he lands on Request access, and the page says his access lapsed in the
//      access review.
//   7. Alex's Members shows Sam lapsed (and Devon, idle for 120 days, auto-suspended), the review is closed
//      with Sam lapsed, and Inactivity lists Devon under Suspended.
//
// It advances the demo clock and changes people's access, so afterAll re-seeds the database (which also
// puts the clock back). Console and page errors fail it.

const TEAM = "coral-offers";
const REASON = "I'm joining the spring campaign and need to draft its offer terms.";
/** Everyone the seeded review asks about, except Sam. */
const KEEP = ["jordan", "maya", "priya", "devon", "dana"] as const;

test.afterAll(() => {
  test.setTimeout(90_000);
  resetDemoData();
});

const card = (page: Page) => page.locator('[data-slot="sidebar-card"]').filter({ visible: true });

test.describe("scenario 8: access", () => {
  test("Morgan requests Author and Alex approves; Alex recertifies leaving Sam out; 31 days later Sam has lapsed and Devon is suspended", async ({ page }) => {
    test.setTimeout(demoTimeout(300_000));

    let unreadBefore = 0;

    // ── 1. Morgan asks ───────────────────────────────────────────────────────

    await asPersona(page, "morgan");
    await page.goto("/");
    await expect(page).toHaveURL(/\/request-access$/);
    await expect(page.getByRole("heading", { level: 1, name: /Request access/ })).toBeVisible();
    await hydrated(page);
    await beat(page, 900);

    await test.step("1.1 Morgan sees every team with its Team Admin, and asks Coral Offers", async () => {
      const coral = page.locator(`section[data-team="${TEAM}"]`);
      await expect(coral).toContainText("Coral Offers");
      await expect(coral).toContainText("Team Admin: Alex Kim");
      await expect(page.locator("section[data-team]")).toHaveCount(3);
      await shoot(page, "morgan-request-access");

      const form = coral.getByRole("form", { name: "Request access to Coral Offers" });
      // The cards hydrate a moment after the shell does, and a press before that does nothing: press again.
      await expect(async () => {
        if (!(await form.isVisible())) await click(coral.getByRole("button", { name: "Request access", exact: true }));
        await expect(form).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
      await click(form.getByRole("radio", { name: "Author", exact: true }));
      await expect(form.getByRole("radio", { name: "Author", exact: true })).toBeChecked();
      const send = form.getByRole("button", { name: "Send request", exact: true });
      await click(form.getByRole("textbox", { name: "Reason" }));
      await typeSlowly(page, REASON);
      await expect(form.getByRole("textbox", { name: "Reason" })).toHaveValue(REASON);
      await expect(form).toContainText("Alex Kim, Team Admin of Coral Offers, will decide.");
      await beat(page, 900);
      await shoot(page, "morgan-request-form");

      await click(send);
      const status = coral.locator('[data-slot="request-status"]');
      await expect(status).toBeVisible({ timeout: 20_000 });
      await expect(status).toContainText("Your request for Author access is waiting on Alex Kim.");
      await expect(form, "the pending note replaces the form").toBeHidden();
      await expect(coral.getByRole("button", { name: "Request access", exact: true })).toHaveCount(0);
      await expect(card(page)).toContainText("Your request is waiting");
      await beat(page, 900);
      await shoot(page, "morgan-request-waiting");
    });

    // ── 2. Alex approves ─────────────────────────────────────────────────────

    await test.step("2.1 Alex: the sidebar card and the bell both say Morgan asked", async () => {
      await switchPersona(page, "Alex Kim");
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/library$`));
      await hydrated(page);
      await expect(card(page)).toContainText(/Access requests? pending/);
      // Its Review action is a link (Base UI gives such a link role "button"), to where requests are decided.
      await expect(card(page).locator(`a[href="/${TEAM}/settings/access-requests"]`)).toHaveText("Review");
      expect(await unreadCount(page), "Morgan's request is unread").toBeGreaterThanOrEqual(1);
      await expect(page.locator('[data-slot="unread-dot"]')).toBeVisible();
      await beat(page, 900);
      await shoot(page, "alex-card-and-bell");

      const popover = await openBell(page);
      const item = popover.getByRole("link", { name: /Morgan Lee asked for Author access to Coral Offers\./ });
      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute("data-unread", "true");
      await expect(popover.getByRole("button", { name: "Mark all as read" })).toBeVisible();
      await beat(page, 900);
      await shoot(page, "alex-bell-open");

      // The item opens the request where it is decided, and counts as read.
      unreadBefore = await unreadCount(page);
      await click(item);
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/settings/access-requests$`));
      await expect(settingsDialog(page)).toBeVisible();
    });

    await test.step("2.2 Alex approves Morgan as Author; the request moves to Decided", async () => {
      const dialog = settingsDialog(page);
      const row = personRow(dialog, "morgan");
      await expect(row).toBeVisible();
      await expect(row).toContainText("Author");
      await expect(row).toContainText(REASON);
      await expect(personRow(dialog, "chris"), "the seeded request is still waiting").toBeVisible();
      await beat(page, 900);

      await click(row.getByRole("button", { name: "Approve", exact: true }));
      const consequence = strip(dialog);
      await expect(consequence).toContainText("Morgan Lee gets Author access to Coral Offers");
      await beat(page, 900);
      await shoot(page, "alex-approve-strip");
      await click(consequence.getByRole("button", { name: "Approve as Author", exact: true }));
      await expect(consequence).toBeHidden({ timeout: 20_000 });

      const decided = dialog.getByRole("table", { name: "Decided requests" });
      await expect(decided).toBeVisible({ timeout: 20_000 });
      await expect(decided.getByRole("row").filter({ hasText: "Morgan Lee" })).toContainText("Approved by Alex Kim");
      await expect(dialog.getByRole("table", { name: "Requester" }).getByRole("row").filter({ hasText: "Morgan Lee" })).toHaveCount(0);
      await beat(page, 900);
      await shoot(page, "alex-approved");

      // Behind the modal the bell has one fewer unread: the item he opened is read.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect.poll(() => unreadCount(page), { message: "opening the bell item marked it read" }).toBe(unreadBefore - 1);
    });

    // ── 3. Morgan sees the Library ───────────────────────────────────────────

    await test.step("3. Morgan now lands on the Coral Offers Library, and the bell says he was approved", async () => {
      await switchPersona(page, "Morgan Lee");
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/library$`));
      await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Switch team" })).toContainText("Coral Offers");
      await expect(page.getByRole("button", { name: "New template" }), "an Author can start a template").toBeVisible();
      await hydrated(page);
      await beat(page, 900);
      const popover = await openBell(page);
      await expect(popover.getByRole("link", { name: /Alex Kim approved your Author access to Coral Offers\./ })).toBeVisible();
      await beat(page, 900);
      await shoot(page, "morgan-library");
      await page.keyboard.press("Escape");
      await expect(popover).toBeHidden();
    });

    // ── 4. Alex recertifies, leaving Sam out ─────────────────────────────────

    await test.step("4. Alex keeps everyone in the access review but Sam", async () => {
      await switchPersona(page, "Alex Kim");
      await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
      await expect(page.locator("main ul > li > a[href*='/templates/']").filter({ visible: true }).first()).toBeVisible();
      await hydrated(page);
      const dialog = await openSettings(page, /^Recertification/);
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/settings/recertification$`));
      const summary = dialog.locator('[data-slot="recert-summary"]');
      await expect(summary).toContainText("0 of 6");
      await expect(summary).toContainText("Anyone not confirmed by");
      await expect(dialog.getByRole("table", { name: "Member" }).locator("[role=row][data-person]")).toHaveCount(6);
      await beat(page, 900);
      await shoot(page, "alex-recert-start");

      let kept = 0;
      for (const id of KEEP) {
        const row = personRow(dialog, id);
        await click(row.getByRole("button", { name: "Keep", exact: true }));
        kept++;
        await expect(summary).toContainText(`${kept} of 6`, { timeout: 20_000 });
        await expect(row).toContainText("Kept");
      }
      const sam = personRow(dialog, "sam");
      await expect(sam.getByRole("button", { name: "Keep", exact: true }), "Sam is still undecided").toBeVisible();
      await expect(sam.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
      await expect(summary).toContainText("5 of 6");
      await beat(page, 900);
      await shoot(page, "alex-recert-sam-undecided");
    });

    // ── 5. The deadline passes ───────────────────────────────────────────────

    await test.step("5. The clock goes 31 days forward, past the review's deadline", async () => {
      await page.keyboard.press("Escape");
      await expect(settingsDialog(page)).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/library$`));
      await beat(page);
      await advanceClock(page, 31);
      await beat(page, 900);
    });

    // ── 6. Sam has lapsed ────────────────────────────────────────────────────

    await test.step("6. Sam loses access: he lands on Request access, and it says why", async () => {
      await switchPersona(page, "Sam Ortiz");
      await expect(page).toHaveURL(/\/request-access$/);
      await expect(page.getByText(/^Your access to Coral Offers lapsed on .+: it wasn't confirmed in the access review\.$/)).toBeVisible();
      // He can ask again.
      await expect(page.locator(`section[data-team="${TEAM}"]`).getByRole("button", { name: "Request access", exact: true })).toBeVisible();
      await expect(page.locator("section[data-team]").first()).toBeVisible();
      await beat(page, 900);
      await shoot(page, "sam-lapsed");
      await click(profileButton(page));
      await expect(page.getByRole("menuitem", { name: "Request access" })).toBeVisible();
      await page.keyboard.press("Escape");
    });

    // ── 7. Alex sees what the clock did ──────────────────────────────────────

    await test.step("7. Alex's Members shows Sam lapsed and Devon suspended; the review closed with Sam lapsed", async () => {
      await switchPersona(page, "Alex Kim");
      await expect(page).toHaveURL(/\/request-access$|\/coral-offers\//);
      await page.goto(`/${TEAM}/library`);
      await hydrated(page);
      // Alex has not signed in for 31 days, but he did just now (the persona switch is the sign-in).
      const dialog = await openSettings(page, /^Members/);
      const sam = personRow(dialog, "sam");
      await expect(sam).toContainText("Sam Ortiz");
      await expect(sam).toContainText(/Access lapsed/);
      await expect(sam.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
      const devon = personRow(dialog, "devon");
      await expect(devon).toContainText(/Auto-suspended/);
      await expect(devon.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
      // Everyone he kept, and Morgan, is still active.
      for (const id of [...KEEP.filter((id) => id !== "devon"), "morgan"]) {
        await expect(personRow(dialog, id).getByRole("button", { name: "Edit roles", exact: true }), `${id} is still active`).toBeVisible();
      }
      // Alex's own row is active too (and says he can't change his own access).
      await expect(personRow(dialog, "alex")).toContainText("You can't change your own access.");
      await expect(personRow(dialog, "alex")).not.toContainText(/lapsed|suspended/i);
      await beat(page, 900);
      await shoot(page, "alex-members-after");

      await click(dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Recertification/ }));
      const summary = dialog.locator('[data-slot="recert-summary"]');
      await expect(summary).toContainText(/Access lapsed on .+ for Sam Ortiz\./);
      await expect(personRow(dialog, "sam")).toContainText(/Access lapsed/);
      await beat(page, 900);
      await shoot(page, "alex-recert-closed");

      await click(dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /^Inactivity/ }));
      const suspended = dialog.getByRole("table", { name: "Suspended members" });
      await expect(suspended).toBeVisible();
      await expect(personRow(suspended, "devon")).toContainText("Automatically");
      await beat(page, 900);
      await shoot(page, "alex-inactivity-suspended");

      // The bell holds the sweep's news, dated by the boundaries it crossed.
      await page.keyboard.press("Escape");
      await expect(settingsDialog(page)).toBeHidden();
      await expect(bell(page)).toBeVisible();
    });
  });
});
