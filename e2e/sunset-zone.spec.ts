import { sunsetDay, sunsetInstant, todayIn } from "@/domain/business-zone";
import { daysBetween } from "@/domain/dates";
import { TEAM, click, type SpringFixture } from "./helpers/golive";
import { asPersona, expect, hydrated, test } from "./helpers/scenario";
import {
  Changes,
  addVersionLike,
  demoNow,
  setting,
  versionById,
  versionNumbered,
} from "./helpers/state";

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

const changes = new Changes();
let fixture: SpringFixture | undefined;

const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const longDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));

test.beforeAll(async () => {
  // The zone change writes a platform.config_changed audit row; both it and the zone go back in afterAll.
  await changes.watchAuditEvents("platform.config_changed");
  // Eastern, the default, whatever an earlier run left.
  await changes.deleteSetting("business_zone");

  fixture = await changes.createSpringTravel();
  // v1, Superseded by v2 with no sunset yet: v2's row, a version earlier.
  const v2 = (await versionById(fixture.v2Id))!;
  const activatedAt = v2.activatedAt!;
  await addVersionLike(v2, {
    number: 1,
    round: 1,
    state: "superseded",
    createdAt: activatedAt - 20 * DAY,
    updatedAt: activatedAt,
    submittedAt: activatedAt - 19 * DAY,
    activatedAt: activatedAt - 18 * DAY,
    supersededAt: activatedAt,
  });
});

test.afterAll(() => changes.undo());

const v1Entry = (page: import("@playwright/test").Page) =>
  page
    .locator('[data-slot="version-entry"][data-version="1"]')
    .filter({ visible: true });

async function openVersions(page: import("@playwright/test").Page) {
  await asPersona(page, "jordan");
  await page.goto(`/${TEAM}/templates/${fixture!.templateId}/versions`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Spring Travel Rewards — Terms",
    }),
  ).toBeVisible();
  await hydrated(page);
}

test("Jordan sets v1's sunset: the picker names Eastern, and 00:00 Eastern on the day is stored", async ({
  page,
}) => {
  await openVersions(page);
  await click(
    v1Entry(page).getByRole("button", {
      name: "Set sunset for v1",
      exact: true,
    }),
  );
  const dialog = page.getByRole("dialog", { name: "Set sunset for v1" });
  await expect(dialog).toBeVisible();

  // The zone, at the control, and as the picker's description.
  const zoneLine = "Ends at 00:00 Eastern (America/New_York)";
  await expect(dialog.locator('[data-slot="sunset-zone"]')).toHaveText(
    zoneLine,
  );
  const picker = dialog.getByRole("button", { name: /^Sunset date/ });
  await expect(picker).toHaveAccessibleDescription(zoneLine);

  // The picker starts 30 days after today in New York.
  const today = todayIn(new Date(await demoNow()), NY);
  const day = plusDays(today, 30);
  await expect(picker).toContainText(longDay(day));

  await click(dialog.getByRole("button", { name: "Set sunset", exact: true }));
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const v1 = await versionNumbered(fixture!.templateId, 1);
  const stored = v1!.sunsetAt!;
  expect(v1!.sunsetSetBy).toBe("jordan");
  expect(
    new Date(stored).toISOString(),
    "00:00 Eastern on the day picked",
  ).toBe(sunsetInstant(day, NY).toISOString());
  expect(stored % DAY, "not midnight UTC").not.toBe(0);
  expect(sunsetDay(new Date(stored), NY)).toBe(day);

  // The badge names the day picked.
  const short = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
  await expect(
    v1Entry(page).locator('[data-status="superseded"]'),
  ).toContainText(`Sunset ${short}`);
  // A day still to come reads as one: "passed" is only for a sunset that has (handoff review N4).
  await expect(
    v1Entry(page).locator('[data-status="superseded"]'),
  ).not.toContainText("passed");
  expect(daysBetween(today, day)).toBe(30);
});

test("Riley makes the zone Pacific: nothing already set moves, and the picker says Pacific", async ({
  page,
}) => {
  const before = await versionNumbered(fixture!.templateId, 1);
  expect(before?.sunsetAt, "the first test set v1's sunset").not.toBeNull();

  await asPersona(page, "riley");
  await page.goto(`/${TEAM}/settings/time-zone`);
  const section = page
    .locator('[data-slot="platform-section"][data-section="time-zone"]')
    .filter({ visible: true });
  await expect(section).toBeVisible();
  await hydrated(page);
  await expect(section.locator('[data-slot="business-zone"]')).toHaveText(
    "Eastern (America/New_York)",
  );

  await click(
    section.getByRole("button", { name: "Change time zone", exact: true }),
  );
  const strip = section.locator('[data-slot="consequence-strip"]');
  const select = strip.getByRole("combobox", { name: "Business time zone" });
  await expect(select).toBeFocused();
  // Nothing picked yet: the confirm waits.
  await expect(
    strip.getByRole("button", { name: "Change time zone", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await select.selectOption("America/Los_Angeles");
  await expect(strip).toContainText(
    "New sunset dates end at 00:00 Pacific (America/Los_Angeles).",
  );
  await expect(strip).toContainText(
    /\d+ sunsets? already set (doesn't|don't) move: (its|their) consumers have been told when (it ends|they end)\./,
  );
  await click(
    strip.getByRole("button", { name: "Change time zone", exact: true }),
  );

  await expect(section.locator('[data-slot="business-zone"]')).toHaveText(
    "Pacific (America/Los_Angeles)",
    { timeout: 20_000 },
  );
  expect(await setting("business_zone")).toBe("America/Los_Angeles");
  const after = await versionNumbered(fixture!.templateId, 1);
  expect(after!.sunsetAt, "the sunset already set keeps its instant").toBe(
    before!.sunsetAt,
  );

  // Jordan's picker now names Pacific.
  await openVersions(page);
  await click(
    v1Entry(page).getByRole("button", {
      name: "Change sunset for v1",
      exact: true,
    }),
  );
  const dialog = page.getByRole("dialog", { name: "Change sunset for v1" });
  await expect(dialog.locator('[data-slot="sunset-zone"]')).toHaveText(
    "Ends at 00:00 Pacific (America/Los_Angeles)",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
