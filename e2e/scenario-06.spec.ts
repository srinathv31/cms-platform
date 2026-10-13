import type { Locator, Page } from "@playwright/test";
import {
  correlation,
  expectError,
  longDate,
  pick,
  render,
  validValues,
  type SeedVersion,
} from "./api/helpers";
import {
  CUSTOMERS,
  backToUcomp,
  dropDemoNoise,
  expectFailed,
  openOffer,
  openOfferTab,
  openSimulator,
  resultsHeadline,
  selectCustomers,
  send,
} from "./helpers/golive";
import {
  asPersona,
  beat,
  demoTimeout,
  expect,
  hydrated,
  openLibrary,
  shoot,
  tap,
  test,
  typeSlowly,
  untilUncovered,
} from "./helpers/scenario";
import {
  Changes,
  allVersions,
  approversOf,
  auditEvents,
  consumerNotices,
  demoNow,
  notificationsAbout,
  renderLogFor,
  simDeliveries,
  teamIdOf,
  versionById,
} from "./helpers/state";

// Phase 4 gate: demo scenario 6 ("Revoke"), all of it that exists in this phase.
//
//   1. Before: Balance Transfer Intro v1 is Superseded, and Coral still renders it (200, with the
//      newer-version header naming v2).
//   2. Jordan (approver) opens the template's Versions tab and starts a revoke on v1 with a reason. The
//      version shows the pending revoke and its reason, and Confirm revoke is disabled for him, with
//      "You started this revoke. Another approver must confirm it." Nothing stops rendering yet.
//   3. Alex (switched to in the persona switcher, as a presenter would) sees the same revoke with Confirm
//      revoke enabled, and confirms it. v1 shows Revoked.
//   4. After: Coral's render of v1 is a 410 version_revoked with the message and the date from the demo
//      clock; v2 still renders.
//   5. The Activity tab shows both steps, by their people, with the reason.
//   6. The database holds the trail: a `revoked` notice for Coral on v1, the notifications (the confirm
//      request to the approvers other than Jordan; the revoked notice to the people who need it), and the
//      audit events `version.revoke_started` and `version.revoked`.
//
// Phase 5 added the simulator's send failure (step 4b): after the revoke, Coral's send on the Balance Transfer
// offer (linked to v1) fails at once in the simulator, with the revoke message shown verbatim. Phase 6 adds the
// Audit page; until then this spec proves the revoke through the Activity tab, the render API and the simulator
// (docs/archive/implementation-plan.md, Phase 4).
//
// Runs from a fresh reset. It REVOKES the seeded v1, so `Changes` remembers what it changes and puts it back in
// afterAll (the versions, the audit events, notifications and consumer notices it wrote for this template, its own
// render_log rows, and what Coral's send wrote: the deliveries, the render_log rows they made and the reads of
// notices): the gate-media run plays the spec twice against one database, and the dev database is shared.
// Console and page errors fail it.

// The preview frames and the customer views are sandboxed; Playwright's trace injects scripts into them.
test.use({ trace: "off" });

const TEAM = "coral-offers";
const NAME = "Balance Transfer Intro — Terms";
const OFFER = "offer_balance_transfer";
const OFFER_NAME = "Balance Transfer Intro";
const REASON = "Wrong intro APR in the legal notices.";
const OWN_REVOKE = "You started this revoke. Another approver must confirm it.";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── What the run changes ─────────────────────────────────────────────────────

const changes = new Changes();

/** What the template had before the run: the steps read only what the revoke wrote since. */
interface Before {
  v2Rev: number;
  audit: Set<string>;
  notifications: Set<string>;
  notices: Set<string>;
  deliveries: Set<string>;
}

let v1: SeedVersion;
let v2: SeedVersion;
let before: Before;
let approvers: string[];

test.beforeAll(async () => {
  const all = await allVersions();
  const find = (number: number) =>
    pick(
      all,
      `${NAME} v${number}`,
      (v) => v.templateName === NAME && v.number === number,
    );
  v1 = find(1);
  v2 = find(2);

  const v1Row = await versionById(v1.id);
  const v2Row = await versionById(v2.id);
  const ready = `from a fresh seed (npm run db:reset): ${NAME} v1 Superseded with no revoke, v2 Active`;
  if (
    v1.state !== "superseded" ||
    v1Row?.revoke !== null ||
    v2.state !== "active"
  ) {
    throw new Error(
      `This scenario needs ${ready}. v1 is ${v1.state}${v1Row?.revoke !== null ? " with a revoke on it" : ""}, v2 is ${v2.state}.`,
    );
  }

  // Registered before Coral's, so it is put back after it: Coral's reads of notices point at the notices the
  // template's undo removes. The test doesn't move the demo clock, so there is no `watchClock`.
  await changes.watchTemplate(v1.templateId);
  await changes.watchSimulator({
    offers: [OFFER],
    noticeTemplates: [v1.templateId],
  });

  before = {
    v2Rev: v2Row!.rev,
    audit: new Set(
      (await auditEvents({ templateId: v1.templateId })).map((e) => e.id),
    ),
    notifications: new Set(
      (await notificationsAbout(v1.templateId)).map((n) => n.id),
    ),
    notices: new Set(
      (await consumerNotices({ templateId: v1.templateId })).map((n) => n.id),
    ),
    deliveries: new Set(
      (await simDeliveries({ offerId: OFFER })).map((d) => d.id),
    ),
  };
  approvers = await approversOf(v1.teamId);
});

test.afterEach(({ problems }) => dropDemoNoise(problems));

test.afterAll(() => changes.undo());

// ── The render API ───────────────────────────────────────────────────────────

/** A render of one version as Coral, the way its send service would call it (never a preview). */
function renderAs(
  request: Parameters<typeof render>[0],
  version: SeedVersion,
  label: string,
) {
  const channel = version.channels.includes("web")
    ? "web"
    : version.channels[0];
  return render(request, {
    templateId: version.templateId,
    consumer: "coral",
    correlationId: correlation(label),
    body: {
      version: version.number,
      channel,
      values: validValues(version.variables),
    },
  });
}

// ── The screens ──────────────────────────────────────────────────────────────

const versionEntry = (page: Page, number: number): Locator =>
  page
    .locator(`[data-slot="version-entry"][data-version="${number}"]`)
    .filter({ visible: true });

const revokeBlock = (entry: Locator): Locator =>
  entry.locator('[data-slot="revoke"]');

/** A counted-free, human-paced click, once the page has stopped moving under the target. */
async function press(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await untilUncovered(target);
  await tap(target);
}

const profileButton = (page: Page) =>
  page.getByRole("button", { name: /profile and persona/ });
const templateTab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Template" })
    .getByRole("link", { name });

/** Through the persona switcher, as a presenter would: the URL stays, the page re-reads as the new person. */
async function switchPersona(page: Page, person: string) {
  const url = page.url();
  await press(profileButton(page));
  await press(
    page.getByRole("menuitemradio", { name: new RegExp(escapeRe(person)) }),
  );
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(profileButton(page)).toHaveAccessibleName(
    new RegExp(`^${escapeRe(person)},`),
  );
  await expect(page).toHaveURL(url);
}

/** For a still: the entry's whole block is on screen, whatever the scroll position. */
async function show(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await beat(target.page(), 300);
}

test.describe("scenario 6: revoke", () => {
  test("Jordan starts revoking Balance Transfer v1 and can't confirm it; Alex confirms; Coral's renders of v1 fail at once", async ({
    page,
    request,
  }) => {
    test.setTimeout(demoTimeout(120_000));
    let confirmedDay = "";
    const dayBefore: string[] = [];

    // ── 1. Before ────────────────────────────────────────────────────────────

    await test.step("1. Before: Coral renders v1 (200, newer version 2); v1 is Superseded", async () => {
      const { res, correlationId } = await renderAs(
        request,
        v1,
        "scenario06-before",
      );
      expect(res.status(), "Coral renders the Superseded v1").toBe(200);
      expect(res.headers()["x-stencil-version"]).toBe("1");
      expect(
        res.headers()["x-stencil-newer-version"],
        "the header names the Active version",
      ).toBe("2");
      const [logged] = await renderLogFor(correlationId!);
      expect(logged).toMatchObject({
        consumerId: "coral",
        versionNumber: 1,
        isPreview: false,
        outcome: "ok",
        errorCode: null,
      });
    });

    // ── 2. Jordan starts the revoke ──────────────────────────────────────────

    await asPersona(page, "jordan");
    await openLibrary(page, TEAM);
    await beat(page, 900);

    await test.step("2.1 Jordan opens Balance Transfer's Versions tab: v1 Superseded, v2 Active", async () => {
      await press(
        page
          .getByRole("main")
          .getByRole("link", { name: new RegExp(`^${escapeRe(NAME)}`) }),
      );
      await expect(
        page.getByRole("heading", { level: 1, name: NAME }),
      ).toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`/${TEAM}/templates/${v1.templateId}$`),
      );
      await hydrated(page);
      await beat(page);

      await press(templateTab(page, "Versions"));
      // The first visit to a route can take a while to compile on a dev server.
      await expect(page).toHaveURL(
        new RegExp(`/templates/${v1.templateId}/versions$`),
        { timeout: 30_000 },
      );

      const first = versionEntry(page, 1);
      const second = versionEntry(page, 2);
      await expect(first).toBeVisible();
      await expect(first).toHaveAttribute("data-state", "superseded");
      await expect(first.locator("[data-status]")).toContainText("Superseded");
      await expect(second).toHaveAttribute("data-state", "active");
      await expect(second.locator("[data-status]")).toContainText("Active");
      await expect(revokeBlock(first), "no revoke on v1 yet").toHaveCount(0);
      await expect(
        first.getByRole("button", { name: "Revoke v1", exact: true }),
        "Jordan may revoke a Superseded version",
      ).toBeVisible();
      await beat(page, 900);
      await show(first);
      await shoot(page, "versions-before");
    });

    await test.step("2.2 Start revoke on v1: the dialog says what happens, wants a reason, and starts it", async () => {
      const first = versionEntry(page, 1);
      await press(
        first.getByRole("button", { name: "Revoke v1", exact: true }),
      );

      const dialog = page.getByRole("dialog", { name: "Revoke v1" });
      await expect(dialog).toBeVisible();
      const reason = dialog.getByLabel("Reason");
      await expect(reason, "the reason has the focus").toBeFocused();
      const start = dialog.getByRole("button", {
        name: "Start revoke",
        exact: true,
      });
      await expect(start, "no reason, no revoke").toBeDisabled();
      await expect(
        dialog,
        "starting only asks for a confirmation",
      ).toContainText(
        "Another approver must confirm before this takes effect.",
      );
      await expect(dialog.locator('[data-slot="consequences"]')).toContainText(
        /^Coral .*v1.*Once confirmed, its renders will fail immediately\./,
      );
      await beat(page);

      await typeSlowly(page, REASON);
      await expect(reason).toHaveValue(REASON);
      await expect(start).toBeEnabled();
      await beat(page, 900);
      await shoot(page, "revoke-dialog");

      await press(start);
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await test.step("2.3 The version shows the pending revoke with the reason; Confirm is disabled for Jordan", async () => {
      const first = versionEntry(page, 1);
      const block = revokeBlock(first);
      await expect(block).toBeVisible({ timeout: 20_000 });
      await expect(block).toHaveAttribute("data-pending", "");
      await expect(block).toContainText(
        `Revoke started by Jordan Ellis: “${REASON}”`,
      );
      await expect(
        first,
        "still Superseded: nothing stops rendering until a second approver confirms",
      ).toHaveAttribute("data-state", "superseded");
      await expect(first.locator("[data-status]")).toContainText("Superseded");

      const confirm = block.getByRole("button", {
        name: "Confirm revoke",
        exact: true,
      });
      await expect(confirm).toBeVisible();
      await expect(
        confirm,
        "Jordan can't confirm his own revoke",
      ).toBeDisabled();
      await expect(block.getByText(OWN_REVOKE)).toBeVisible();
      await expect(confirm).toHaveAccessibleDescription(OWN_REVOKE);
      await expect(
        block.getByRole("button", { name: "Withdraw revoke", exact: true }),
        "he may withdraw it",
      ).toBeEnabled();
      await expect(
        first.getByRole("button", { name: "Revoke v1", exact: true }),
        "no second revoke while one is pending",
      ).toHaveCount(0);
      await beat(page, 900);
      await show(block);
      await shoot(page, "pending-as-starter");
    });

    await test.step("2.4 Nothing has changed for Coral yet: the version row, the audit event, the confirm request", async () => {
      const row = await versionById(v1.id);
      expect(row!.state).toBe("superseded");
      expect(row!.revoke).toMatchObject({
        reason: REASON,
        startedBy: "jordan",
      });
      expect(row!.revoke!.confirmedAt, "not confirmed").toBeUndefined();

      const audit = (await auditEvents({ templateId: v1.templateId })).filter(
        (e) => !before.audit.has(e.id),
      );
      expect(audit.map((e) => e.action)).toEqual(["version.revoke_started"]);
      expect(audit[0]).toMatchObject({
        actorId: "jordan",
        teamId: await teamIdOf(TEAM),
        templateId: v1.templateId,
        versionId: v1.id,
      });
      expect(audit[0].details).toMatchObject({
        number: 1,
        reason: REASON,
      });

      const fresh = (await notificationsAbout(v1.templateId)).filter(
        (n) => !before.notifications.has(n.id),
      );
      expect(
        fresh.map((n) => n.kind),
        "one confirm request each",
      ).toEqual(
        approvers.filter((id) => id !== "jordan").map(() => "revoke_started"),
      );
      expect(
        fresh.map((n) => n.userId).sort(),
        "to the approvers other than Jordan",
      ).toEqual(approvers.filter((id) => id !== "jordan"));
      for (const note of fresh) {
        expect(note).toMatchObject({
          teamId: v1.teamId,
          title: `Jordan Ellis started revoking ${NAME} v1. Confirm or cancel.`,
          body: REASON,
          href: `/${TEAM}/templates/${v1.templateId}/versions`,
          readAt: null,
        });
      }

      const notices = (
        await consumerNotices({ templateId: v1.templateId })
      ).filter((n) => !before.notices.has(n.id));
      expect(
        notices,
        "consumers are told when it is confirmed, not before",
      ).toEqual([]);

      const { res } = await renderAs(request, v1, "scenario06-pending");
      expect(
        res.status(),
        "Coral still renders v1 while the revoke waits",
      ).toBe(200);
    });

    // ── 3. Alex confirms ─────────────────────────────────────────────────────

    await test.step("3.1 Switch to Alex: the same revoke, and Confirm revoke is his to press", async () => {
      await beat(page);
      await switchPersona(page, "Alex Kim");
      const first = versionEntry(page, 1);
      const block = revokeBlock(first);
      await expect(block).toContainText(
        `Revoke started by Jordan Ellis: “${REASON}”`,
      );
      const confirm = block.getByRole("button", {
        name: "Confirm revoke",
        exact: true,
      });
      await expect(confirm, "a different approver").toBeEnabled();
      await expect(block.getByText(OWN_REVOKE)).toHaveCount(0);
      await expect(
        block.getByRole("button", { name: "Withdraw revoke", exact: true }),
      ).toBeEnabled();
      await beat(page, 900);
      await show(block);
      await shoot(page, "pending-as-confirmer");
    });

    await test.step("3.2 Alex confirms: v1 shows Revoked", async () => {
      const first = versionEntry(page, 1);
      await press(
        revokeBlock(first).getByRole("button", {
          name: "Confirm revoke",
          exact: true,
        }),
      );

      const dialog = page.getByRole("dialog", { name: "Confirm revoke of v1" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(
        `Jordan Ellis started this revoke: “${REASON}”`,
      );
      await expect(dialog.locator('[data-slot="consequences"]')).toContainText(
        /^Coral .*v1.*Its renders will fail immediately\./,
      );
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
        "the safe action has the focus",
      ).toBeFocused();
      await beat(page, 900);

      dayBefore.push(longDate(await demoNow()));
      await press(
        dialog.getByRole("button", { name: "Confirm revoke", exact: true }),
      );
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      dayBefore.push(longDate(await demoNow()));

      await expect(first).toHaveAttribute("data-state", "revoked", {
        timeout: 20_000,
      });
      await expect(first.locator("[data-status]")).toHaveText("Revoked");
      const block = revokeBlock(first);
      await expect(
        block,
        "the revoke is final: no longer pending",
      ).not.toHaveAttribute("data-pending", "");
      await expect(block).toContainText(
        new RegExp(`^Revoked .+: “${escapeRe(REASON)}”`),
      );
      await expect(block).toContainText(
        "Started by Jordan Ellis, confirmed by Alex Kim.",
      );
      await expect(
        first.getByRole("button"),
        "nothing left to do on a revoked version",
      ).toHaveCount(0);
      await expect(versionEntry(page, 2), "v2 is untouched").toHaveAttribute(
        "data-state",
        "active",
      );
      await beat(page, 900);
      await show(first);
      await shoot(page, "revoked");
    });

    // ── 4. After: the render API ─────────────────────────────────────────────

    await test.step("4. After: Coral's render of v1 is 410 version_revoked with the date; v2 still renders", async () => {
      const row = await versionById(v1.id);
      expect(row!.state).toBe("revoked");
      const revoke = row!.revoke!;
      expect(revoke).toMatchObject({
        reason: REASON,
        startedBy: "jordan",
        confirmedBy: "alex",
      });
      expect(
        revoke.confirmedAt,
        "a confirmed revoke has its time",
      ).toBeTruthy();
      confirmedDay = longDate(revoke.confirmedAt!);
      expect(dayBefore, "the date is the demo clock's day").toContain(
        confirmedDay,
      );

      const { res, correlationId } = await renderAs(
        request,
        v1,
        "scenario06-after",
      );
      const error = await expectError(
        res,
        410,
        "version_revoked",
        `Version 1 was revoked on ${confirmedDay}. Version 2 is active.`,
      );
      expect(error.details).toEqual({
        version: 1,
        activeVersion: 2,
        at: new Date(revoke.confirmedAt!).toISOString(),
      });
      const [logged] = await renderLogFor(correlationId!);
      expect(logged).toMatchObject({
        consumerId: "coral",
        versionNumber: 1,
        isPreview: false,
        errorCode: "version_revoked",
      });
      expect(logged.outcome).not.toBe("ok");

      const active = await renderAs(request, v2, "scenario06-v2");
      expect(active.res.status(), "v2 is unaffected").toBe(200);
      expect(active.res.headers()["x-stencil-version"]).toBe("2");
      expect(
        active.res.headers()["x-stencil-newer-version"],
        "v2 is the newest",
      ).toBeUndefined();
    });

    // ── 4b. After: Coral's send in the simulator ─────────────────────────────

    await test.step("4b. In the simulator, Coral's send on the offer fails at once, with the revoke message verbatim", async () => {
      await beat(page);
      await openSimulator(page);
      const offerRow = page
        .getByRole("table", { name: "Offers" })
        .getByRole("row")
        .filter({
          has: page.getByRole("link", { name: OFFER_NAME, exact: true }),
        });
      await expect(offerRow).toContainText("Revoked");
      await beat(page, 900);
      await shoot(page, "simulator-offers-revoked");

      await openOffer(page, OFFER_NAME);
      await expect(page.getByText("A send now fails.")).toBeVisible();
      await expect(page.getByText(/v1 was revoked on /)).toBeVisible();
      await beat(page, 900);
      await shoot(page, "simulator-offer-revoked");

      await openOfferTab(page, "Send");
      await expect(
        page.getByRole("table", { name: "Customers" }),
      ).toBeVisible();
      await selectCustomers(page, [CUSTOMERS.olivia, CUSTOMERS.marcus]);
      await beat(page, 500);
      await send(page);

      // Two customers on the offer's two channels (PDF and Web): four renders, none delivered.
      await expect(resultsHeadline(page)).toHaveText("0 delivered, 4 failed", {
        timeout: 60_000,
      });
      const message = `Version 1 was revoked on ${confirmedDay}. Version 2 is active.`;
      await expectFailed(page, 4, {
        status: 410,
        code: "version_revoked",
        message,
      });
      await beat(page, 900);
      await resultsHeadline(page).scrollIntoViewIfNeeded();
      await shoot(page, "simulator-send-revoked");

      // Coral stored the API's words as received, and UCOMP logged the refusals under Coral's id.
      const deliveries = (await simDeliveries({ offerId: OFFER })).filter(
        (d) => !before.deliveries.has(d.id),
      );
      expect(deliveries).toHaveLength(4);
      for (const delivery of deliveries) {
        expect(delivery).toMatchObject({
          status: "failed",
          templateId: v1.templateId,
          versionNumber: 1,
          output: null,
        });
        expect(delivery.error).toEqual({
          status: 410,
          code: "version_revoked",
          message,
        });
        const [logged] = await renderLogFor(delivery.correlationId);
        expect(logged).toMatchObject({
          consumerId: "coral",
          versionNumber: 1,
          isPreview: false,
          errorCode: "version_revoked",
        });
      }

      // Back to UCOMP, on the template Alex was looking at.
      await backToUcomp(page);
      await page.goto(`/${TEAM}/templates/${v1.templateId}/versions`);
      await expect(
        page.getByRole("heading", { level: 1, name: NAME }),
      ).toBeVisible();
      await hydrated(page);
      await expect(versionEntry(page, 1)).toHaveAttribute(
        "data-state",
        "revoked",
      );
    });

    // ── 5. The Activity tab ──────────────────────────────────────────────────

    await test.step("5. The Activity tab shows both steps, by Jordan Ellis and Alex Kim, with the reason", async () => {
      await press(templateTab(page, "Activity"));
      await expect(page).toHaveURL(
        new RegExp(`/templates/${v1.templateId}/activity$`),
      );

      const activity = page
        .locator('[data-slot="activity"]')
        .filter({ visible: true });
      const started = activity
        .locator("li")
        .filter({ hasText: `Jordan Ellis started revoking v1: ${REASON}` });
      const revoked = activity
        .locator("li")
        .filter({ hasText: `Alex Kim confirmed the revoke of v1: ${REASON}` });
      await expect(started).toHaveCount(1);
      await expect(revoked).toHaveCount(1);
      await expect(started.locator("span", { hasText: /^v1$/ })).toBeVisible();
      await expect(revoked.locator("span", { hasText: /^v1$/ })).toBeVisible();
      await expect(started.locator("time")).toBeVisible();
      await expect(revoked.locator("time")).toBeVisible();

      // Newest first: the confirmation sits above the start.
      const lines = await activity.locator("li").allInnerTexts();
      const at = (needle: string) =>
        lines.findIndex((line) => line.includes(needle));
      expect(at("Alex Kim confirmed the revoke of v1")).toBeGreaterThanOrEqual(
        0,
      );
      expect(
        at("Alex Kim confirmed the revoke of v1"),
        "newest first",
      ).toBeLessThan(at("Jordan Ellis started revoking v1"));
      // Both are today's, so they share a day group.
      const day = activity
        .locator('[data-slot="activity-day"]')
        .filter({
          has: page.locator("li", {
            hasText: `Jordan Ellis started revoking v1: ${REASON}`,
          }),
        })
        .filter({
          has: page.locator("li", {
            hasText: `Alex Kim confirmed the revoke of v1: ${REASON}`,
          }),
        });
      await expect(day).toHaveCount(1);
      await beat(page, 900);
      await shoot(page, "activity");
    });

    // ── 6. The trail in the database ─────────────────────────────────────────

    await test.step("6. consumer_notices, notifications and audit_events hold the whole revoke", async () => {
      // audit_events: both steps, in order, by who did them.
      const audit = (await auditEvents({ templateId: v1.templateId })).filter(
        (e) => !before.audit.has(e.id),
      );
      expect(audit.map((e) => e.action)).toEqual([
        "version.revoke_started",
        "version.revoked",
      ]);
      expect(audit.map((e) => e.actorId)).toEqual(["jordan", "alex"]);
      for (const event of audit)
        expect(event).toMatchObject({
          teamId: v1.teamId,
          templateId: v1.templateId,
          versionId: v1.id,
        });
      expect(audit[0].details).toMatchObject({
        number: 1,
        reason: REASON,
      });
      expect(audit[1].details).toMatchObject({
        number: 1,
        reason: REASON,
        startedBy: "jordan",
        wasActive: false,
      });
      expect(audit[1].at).toBeGreaterThanOrEqual(audit[0].at);

      // consumer_notices: Coral is told v1 was revoked, and that v2 is the one to use.
      const notices = (
        await consumerNotices({ templateId: v1.templateId })
      ).filter((n) => !before.notices.has(n.id));
      expect(notices.length, "at least Coral").toBeGreaterThanOrEqual(1);
      for (const notice of notices)
        expect(notice).toMatchObject({ kind: "revoked", versionId: v1.id });
      const forCoral = notices.filter((n) => n.consumerId === "coral");
      expect(forCoral, "one revoked notice for Coral on v1").toHaveLength(1);
      expect(forCoral[0].payload).toEqual({
        templateName: NAME,
        versionNumber: 1,
        activeVersion: 2,
        reason: REASON,
      });

      // notifications: the confirm request went to the approvers other than Jordan (checked at step 2.4);
      // the revoked notice goes to the other approvers (Jordan) and whoever submitted v1, never to Alex.
      const submitter = (await versionById(v1.id))!.submittedBy;
      const told = new Set(approvers.filter((id) => id !== "alex"));
      if (submitter && submitter !== "alex") told.add(submitter);
      const fresh = (await notificationsAbout(v1.templateId)).filter(
        (n) => !before.notifications.has(n.id),
      );
      const started = fresh.filter((n) => n.kind === "revoke_started");
      const revoked = fresh.filter((n) => n.kind === "version_revoked");
      expect(fresh.length, "nothing else was sent").toBe(
        started.length + revoked.length,
      );
      expect(
        started.map((n) => n.userId).sort(),
        "the confirm request: not to Jordan",
      ).toEqual(approvers.filter((id) => id !== "jordan"));
      expect(
        revoked.map((n) => n.userId).sort(),
        "the revoked notice: not to Alex",
      ).toEqual([...told].sort());
      for (const note of revoked) {
        expect(note).toMatchObject({
          teamId: v1.teamId,
          title: `Alex Kim confirmed the revoke of ${NAME} v1.`,
          body: REASON,
          href: `/${TEAM}/templates/${v1.templateId}/versions`,
          readAt: null,
        });
      }

      // The other version is as it was.
      expect(await versionById(v2.id)).toMatchObject({
        state: "active",
        rev: before.v2Rev,
      });
    });
  });
});
