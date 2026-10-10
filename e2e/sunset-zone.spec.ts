import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { sunsetDay, sunsetInstant, todayIn } from "@/domain/business-zone";
import { daysBetween } from "@/domain/dates";
import { openDb } from "./api/helpers";
import { TEAM, click, createSpringTravel, removeTemplate, rows, run, type SpringFixture } from "./helpers/golive";
import { asPersona, expect, hydrated, test } from "./helpers/scenario";

// A sunset date ends at 00:00 on that day in the business time zone (handoff review D6, decision 0017).
// Jordan sets a sunset from the Versions tab: the picker names the zone, and the database holds 00:00
// Eastern on the day picked, not midnight UTC (7 PM Eastern the evening before). Riley then makes the zone
// Pacific in Settings > Platform > Time zone: the screen says what doesn't move, the picker follows, and
// the sunset already set keeps its instant.
//
// Standalone: a fixture template (Spring Travel, v2 Active) with a v1 Superseded under it, removed in
// afterAll with everything it wrote; the zone and its audit rows are put back too.

test.describe.configure({ mode: "serial" });

const NY = "America/New_York";
const DAY = 86_400_000;

let db: Client;
let fixture: SpringFixture | undefined;
let zoneBefore: string | null = null;
let zoneAuditBefore = new Set<string>();

/** The demo clock, as the server reads it. */
async function demoNow(): Promise<Date> {
  const [row] = await rows(db, "SELECT value FROM settings WHERE key = 'clock_offset_days'");
  const offset = row ? Number(JSON.parse(String(row.value))) : 0;
  return new Date(Date.now() + offset * DAY);
}

const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const longDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

test.beforeAll(async () => {
  db = openDb();
  const [zone] = await rows(db, "SELECT value FROM settings WHERE key = 'business_zone'");
  zoneBefore = zone ? String(zone.value) : null;
  zoneAuditBefore = new Set(
    (await rows(db, "SELECT id FROM audit_events WHERE action = 'platform.config_changed' AND json_extract(details, '$.area') = 'business_zone'")).map(
      (r) => String(r.id),
    ),
  );
  // Eastern, the default, whatever an earlier run left.
  await run(db, "DELETE FROM settings WHERE key = 'business_zone'");

  fixture = await createSpringTravel(db);
  // v1, Superseded by v2 with no sunset yet: v2's row, a version earlier.
  const [v2] = await rows(db, "SELECT * FROM versions WHERE id = ?", [fixture.v2Id]);
  const activatedAt = Number(v2!.activated_at);
  const v1 = {
    ...v2,
    id: `v_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`,
    number: 1,
    round: 1,
    state: "superseded",
    created_at: activatedAt - 20 * DAY,
    updated_at: activatedAt,
    submitted_at: activatedAt - 19 * DAY,
    activated_at: activatedAt - 18 * DAY,
    superseded_at: activatedAt,
  };
  const columns = Object.keys(v1);
  await run(db, `INSERT INTO versions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((c) => v1[c as keyof typeof v1]));
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (fixture) await removeTemplate(db, fixture.templateId);
    if (zoneBefore === null) await run(db, "DELETE FROM settings WHERE key = 'business_zone'");
    else await run(db, "INSERT INTO settings (key, value) VALUES ('business_zone', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [zoneBefore]);
    const added = (
      await rows(db, "SELECT id FROM audit_events WHERE action = 'platform.config_changed' AND json_extract(details, '$.area') = 'business_zone'")
    ).filter((r) => !zoneAuditBefore.has(String(r.id)));
    for (const r of added) await run(db, "DELETE FROM audit_events WHERE id = ?", [r.id]);
  } finally {
    db.close();
  }
});

const v1Entry = (page: import("@playwright/test").Page) =>
  page.locator('[data-slot="version-entry"][data-version="1"]').filter({ visible: true });

async function openVersions(page: import("@playwright/test").Page) {
  await asPersona(page, "jordan");
  await page.goto(`/${TEAM}/templates/${fixture!.templateId}/versions`);
  await expect(page.getByRole("heading", { level: 1, name: "Spring Travel Rewards — Terms" })).toBeVisible();
  await hydrated(page);
}

test("Jordan sets v1's sunset: the picker names Eastern, and 00:00 Eastern on the day is stored", async ({ page }) => {
  await openVersions(page);
  await click(v1Entry(page).getByRole("button", { name: "Set sunset for v1", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Set sunset for v1" });
  await expect(dialog).toBeVisible();

  // The zone, at the control, and as the picker's description.
  const zoneLine = "Ends at 00:00 Eastern (America/New_York)";
  await expect(dialog.locator('[data-slot="sunset-zone"]')).toHaveText(zoneLine);
  const picker = dialog.getByRole("button", { name: /^Sunset date/ });
  await expect(picker).toHaveAccessibleDescription(zoneLine);

  // The picker starts 30 days after today in New York.
  const today = todayIn(await demoNow(), NY);
  const day = plusDays(today, 30);
  await expect(picker).toContainText(longDay(day));

  await click(dialog.getByRole("button", { name: "Set sunset", exact: true }));
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const [v1] = await rows(db, "SELECT sunset_at, sunset_set_by FROM versions WHERE template_id = ? AND number = 1", [fixture!.templateId]);
  const stored = Number(v1!.sunset_at);
  expect(v1!.sunset_set_by).toBe("jordan");
  expect(new Date(stored).toISOString(), "00:00 Eastern on the day picked").toBe(sunsetInstant(day, NY).toISOString());
  expect(stored % DAY, "not midnight UTC").not.toBe(0);
  expect(sunsetDay(new Date(stored), NY)).toBe(day);

  // The badge names the day picked.
  const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  await expect(v1Entry(page).locator('[data-status="superseded"]')).toContainText(`Sunset ${short}`);
  expect(daysBetween(today, day)).toBe(30);
});

test("Riley makes the zone Pacific: nothing already set moves, and the picker says Pacific", async ({ page }) => {
  const [before] = await rows(db, "SELECT sunset_at FROM versions WHERE template_id = ? AND number = 1", [fixture!.templateId]);
  expect(before?.sunset_at, "the first test set v1's sunset").not.toBeNull();

  await asPersona(page, "riley");
  await page.goto(`/${TEAM}/settings/time-zone`);
  const section = page.locator('[data-slot="platform-section"][data-section="time-zone"]').filter({ visible: true });
  await expect(section).toBeVisible();
  await hydrated(page);
  await expect(section.locator('[data-slot="business-zone"]')).toHaveText("Eastern (America/New_York)");

  await click(section.getByRole("button", { name: "Change time zone", exact: true }));
  const strip = section.locator('[data-slot="consequence-strip"]');
  const select = strip.getByRole("combobox", { name: "Business time zone" });
  await expect(select).toBeFocused();
  // Nothing picked yet: the confirm waits.
  await expect(strip.getByRole("button", { name: "Change time zone", exact: true })).toHaveAttribute("aria-disabled", "true");
  await select.selectOption("America/Los_Angeles");
  await expect(strip).toContainText("New sunset dates end at 00:00 Pacific (America/Los_Angeles).");
  await expect(strip).toContainText(/\d+ sunsets? already set (doesn't|don't) move: (its|their) consumers have been told when (it ends|they end)\./);
  await click(strip.getByRole("button", { name: "Change time zone", exact: true }));

  await expect(section.locator('[data-slot="business-zone"]')).toHaveText("Pacific (America/Los_Angeles)", { timeout: 20_000 });
  const [zone] = await rows(db, "SELECT value FROM settings WHERE key = 'business_zone'");
  expect(JSON.parse(String(zone!.value))).toBe("America/Los_Angeles");
  const [after] = await rows(db, "SELECT sunset_at FROM versions WHERE template_id = ? AND number = 1", [fixture!.templateId]);
  expect(after!.sunset_at, "the sunset already set keeps its instant").toBe(before!.sunset_at);

  // Jordan's picker now names Pacific.
  await openVersions(page);
  await click(v1Entry(page).getByRole("button", { name: "Change sunset for v1", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Change sunset for v1" });
  await expect(dialog.locator('[data-slot="sunset-zone"]')).toHaveText("Ends at 00:00 Pacific (America/Los_Angeles)");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
