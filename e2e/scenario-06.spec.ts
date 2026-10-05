import type { Client, InValue } from "@libsql/client";
import type { Locator, Page } from "@playwright/test";
import { allVersions, correlation, demoNow, expectError, logFor, longDate, openDb, pick, render, validValues, type SeedVersion } from "./api/helpers";
import {
  CUSTOMERS,
  backToUcomp,
  dropDemoNoise,
  expectFailed,
  openOffer,
  openOfferTab,
  openSimulator,
  restore as restoreCoral,
  resultsHeadline,
  selectCustomers,
  send,
  takeSnapshot as takeCoralSnapshot,
  type Snapshot as CoralSnapshot,
} from "./helpers/golive";
import { asPersona, beat, demoTimeout, expect, hydrated, openLibrary, shoot, tap, test, typeSlowly, untilUncovered } from "./helpers/scenario";

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
// (docs/UCOMP-Implementation-Plan.md, Phase 4).
//
// Runs from a fresh reset. It REVOKES the seeded v1, so the rows it changes are snapshotted before and put
// back in afterAll (the version, the audit events, notifications and consumer notices it wrote for this
// template, its own render_log rows, and what Coral's send wrote: the deliveries, the render_log rows they
// made and the reads of notices): the gate-media run plays the spec twice against one database,
// and the dev database is shared. Console and page errors fail it.

// The preview frames and the customer views are sandboxed; Playwright's trace injects scripts into them.
test.use({ trace: "off" });

const TEAM = "coral-offers";
const NAME = "Balance Transfer Intro — Terms";
const OFFER = "offer_balance_transfer";
const OFFER_NAME = "Balance Transfer Intro";
const REASON = "Wrong intro APR in the legal notices.";
const OWN_REVOKE = "You started this revoke. Another approver must confirm it.";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── The database ─────────────────────────────────────────────────────────────

type Row = Record<string, InValue>;

/** The file has no busy timeout, and the app writes to it: a read or write waits its turn. */
async function busy<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const text = String((error as { code?: unknown; message?: unknown })?.code ?? "") + String((error as Error)?.message ?? "");
      if (attempt >= 8 || !/SQLITE_BUSY|database is locked/i.test(text)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    }
  }
}

async function rows(db: Client, sql: string, args: InValue[] = []): Promise<Row[]> {
  const result = await busy(() => db.execute({ sql, args }));
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column) => [column, row[column] as InValue])));
}

const json = (value: InValue) => (value === null || value === undefined ? null : JSON.parse(String(value)));

// What this scenario leaves in the shared database, so it can be put back.
interface Snapshot {
  v1Row: Row;
  v2Rev: number;
  audit: Set<string>;
  notifications: Set<string>;
  notices: Set<string>;
  correlationIds: string[];
}

let db: Client;
let v1: SeedVersion;
let v2: SeedVersion;
let snapshot: Snapshot;
let coral: CoralSnapshot;
let approvers: string[];

const hrefLike = (templateId: string) => `%/templates/${templateId}%`;

async function ids(sql: string, args: InValue[]): Promise<Set<string>> {
  return new Set((await rows(db, sql, args)).map((row) => String(row.id)));
}

async function deleteNew(table: string, where: string, args: InValue[], before: Set<string>) {
  const fresh = [...(await ids(`SELECT id FROM ${table} WHERE ${where}`, args))].filter((id) => !before.has(id));
  if (fresh.length === 0) return;
  await busy(() => db.execute({ sql: `DELETE FROM ${table} WHERE id IN (${fresh.map(() => "?").join(",")})`, args: fresh }));
}

test.beforeAll(async () => {
  db = openDb();
  const all = await allVersions(db);
  const find = (number: number) => pick(all, `${NAME} v${number}`, (v) => v.templateName === NAME && v.number === number);
  v1 = find(1);
  v2 = find(2);

  const [row] = await rows(db, "SELECT * FROM versions WHERE id = ?", [v1.id]);
  const ready = `from a fresh seed (npm run db:reset): ${NAME} v1 Superseded with no revoke, v2 Active`;
  if (v1.state !== "superseded" || row.revoke !== null || v2.state !== "active") {
    throw new Error(`This scenario needs ${ready}. v1 is ${v1.state}${row.revoke !== null ? " with a revoke on it" : ""}, v2 is ${v2.state}.`);
  }
  const [v2Row] = await rows(db, "SELECT rev FROM versions WHERE id = ?", [v2.id]);
  coral = await takeCoralSnapshot(db);

  snapshot = {
    v1Row: row,
    v2Rev: Number(v2Row.rev),
    audit: await ids("SELECT id FROM audit_events WHERE template_id = ?", [v1.templateId]),
    notifications: await ids("SELECT id FROM notifications WHERE href LIKE ?", [hrefLike(v1.templateId)]),
    notices: await ids("SELECT id FROM consumer_notices WHERE template_id = ?", [v1.templateId]),
    correlationIds: [],
  };
  approvers = (
    await rows(
      db,
      `SELECT DISTINCT m.user_id AS id FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
       WHERE m.team_id = ? AND m.status = 'active' AND r.role = 'approver'`,
      [v1.teamId],
    )
  )
    .map((r) => String(r.id))
    .sort();
});

test.afterEach(({ problems }) => dropDemoNoise(problems));

test.afterAll(async () => {
  if (!db) return;
  try {
    // Coral's side first: its reads of notices point at the notices removed below.
    if (coral) await restoreCoral(db, coral, { offers: [OFFER], noticeTemplates: [v1.templateId], clock: false });
    if (snapshot) {
      const columns = Object.keys(snapshot.v1Row).filter((column) => column !== "id");
      await busy(() =>
        db.execute({
          sql: `UPDATE versions SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
          args: [...columns.map((column) => snapshot.v1Row[column]), v1.id],
        }),
      );
      await deleteNew("audit_events", "template_id = ?", [v1.templateId], snapshot.audit);
      await deleteNew("notifications", "href LIKE ?", [hrefLike(v1.templateId)], snapshot.notifications);
      await deleteNew("consumer_notices", "template_id = ?", [v1.templateId], snapshot.notices);
      if (snapshot.correlationIds.length > 0) {
        const marks = snapshot.correlationIds.map(() => "?").join(",");
        await busy(() => db.execute({ sql: `DELETE FROM render_log WHERE correlation_id IN (${marks})`, args: snapshot.correlationIds }));
      }
    }
  } finally {
    db.close();
  }
});

// ── The render API ───────────────────────────────────────────────────────────

/** A render of one version as Coral, the way its send service would call it (never a preview). */
function renderAs(request: Parameters<typeof render>[0], version: SeedVersion, label: string) {
  const channel = version.channels.includes("web") ? "web" : version.channels[0];
  const cid = correlation(label);
  snapshot.correlationIds.push(cid);
  return render(request, {
    templateId: version.templateId,
    consumer: "coral",
    correlationId: cid,
    body: { version: version.number, channel, values: validValues(version.variables) },
  });
}

// ── The screens ──────────────────────────────────────────────────────────────

const versionEntry = (page: Page, number: number): Locator =>
  page.locator(`[data-slot="version-entry"][data-version="${number}"]`).filter({ visible: true });

const revokeBlock = (entry: Locator): Locator => entry.locator('[data-slot="revoke"]');

/** A counted-free, human-paced click, once the page has stopped moving under the target. */
async function press(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await untilUncovered(target);
  await tap(target);
}

const profileButton = (page: Page) => page.getByRole("button", { name: /profile and persona/ });
const templateTab = (page: Page, name: string) => page.getByRole("navigation", { name: "Template" }).getByRole("link", { name });

/** Through the persona switcher, as a presenter would: the URL stays, the page re-reads as the new person. */
async function switchPersona(page: Page, person: string) {
  const url = page.url();
  await press(profileButton(page));
  await press(page.getByRole("menuitemradio", { name: new RegExp(escapeRe(person)) }));
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(profileButton(page)).toHaveAccessibleName(new RegExp(`^${escapeRe(person)},`));
  await expect(page).toHaveURL(url);
}

/** For a still: the entry's whole block is on screen, whatever the scroll position. */
async function show(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await beat(target.page(), 300);
}

test.describe("scenario 6: revoke", () => {
  test("Jordan starts revoking Balance Transfer v1 and can't confirm it; Alex confirms; Coral's renders of v1 fail at once", async ({ page, request }) => {
    test.setTimeout(demoTimeout(120_000));
    let confirmedDay = "";
    const dayBefore: string[] = [];

    // ── 1. Before ────────────────────────────────────────────────────────────

    await test.step("1. Before: Coral renders v1 (200, newer version 2); v1 is Superseded", async () => {
      const { res, correlationId } = await renderAs(request, v1, "scenario06-before");
      expect(res.status(), "Coral renders the Superseded v1").toBe(200);
      expect(res.headers()["x-ucomp-version"]).toBe("1");
      expect(res.headers()["x-ucomp-newer-version"], "the header names the Active version").toBe("2");
      const [logged] = await logFor(db, correlationId!);
      expect(logged).toMatchObject({ consumer_id: "coral", version_number: 1, is_preview: 0, outcome: "ok", error_code: null });
    });

    // ── 2. Jordan starts the revoke ──────────────────────────────────────────

    await asPersona(page, "jordan");
    await openLibrary(page, TEAM);
    await beat(page, 900);

    await test.step("2.1 Jordan opens Balance Transfer's Versions tab: v1 Superseded, v2 Active", async () => {
      await press(page.getByRole("main").getByRole("link", { name: new RegExp(`^${escapeRe(NAME)}`) }));
      await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/${TEAM}/templates/${v1.templateId}$`));
      await hydrated(page);
      await beat(page);

      await press(templateTab(page, "Versions"));
      // The first visit to a route can take a while to compile on a dev server.
      await expect(page).toHaveURL(new RegExp(`/templates/${v1.templateId}/versions$`), { timeout: 30_000 });

      const first = versionEntry(page, 1);
      const second = versionEntry(page, 2);
      await expect(first).toBeVisible();
      await expect(first).toHaveAttribute("data-state", "superseded");
      await expect(first.locator("[data-status]")).toContainText("Superseded");
      await expect(second).toHaveAttribute("data-state", "active");
      await expect(second.locator("[data-status]")).toContainText("Active");
      await expect(revokeBlock(first), "no revoke on v1 yet").toHaveCount(0);
      await expect(first.getByRole("button", { name: "Revoke v1", exact: true }), "Jordan may revoke a Superseded version").toBeVisible();
      await beat(page, 900);
      await show(first);
      await shoot(page, "versions-before");
    });

    await test.step("2.2 Start revoke on v1: the dialog says what happens, wants a reason, and starts it", async () => {
      const first = versionEntry(page, 1);
      await press(first.getByRole("button", { name: "Revoke v1", exact: true }));

      const dialog = page.getByRole("dialog", { name: "Revoke v1" });
      await expect(dialog).toBeVisible();
      const reason = dialog.getByLabel("Reason");
      await expect(reason, "the reason has the focus").toBeFocused();
      const start = dialog.getByRole("button", { name: "Start revoke", exact: true });
      await expect(start, "no reason, no revoke").toBeDisabled();
      await expect(dialog, "starting only asks for a confirmation").toContainText("Another approver must confirm before this takes effect.");
      await expect(dialog.locator('[data-slot="consequences"]')).toContainText(/^Coral .*v1.*Once confirmed, its renders will fail immediately\./);
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
      await expect(block).toContainText(`Revoke started by Jordan Ellis: “${REASON}”`);
      await expect(first, "still Superseded: nothing stops rendering until a second approver confirms").toHaveAttribute("data-state", "superseded");
      await expect(first.locator("[data-status]")).toContainText("Superseded");

      const confirm = block.getByRole("button", { name: "Confirm revoke", exact: true });
      await expect(confirm).toBeVisible();
      await expect(confirm, "Jordan can't confirm his own revoke").toBeDisabled();
      await expect(block.getByText(OWN_REVOKE)).toBeVisible();
      await expect(confirm).toHaveAccessibleDescription(OWN_REVOKE);
      await expect(block.getByRole("button", { name: "Withdraw revoke", exact: true }), "he may withdraw it").toBeEnabled();
      await expect(first.getByRole("button", { name: "Revoke v1", exact: true }), "no second revoke while one is pending").toHaveCount(0);
      await beat(page, 900);
      await show(block);
      await shoot(page, "pending-as-starter");
    });

    await test.step("2.4 Nothing has changed for Coral yet: the version row, the audit event, the confirm request", async () => {
      const [row] = await rows(db, "SELECT state, revoke FROM versions WHERE id = ?", [v1.id]);
      expect(row.state).toBe("superseded");
      expect(json(row.revoke)).toMatchObject({ reason: REASON, startedBy: "jordan" });
      expect(json(row.revoke).confirmedAt, "not confirmed").toBeUndefined();

      const audit = (await rows(db, "SELECT * FROM audit_events WHERE template_id = ? ORDER BY at, id", [v1.templateId])).filter((r) => !snapshot.audit.has(String(r.id)));
      expect(audit.map((r) => r.action)).toEqual(["version.revoke_started"]);
      expect(audit[0]).toMatchObject({ actor_id: "jordan", team_id: TEAM, template_id: v1.templateId, version_id: v1.id });
      expect(json(audit[0].details)).toMatchObject({ number: 1, reason: REASON });

      const fresh = (await rows(db, "SELECT * FROM notifications WHERE href LIKE ? ORDER BY created_at, id", [hrefLike(v1.templateId)])).filter((r) => !snapshot.notifications.has(String(r.id)));
      expect(fresh.map((r) => r.kind), "one confirm request each").toEqual(approvers.filter((id) => id !== "jordan").map(() => "revoke_started"));
      expect(fresh.map((r) => String(r.user_id)).sort(), "to the approvers other than Jordan").toEqual(approvers.filter((id) => id !== "jordan"));
      for (const note of fresh) {
        expect(note).toMatchObject({
          team_id: TEAM,
          title: `Jordan Ellis started revoking ${NAME} v1. Confirm or cancel.`,
          body: REASON,
          href: `/${TEAM}/templates/${v1.templateId}/versions`,
          read_at: null,
        });
      }

      const notices = (await rows(db, "SELECT id FROM consumer_notices WHERE template_id = ?", [v1.templateId])).filter((r) => !snapshot.notices.has(String(r.id)));
      expect(notices, "consumers are told when it is confirmed, not before").toEqual([]);

      const { res } = await renderAs(request, v1, "scenario06-pending");
      expect(res.status(), "Coral still renders v1 while the revoke waits").toBe(200);
    });

    // ── 3. Alex confirms ─────────────────────────────────────────────────────

    await test.step("3.1 Switch to Alex: the same revoke, and Confirm revoke is his to press", async () => {
      await beat(page);
      await switchPersona(page, "Alex Kim");
      const first = versionEntry(page, 1);
      const block = revokeBlock(first);
      await expect(block).toContainText(`Revoke started by Jordan Ellis: “${REASON}”`);
      const confirm = block.getByRole("button", { name: "Confirm revoke", exact: true });
      await expect(confirm, "a different approver").toBeEnabled();
      await expect(block.getByText(OWN_REVOKE)).toHaveCount(0);
      await expect(block.getByRole("button", { name: "Withdraw revoke", exact: true })).toBeEnabled();
      await beat(page, 900);
      await show(block);
      await shoot(page, "pending-as-confirmer");
    });

    await test.step("3.2 Alex confirms: v1 shows Revoked", async () => {
      const first = versionEntry(page, 1);
      await press(revokeBlock(first).getByRole("button", { name: "Confirm revoke", exact: true }));

      const dialog = page.getByRole("dialog", { name: "Confirm revoke of v1" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Jordan Ellis started this revoke: “${REASON}”`);
      await expect(dialog.locator('[data-slot="consequences"]')).toContainText(/^Coral .*v1.*Its renders will fail immediately\./);
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true }), "the safe action has the focus").toBeFocused();
      await beat(page, 900);

      dayBefore.push(longDate(await demoNow(db)));
      await press(dialog.getByRole("button", { name: "Confirm revoke", exact: true }));
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      dayBefore.push(longDate(await demoNow(db)));

      await expect(first).toHaveAttribute("data-state", "revoked", { timeout: 20_000 });
      await expect(first.locator("[data-status]")).toHaveText("Revoked");
      const block = revokeBlock(first);
      await expect(block, "the revoke is final: no longer pending").not.toHaveAttribute("data-pending", "");
      await expect(block).toContainText(new RegExp(`^Revoked .+: “${escapeRe(REASON)}”`));
      await expect(block).toContainText("Started by Jordan Ellis, confirmed by Alex Kim.");
      await expect(first.getByRole("button"), "nothing left to do on a revoked version").toHaveCount(0);
      await expect(versionEntry(page, 2), "v2 is untouched").toHaveAttribute("data-state", "active");
      await beat(page, 900);
      await show(first);
      await shoot(page, "revoked");
    });

    // ── 4. After: the render API ─────────────────────────────────────────────

    await test.step("4. After: Coral's render of v1 is 410 version_revoked with the date; v2 still renders", async () => {
      const [row] = await rows(db, "SELECT state, revoke FROM versions WHERE id = ?", [v1.id]);
      expect(row.state).toBe("revoked");
      const revoke = json(row.revoke);
      expect(revoke).toMatchObject({ reason: REASON, startedBy: "jordan", confirmedBy: "alex" });
      expect(revoke.confirmedAt, "a confirmed revoke has its time").toBeTruthy();
      confirmedDay = longDate(revoke.confirmedAt);
      expect(dayBefore, "the date is the demo clock's day").toContain(confirmedDay);

      const { res, correlationId } = await renderAs(request, v1, "scenario06-after");
      const error = await expectError(res, 410, "version_revoked", `Version 1 was revoked on ${confirmedDay}. Version 2 is active.`);
      expect(error.details).toEqual({ version: 1, activeVersion: 2, at: new Date(revoke.confirmedAt).toISOString() });
      const [logged] = await logFor(db, correlationId!);
      expect(logged).toMatchObject({ consumer_id: "coral", version_number: 1, is_preview: 0, error_code: "version_revoked" });
      expect(logged.outcome).not.toBe("ok");

      const active = await renderAs(request, v2, "scenario06-v2");
      expect(active.res.status(), "v2 is unaffected").toBe(200);
      expect(active.res.headers()["x-ucomp-version"]).toBe("2");
      expect(active.res.headers()["x-ucomp-newer-version"], "v2 is the newest").toBeUndefined();
    });

    // ── 4b. After: Coral's send in the simulator ─────────────────────────────

    await test.step("4b. In the simulator, Coral's send on the offer fails at once, with the revoke message verbatim", async () => {
      await beat(page);
      await openSimulator(page);
      const offerRow = page.getByRole("table", { name: "Offers" }).getByRole("row").filter({ has: page.getByRole("link", { name: OFFER_NAME, exact: true }) });
      await expect(offerRow).toContainText("Revoked");
      await beat(page, 900);
      await shoot(page, "simulator-offers-revoked");

      await openOffer(page, OFFER_NAME);
      await expect(page.getByText("A send now fails.")).toBeVisible();
      await expect(page.getByText(/v1 was revoked on /)).toBeVisible();
      await beat(page, 900);
      await shoot(page, "simulator-offer-revoked");

      await openOfferTab(page, "Send");
      await expect(page.getByRole("table", { name: "Customers" })).toBeVisible();
      await selectCustomers(page, [CUSTOMERS.olivia, CUSTOMERS.marcus]);
      await beat(page, 500);
      await send(page);

      // Two customers on the offer's two channels (PDF and Web): four renders, none delivered.
      await expect(resultsHeadline(page)).toHaveText("0 delivered, 4 failed", { timeout: 60_000 });
      const message = `Version 1 was revoked on ${confirmedDay}. Version 2 is active.`;
      await expectFailed(page, 4, { status: 410, code: "version_revoked", message });
      await beat(page, 900);
      await resultsHeadline(page).scrollIntoViewIfNeeded();
      await shoot(page, "simulator-send-revoked");

      // Coral stored the API's words as received, and UCOMP logged the refusals under Coral's id.
      const deliveries = (await rows(db, "SELECT * FROM sim_deliveries WHERE offer_id = ?", [OFFER])).filter((r) => !coral.simDeliveries.has(String(r.id)));
      expect(deliveries).toHaveLength(4);
      for (const delivery of deliveries) {
        expect(delivery).toMatchObject({ status: "failed", template_id: v1.templateId, version_number: 1, output: null });
        expect(json(delivery.error)).toEqual({ status: 410, code: "version_revoked", message });
        const [logged] = await logFor(db, String(delivery.correlation_id));
        expect(logged).toMatchObject({ consumer_id: "coral", version_number: 1, is_preview: 0, error_code: "version_revoked" });
      }

      // Back to UCOMP, on the template Alex was looking at.
      await backToUcomp(page);
      await page.goto(`/${TEAM}/templates/${v1.templateId}/versions`);
      await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
      await hydrated(page);
      await expect(versionEntry(page, 1)).toHaveAttribute("data-state", "revoked");
    });

    // ── 5. The Activity tab ──────────────────────────────────────────────────

    await test.step("5. The Activity tab shows both steps, by Jordan Ellis and Alex Kim, with the reason", async () => {
      await press(templateTab(page, "Activity"));
      await expect(page).toHaveURL(new RegExp(`/templates/${v1.templateId}/activity$`));

      const activity = page.locator('[data-slot="activity"]').filter({ visible: true });
      const started = activity.locator("li").filter({ hasText: `Jordan Ellis started revoking v1: ${REASON}` });
      const revoked = activity.locator("li").filter({ hasText: `Alex Kim confirmed the revoke of v1: ${REASON}` });
      await expect(started).toHaveCount(1);
      await expect(revoked).toHaveCount(1);
      await expect(started.locator("span", { hasText: /^v1$/ })).toBeVisible();
      await expect(revoked.locator("span", { hasText: /^v1$/ })).toBeVisible();
      await expect(started.locator("time")).toBeVisible();
      await expect(revoked.locator("time")).toBeVisible();

      // Newest first: the confirmation sits above the start.
      const lines = await activity.locator("li").allInnerTexts();
      const at = (needle: string) => lines.findIndex((line) => line.includes(needle));
      expect(at("Alex Kim confirmed the revoke of v1")).toBeGreaterThanOrEqual(0);
      expect(at("Alex Kim confirmed the revoke of v1"), "newest first").toBeLessThan(at("Jordan Ellis started revoking v1"));
      // Both are today's, so they share a day group.
      const day = activity
        .locator('[data-slot="activity-day"]')
        .filter({ has: page.locator("li", { hasText: `Jordan Ellis started revoking v1: ${REASON}` }) })
        .filter({ has: page.locator("li", { hasText: `Alex Kim confirmed the revoke of v1: ${REASON}` }) });
      await expect(day).toHaveCount(1);
      await beat(page, 900);
      await shoot(page, "activity");
    });

    // ── 6. The trail in the database ─────────────────────────────────────────

    await test.step("6. consumer_notices, notifications and audit_events hold the whole revoke", async () => {
      // audit_events: both steps, in order, by who did them.
      const audit = (await rows(db, "SELECT * FROM audit_events WHERE template_id = ? ORDER BY at, id", [v1.templateId])).filter((r) => !snapshot.audit.has(String(r.id)));
      expect(audit.map((r) => r.action)).toEqual(["version.revoke_started", "version.revoked"]);
      expect(audit.map((r) => r.actor_id)).toEqual(["jordan", "alex"]);
      for (const event of audit) expect(event).toMatchObject({ team_id: TEAM, template_id: v1.templateId, version_id: v1.id });
      expect(json(audit[0].details)).toMatchObject({ number: 1, reason: REASON });
      expect(json(audit[1].details)).toMatchObject({ number: 1, reason: REASON, startedBy: "jordan", wasActive: false });
      expect(Number(audit[1].at)).toBeGreaterThanOrEqual(Number(audit[0].at));

      // consumer_notices: Coral is told v1 was revoked, and that v2 is the one to use.
      const notices = (await rows(db, "SELECT * FROM consumer_notices WHERE template_id = ?", [v1.templateId])).filter((r) => !snapshot.notices.has(String(r.id)));
      expect(notices.length, "at least Coral").toBeGreaterThanOrEqual(1);
      for (const notice of notices) expect(notice).toMatchObject({ kind: "revoked", version_id: v1.id });
      const coral = notices.filter((r) => r.consumer_id === "coral");
      expect(coral, "one revoked notice for Coral on v1").toHaveLength(1);
      expect(json(coral[0].payload)).toEqual({ templateName: NAME, versionNumber: 1, activeVersion: 2, reason: REASON });

      // notifications: the confirm request went to the approvers other than Jordan (checked at step 2.4);
      // the revoked notice goes to the other approvers (Jordan) and whoever submitted v1, never to Alex.
      const [submitter] = await rows(db, "SELECT submitted_by FROM versions WHERE id = ?", [v1.id]);
      const told = new Set(approvers.filter((id) => id !== "alex"));
      if (submitter.submitted_by && submitter.submitted_by !== "alex") told.add(String(submitter.submitted_by));
      const fresh = (await rows(db, "SELECT * FROM notifications WHERE href LIKE ? ORDER BY created_at, id", [hrefLike(v1.templateId)])).filter((r) => !snapshot.notifications.has(String(r.id)));
      const started = fresh.filter((r) => r.kind === "revoke_started");
      const revoked = fresh.filter((r) => r.kind === "version_revoked");
      expect(fresh.length, "nothing else was sent").toBe(started.length + revoked.length);
      expect(started.map((r) => String(r.user_id)).sort(), "the confirm request: not to Jordan").toEqual(approvers.filter((id) => id !== "jordan"));
      expect(revoked.map((r) => String(r.user_id)).sort(), "the revoked notice: not to Alex").toEqual([...told].sort());
      for (const note of revoked) {
        expect(note).toMatchObject({
          team_id: TEAM,
          title: `Alex Kim confirmed the revoke of ${NAME} v1.`,
          body: REASON,
          href: `/${TEAM}/templates/${v1.templateId}/versions`,
          read_at: null,
        });
      }

      // The other version is as it was.
      const [other] = await rows(db, "SELECT state, rev FROM versions WHERE id = ?", [v2.id]);
      expect(other).toMatchObject({ state: "active", rev: snapshot.v2Rev });
    });
  });
});
