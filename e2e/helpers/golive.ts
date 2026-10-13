import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { correlation, render, validValues } from "../api/helpers";
import { beat, expect, tap, untilUncovered } from "./scenario";
import { SPRING_NAME, TEAM, linkOffer, type SpringFixture } from "./state";

// Shared by the going-live specs (scenarios 4, 5 and 6): the Spring Travel fixture's names, the pieces of the
// simulator ("Coral — simulated") a person drives, and the persona switcher. The fixture itself and the cleanup
// that puts the database back are in ./state.

export { SPRING_NAME, TEAM, type SpringFixture };
export const SPRING_OFFER = "offer_spring_travel";
export const SPRING_OFFER_NAME = "Spring Travel Rewards";

export const CUSTOMERS = {
  olivia: {
    name: "Olivia Bennett",
    first: "Olivia",
    last: "Bennett",
    email: "olivia.bennett@example.com",
    apr: "21.99",
  },
  marcus: {
    name: "Marcus Delgado",
    first: "Marcus",
    last: "Delgado",
    email: "marcus.delgado@example.com",
    apr: "24.49",
  },
  anjali: {
    name: "Anjali Kapoor",
    first: "Anjali",
    last: "Kapoor",
    email: "anjali.kapoor@example.com",
    apr: "19.24",
  },
  fatima: {
    name: "Fatima Al-Sayed",
    first: "Fatima",
    last: "Al-Sayed",
    email: "fatima.al-sayed@example.com",
    apr: "26.99",
  },
  long: {
    name: "Maximiliano-Bartholomew Featherstonehaugh-Villiers-Montgomery",
    first: "Maximiliano-Bartholomew",
    last: "Featherstonehaugh-Villiers-Montgomery",
    email:
      "maximiliano-bartholomew.featherstonehaugh-villiers-montgomery@example.com",
    apr: "29.99",
  },
} as const;
export type Customer = (typeof CUSTOMERS)[keyof typeof CUSTOMERS];

/** The five customers scenario 4 sends to: four ordinary ones and the long-name one. */
export const FIVE: readonly Customer[] = [
  CUSTOMERS.olivia,
  CUSTOMERS.marcus,
  CUSTOMERS.anjali,
  CUSTOMERS.fatima,
  CUSTOMERS.long,
];

// ── Coral, as the API sees it ────────────────────────────────────────────────

/** One render as Coral's send service would make it: its own consumer id, a real version, never a preview. */
export function coralRender(
  request: APIRequestContext,
  fixture: SpringFixture,
  version: number,
  label: string,
) {
  return render(request, {
    templateId: fixture.templateId,
    consumer: "coral",
    correlationId: correlation(label),
    body: { version, channel: "web", values: validValues(fixture.variables) },
  });
}

/** Coral's link of the offer to the fixture, as a person would have left it after scenario 4: pinned to v2, mapped. */
export function linkSpringOffer(fixture: SpringFixture) {
  return linkOffer({
    offerId: SPRING_OFFER,
    templateId: fixture.templateId,
    templateName: SPRING_NAME,
    pinnedVersion: 2,
    channels: ["pdf", "web", "email"],
    mapping: {
      first_name: "customer.firstName",
      last_name: "customer.lastName",
      purchase_apr: "customer.purchaseApr",
      home_state: "customer.homeState",
      offer_end_date: "offer.endsOn",
    },
  });
}

// ── Driving the screens ──────────────────────────────────────────────────────

/** A human-paced click, once the page has stopped moving under the target. */
export async function click(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await untilUncovered(target);
  await tap(target);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export { escapeRe };

export const profileButton = (page: Page) =>
  page.getByRole("button", { name: /profile and persona/ });

/** Through the persona switcher, as a presenter would: the URL stays, the page re-reads as the new person. */
export async function switchPersona(page: Page, person: string) {
  const url = page.url();
  await click(profileButton(page));
  await click(
    page.getByRole("menuitemradio", { name: new RegExp(escapeRe(person)) }),
  );
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(profileButton(page)).toHaveAccessibleName(
    new RegExp(`^${escapeRe(person)},`),
  );
  await expect(page).toHaveURL(url);
}

/** React has attached its handlers to the element (an interactive element of a simulator page). */
export async function reactReady(target: Locator) {
  await expect
    .poll(
      () =>
        target.evaluate((el) =>
          Object.keys(el).some((k) => k.startsWith("__reactProps")),
        ),
      { message: "the page is interactive" },
    )
    .toBe(true);
}

/** The Demo pill, opened. */
export async function openDemoDrawer(page: Page) {
  const pill = page.getByRole("button", { name: "Demo", exact: true });
  await reactReady(pill);
  await click(pill);
  const drawer = page.getByRole("dialog", { name: "Demo" });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** From anywhere in UCOMP: the Demo pill, "Open simulator". Lands on the simulator's offers. */
export async function openSimulator(page: Page) {
  const drawer = await openDemoDrawer(page);
  await beat(page, 600);
  await click(drawer.getByRole("button", { name: "Open simulator" }));
  await expect(page).toHaveURL(/\/sim$/);
  await expect(page.getByRole("table", { name: "Offers" })).toBeVisible();
  await reactReady(
    page.getByRole("table", { name: "Offers" }).getByRole("link").first(),
  );
}

/** From the simulator: "Back to Stencil". */
export async function backToUcomp(page: Page) {
  await click(page.getByRole("link", { name: "Back to Stencil" }));
  await expect(page.getByRole("link", { name: "Back to Stencil" })).toHaveCount(
    0,
  );
}

/** Opens one offer from the simulator's offers table. */
export async function openOffer(page: Page, offerName: string) {
  await click(
    page
      .getByRole("table", { name: "Offers" })
      .getByRole("link", { name: offerName, exact: true }),
  );
  await expect(
    page.getByRole("heading", { level: 1, name: offerName }),
  ).toBeVisible();
  await reactReady(page.getByRole("tab", { name: "Template" }));
}

/** The offer's tab, picked in the page (the URL follows). */
export async function openOfferTab(
  page: Page,
  tab: "Template" | "Values" | "Send",
) {
  const control = page.getByRole("tab", { name: tab, exact: true });
  await reactReady(control);
  await click(control);
  await expect(control).toHaveAttribute("aria-selected", "true");
}

/** The Send tab's customer picker: ticks each name, as a person would. */
export async function selectCustomers(
  page: Page,
  customers: readonly { name: string }[],
) {
  for (const customer of customers) {
    const box = page.getByRole("checkbox", {
      name: `Select ${customer.name}`,
      exact: true,
    });
    await reactReady(box);
    // A page that has just changed (a relink lands on Send) can reset the picker once more as it settles:
    // a person would see the box still empty and press it again. Press until the tick is there after the
    // page has painted twice, which is when a reset would have shown.
    for (let attempt = 0; attempt < 4; attempt++) {
      if ((await box.getAttribute("aria-checked")) !== "true") await click(box);
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      if ((await box.getAttribute("aria-checked")) === "true") break;
    }
    await expect(box).toHaveAttribute("aria-checked", "true");
  }
}

/** The results headline ("15 delivered", "0 delivered, 4 failed") of the newest send. */
export const resultsHeadline = (page: Page) =>
  page.getByRole("heading", { level: 3 }).filter({ hasText: /\d+ delivered/ });

/** The results grid's rows (one per customer). */
export const resultsRows = (page: Page) =>
  page.getByRole("table", { name: "Results" }).locator("tbody tr");

/** The Send button: "Send", or "Send to 2 customers" once some are chosen. */
export const sendButton = (page: Page) =>
  page.getByRole("button", { name: /^Send( to \d+ customers?)?$/ });

/** Send, once the page can take it. */
export async function send(page: Page) {
  const button = sendButton(page);
  await expect(button).toBeEnabled();
  await reactReady(button);
  await click(button);
}

// The console lines the recording harness itself causes are dropped by `dropDemoNoise` (../media/demo.ts).
export { dropDemoNoise } from "../media/demo";

/**
 * The failed renders of the newest send: `count` failed cells, each with the API's status and code, and the
 * API's message verbatim on screen. When every failure shares one message the grid says it once, in the
 * results header; when they differ each cell carries its own. Either way the sentence is shown as received.
 */
export async function expectFailed(
  page: Page,
  count: number,
  error: { status: number; code: string; message: string },
) {
  const cells = page
    .getByRole("table", { name: "Results" })
    .locator("td")
    .filter({ hasText: "Failed" });
  await expect(cells).toHaveCount(count);
  for (let i = 0; i < count; i++)
    await expect(cells.nth(i)).toContainText(`${error.status} ${error.code}`);
  await expect(
    page
      .getByText(error.message, { exact: false })
      .filter({ visible: true })
      .first(),
    "the API's message, verbatim",
  ).toBeVisible();
}
