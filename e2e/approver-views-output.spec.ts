import type { Locator, Page } from "@playwright/test";
import {
  channelControl,
  expectViewed,
  phoneControl,
  reviewPreview,
  reviewTabs,
} from "./helpers/review";
import { asPersona, expect, hydrated, tap, test } from "./helpers/scenario";
import {
  Changes,
  addVersionLike,
  auditEvents,
  findVersion,
  removeTemplate,
} from "./helpers/state";

// An approver views every output before approving (decision 0037). Approve waits until each output of the
// round has rendered on the approver's screen in the Preview: each channel, and Push on both phones. It is
// greyed meanwhile, with the sentence the server refuses with, and the Preview's controls check off what
// has been viewed. Request changes never waits. What was viewed lasts a reload in the same tab, and the
// approval's audit row records it.
//
//   1. A document (PDF and Web): Approve greyed with "Preview PDF and Web first."; Request
//      changes is Jordan's to press. The Preview opens on PDF; once it is drawn, PDF is checked and the
//      reason names Web alone. Web: checked, and Approve is available. A reload keeps it. Approve: v1 is
//      Active, and the audit row says ["pdf", "web"].
//   2. An alert (Push and SMS): Push on the iPhone, then SMS, then Push on Android. The phone control checks
//      each phone, the channel control checks Push once both are, and nothing moves as a check appears.
//      Approve: v1 is Active, and the audit row says ["push.ios", "push.android", "sms"].
//   3. An output the route refuses (a PDF with a character its font can't draw): the Preview shows the error,
//      the PDF is never checked, and Approve says "The PDF can't be shown. Request changes." in the same row.
//   4. A PDF the route returns but pdf.js can't open: the viewer offers the file, and downloading it counts
//      the PDF as viewed. Approve: the audit row says ["pdf", "web"].
//
// Self-contained: each test copies a seeded round in review into a template of its own (v1, in review,
// submitted by Maya), and afterAll removes them. Console and page errors fail it.

// The preview frames are sandboxed: Playwright's trace injects scripts into them ("Blocked script execution").
test.use({ trace: "off" });

const TEAM = "coral-offers";
const DOCUMENT = {
  id: "UC-E2EVD1",
  from: "Cash Back Welcome Bonus — Terms",
  name: "Viewed outputs — Terms",
};
const ALERT = {
  id: "UC-E2EVA1",
  from: "Card Used Abroad",
  name: "Viewed outputs — Alert",
};
const REFUSED = {
  id: "UC-E2EVD2",
  from: DOCUMENT.from,
  name: "Viewed outputs — Refused PDF",
};
const UNDRAWABLE = {
  id: "UC-E2EVD3",
  from: DOCUMENT.from,
  name: "Viewed outputs — Undrawable PDF",
};

const changes = new Changes();

test.beforeAll(async () => {
  // A run that died half way leaves its copies: start clean.
  for (const id of [DOCUMENT.id, ALERT.id, REFUSED.id, UNDRAWABLE.id])
    await removeTemplate(id);
});

// Removes the copies the tests made, with everything the approvals wrote for them.
test.afterAll(() => changes.undo());

/** A seeded round in review, copied as the first version of a template of its own, waiting on its first stage. */
async function copyInReview(copy: { id: string; from: string; name: string }) {
  const version = await findVersion({ name: copy.from, state: "in_review" });
  expect(version, `the seed has ${copy.from} in review`).toBeTruthy();
  await changes.addTemplateLike(version!.templateId, { id: copy.id });
  await addVersionLike(version!, {
    id: `ver_e2e_${copy.id}`,
    templateId: copy.id,
    name: copy.name,
    number: 1,
    round: 1,
    basedOnVersionId: null,
    contractChanges: null,
    currentStage: 0,
    submittedBy: "maya",
    createdBy: "maya",
    writers: ["maya"],
  });
}

const decision = (page: Page) =>
  page.locator('aside[aria-label="Decision"]').filter({ visible: true });
const approveButton = (page: Page) =>
  decision(page).getByRole("button", { name: "Approve", exact: true });
const requestButton = (page: Page) =>
  decision(page).getByRole("button", { name: "Request changes", exact: true });
const stageLine = (page: Page) =>
  decision(page).locator('[data-step="current"]');
const statusBadge = (page: Page) =>
  page
    .locator('header [data-slot="badge"][data-status]')
    .filter({ visible: true });
const segment = (group: Locator, name: string) =>
  group.getByRole("button", { name, exact: true });

/** Approve is greyed (focusable, `aria-disabled`), its reason the stage's line and its description. */
async function expectApproveWaits(page: Page, reason: string) {
  await expect(approveButton(page)).toBeDisabled();
  await expect(approveButton(page)).toHaveAccessibleDescription(reason);
  await expect(stageLine(page)).toContainText(reason);
  await expect(
    requestButton(page),
    "Request changes never waits on the outputs",
  ).toBeEnabled();
}

async function openReview(page: Page, id: string) {
  await asPersona(page, "jordan");
  await page.goto(`/${TEAM}/review/${id}/1`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await hydrated(page);
}

/** Approve → Approve v1: the version goes Active. */
async function approve(page: Page) {
  await tap(approveButton(page));
  const dialog = page.getByRole("dialog", { name: "Approve v1" });
  await expect(dialog).toBeVisible();
  await tap(dialog.getByRole("button", { name: "Approve v1", exact: true }));
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(statusBadge(page)).toHaveText("Active", { timeout: 20_000 });
}

async function auditedOutputs(templateId: string): Promise<unknown> {
  const [event] = await auditEvents({
    templateId,
    action: "version.activated",
  });
  return event!.details!.outputsViewed;
}

test("a document: Approve waits until PDF and Web have rendered on screen, and the approval records them", async ({
  page,
}) => {
  await copyInReview(DOCUMENT);
  await openReview(page, DOCUMENT.id);

  await test.step("1.1 Jordan arrives on the Document view: Approve waits on both outputs", async () => {
    await expect(
      reviewTabs(page).getByRole("tab", { name: "Document" }),
    ).toHaveAttribute("aria-selected", "true");
    await expectApproveWaits(page, "Preview PDF and Web first.");
  });

  await test.step("1.2 The Preview opens on PDF: once drawn it is checked, and Web alone is left", async () => {
    await tap(
      reviewTabs(page).getByRole("tab", { name: "Preview", exact: true }),
    );
    const pdf = segment(channelControl(page), "PDF");
    const web = segment(channelControl(page), "Web");
    await expect(pdf).toHaveAttribute("aria-pressed", "true");
    const widthBefore = (await web.boundingBox())!.width;
    await expectViewed(pdf);
    await expect(pdf).toHaveAccessibleDescription("Viewed");
    await expect(web, "picked, never shown: not viewed").not.toHaveAttribute(
      "data-done",
      "",
    );
    await expectApproveWaits(page, "Preview Web first.");

    await tap(web);
    await expectViewed(web);
    expect(
      (await web.boundingBox())!.width,
      "the check had its room before it appeared",
    ).toBe(widthBefore);
    await expect(approveButton(page)).toBeEnabled();
    await expect(stageLine(page)).toContainText("Waiting for a decision");
  });

  await test.step("1.3 A reload in the same tab keeps what was viewed", async () => {
    await page.reload();
    await hydrated(page);
    await expect(approveButton(page)).toBeEnabled();
  });

  await test.step("1.4 He approves: v1 is Active, and the audit row records the outputs he viewed", async () => {
    await approve(page);
    expect(await auditedOutputs(DOCUMENT.id)).toEqual(["pdf", "web"]);
  });
});

test("an alert: Push counts on each phone, then SMS; the controls check off what was viewed", async ({
  page,
}) => {
  await copyInReview(ALERT);
  await openReview(page, ALERT.id);
  await expectApproveWaits(
    page,
    "Preview Push (iPhone, Android) and SMS first.",
  );

  await tap(
    reviewTabs(page).getByRole("tab", { name: "Preview", exact: true }),
  );
  const push = segment(channelControl(page), "Push");
  const sms = segment(channelControl(page), "SMS");
  const iphone = segment(phoneControl(page), "iPhone");
  const android = segment(phoneControl(page), "Android");

  await test.step("2.1 Push on the iPhone: that phone is checked; Push itself waits for Android", async () => {
    await expect(push).toHaveAttribute("aria-pressed", "true");
    await expect(iphone).toHaveAttribute("aria-pressed", "true");
    await expectViewed(iphone);
    await expect(android).not.toHaveAttribute("data-done", "");
    await expect(push).not.toHaveAttribute("data-done", "");
    await expectApproveWaits(page, "Preview Push (Android) and SMS first.");
  });

  await test.step("2.2 SMS: checked, and Push on Android is all that's left", async () => {
    await tap(sms);
    await expectViewed(sms);
    await expectApproveWaits(page, "Preview Push (Android) first.");
  });

  await test.step("2.3 Push on Android: both phones and Push are checked, and Approve is his", async () => {
    await tap(push);
    const widthBefore = (await android.boundingBox())!.width;
    await tap(android);
    await expectViewed(android);
    await expectViewed(push);
    expect(
      (await android.boundingBox())!.width,
      "nothing moves as the check appears",
    ).toBe(widthBefore);
    await expect(approveButton(page)).toBeEnabled();
  });

  await test.step("2.4 He approves: v1 is Active, and the audit row records all three outputs", async () => {
    await approve(page);
    expect(await auditedOutputs(ALERT.id)).toEqual([
      "push.ios",
      "push.android",
      "sms",
    ]);
  });
});

test("an output the route refuses can't be previewed: Approve says it can't be shown and to request changes", async ({
  page,
  problems,
}) => {
  await copyInReview(REFUSED);
  await page.route(`**/api/templates/${REFUSED.id}/preview`, async (route) => {
    const asked = route.request().postDataJSON() as { channel?: string };
    if (asked.channel !== "pdf") return route.continue();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "render_failed",
          message:
            "The PDF couldn't be rendered. Its font can't show these characters: U+1F600 (\u{1F600}).",
          details: { reason: "glyphs", characters: ["U+1F600"] },
        },
      }),
    });
  });
  await openReview(page, REFUSED.id);
  const reasonBefore =
    await test.step("3.1 Approve waits on both outputs, in one line", async () => {
      await expectApproveWaits(page, "Preview PDF and Web first.");
      return (await stageLine(page).boundingBox())!;
    });

  await test.step("3.2 The Preview opens on PDF and shows the route's error: Approve now says to request changes", async () => {
    await tap(
      reviewTabs(page).getByRole("tab", { name: "Preview", exact: true }),
    );
    await expect(reviewPreview(page).getByRole("alert")).toContainText(
      "Its font can't show these characters",
    );
    await expectApproveWaits(page, "The PDF can't be shown. Request changes.");
    const after = (await stageLine(page).boundingBox())!;
    expect(
      [after.x, after.y, after.height],
      "the stage's line didn't move or grow",
    ).toEqual([reasonBefore.x, reasonBefore.y, reasonBefore.height]);
    await expect(
      segment(channelControl(page), "PDF"),
      "never shown: not viewed",
    ).not.toHaveAttribute("data-done", "");
  });

  await test.step("3.3 Web renders, and Approve still says the PDF can't be shown", async () => {
    await tap(segment(channelControl(page), "Web"));
    await expectViewed(segment(channelControl(page), "Web"));
    await expectApproveWaits(page, "The PDF can't be shown. Request changes.");
  });

  // The route's refusal is a 500, which Chrome logs: the console errors this test expects.
  const refusals = problems.filter(
    (p) =>
      /status of 500/.test(p) &&
      p.includes(`/api/templates/${REFUSED.id}/preview`),
  );
  expect(refusals.length).toBeGreaterThan(0);
  for (const refused of refusals) problems.splice(problems.indexOf(refused), 1);
});

test("a PDF pdf.js can't open counts as viewed once the approver downloads it from the viewer", async ({
  page,
}) => {
  await copyInReview(UNDRAWABLE);
  // Valid response, bytes pdf.js can't open: the viewer falls back to offering the file.
  await page.route(
    `**/api/templates/${UNDRAWABLE.id}/preview`,
    async (route) => {
      const asked = route.request().postDataJSON() as { channel?: string };
      if (asked.channel !== "pdf") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "content-disposition": `inline; filename="${UNDRAWABLE.id}-v1.pdf"`,
        },
        body: "this is not a PDF",
      });
    },
  );
  await openReview(page, UNDRAWABLE.id);

  await test.step("4.1 The Preview opens on PDF: the viewer offers the file, and the PDF is not viewed yet", async () => {
    await tap(
      reviewTabs(page).getByRole("tab", { name: "Preview", exact: true }),
    );
    const fallback = reviewPreview(page)
      .getByRole("region", { name: "PDF preview" })
      .getByRole("button", { name: "Download PDF" });
    await expect(fallback).toBeVisible({ timeout: 30_000 });
    await expect(segment(channelControl(page), "PDF")).not.toHaveAttribute(
      "data-done",
      "",
    );
    await expectApproveWaits(page, "Preview PDF and Web first.");
  });

  await test.step("4.2 He downloads the file from the viewer: the PDF is viewed", async () => {
    const download = page.waitForEvent("download");
    await tap(
      reviewPreview(page)
        .getByRole("region", { name: "PDF preview" })
        .getByRole("button", { name: "Download PDF" }),
    );
    expect((await download).suggestedFilename()).toBe(
      `${UNDRAWABLE.id}-v1.pdf`,
    );
    await expectViewed(segment(channelControl(page), "PDF"));
    await expectApproveWaits(page, "Preview Web first.");
  });

  await test.step("4.3 Web renders, and Approve records both", async () => {
    await tap(segment(channelControl(page), "Web"));
    await expectViewed(segment(channelControl(page), "Web"));
    await expect(approveButton(page)).toBeEnabled();
    await approve(page);
    expect(await auditedOutputs(UNDRAWABLE.id)).toEqual(["pdf", "web"]);
  });
});
