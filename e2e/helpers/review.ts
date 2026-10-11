import type { Locator, Page } from "@playwright/test";
import { expect } from "./scenario";

// The review screen's Preview, as an approver pages through it before approving (decision 0037): Approve
// waits until every output of the round has rendered on screen, each channel and Push on both phones.
// Every spec that approves on the review screen calls `viewEveryOutput` first.

/** The review screen's view tabs: Document and Preview. */
export const reviewTabs = (page: Page): Locator => page.getByRole("tablist", { name: "View" });

/** The Preview's panel, while it is the view showing. */
export const reviewPreview = (page: Page): Locator => page.locator("#review-panel-preview").filter({ visible: true });

/** The Preview's channel control, and its phone control (on Push and SMS). */
export const channelControl = (page: Page): Locator => reviewPreview(page).getByRole("group", { name: "Channel", exact: true });
export const phoneControl = (page: Page): Locator => reviewPreview(page).getByRole("group", { name: "Phone", exact: true });

/** A segment the approver has viewed carries a quiet check (`data-done`). */
export async function expectViewed(segment: Locator, timeout = 30_000) {
  await expect(segment).toHaveAttribute("data-done", "", { timeout });
}

/**
 * Views every output of the round on the open review screen: opens the Preview, picks each channel in turn
 * (and for Push each phone) and waits for each to be checked off, then goes back to the view it started on.
 * Approve is the approver's to press afterwards, unless something else blocks it.
 */
export async function viewEveryOutput(page: Page) {
  const tabs = reviewTabs(page);
  const startedOn = ((await tabs.getByRole("tab", { selected: true }).textContent()) ?? "Document").trim();
  await tabs.getByRole("tab", { name: "Preview", exact: true }).click();

  const channels = channelControl(page).getByRole("button");
  await expect(channels.first()).toBeVisible();
  const count = await channels.count();
  for (let i = 0; i < count; i++) {
    const channel = channels.nth(i);
    await channel.click();
    await expect(channel).toHaveAttribute("aria-pressed", "true");
    if ((await channel.textContent())?.trim() === "Push") {
      const phones = phoneControl(page).getByRole("button");
      const phoneCount = await phones.count();
      for (let j = 0; j < phoneCount; j++) {
        await phones.nth(j).click();
        await expectViewed(phones.nth(j));
      }
    }
    await expectViewed(channel);
  }

  if (startedOn !== "Preview") await tabs.getByRole("tab", { name: startedOn, exact: true }).click();
}
