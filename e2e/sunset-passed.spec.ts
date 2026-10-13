import type { ApiNoticeList } from "@/contracts/api-v1";
import { sunsetDay } from "@/domain/business-zone";
import { switchPersona } from "./helpers/access";
import {
  Changes,
  TEAM,
  auditEvents,
  clockOffsetDays,
  consumerIds,
  consumerNotices,
  findVersion,
  renderLog,
} from "./helpers/state";
import { asPersona, expect, hydrated, test } from "./helpers/scenario";

// A sunset that has passed is final (handoff review D2): the version has stopped rendering, and a new date
// would make it render again. With the demo clock moved past Balance Transfer v1's seeded sunset, the
// Versions tab keeps v1's Change sunset in place, greyed, with the reason at the control, and pressing it
// opens nothing.
//
// And it's recorded (D7): a persona switch runs the sunset sweep, which writes one `version.sunset_passed`
// row dated at the sunset, and the Activity tab says v1 stopped rendering on its day in the business zone.
// The same sweep tells the template's consumers (decision 0032): one `sunset_passed` notice each, which the
// notices API serves and Coral's inbox shows.
//
// Standalone: the clock is moved in the database, and afterAll puts back everything the run wrote, failed or
// not: the clock, the sweep's rows and notices (with any read marks on them), and the sign-in time the persona
// switch stamped. The switch runs the access sweep too; at this clock (about 22 days after the seed) it has
// nothing to do, and the test checks it wrote nothing.

const NAME = "Balance Transfer Intro — Terms";
const REASON = "This version's sunset has passed. It can't render again.";
const DAY = 86_400_000;

const NY = "America/New_York";
/** The personas the test switches to through the app; each switch stamps their sign-in time. */
const SWITCHED = ["alex", "jordan"];

const changes = new Changes();
let templateId = "";
let sunsetAt = 0;

test.beforeAll(async () => {
  const v1 = await findVersion({
    teamSlug: TEAM,
    name: NAME,
    number: 1,
    state: "superseded",
  });
  if (!v1?.sunsetAt)
    throw new Error(
      "The seed has no Balance Transfer v1 (Superseded, with a sunset). Run npm run db:reset.",
    );
  templateId = v1.templateId;
  sunsetAt = v1.sunsetAt;

  // What the run writes: the sweep's audit rows and notices (with any read marks on them), the sign-in time the
  // persona switch stamps, and the clock this moves.
  await changes.watchAuditEvents("version.sunset_passed");
  await changes.watchConsumerNotices("sunset_passed");
  await changes.watchSignIns(SWITCHED);
  const past = Math.ceil((sunsetAt - Date.now()) / DAY) + 1;
  await changes.setClockOffsetDays(Math.max(await clockOffsetDays(), past));
});

// Every step runs, whatever failed before it; the first failure is reported at the end.
test.afterAll(() => changes.undo());

test("once v1's sunset has passed, Change sunset stays in place, disabled, with the reason", async ({
  page,
}) => {
  await asPersona(page, "jordan");
  await page.goto(`/${TEAM}/templates/${templateId}/versions`);
  await expect(
    page.getByRole("heading", { level: 1, name: NAME }),
  ).toBeVisible();
  await hydrated(page);

  const v1 = page
    .locator('[data-slot="version-entry"][data-version="1"]')
    .filter({ visible: true });
  await expect(v1).toHaveAttribute("data-state", "superseded");
  await expect(v1).toContainText("Sunset passed");
  // And so does the badge: the version no longer renders, so it can't read like a date to come (handoff review
  // N4). The day is the one in the business zone, as the entry's dates give it.
  const shortDay = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${sunsetDay(new Date(sunsetAt), NY)}T00:00:00Z`));
  await expect(v1.locator('[data-status="superseded"]')).toHaveText(
    new RegExp(`^Superseded\\s*·\\s*Sunset passed ${shortDay}(, \\d{4})?$`),
  );

  const change = v1.getByRole("button", {
    name: "Change sunset for v1",
    exact: true,
  });
  await expect(change).toBeVisible();
  await expect(change).toBeDisabled();
  await expect(change).toHaveAttribute("data-disabled", "");
  await expect(change).toHaveAccessibleDescription(REASON);
  // Greyed: visibly different from the Revoke button beside it, which is still offered.
  const revoke = v1.getByRole("button", { name: "Revoke v1", exact: true });
  await expect(revoke).toBeEnabled();
  expect(
    await change.evaluate((el) => Number(getComputedStyle(el).opacity)),
  ).toBeLessThan(1);
  expect(
    await revoke.evaluate((el) => Number(getComputedStyle(el).opacity)),
  ).toBe(1);

  // The reason, at the control: on hover, and from the keyboard.
  const tooltip = page
    .locator('[data-slot="tooltip-content"]')
    .filter({ visible: true });
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
  expect(await findVersion({ templateId, number: 1 })).toMatchObject({
    state: "superseded",
    sunsetAt,
  });

  // The Usage tab's consumers read v1 the same way (a render the version no longer serves can't wait on a date).
  await page.goto(`/${TEAM}/templates/${templateId}/usage`);
  await expect(
    page.getByRole("heading", { level: 1, name: NAME }),
  ).toBeVisible();
  const usageBadge = page
    .locator('[data-status="superseded"]')
    .filter({ visible: true })
    .first();
  await expect(usageBadge).toHaveText(
    new RegExp(`^Superseded\\s*·\\s*Sunset passed ${shortDay}(, \\d{4})?$`),
  );
});

test("a persona switch records v1's passed sunset once, Activity says it stopped rendering on its day, and Coral is told", async ({
  page,
}) => {
  const others = async () =>
    (await auditEvents({ notAction: "version.sunset_passed" })).length;
  const recorded = () =>
    auditEvents({ templateId, action: "version.sunset_passed" });
  const notices = () => consumerNotices({ templateId, kind: "sunset_passed" });
  const before = await others();
  expect(
    await recorded(),
    "nothing records the sunset until a sweep runs",
  ).toEqual([]);
  expect(await notices(), "nor tells a consumer").toEqual([]);
  // Who hears of it: the consumers with a non-preview render of the template from 90 days before the sunset on.
  const registered = new Set(await consumerIds());
  const audience = [
    ...new Set(
      (await renderLog({ templateId, isPreview: false }))
        .filter((r) => r.at >= sunsetAt - 90 * DAY)
        .map((r) => r.consumerId)
        .filter((id): id is string => id !== null && registered.has(id)),
    ),
  ].sort();
  expect(audience, "Coral renders Balance Transfer").toContain("coral");
  const active = await findVersion({ templateId, state: "active" });

  await asPersona(page, "jordan");
  await page.goto(`/${TEAM}/templates/${templateId}/activity`);
  await expect(
    page.getByRole("heading", { level: 1, name: NAME }),
  ).toBeVisible();
  await hydrated(page);
  await switchPersona(page, "Alex Kim");

  // One row, by the system, dated at the sunset, with the day in the business zone.
  const day = sunsetDay(new Date(sunsetAt), NY);
  await expect.poll(async () => (await recorded()).length).toBe(1);
  const [row] = await recorded();
  expect(row).toMatchObject({ actorId: null, teamId: TEAM });
  expect(row!.at, "dated at the sunset").toBe(sunsetAt);
  expect(row!.details).toEqual({
    number: 1,
    sunsetAt: new Date(sunsetAt).toISOString(),
    sunsetDay: day,
    zone: NY,
  });
  expect(
    await others(),
    "the access sweep had nothing to do at this clock",
  ).toBe(before);

  const long = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
  const activity = page
    .locator('[data-slot="activity"]')
    .filter({ visible: true });
  const line = activity
    .locator("li")
    .filter({ hasText: `v1 stopped rendering: its sunset passed on ${long}.` });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("v1");

  // The same sweep told each consumer once: created when it ran (after the sunset), with the instant, the day
  // and the zone, and the version to move to.
  const sent = await notices();
  expect(sent.map((n) => n.consumerId).sort()).toEqual(audience);
  const payload = {
    templateName: NAME,
    versionNumber: 1,
    activeVersion: active?.number ?? null,
    sunsetAt: new Date(sunsetAt).toISOString(),
    sunsetDay: day,
    zone: NY,
  };
  for (const n of sent) {
    expect(n).toMatchObject({ kind: "sunset_passed", templateId });
    expect(
      n.createdAt,
      "written when the sweep ran, not backdated",
    ).toBeGreaterThan(sunsetAt);
    expect(n.payload).toEqual(payload);
  }

  // The notices API serves it to Coral as the newest notice about the template.
  const res = await page.request.get(
    `/api/v1/consumers/coral/notices?templateId=${templateId}&limit=200`,
    { headers: { "X-Consumer-Id": "coral" } },
  );
  expect(res.status()).toBe(200);
  const served = ((await res.json()) as ApiNoticeList).notices;
  const move =
    payload.activeVersion === null ? "" : ` Move to v${payload.activeVersion}.`;
  const message = `${NAME} v1 stopped rendering: its sunset passed on ${long}.${move}`;
  expect(served.at(-1)).toMatchObject({
    kind: "sunset_passed",
    versionNumber: 1,
    activeVersion: payload.activeVersion,
    sunsetAt: payload.sunsetAt,
    sunsetDay: day,
    zone: NY,
    changes: [],
    message,
  });

  // And Coral's inbox shows it, unread.
  await page.goto("/sim/notices");
  const item = page.locator("li").filter({ hasText: message });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("v1 sunset passed");
  await expect(item.getByRole("img", { name: "Unread" })).toBeVisible();

  // Again: already recorded and told, nothing more.
  await page.goto(`/${TEAM}/templates/${templateId}/activity`);
  await hydrated(page);
  await switchPersona(page, "Jordan Ellis");
  await expect(
    activity.locator("li").filter({ hasText: "its sunset passed" }),
  ).toHaveCount(1);
  expect(await recorded()).toHaveLength(1);
  expect(await notices()).toHaveLength(audience.length);
});
