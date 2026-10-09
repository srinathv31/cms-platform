import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { openDb } from "./api/helpers";
import { SPRING_NAME, TEAM, createSpringTravel, removeTemplate, rows, run, type Row, type SpringFixture } from "./helpers/golive";
import { asPersona, expect, hydrated, tap, test } from "./helpers/scenario";

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

let db: Client;
let fixture: SpringFixture | null = null;

test.beforeAll(async () => {
  db = openDb();
  fixture = await createSpringTravel(db);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (fixture) await removeTemplate(db, fixture.templateId);
  } finally {
    db.close();
  }
});

/** v3, In review: a copy of v2 submitted after it. */
async function submitV3(spring: SpringFixture) {
  const [v2] = await rows(db, "SELECT * FROM versions WHERE id = ?", [spring.v2Id]);
  const at = Date.now();
  const v3: Row = {
    ...v2,
    id: `v_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`,
    number: 3,
    state: "in_review",
    based_on_version_id: spring.v2Id,
    current_stage: 0,
    rev: 0,
    created_at: at,
    updated_at: at,
    submitted_by: "priya",
    submitted_at: at,
    writers: JSON.stringify(["priya"]),
    activated_at: null,
  };
  const columns = Object.keys(v3);
  await run(db, `INSERT INTO versions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((c) => v3[c]));
}

test("Edit refused because a newer version went into review shows the domain's sentence", async ({ page }) => {
  const spring = fixture!;
  await asPersona(page, "maya");
  await page.goto(`/${TEAM}/templates/${spring.templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: SPRING_NAME })).toBeVisible();
  await hydrated(page);
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await expect(edit).toBeVisible();

  await submitV3(spring);
  await tap(edit);

  await expect(page.locator("[data-sonner-toast]").filter({ hasText: REFUSAL })).toBeVisible();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Couldn't open a draft" })).toHaveCount(0);
  await expect(edit, "the page stays as it was, and Edit can be pressed again").toBeEnabled();
  expect(new URL(page.url()).pathname).toBe(`/${TEAM}/templates/${spring.templateId}`);
  expect(await rows(db, "SELECT id FROM versions WHERE template_id = ? AND state = 'draft'", [spring.templateId])).toEqual([]);
});
