import type { Client } from "@libsql/client";
import { sunsetDay } from "@/domain/business-zone";
import { openDb } from "./api/helpers";
import { switchPersona } from "./helpers/access";
import { TEAM, restore, rows, run, takeSnapshot, type Row, type Snapshot } from "./helpers/golive";
import { asPersona, expect, hydrated, test } from "./helpers/scenario";

// A sunset that has passed is final (handoff review D2): the version has stopped rendering, and a new date
// would make it render again. With the demo clock moved past Balance Transfer v1's seeded sunset, the
// Versions tab keeps v1's Change sunset in place, greyed, with the reason at the control, and pressing it
// opens nothing.
//
// And it's recorded (D7): a persona switch runs the sunset sweep, which writes one `version.sunset_passed`
// row dated at the sunset, and the Activity tab says v1 stopped rendering on its day in the business zone.
//
// Standalone: the clock is moved in the database, and afterAll puts back everything the run wrote, failed or
// not: the clock, the sweep's rows, and the sign-in time the persona switch stamped. The switch runs the
// access sweep too; at this clock (about 22 days after the seed) it has nothing to do, and the test checks it
// wrote nothing.

const NAME = "Balance Transfer Intro — Terms";
const REASON = "This version's sunset has passed. It can't render again.";
const DAY = 86_400_000;

const NY = "America/New_York";
/** The personas the test switches to through the app; each switch stamps their sign-in time. */
const SWITCHED = ["alex", "jordan"];

let db: Client;
let snapshot: Snapshot | undefined;
let templateId = "";
let sunsetAt = 0;
let passedBefore = new Set<string>();
let lastActiveBefore: Row[] = [];

test.beforeAll(async () => {
  db = openDb();
  const [v1] = await rows(
    db,
    `SELECT v.template_id, v.sunset_at FROM versions v JOIN templates t ON t.id = v.template_id
     WHERE t.team_id = ? AND v.name = ? AND v.number = 1 AND v.state = 'superseded'`,
    [TEAM, NAME],
  );
  if (!v1?.sunset_at) throw new Error("The seed has no Balance Transfer v1 (Superseded, with a sunset). Run npm run db:reset.");
  templateId = String(v1.template_id);
  sunsetAt = Number(v1.sunset_at);

  passedBefore = new Set((await rows(db, "SELECT id FROM audit_events WHERE action = 'version.sunset_passed'")).map((r) => String(r.id)));
  lastActiveBefore = await rows(db, `SELECT id, last_active_at FROM users WHERE id IN (${SWITCHED.map(() => "?").join(", ")})`, SWITCHED);
  snapshot = await takeSnapshot(db);
  const current = snapshot.clock === null ? 0 : Number(JSON.parse(snapshot.clock));
  const past = Math.ceil((sunsetAt - Date.now()) / DAY) + 1;
  await run(db, "INSERT INTO settings (key, value) VALUES ('clock_offset_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    String(Math.max(current, past)),
  ]);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (snapshot) await restore(db, snapshot);
    const written = (await rows(db, "SELECT id FROM audit_events WHERE action = 'version.sunset_passed'")).filter((r) => !passedBefore.has(String(r.id)));
    for (const r of written) await run(db, "DELETE FROM audit_events WHERE id = ?", [r.id]);
    for (const u of lastActiveBefore) await run(db, "UPDATE users SET last_active_at = ? WHERE id = ?", [u.last_active_at ?? null, u.id ?? null]);
  } finally {
    db.close();
  }
});

test("once v1's sunset has passed, Change sunset stays in place, disabled, with the reason", async ({ page }) => {
  await asPersona(page, "jordan");
  await page.goto(`/${TEAM}/templates/${templateId}/versions`);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await hydrated(page);

  const v1 = page.locator('[data-slot="version-entry"][data-version="1"]').filter({ visible: true });
  await expect(v1).toHaveAttribute("data-state", "superseded");
  await expect(v1).toContainText("Sunset passed");

  const change = v1.getByRole("button", { name: "Change sunset for v1", exact: true });
  await expect(change).toBeVisible();
  await expect(change).toBeDisabled();
  await expect(change).toHaveAttribute("data-disabled", "");
  await expect(change).toHaveAccessibleDescription(REASON);
  // Greyed: visibly different from the Revoke button beside it, which is still offered.
  const revoke = v1.getByRole("button", { name: "Revoke v1", exact: true });
  await expect(revoke).toBeEnabled();
  expect(await change.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(1);
  expect(await revoke.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);

  // The reason, at the control: on hover, and from the keyboard.
  const tooltip = page.locator('[data-slot="tooltip-content"]').filter({ visible: true });
  await change.hover();
  await expect(tooltip).toHaveText(REASON);
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await change.focus();
  await expect(change).toBeFocused();
  await expect(tooltip).toHaveText(REASON);

  // Pressing it opens nothing, and nothing is written.
  await change.click({ force: true });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const [after] = await rows(db, "SELECT state, sunset_at FROM versions WHERE template_id = ? AND number = 1", [templateId]);
  expect(after).toMatchObject({ state: "superseded", sunset_at: sunsetAt });
});

test("a persona switch records v1's passed sunset once, and Activity says it stopped rendering on its day", async ({ page }) => {
  const others = async () => (await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action <> 'version.sunset_passed'"))[0]!.n;
  const recorded = () => rows(db, "SELECT * FROM audit_events WHERE action = 'version.sunset_passed' AND template_id = ?", [templateId]);
  const before = await others();
  expect(await recorded(), "nothing records the sunset until a sweep runs").toEqual([]);

  await asPersona(page, "jordan");
  await page.goto(`/${TEAM}/templates/${templateId}/activity`);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await hydrated(page);
  await switchPersona(page, "Alex Kim");

  // One row, by the system, dated at the sunset, with the day in the business zone.
  const day = sunsetDay(new Date(sunsetAt), NY);
  await expect.poll(async () => (await recorded()).length).toBe(1);
  const [row] = await recorded();
  expect(row).toMatchObject({ actor_id: null, team_id: TEAM });
  expect(Number(row!.at), "dated at the sunset").toBe(sunsetAt);
  expect(JSON.parse(String(row!.details))).toEqual({ number: 1, sunsetAt: new Date(sunsetAt).toISOString(), sunsetDay: day, zone: NY });
  expect(await others(), "the access sweep had nothing to do at this clock").toBe(before);

  const long = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  const activity = page.locator('[data-slot="activity"]').filter({ visible: true });
  const line = activity.locator("li").filter({ hasText: `v1 stopped rendering: its sunset passed on ${long}.` });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("v1");

  // Again: already recorded, nothing more.
  await switchPersona(page, "Jordan Ellis");
  await expect(activity.locator("li").filter({ hasText: "its sunset passed" })).toHaveCount(1);
  expect(await recorded()).toHaveLength(1);
});
