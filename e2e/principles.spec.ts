import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 7 principle checks, on every route, as the persona(s) that can see it:
//
//   1. At most one primary (black, filled) button in the canvas, and at most one in each open dialog,
//      sheet or confirm strip. "Primary" is what the shadcn Button renders for its default variant:
//      a button, link or [role=button] whose background is the --primary token.
//   2. A lifecycle status word (Draft, In review, Changes requested, Active, Superseded, Sunset, Revoked)
//      appears only inside a <StatusBadge> (its element carries data-status). Prose in the document body,
//      the audit Action column, notification sentences and the simulator are not looked at.
//   3. No element carries a placeholder (placeholder, aria-placeholder, data-placeholder) other than
//      "Type / for blocks" (which is ProseMirror's own empty-line placeholder).
//   4. axe has no violations of impact serious or critical (moderate and minor ones are logged).
//   5. CLS is 0: a PerformanceObserver (layout-shift, buffered) is installed before the document starts and
//      read after the page has settled. Shifts that follow user input (hadRecentInput) do not count.
//
// THE SIMULATOR IS A DELIBERATELY FOREIGN OUTSIDE SYSTEM (docs/UCOMP-Implementation-Plan.md §8). It gets rules
// 3, 4 and 5 (placeholders, axe, CLS) but NOT rules 1 and 2: it has its own button language and its own status
// vocabulary, and must not look like UCOMP.
//
// Next 16 keeps visited routes mounted but hidden, so every query looks at visible elements only.
// Read-only: nothing here changes data. Run against the dev server:
//   E2E_PORT=3000 npx playwright test e2e/principles.spec.ts --workers=1

// The preview iframes are sandboxed: Playwright's trace injects scripts into frames and Chrome logs "Blocked script execution".
test.use({ trace: "off" });

const PERSONA_COOKIE = "ucomp_persona";
const ALLOWED_PLACEHOLDER = "Type / for blocks";
const STATUS_WORDS = ["Draft", "In review", "Changes requested", "Active", "Superseded", "Sunset", "Revoked"];

// ── What the page reports about itself ───────────────────────────────────────

interface PageFindings {
  /** Visible primary buttons in the canvas (the main element, outside dialogs). */
  canvasPrimary: string[];
  /** Visible primary buttons per open dialog or sheet. */
  dialogPrimary: { dialog: string; buttons: string[] }[];
  /** Status words outside a StatusBadge. */
  strayStatus: string[];
  /** Placeholders that are not the one allowed. */
  placeholders: string[];
}

/** Runs in the page. Everything it looks at is visible: hidden (kept-mounted) routes do not count. */
function inspectPage(args: { foreign: boolean; allowed: string; words: string[] }): PageFindings {
  const { foreign, allowed, words } = args;
  const visible = (el: Element): boolean => {
    const html = el as HTMLElement;
    if (!html.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })) return false;
    const r = html.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = (el: Element): string => {
    const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const slot = el.getAttribute("data-slot");
    return `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ""} "${label}"`;
  };

  // ── 1. primary buttons ──
  const probe = document.createElement("div");
  probe.className = "bg-primary";
  document.body.append(probe);
  const primaryColor = getComputedStyle(probe).backgroundColor;
  probe.remove();

  const NOT_BUTTONS = '[role="switch"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitemradio"],[role="option"]';
  const isPrimary = (el: Element) => {
    if (el.matches(NOT_BUTTONS) || !visible(el)) return false;
    return getComputedStyle(el).backgroundColor === primaryColor;
  };
  const candidates = [...document.querySelectorAll('button, a[href], [role="button"]')];
  const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover-content"]';
  const dialogs = [...document.querySelectorAll(LAYER)].filter(visible);

  const inDialog = (el: Element) => !!el.closest(LAYER);
  const canvas = document.querySelector('main[data-slot="sidebar-inset"]');
  const canvasPrimary: string[] = [];
  const dialogPrimary: PageFindings["dialogPrimary"] = [];
  if (!foreign) {
    for (const el of candidates) {
      if (!isPrimary(el)) continue;
      if (inDialog(el)) continue;
      if (canvas?.contains(el)) canvasPrimary.push(describe(el));
    }
    for (const dialog of dialogs) {
      const buttons = candidates.filter((el) => dialog.contains(el) && isPrimary(el)).map(describe);
      dialogPrimary.push({ dialog: describe(dialog).slice(0, 60), buttons });
    }
  }

  // ── 2. status words outside a StatusBadge ──
  const strayStatus: string[] = [];
  if (!foreign) {
    // A status word on its own, or "Sunset Mar 1": the label of something that is, or shows, a state. Event lines
    // such as "Superseded Jul 11" in a version's history ("Submitted Mar 14 · Activated Mar 20 · …") and
    // "Revoked Oct 20: reason" say when something happened; they are log entries, not a status.
    const exact = new RegExp(`^(${words.join("|")}|Sunset( \\w{3} \\d{1,2})?)$`, "i");
    // Not looked at: the document itself, the audit Action column, notification sentences.
    const SKIP = [
      ".ProseMirror",
      ".ucomp-doc",
      '[data-slot="document"]',
      '[data-column="action"]',
      '[role="columnheader"]',
      // Column and section labels (the library's "Active" column holds a version number), and filter controls
      // (Draft 1, In review 1, Active 4: the choices of a filter, which show no item's state).
      ".caps-label",
      '[aria-label^="Filter by"]',
      '[aria-label="Notifications"]',
      '[data-slot="notification"]',
      "script",
      "style",
      "[data-status]",
    ].join(",");
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      // The whole element's text, not one text node of it: "Revoked <time>Oct 20</time>: reason" is a sentence.
      const text = (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || !el || !exact.test(text) || seen.has(el)) continue;
      seen.add(el);
      if (el.closest(SKIP) || !visible(el)) continue;
      // The audit table's Action cell is a sentence about what happened, in a cell of its own.
      if (el.closest("td, [role=cell]")?.closest("[data-slot=audit-table], [aria-label*=Audit i]")) continue;
      strayStatus.push(`${describe(el)} in ${el.parentElement ? describe(el.parentElement) : "?"}`);
    }
  }

  // ── 3. placeholders ──
  const placeholders: string[] = [];
  for (const el of document.querySelectorAll("[placeholder], [aria-placeholder], [data-placeholder]")) {
    if (!visible(el) && !(el as HTMLElement).closest(".ProseMirror")) continue;
    for (const attr of ["placeholder", "aria-placeholder", "data-placeholder"]) {
      const value = el.getAttribute(attr);
      // A bare data-placeholder (Base UI's Select marks an unfilled trigger with it) has no text of its own.
      if (value === null || value === "" || value === allowed) continue;
      placeholders.push(`${describe(el)} ${attr}="${value}"`);
    }
  }
  // Base UI Select shows its placeholder as the trigger's text; report an unfilled Select too.
  for (const el of document.querySelectorAll('[data-slot="select-value"][data-placeholder]')) {
    if (visible(el)) placeholders.push(`${describe(el)} (unfilled select shows placeholder text)`);
  }
  return { canvasPrimary, dialogPrimary, strayStatus, placeholders };
}

// ── Page plumbing ────────────────────────────────────────────────────────────

/** Before any script of the document: a buffered layout-shift observer. */
function installCls() {
  const w = window as unknown as { __cls: { value: number; shifts: string[] } };
  w.__cls = { value: 0, shifts: [] };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        startTime: number;
        sources?: { node?: Element }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        w.__cls.value += entry.value;
        const where = (entry.sources ?? [])
          .map((s) => (s.node ? `${s.node.nodeName.toLowerCase()}${(s.node as HTMLElement).className ? "." + String((s.node as HTMLElement).className).split(" ").slice(0, 3).join(".") : ""}` : "?"))
          .join(", ");
        w.__cls.shifts.push(`${entry.value.toFixed(6)} at ${Math.round(entry.startTime)}ms (${where})`);
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* not supported: the CLS check reports it */
  }
}

const profileButton = (page: Page) => page.getByRole("button", { name: /profile and persona/ });

async function asPersona(page: Page, id: string) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: PERSONA_COOKIE, value: id, url: baseURL }]);
}

/** The page has stopped moving: hydrated, streams resolved, skeletons gone, the live editor mounted if there is one. */
async function settle(page: Page, opts: { shell?: boolean } = {}) {
  if (opts.shell !== false) {
    await page.waitForFunction(() => {
      const el = document.querySelector("button[aria-label$='profile and persona']");
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
    });
  } else {
    await page.waitForLoadState("load");
  }
  await page
    .waitForFunction(() => {
      const shown = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true }) && el.getClientRects().length > 0;
      const loading = [...document.querySelectorAll('[data-slot="skeleton"], [aria-busy="true"]')].some(shown);
      const hasEditor = [...document.querySelectorAll(".ProseMirror")].filter(shown);
      const live = hasEditor.every((el) => "pmViewDesc" in el);
      return !loading && live;
    }, undefined, { timeout: 20_000 })
    .catch(() => undefined);
  // Human pace: let view transitions, fonts and the editor's server-to-live handover finish.
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

/** Opens a route as a persona and fails on a server error: another agent may be mid-edit, so wait and go again. */
async function open(page: Page, url: string, persona: string, opts: { shell?: boolean } = {}) {
  await asPersona(page, persona);
  for (let attempt = 1; ; attempt++) {
    const response = await page.goto(url, { waitUntil: "load" });
    if (!response || response.status() < 500 || attempt >= 4) {
      expect(response?.status(), `${url} responded`).toBeLessThan(500);
      break;
    }
    await page.waitForTimeout(4000 * attempt);
  }
  await settle(page, opts);
}

interface Axe {
  serious: string[];
  other: string[];
  passes: number;
}

async function runAxe(page: Page): Promise<Axe> {
  const results = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  const line = (v: (typeof results.violations)[number]) =>
    `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help} — ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(" | ")}`;
  return {
    passes: results.passes.length,
    serious: results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map(line),
    other: results.violations.filter((v) => v.impact !== "serious" && v.impact !== "critical").map(line),
  };
}

async function cls(page: Page) {
  return page.evaluate(() => (window as unknown as { __cls?: { value: number; shifts: string[] } }).__cls ?? null);
}

/** The five checks, softly, so one run reports everything a screen gets wrong. */
async function checkScreen(page: Page, label: string, opts: { foreign?: boolean } = {}) {
  const foreign = !!opts.foreign;
  const found = await page.evaluate(inspectPage, { foreign, allowed: ALLOWED_PLACEHOLDER, words: STATUS_WORDS });

  if (!foreign) {
    expect.soft(found.canvasPrimary.length <= 1, `${label}: at most one primary button in the canvas, found ${JSON.stringify(found.canvasPrimary)}`).toBe(true);
    for (const d of found.dialogPrimary) {
      expect.soft(d.buttons.length <= 1, `${label}: at most one primary button in the dialog ${d.dialog}, found ${JSON.stringify(d.buttons)}`).toBe(true);
    }
    expect.soft(found.strayStatus, `${label}: status words only inside <StatusBadge>`).toEqual([]);
  }
  expect.soft(found.placeholders, `${label}: no placeholder other than "${ALLOWED_PLACEHOLDER}"`).toEqual([]);

  const axe = await runAxe(page);
  expect.soft(axe.passes, `${label}: axe ran (it checked something)`).toBeGreaterThan(0);
  if (axe.other.length) console.log(`[axe moderate/minor] ${label}\n  ${axe.other.join("\n  ")}`);
  expect.soft(axe.serious, `${label}: axe serious/critical violations`).toEqual([]);

  const shift = await cls(page);
  expect.soft(shift, `${label}: layout-shift observer installed`).not.toBeNull();
  expect.soft(shift?.shifts ?? [], `${label}: CLS 0 (excluding shifts after input)`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installCls);
});

// ── The routes ───────────────────────────────────────────────────────────────

// Personas: maya (author), jordan (approver), alex (team admin, Coral Offers), dana (viewer, Legal
// reviewer), priya (author Coral, viewer Deposits), riley (Platform Admin), taylor (Auditor), morgan (no access).
const COLLECT = "UC-J530DX"; // Cash Back Welcome Bonus: v1 superseded, v2 active, v3 in review
const BALANCE = "UC-D6KSGY"; // Balance Transfer Intro: v1 superseded, v2 active
const FEE_WAIVER = "UC-1NKHEN"; // v1 changes requested
const HOLIDAY = "UC-H8QY9G"; // v1 revoked, v2 active
const RATE_CHANGE = "UC-D3R0YG"; // v1 active
const DEPOSIT = "UC-C20V29"; // Deposits, v1 active
const STATEMENT = "UC-E0VB9A"; // Card Statements, v1 active

interface Route {
  url: string;
  personas: string[];
}

const LIBRARY: Route[] = [
  { url: "/coral-offers/library", personas: ["maya", "jordan", "alex", "dana", "riley", "taylor"] },
  { url: "/deposits/library", personas: ["priya", "riley"] },
  { url: "/card-statements/library", personas: ["riley", "taylor"] },
  { url: "/all/library", personas: ["riley", "taylor"] },
];

const WORKSPACE_TABS = ["", "/versions", "/usage", "/activity"];
const WORKSPACE: Route[] = [
  // All four tabs on the template with every kind of version, as the author, an approver and an observer.
  ...WORKSPACE_TABS.map((tab) => ({ url: `/coral-offers/templates/${COLLECT}${tab}`, personas: ["maya", "jordan", "taylor"] })),
  // And every tab on a second template, with a superseded and a sunset history.
  ...WORKSPACE_TABS.map((tab) => ({ url: `/coral-offers/templates/${BALANCE}${tab}`, personas: ["maya"] })),
  // The other lifecycle states, on the Content tab and Versions.
  ...["", "/versions"].flatMap((tab) =>
    [FEE_WAIVER, HOLIDAY, RATE_CHANGE].map((id) => ({ url: `/coral-offers/templates/${id}${tab}`, personas: ["maya"] })),
  ),
  // Read-only viewers and other teams.
  { url: `/coral-offers/templates/${RATE_CHANGE}`, personas: ["dana"] },
  { url: `/deposits/templates/${DEPOSIT}`, personas: ["priya", "riley"] },
  { url: `/deposits/templates/${DEPOSIT}/versions`, personas: ["priya"] },
  { url: `/card-statements/templates/${STATEMENT}`, personas: ["riley"] },
  { url: `/card-statements/templates/${STATEMENT}/usage`, personas: ["riley"] },
];

const REVIEW: Route[] = [
  { url: "/coral-offers/review", personas: ["jordan", "alex", "maya"] },
  { url: "/all/review", personas: ["riley", "taylor"] },
  // The review screen for the version in review (v3): the approver, the author who submitted it, Legal, an observer.
  { url: `/coral-offers/review/${COLLECT}/3`, personas: ["jordan", "maya", "dana", "taylor"] },
  { url: `/coral-offers/review/${COLLECT}/2`, personas: ["jordan"] },
];

const USAGE: Route[] = [
  { url: "/coral-offers/usage", personas: ["maya", "jordan", "alex", "riley"] },
  { url: "/coral-offers/usage?tab=consumers", personas: ["jordan", "riley"] },
  { url: "/all/usage?tab=consumers", personas: ["riley"] },
  { url: "/deposits/usage", personas: ["priya", "riley"] },
  { url: "/all/usage", personas: ["riley", "taylor"] },
];

const AUDIT: Route[] = [
  { url: "/coral-offers/audit", personas: ["alex", "riley", "taylor"] },
  { url: "/deposits/audit", personas: ["riley"] },
  { url: "/all/audit", personas: ["riley", "taylor"] },
];

// The settings sections as hard navigations (reload or a shared link): the dialog over the library.
const TEAM_SECTIONS = ["members", "access-requests", "recertification", "inactivity"];
const PLATFORM_SECTIONS = ["teams", "content-types", "channel-rules", "approval-chains"];
const SETTINGS_HARD: Route[] = [
  ...TEAM_SECTIONS.map((s) => ({ url: `/coral-offers/settings/${s}`, personas: ["alex"] })),
  ...PLATFORM_SECTIONS.map((s) => ({ url: `/coral-offers/settings/${s}`, personas: ["riley"] })),
  { url: "/all/settings/teams", personas: ["riley"] },
];

const REQUEST_ACCESS: Route[] = [{ url: "/request-access", personas: ["morgan"] }];

function describeRoutes(group: string, routes: Route[]) {
  test.describe(group, () => {
    for (const route of routes) {
      for (const persona of route.personas) {
        test(`${route.url} as ${persona}`, async ({ page }) => {
          await open(page, route.url, persona);
          // The persona must actually be allowed here: a redirect elsewhere means this row of the matrix is wrong.
          expect(new URL(page.url()).pathname, "the route shows for this persona (no redirect)").toBe(route.url.split("?")[0]);
          await checkScreen(page, `${route.url} as ${persona}`);
        });
      }
    }
  });
}

describeRoutes("Library", LIBRARY);
describeRoutes("Template workspace (Content, Versions, Usage, Activity)", WORKSPACE);
describeRoutes("Review queue and review screen", REVIEW);
describeRoutes("Usage dashboard", USAGE);
describeRoutes("Audit", AUDIT);
describeRoutes("Settings (hard navigation)", SETTINGS_HARD);
describeRoutes("Request access", REQUEST_ACCESS);

// ── The settings modal (soft navigation, through the sidebar footer) ─────────

test.describe("Settings modal", () => {
  const cases: { persona: string; space: string; sections: string[] }[] = [
    { persona: "alex", space: "coral-offers", sections: TEAM_SECTIONS },
    { persona: "riley", space: "coral-offers", sections: PLATFORM_SECTIONS },
  ];
  for (const { persona, space, sections } of cases) {
    test(`modal sections as ${persona}`, async ({ page }) => {
      await open(page, `/${space}/library`, persona);
      await page.locator('[data-slot="sidebar-footer"]').getByRole("link", { name: "Settings" }).click({ delay: 90 });
      const dialog = page.getByRole("dialog").filter({ has: page.getByRole("navigation", { name: "Settings sections" }) });
      await expect(dialog).toBeVisible();
      await settle(page);
      for (const section of sections) {
        const link = dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: new RegExp(`^${section.replace("-", "[ -]")}`, "i") });
        await link.click({ delay: 90 });
        await expect(link).toHaveAttribute("aria-current", /page|true/);
        await settle(page);
        await checkScreen(page, `settings modal "${section}" as ${persona}`);
      }
    });
  }
});

// ── The simulator: a foreign system (axe, CLS and placeholders only) ─────────

test.describe("Simulator (foreign system)", () => {
  const SIM = [
    "/sim",
    "/sim/customers",
    "/sim/deliveries",
    "/sim/notices",
    "/sim/offers/offer_spring_travel",
    "/sim/offers/offer_cash_back",
    "/sim/offers/offer_cash_back/link",
  ];
  for (const url of SIM) {
    test(`${url}`, async ({ page }) => {
      await open(page, url, "maya", { shell: false });
      expect(new URL(page.url()).pathname).toBe(url);
      await checkScreen(page, url, { foreign: true });
    });
  }
});

// ── Views inside a page: tabs and filters ────────────────────────────────────

test.describe("Views inside a page", () => {
  const TAB_PAGES: { url: string; persona: string }[] = [
    { url: "/coral-offers/review", persona: "jordan" },
    { url: "/all/review", persona: "riley" },
    { url: `/coral-offers/templates/${FEE_WAIVER}`, persona: "maya" }, // the rail's views (Variables, Comments, ...)
    { url: `/coral-offers/review/${COLLECT}/3`, persona: "jordan" },
    { url: "/coral-offers/usage", persona: "jordan" }, // Overview, Consumers
  ];
  for (const { url, persona } of TAB_PAGES) {
    test(`every tab of ${url} as ${persona}`, async ({ page }) => {
      await open(page, url, persona);
      const names = await page
        .getByRole("tab")
        .filter({ visible: true })
        .evaluateAll((tabs) => tabs.map((t) => (t.getAttribute("aria-label") ?? t.textContent ?? "").replace(/\s+/g, " ").trim()));
      expect(names.length, "the page has tabs").toBeGreaterThan(0);
      for (const name of names) {
        const tab = page.getByRole("tab").filter({ visible: true }).filter({ hasText: name.replace(/\s*\d+$/, "") }).first();
        await click(tab);
        await page.waitForTimeout(1200);
        await checkScreen(page, `${url} as ${persona}, tab "${name}"`);
      }
    });
  }

  test("every status filter of the Library (Maya)", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    const filters = page.getByRole("group", { name: "Filter by status" }).getByRole("button").filter({ visible: true });
    const count = await filters.count();
    expect(count, "the Library has status filters").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const label = ((await filters.nth(i).textContent()) ?? "").trim();
      await click(filters.nth(i));
      await page.waitForTimeout(900);
      await checkScreen(page, `Library filtered by "${label}" as maya`);
    }
  });
});

// ── The checks themselves must be able to fail ───────────────────────────────

test.describe("The checks catch what they should", () => {
  test("a stray status word, a second primary button and a placeholder are all found", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    const clean = await page.evaluate(inspectPage, { foreign: false, allowed: ALLOWED_PLACEHOLDER, words: STATUS_WORDS });
    expect(clean.canvasPrimary, "the Library's one primary button is seen").toHaveLength(1);
    expect(await page.locator('main [data-slot="badge"][data-status]').filter({ visible: true }).count(), "the Library shows StatusBadges").toBeGreaterThan(0);
    await page.evaluate(() => {
      const main = document.querySelector('main[data-slot="sidebar-inset"]')!;
      main.insertAdjacentHTML(
        "beforeend",
        '<span id="x1">Superseded</span><button id="x2" class="bg-primary">Second</button><input id="x3" placeholder="Enter a name">',
      );
    });
    const dirty = await page.evaluate(inspectPage, { foreign: false, allowed: ALLOWED_PLACEHOLDER, words: STATUS_WORDS });
    expect(dirty.canvasPrimary.length, "a second primary button is counted").toBe(2);
    expect(dirty.strayStatus.join()).toContain("Superseded");
    expect(dirty.placeholders.join()).toContain("Enter a name");
    expect((await runAxe(page)).passes, "axe checked something").toBeGreaterThan(0);
  });
});

// ── Dialogs, sheets, strips, popovers: each with a confirm is checked for at most one primary ──

/** Lets an opened layer finish its entrance (focus lands a frame after it opens), then runs the checks. */
async function checkOpened(page: Page, label: string) {
  await page.waitForTimeout(900);
  await checkScreen(page, label);
}

const click = (target: Locator) => target.click({ delay: 90 });

test.describe("Dialogs, sheets, strips and popovers", () => {
  test("New template gallery (Library, Maya)", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    await click(page.getByRole("button", { name: "New template" }));
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkOpened(page, "New template gallery as maya");
  });

  test("Submit for review dialog (a draft, Maya)", async ({ page }) => {
    await open(page, `/coral-offers/templates/${FEE_WAIVER}`, "maya");
    await click(page.getByRole("button", { name: "Submit for review" }));
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkOpened(page, "Submit for review dialog as maya");
  });

  test("Approve and Request changes dialogs (review screen, Jordan)", async ({ page }) => {
    await open(page, `/coral-offers/review/${COLLECT}/3`, "jordan");
    const decision = page.locator('aside[aria-label="Decision"]').filter({ visible: true });
    await click(decision.getByRole("button", { name: "Approve", exact: true }));
    await expect(page.getByRole("dialog", { name: /^Approve v3/ })).toBeVisible();
    await checkOpened(page, "Approve dialog as jordan");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /^Approve v3/ })).toBeHidden();
    await click(decision.getByRole("button", { name: "Request changes", exact: true }));
    await expect(page.getByRole("dialog", { name: /Request changes/ })).toBeVisible();
    await checkOpened(page, "Request changes dialog as jordan");
  });

  test("Revoke dialog (Versions, Jordan)", async ({ page }) => {
    await open(page, `/coral-offers/templates/${COLLECT}/versions`, "jordan");
    const revoke = page.getByRole("button", { name: /^Revoke v\d/ }).filter({ visible: true }).first();
    test.skip((await revoke.count()) === 0, "no version can be revoked in the current data");
    await click(revoke);
    await expect(page.getByRole("dialog", { name: /^Revoke v\d/ })).toBeVisible();
    await checkOpened(page, "Revoke dialog as jordan");
  });

  test("Integration sheet (Jordan and Maya)", async ({ page }) => {
    for (const persona of ["jordan", "maya"]) {
      await open(page, `/coral-offers/templates/${RATE_CHANGE}`, persona);
      await click(page.getByRole("button", { name: /^Share .* — integration details$/ }).filter({ visible: true }));
      await expect(page.getByRole("dialog").filter({ hasText: "Integration" })).toBeVisible();
      await checkOpened(page, `Integration sheet as ${persona}`);
    }
  });

  test("Copilot prompt (Variables, Maya)", async ({ page }) => {
    await open(page, `/coral-offers/templates/${FEE_WAIVER}`, "maya");
    await click(page.getByRole("tab", { name: "Variables", exact: true }).filter({ visible: true }));
    await click(page.getByRole("button", { name: "Copilot prompt" }).filter({ visible: true }));
    await expect(page.getByRole("dialog", { name: "Prompt for Copilot" })).toBeVisible();
    await checkOpened(page, "Copilot prompt as maya");
  });

  test("Preview mode (the rail widens, Maya)", async ({ page }) => {
    await open(page, `/coral-offers/templates/${COLLECT}`, "maya");
    await click(page.getByRole("button", { name: "Preview", exact: true }));
    await page.waitForTimeout(2500); // the render streams into the frame
    await checkOpened(page, "Preview mode as maya");
  });

  test("Command palette (Maya)", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
    await checkOpened(page, "Command palette as maya");
  });

  test("Settings consequence strips (Alex: remove a member; Riley: a channel rule)", async ({ page }) => {
    await open(page, "/coral-offers/settings/members", "alex");
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("navigation", { name: "Settings sections" }) });
    await expect(dialog).toBeVisible();
    await click(dialog.getByRole("button", { name: "Remove", exact: true }).filter({ visible: true }).first());
    await expect(dialog.locator('[data-slot="consequence-strip"]').filter({ visible: true })).toBeVisible();
    await checkOpened(page, "Remove-member strip as alex");

    await open(page, "/coral-offers/settings/channel-rules", "riley");
    await click(dialog.getByRole("switch", { name: "Disclosure on Email" }));
    await expect(dialog.locator('[data-slot="consequence-strip"]').filter({ visible: true })).toBeVisible();
    await checkOpened(page, "Channel-rule strip as riley");
  });

  test("The Demo drawer and its Reset confirm", async ({ page }) => {
    await open(page, "/coral-offers/library", "maya");
    await click(page.getByRole("button", { name: "Demo", exact: true }));
    const drawer = page.getByRole("dialog", { name: "Demo" });
    await expect(drawer).toBeVisible();
    await checkOpened(page, "Demo drawer as maya");
    await click(drawer.getByRole("button", { name: "Reset demo" }));
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await checkOpened(page, "Reset demo confirm as maya");
    // Nothing is reset: the confirm is only looked at, then cancelled.
    await click(page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }));
  });

  test("Bell, Help, profile menu and team switcher", async ({ page }) => {
    await open(page, "/coral-offers/library", "jordan");
    await click(page.getByRole("button", { name: /^Notifications/ }));
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await checkOpened(page, "Notifications popover as jordan");
    await page.keyboard.press("Escape");
    await click(page.getByRole("button", { name: "Help" }));
    await page.waitForTimeout(600);
    await checkOpened(page, "Help popover as jordan");
    await page.keyboard.press("Escape");
    await click(profileButton(page));
    await expect(page.getByRole("menu")).toBeVisible();
    await checkOpened(page, "Profile and persona menu as jordan");
    await page.keyboard.press("Escape");
    await open(page, "/all/library", "riley");
    await click(page.getByRole("button", { name: "Switch team" }));
    await expect(page.getByRole("menu")).toBeVisible();
    await checkOpened(page, "Team switcher as riley");
  });
});
