import type { Client } from "@libsql/client";
import { openDb } from "./api/helpers";
import { TEAM, restore, rows, run, takeSnapshot, type Snapshot } from "./helpers/golive";
import { asPersona, expect, hydrated, test } from "./helpers/scenario";

// A sunset that has passed is final (handoff review D2): the version has stopped rendering, and a new date
// would make it render again. With the demo clock moved past Balance Transfer v1's seeded sunset, the
// Versions tab keeps v1's Change sunset in place, greyed, with the reason at the control, and pressing it
// opens nothing.
//
// Standalone: the clock is moved in the database and put back in afterAll. Nothing here runs the access
// sweep (no clock advance through the Demo pill, no persona switch through the app), so the move leaves
// nothing else behind.

const NAME = "Balance Transfer Intro — Terms";
const REASON = "This version's sunset has passed. It can't render again.";
const DAY = 86_400_000;

let db: Client;
let snapshot: Snapshot | undefined;
let templateId = "";
let sunsetAt = 0;

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
