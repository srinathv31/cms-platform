import { SPRING_NAME, TEAM, type SpringFixture } from "./helpers/golive";
import { asPersona, expect, hydrated, tap, test } from "./helpers/scenario";
import {
  Changes,
  addVersionLike,
  findVersions,
  versionById,
} from "./helpers/state";

// A refusal an action used to throw now shows its sentence (handoff review A3, H1). Edit threw the
// domain's refusal, so the person saw "Couldn't open a draft. Try again." whatever the reason was.
//
//   Maya opens Spring Travel Rewards (v2 Active): Edit is offered. Before she presses it, a newer
//   version goes into review (written straight to the database, as a colleague's submit from another
//   tab would). Edit is refused with the domain's sentence, "A newer version is in review.", the page
//   stays where it is, and no draft is made.
//
// Self-contained: the fixture template and every row that points at it are removed in afterAll.

const REFUSAL = "A newer version is in review.";

const changes = new Changes();
let fixture: SpringFixture | null = null;

test.beforeAll(async () => {
  fixture = await changes.createSpringTravel();
});

test.afterAll(() => changes.undo());

/** v3, In review: a copy of v2 submitted after it. */
async function submitV3(spring: SpringFixture) {
  const v2 = await versionById(spring.v2Id);
  const at = Date.now();
  await addVersionLike(v2!, {
    number: 3,
    round: 1,
    state: "in_review",
    basedOnVersionId: spring.v2Id,
    currentStage: 0,
    rev: 0,
    createdAt: at,
    updatedAt: at,
    submittedBy: "priya",
    submittedAt: at,
    writers: ["priya"],
    activatedAt: null,
  });
}

test("Edit refused because a newer version went into review shows the domain's sentence", async ({
  page,
}) => {
  const spring = fixture!;
  await asPersona(page, "maya");
  await page.goto(`/${TEAM}/templates/${spring.templateId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: SPRING_NAME }),
  ).toBeVisible();
  await hydrated(page);
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await expect(edit).toBeVisible();

  await submitV3(spring);
  await tap(edit);

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: REFUSAL }),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Couldn't open a draft" }),
  ).toHaveCount(0);
  await expect(
    edit,
    "the page stays as it was, and Edit can be pressed again",
  ).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe(
    `/${TEAM}/templates/${spring.templateId}`,
  );
  expect(
    await findVersions({ templateId: spring.templateId, state: "draft" }),
  ).toEqual([]);
});
