import { test as base, expect, type Locator, type Page } from "@playwright/test";

// Phase 1 gate: shell, personas, library, workspace header (SHARE ring), editor first look.
// Runs serially against the production build after `npm run db:reset` (see playwright.config.ts).
// Every test also fails on any console error or uncaught page error.

const PERSONA_COOKIE = "ucomp_persona";

// ── Seed knowledge (src/server/seed): names are stable, IDs are not assumed ──
const CORAL = [
  "Annual Fee Waiver — Terms",
  "Balance Transfer Intro — Terms",
  "Cash Back Welcome Bonus — Terms",
  "Holiday Points Promo — Terms",
  "Rate Change Notice",
];
const DEPOSITS = [
  "Everyday Checking — Fee Schedule",
  "High-Yield Savings — Rate Disclosure",
  "Overdraft Protection — Terms",
];
const CARD_STATEMENTS = [
  "Statement Insert — Annual Privacy Notice",
  "Statement Insert — Paperless Enrollment",
  "Statement Insert — Rate Change",
];
const ALL = [...CORAL, ...DEPOSITS, ...CARD_STATEMENTS].sort();

interface PersonaSpec {
  id: string;
  name: string;
  /** Entries in the team switcher, in order. Empty = no team yet. */
  spaces: string[];
  landing: string;
  /** Main-nav link labels, in order. */
  nav: string[];
  settings: boolean;
  /** Review badge count, or null for no badge. */
  review: number | null;
  /** Template names the landing library lists. */
  rows: string[];
}

const CROSS_TEAM_SPACES = ["All teams", "Card Statements", "Coral Offers", "Deposits"];

const PERSONAS: PersonaSpec[] = [
  { id: "maya", name: "Maya Chen", spaces: ["Coral Offers"], landing: "/coral-offers/library", nav: ["Library", "Review", "Usage"], settings: false, review: null, rows: CORAL },
  { id: "jordan", name: "Jordan Ellis", spaces: ["Coral Offers"], landing: "/coral-offers/library", nav: ["Library", "Review", "Usage"], settings: false, review: 1, rows: CORAL },
  { id: "alex", name: "Alex Kim", spaces: ["Coral Offers"], landing: "/coral-offers/library", nav: ["Library", "Review", "Usage", "Audit"], settings: true, review: 1, rows: CORAL },
  { id: "priya", name: "Priya Raman", spaces: ["Coral Offers", "Deposits"], landing: "/coral-offers/library", nav: ["Library", "Review", "Usage"], settings: false, review: null, rows: CORAL },
  { id: "sam", name: "Sam Ortiz", spaces: ["Coral Offers"], landing: "/coral-offers/library", nav: ["Library", "Review", "Usage"], settings: false, review: null, rows: CORAL },
  { id: "riley", name: "Riley Brooks", spaces: CROSS_TEAM_SPACES, landing: "/all/library", nav: ["Library", "Review", "Usage", "Audit"], settings: true, review: null, rows: ALL },
  { id: "taylor", name: "Taylor Nguyen", spaces: CROSS_TEAM_SPACES, landing: "/all/library", nav: ["Library", "Review", "Usage", "Audit"], settings: false, review: null, rows: ALL },
  { id: "morgan", name: "Morgan Lee", spaces: [], landing: "/request-access", nav: [], settings: false, review: null, rows: [] },
];

// ── Fixtures ──

interface Fixtures {
  /** Uncaught page errors and console errors collected during the test. */
  problems: string[];
  /**
   * The router prefetch of a template link is answered with an empty 204 instead of hitting the
   * server. Without it, the library page currently re-requests every link's prefetch hundreds of
   * times a second (see "prefetch storm" below), which would make every other test slow and noisy.
   */
  calmPrefetch: boolean;
}

const test = base.extend<Fixtures>({
  calmPrefetch: [true, { option: true }],
  problems: [
    async ({ page, calmPrefetch }, use) => {
      const problems: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") problems.push(`console.error: ${msg.text()} @ ${msg.location().url}`);
      });
      page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      page.on("crash", () => problems.push("page crashed"));
      await page.addInitScript(observeLayoutShift);
      if (calmPrefetch) {
        await page.context().route(/\/templates\/UC-[A-Z0-9]+\?_rsc=/, (route) =>
          route.request().headers()["next-router-prefetch"] === "1"
            ? route.fulfill({ status: 204 })
            : route.continue(),
        );
      }
      await use(problems);
      expect(problems, "console errors and page errors").toEqual([]);
    },
    { auto: true },
  ],
});

/** Runs in the page before any script: records every layout shift (buffered) from document start. */
function observeLayoutShift() {
  const w = window as unknown as { __cls: number; __shifts: { value: number; at: number; nodes: string[] }[] };
  w.__cls = 0;
  w.__shifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        startTime: number;
        hadRecentInput: boolean;
        sources?: { node?: Element }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        w.__cls += entry.value;
        w.__shifts.push({
          value: entry.value,
          at: Math.round(entry.startTime),
          nodes: (entry.sources ?? []).map((s) => {
            const el = s.node as HTMLElement | undefined;
            return el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).slice(0, 60)}` : "?";
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* layout-shift unsupported */
  }
}

async function readCls(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __cls: number; __shifts: unknown[] };
    return { cls: w.__cls, shifts: w.__shifts };
  });
}

/** React has attached its handlers to the shell (the profile button is interactive). */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("button[aria-label$='profile and persona']");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  });
}

async function asPersona(page: Page, id: string) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100";
  await page.context().addCookies([{ name: PERSONA_COOKIE, value: id, url: baseURL }]);
}

// ── Page helpers ──

const sidebarNav = (page: Page) => page.locator('[data-slot="sidebar-content"]');
const sidebarFooter = (page: Page) => page.locator('[data-slot="sidebar-footer"]');
const profileButton = (page: Page) => page.getByRole("button", { name: /profile and persona/ });

async function openSwitcher(page: Page) {
  await page.getByRole("button", { name: "Switch team" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function teamSwitcherEntries(page: Page): Promise<string[]> {
  const menu = await openSwitcher(page);
  const entries = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  return entries;
}

async function mainNavLabels(page: Page): Promise<string[]> {
  const links = sidebarNav(page).getByRole("link");
  // Link names are "Review 1 waiting": read the visible label (first text line) instead.
  return (await links.allInnerTexts()).map((t) => t.split("\n")[0]!.trim());
}

interface LibraryRow {
  name: string;
  id: string;
  status: string;
  active: string;
  href: string;
  team: string | null;
}

/** Waits for the library list and returns its rows. The "All teams" library has a Team column. */
async function libraryRows(page: Page): Promise<LibraryRow[]> {
  // Next keeps the previous route alive (display: none) behind the new one, so only count what is shown.
  const rows = page.locator("main ul > li > a[href*='/templates/']").filter({ visible: true });
  await expect(rows.first()).toBeVisible();
  await hydrated(page);
  const count = await rows.count();
  const out: LibraryRow[] = [];
  const hasTeamColumn = await page
    .locator("main [aria-hidden='true'] .caps-label", { hasText: /^Team$/ })
    .filter({ visible: true })
    .count()
    .then((n) => n > 0);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const lines = (await row.innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
    // name, id, [team,] status, active, last edited, owner initials, owner name
    const offset = hasTeamColumn ? 1 : 0;
    out.push({
      name: lines[0]!,
      id: lines[1]!,
      team: hasTeamColumn ? lines[2]! : null,
      status: lines[2 + offset]!,
      active: lines[3 + offset]!,
      href: (await row.getAttribute("href"))!,
    });
  }
  return out;
}

const names = (rows: LibraryRow[]) => rows.map((r) => r.name).sort();

async function expectLanded(page: Page, spec: PersonaSpec) {
  await expect(page).toHaveURL(new RegExp(`${spec.landing}$`));
}

async function openTemplate(page: Page, name: string) {
  await page.getByRole("link", { name: new RegExp(`^${escapeRe(name)}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await hydrated(page);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const editor = (page: Page): Locator => page.locator(".ProseMirror").filter({ visible: true });

/**
 * The server renders the document as static markup with the editor's classes; the live editor
 * swaps in after hydration. ProseMirror stamps `pmViewDesc` on its root once it is live.
 */
async function liveEditor(page: Page): Promise<Locator> {
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".ProseMirror")].some(
      (el) => (el as HTMLElement).offsetParent !== null && "pmViewDesc" in el,
    ),
  );
  return editor(page);
}

/**
 * Puts the caret at the end of a paragraph the way a person does: a click with a natural
 * press-and-release (Playwright's default click releases within ~1ms, which ProseMirror
 * sometimes misses: its selection then stays at the document start).
 */
async function caretAtEndOf(page: Page, paragraph: Locator) {
  const box = (await paragraph.boundingBox())!;
  await paragraph.click({ position: { x: box.width - 3, y: box.height - 9 }, delay: 90 });
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.querySelector(".ProseMirror") as unknown as { editor: { state: { selection: { from: number } } } }).editor.state.selection.from,
      ),
    )
    .toBeGreaterThan(1);
}

/** Selects a block's text by dragging across it, with a natural press-and-release. */
async function dragSelect(page: Page, block: Locator) {
  const rect = await block.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, height: r.height };
  });
  const y = rect.top + rect.height / 2;
  await page.mouse.move(rect.left + 1, y, { steps: 3 });
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move(rect.right - 1, y, { steps: 8 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

// ───────────────────────────────────────────────────────────────────────────
// Per-persona shell and library
// ───────────────────────────────────────────────────────────────────────────

test.describe("shell and library, per persona", () => {
  for (const spec of PERSONAS) {
    test(`${spec.id}: lands, switcher, nav, settings, review badge, library rows`, async ({ page }) => {
      await asPersona(page, spec.id);
      await page.goto("/");
      await expectLanded(page, spec);

      if (spec.id === "morgan") {
        // No team: a "No team yet" header, no nav, no Settings, and the request-access page.
        await expect(page.getByRole("heading", { level: 1, name: "Request access" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Switch team" })).toHaveCount(0);
        await expect(sidebarNav(page).getByRole("link")).toHaveCount(0);
        await expect(sidebarNav(page).getByText("No team yet").or(page.getByText("No team yet"))).toBeVisible();
        await expect(sidebarFooter(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
        // Having no team, Morgan cannot open anyone's library: it falls back to request access.
        await page.goto("/coral-offers/library");
        await expect(page).toHaveURL(/\/request-access$/);
        return;
      }

      await expect(profileButton(page)).toHaveAccessibleName(new RegExp(`^${spec.name},`));

      // Team switcher entries
      expect(await teamSwitcherEntries(page)).toEqual(spec.spaces);

      // Nav items (Audit only for alex, riley, taylor)
      expect(await mainNavLabels(page)).toEqual(spec.nav);
      const auditLink = sidebarNav(page).getByRole("link", { name: "Audit" });
      await expect(auditLink).toHaveCount(spec.nav.includes("Audit") ? 1 : 0);

      // Settings (alex, riley only)
      await expect(sidebarFooter(page).getByRole("link", { name: "Settings" })).toHaveCount(spec.settings ? 1 : 0);
      await expect(sidebarFooter(page).getByRole("button", { name: "Help" })).toBeVisible();

      // Review badge ("1" for jordan and alex only)
      const review = sidebarNav(page).getByRole("link", { name: /^Review/ });
      const badge = review.locator("[aria-label$='waiting']");
      if (spec.review === null) await expect(badge).toHaveCount(0);
      else {
        await expect(badge).toHaveText(String(spec.review));
        await expect(badge).toHaveAccessibleName(`${spec.review} waiting`);
      }

      // Library rows belong only to the persona's spaces
      const rows = await libraryRows(page);
      expect(names(rows)).toEqual([...spec.rows].sort());
      if (spec.landing.startsWith("/all/")) {
        expect(rows).toHaveLength(11);
        await expect(page.locator(".caps-label", { hasText: /^Team$/ }).filter({ visible: true })).toHaveCount(1);
        const byTeam = Object.groupBy(rows, (r) => r.team ?? "");
        expect(Object.keys(byTeam).sort()).toEqual(["Card Statements", "Coral Offers", "Deposits"]);
        expect(byTeam["Coral Offers"]).toHaveLength(5);
        expect(byTeam["Deposits"]).toHaveLength(3);
        expect(byTeam["Card Statements"]).toHaveLength(3);
      } else {
        expect(rows.every((r) => r.href.startsWith("/coral-offers/templates/"))).toBe(true);
        for (const n of [...DEPOSITS, ...CARD_STATEMENTS]) expect(names(rows)).not.toContain(n);
      }
      await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();

      // The one primary action: authors get "New template", nobody else does.
      const newTemplate = page.getByRole("button", { name: "New template" });
      await expect(newTemplate).toHaveCount(spec.id === "maya" || spec.id === "priya" ? 1 : 0);
    });
  }

  test("Card Statements content never appears for a Coral persona, even by URL", async ({ page }) => {
    // Find a Card Statements template id the way a Platform Admin sees it.
    await asPersona(page, "riley");
    await page.goto("/all/library");
    const insert = (await libraryRows(page)).find((r) => r.name === "Statement Insert — Rate Change")!;
    expect(insert.team).toBe("Card Statements");

    await asPersona(page, "maya");
    await page.goto("/card-statements/library");
    await expect(page).toHaveURL(/\/coral-offers\/library$/);
    const rows = await libraryRows(page);
    for (const n of CARD_STATEMENTS) expect(names(rows)).not.toContain(n);

    // The same template under the Coral space, or under its own space, is not Maya's to open.
    for (const href of [`/coral-offers/templates/${insert.id}`, `/card-statements/templates/${insert.id}`]) {
      await page.goto(href);
      await expect(page.getByText("Statement Insert", { exact: false })).toHaveCount(0);
      await expect(page.locator("main h1").filter({ visible: true })).not.toContainText("Statement Insert");
      await expect(editor(page)).toHaveCount(0);
    }
  });

  test("priya sees Deposits as a separate space and loses it when she leaves", async ({ page }) => {
    await asPersona(page, "priya");
    await page.goto("/coral-offers/library");
    await libraryRows(page);
    const menu = await openSwitcher(page);
    await menu.getByRole("menuitem", { name: "Deposits" }).click();
    await expect(page).toHaveURL(/\/deposits\/library$/);
    expect(names(await libraryRows(page))).toEqual([...DEPOSITS].sort());
    await expect(page.getByRole("button", { name: "Switch team" })).toContainText("Deposits");
    // Viewer on Deposits: no New template there.
    await expect(page.getByRole("button", { name: "New template" })).toHaveCount(0);
    // But she can't open Card Statements: she is sent home.
    await page.goto("/card-statements/library");
    await expect(page).toHaveURL(/\/coral-offers\/library$/);
  });

  test("riley and taylor: every team's library is reachable from the switcher", async ({ page }) => {
    await asPersona(page, "riley");
    await page.goto("/");
    await expect(page).toHaveURL(/\/all\/library$/);
    expect(await libraryRows(page)).toHaveLength(11);
    const menu = await openSwitcher(page);
    await menu.getByRole("menuitem", { name: "Card Statements" }).click();
    await expect(page).toHaveURL(/\/card-statements\/library$/);
    expect(names(await libraryRows(page))).toEqual([...CARD_STATEMENTS].sort());
    await expect(page.getByRole("button", { name: "New template" })).toHaveCount(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Persona switching through the profile menu
// ───────────────────────────────────────────────────────────────────────────

async function switchVia(page: Page, personaName: string) {
  await profileButton(page).click();
  await page.getByRole("menuitemradio", { name: new RegExp(personaName) }).click();
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(profileButton(page)).toHaveAccessibleName(new RegExp(`^${personaName},`));
}

test.describe("persona switcher", () => {
  test("lists all eight personas with a one-line role summary", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/coral-offers\/library$/);
    await profileButton(page).click();
    const items = page.getByRole("menuitemradio");
    await expect(items).toHaveCount(8);
    await expect(items.nth(0)).toContainText("Maya Chen");
    await expect(items.nth(0)).toContainText("Coral Offers · Author");
    await expect(items.nth(0)).toBeChecked();
    await expect(page.getByRole("menuitemradio", { name: /Riley Brooks/ })).toContainText("Platform Admin");
    await expect(page.getByRole("menuitemradio", { name: /Morgan Lee/ })).toContainText("No team yet");
  });

  test("switching keeps the URL when the new persona may see it, otherwise goes home", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await libraryRows(page);

    // Maya → Jordan on the library: same URL, Review badge appears.
    await switchVia(page, "Jordan Ellis");
    await expect(page).toHaveURL(/\/coral-offers\/library$/);
    await expect(sidebarNav(page).getByRole("link", { name: /^Review/ }).locator("[aria-label='1 waiting']")).toHaveText("1");

    // Jordan → Alex deep inside a template: same URL, Audit appears, Settings appears.
    await openTemplate(page, "Balance Transfer Intro — Terms");
    const templateUrl = page.url();
    await switchVia(page, "Alex Kim");
    await expect(page).toHaveURL(templateUrl);
    await expect(sidebarNav(page).getByRole("link", { name: "Audit" })).toBeVisible();
    await expect(sidebarFooter(page).getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Balance Transfer Intro — Terms" })).toBeVisible();

    // Alex → Riley: a Platform Admin may see any team, so the URL stays.
    await switchVia(page, "Riley Brooks");
    await expect(page).toHaveURL(templateUrl);
    expect(await teamSwitcherEntries(page)).toEqual(CROSS_TEAM_SPACES);

    // Riley → Priya on a Card Statements page would be refused, so go there first.
    await page.goto("/card-statements/library");
    await libraryRows(page);
    await switchVia(page, "Priya Raman");
    await expect(page).toHaveURL(/\/coral-offers\/library$/);

    // Priya → Morgan: no team, so request access.
    await switchVia(page, "Morgan Lee");
    await expect(page).toHaveURL(/\/request-access$/);
    await expect(page.getByRole("heading", { level: 1, name: "Request access" })).toBeVisible();
    await expect(sidebarNav(page).getByRole("link")).toHaveCount(0);

    // Morgan → Maya: from request access, someone with a team lands in it.
    await switchVia(page, "Maya Chen");
    await expect(page).toHaveURL(/\/coral-offers\/library$/);
    expect(names(await libraryRows(page))).toEqual([...CORAL].sort());
  });

  test("the persona survives a reload (cookie)", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await switchVia(page, "Sam Ortiz");
    await page.reload();
    await expect(profileButton(page)).toHaveAccessibleName(/^Sam Ortiz,/);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === PERSONA_COOKIE)?.value).toBe("sam");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Workspace: header, SHARE ring, integration sheet, editor
// ───────────────────────────────────────────────────────────────────────────

const ring = (page: Page) => page.locator("[data-slot='share-ring']");

test.describe("workspace", () => {
  test("SHARE ring appears exactly on templates that have an Active version", async ({ page }) => {
    await asPersona(page, "riley");
    await page.goto("/all/library");
    const rows = await libraryRows(page);
    expect(rows).toHaveLength(11);

    const withActive = rows.filter((r) => r.active !== "—");
    const without = rows.filter((r) => r.active === "—");
    // Seed sanity: both kinds exist, so the assertion below means something.
    expect(withActive.length).toBeGreaterThanOrEqual(6);
    expect(without.length).toBeGreaterThanOrEqual(2);

    for (const row of rows) {
      await page.goto(row.href);
      await expect(page.getByRole("heading", { level: 1, name: row.name })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Template" })).toBeVisible();
      await expect(ring(page), `${row.name} (${row.status}, active ${row.active})`).toHaveCount(
        row.active !== "—" ? 1 : 0,
      );
      // A Platform Admin never edits: every workspace is "View only".
      await expect(page.getByText("View only", { exact: true })).toBeVisible();
    }
  });

  test("workspace header: name, template ID, status badge, version label", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await openTemplate(page, "Balance Transfer Intro — Terms");
    const header = page.locator("main header:has(h1)").filter({ visible: true });
    await expect(header.getByText(/^UC-[0-9A-Z]{6}$/)).toBeVisible();
    await expect(header.locator("[data-status='active']")).toHaveText("Active");
    await expect(header.getByText("v2", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Content" })).toHaveAttribute("aria-current", "page");
    for (const tab of ["Content", "Versions", "Usage", "Activity"]) {
      await expect(page.getByRole("navigation", { name: "Template" }).getByRole("link", { name: tab })).toBeVisible();
    }
  });

  test("the SHARE ring opens the integration sheet and Esc closes it", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await openTemplate(page, "Balance Transfer Intro — Terms");
    const share = page.getByRole("button", { name: /^Share Balance Transfer Intro — Terms/ });
    await expect(share).toBeVisible();
    await expect(ring(page)).toHaveCount(1);
    const box = (await share.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(72);
    expect(box.width).toBeLessThanOrEqual(80);

    await share.hover();
    await page.waitForTimeout(400);
    await share.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Integration", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Balance Transfer Intro — Terms")).toBeVisible();
    await expect(sheet.getByText(/^UC-[0-9A-Z]{6}$/)).toBeVisible();
    await expect(sheet.getByText("v2", { exact: true })).toBeVisible();
    await expect(sheet.locator("[data-status='active']")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/templates\/UC-/);
  });

  test("a template without an Active version has no SHARE ring (Annual Fee Waiver)", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await openTemplate(page, "Annual Fee Waiver — Terms");
    await expect(page.locator("main header:has(h1)").filter({ visible: true }).locator("[data-status='draft']")).toBeVisible();
    await expect(ring(page)).toHaveCount(0);
  });

  test("priya on Deposits: a viewer sees View only and no editor chrome", async ({ page }) => {
    await asPersona(page, "priya");
    await page.goto("/deposits/library");
    await openTemplate(page, "Everyday Checking — Fee Schedule");
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    const ed = await liveEditor(page);
    await expect(ed).toBeVisible();
    await expect(ed).toHaveAttribute("contenteditable", "false");
    await expect(ed).toHaveAttribute("aria-readonly", "true");
    // No drag handles, no insert button, no format toolbar, even after clicking and selecting.
    await editor(page).locator("p").first().click({ clickCount: 3 });
    await page.mouse.move(400, 400);
    await expect(page.locator(".ucomp-block-handle")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Insert block below" })).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Format text" })).toHaveCount(0);
    await page.keyboard.type("/ should not type");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(editor(page)).not.toContainText("should not type");
    // It is Active, so the ring is there for her as well.
    await expect(ring(page)).toHaveCount(1);
  });

  test("sam (viewer) on an open draft: View only", async ({ page }) => {
    await asPersona(page, "sam");
    await page.goto("/coral-offers/library");
    await openTemplate(page, "Annual Fee Waiver — Terms");
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await expect(editor(page)).toHaveAttribute("contenteditable", "false");
    await expect(page.locator(".ucomp-block-handle")).toHaveCount(0);
  });

  test("maya is read-only on a version that is not an open draft", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await openTemplate(page, "Balance Transfer Intro — Terms");
    await expect(editor(page)).toHaveAttribute("contenteditable", "false");
    await expect(page.getByRole("toolbar", { name: "Format text" })).toHaveCount(0);
  });

  test("maya on Annual Fee Waiver: types in the editor, `/` opens the block menu, Heading 2 inserts", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await openTemplate(page, "Annual Fee Waiver — Terms");
    await expect(page.getByText("View only", { exact: true })).toHaveCount(0);

    const ed = await liveEditor(page);
    await expect(ed).toHaveAttribute("contenteditable", "true");
    await expect(ed).toHaveAttribute("aria-readonly", "false");

    // Type a sentence at the end of the last required section.
    await caretAtEndOf(page, ed.locator("p").last());
    await page.keyboard.press("Enter");
    await page.keyboard.type("Typed by the gate spec.");
    await expect(ed).toContainText("Typed by the gate spec.");

    // `/` opens the block menu at the caret.
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    const menu = page.getByRole("listbox").or(page.locator("[cmdk-list]"));
    await expect(menu.first()).toBeVisible();
    const options = page.getByRole("option");
    await expect(options.nth(8)).toBeVisible();
    await expect(options).toHaveText([
      /Text/,
      /Heading 1/,
      /Heading 2/,
      /Heading 3/,
      /Bulleted list/,
      /Numbered list/,
      /Table/,
      /Callout/,
      /Divider/,
    ]);
    // Typing narrows the list; Esc dismisses and leaves the slash text.
    await page.keyboard.type("head");
    await expect(options).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(options).toHaveCount(0);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");

    // Re-open, narrow to the headings (a space would close the menu), pick Heading 2 with the arrows.
    await page.keyboard.type("/head");
    await expect(options).toHaveCount(3);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(options).toHaveCount(0);
    await page.keyboard.type("Added section");
    await expect(ed.getByRole("heading", { level: 2, name: "Added section" })).toBeVisible();

    // The bubble toolbar follows a text selection and Bold toggles the mark.
    await dragSelect(page, ed.locator("p", { hasText: "Typed by the gate spec." }));
    const toolbar = page.getByRole("toolbar", { name: "Format text" });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Bold" }).click();
    await expect(ed.locator("strong", { hasText: /\S/ })).toHaveCount(1);
  });

  test("the block handle appears on hover for an author", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await openTemplate(page, "Annual Fee Waiver — Terms");
    const ed = await liveEditor(page);
    await expect(ed).toHaveAttribute("contenteditable", "true");
    const para = ed.locator("p").first();
    const box = (await para.boundingBox())!;
    // The handle plugin attaches a moment after the editor does: keep moving until it shows.
    await expect(async () => {
      await page.mouse.move(box.x + box.width / 2, box.y - 30);
      await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 8 });
      await page.mouse.move(box.x + 60, box.y + box.height / 2 + 1, { steps: 4 });
      await expect(page.getByRole("button", { name: "Insert block below" })).toBeVisible({ timeout: 700 });
    }).toPass({ timeout: 10_000 });
    await expect(page.getByLabel("Drag to move block")).toBeVisible();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Settings modal, demo drawer, palette, profile
// ───────────────────────────────────────────────────────────────────────────

test.describe("overlays", () => {
  test("settings modal opens from the sidebar and closes with Esc, back to the page behind it", async ({ page }) => {
    await asPersona(page, "alex");
    await page.goto("/coral-offers/library");
    await libraryRows(page);
    await sidebarFooter(page).getByRole("link", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/coral-offers\/settings\/members$/);
    await expect(dialog.getByText("Team", { exact: true })).toBeVisible();
    for (const label of ["Members", "Access requests", "Recertification", "Inactivity"]) {
      await expect(dialog.getByRole("link", { name: label })).toBeVisible();
    }
    // Alex is not a Platform Admin: no Platform group.
    await expect(dialog.getByText("Platform", { exact: true })).toHaveCount(0);
    // The library stays behind the modal (the page is inert while it is open, so look by tag).
    await expect(page.locator("main h1", { hasText: "Library" }).filter({ visible: true })).toBeVisible();

    await dialog.getByRole("link", { name: "Recertification" }).click();
    await expect(page).toHaveURL(/\/settings\/recertification$/);
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/coral-offers\/library$/);
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  });

  test("settings modal closes with its X button; riley sees both groups", async ({ page }) => {
    await asPersona(page, "riley");
    await page.goto("/all/library");
    await libraryRows(page);
    await sidebarFooter(page).getByRole("link", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/all\/settings\/teams$/);
    await expect(dialog.getByText("Platform", { exact: true })).toBeVisible();
    for (const label of ["Teams", "Content types", "Channel rules", "Approval chains"]) {
      await expect(dialog.getByRole("link", { name: label })).toBeVisible();
    }
    await dialog.getByRole("button", { name: "Close settings" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/all\/library$/);
  });

  test("settings opened by URL still shows the modal, and Esc goes to the library", async ({ page }) => {
    await asPersona(page, "alex");
    await page.goto("/coral-offers/settings/members");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).toHaveURL(/\/coral-offers\/library$/);
  });

  test("a persona without settings access cannot open the modal by URL", async ({ page }) => {
    await page.goto("/coral-offers/settings/members");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("⌘K opens the palette; it lists pages and this team's templates; Enter navigates", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await libraryRows(page);
    const dialog = page.getByRole("dialog");
    await page.keyboard.press("ControlOrMeta+K");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option", { name: "Library" })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Annual Fee Waiver/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Statement Insert/ })).toHaveCount(0);
    await page.keyboard.type("balance");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/coral-offers\/templates\/UC-/);
    await expect(page.getByRole("heading", { level: 1, name: "Balance Transfer Intro — Terms" })).toBeVisible();
  });

  test("demo drawer: reset returns to Maya on the Coral Offers library", async ({ page }) => {
    await asPersona(page, "riley");
    await page.goto("/all/usage");
    await expect(profileButton(page)).toHaveAccessibleName(/^Riley Brooks,/);
    await page.getByRole("button", { name: "Demo", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Demo" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "+1 day" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "+15 days" })).toBeVisible();
    await drawer.getByRole("button", { name: "Reset demo" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/Maya Chen/)).toBeVisible();
    await confirm.getByRole("button", { name: "Reset" }).click();
    await expect(page).toHaveURL(/\/coral-offers\/library$/);
    await expect(profileButton(page)).toHaveAccessibleName(/^Maya Chen,/);
    expect(names(await libraryRows(page))).toEqual([...CORAL].sort());
  });

  test("demo drawer: reset can be cancelled", async ({ page }) => {
    await asPersona(page, "alex");
    await page.goto("/coral-offers/review");
    await page.getByRole("button", { name: "Demo", exact: true }).click();
    await page.getByRole("button", { name: "Reset demo" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).toHaveURL(/\/coral-offers\/review$/);
    await expect(profileButton(page)).toHaveAccessibleName(/^Alex Kim,/);
  });

  test("alex sees the recertification card and can dismiss it", async ({ page }) => {
    await asPersona(page, "alex");
    await page.goto("/coral-offers/library");
    const card = page.locator("[data-slot='sidebar-card']");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Recertification due");
    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await libraryRows(page);
    await expect(card).toHaveCount(0);
    // No other persona gets a card.
    await asPersona(page, "maya");
    await page.goto("/coral-offers/library");
    await libraryRows(page);
    await expect(card).toHaveCount(0);
  });

  test("the other nav pages render under their sidebar item", async ({ page }) => {
    await asPersona(page, "alex");
    await page.goto("/coral-offers/library");
    await hydrated(page);
    for (const [label, path] of [
      ["Review", "/coral-offers/review"],
      ["Usage", "/coral-offers/usage"],
      ["Audit", "/coral-offers/audit"],
      ["Library", "/coral-offers/library"],
    ] as const) {
      await sidebarNav(page).getByRole("link", { name: new RegExp(`^${label}`) }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
      await expect(sidebarNav(page).getByRole("link", { name: new RegExp(`^${label}`) })).toHaveAttribute("aria-current", "page");
    }
  });

  test("audit is not reachable for a persona without it", async ({ page }) => {
    await page.goto("/coral-offers/audit");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(sidebarNav(page).getByRole("link", { name: "Audit" })).toHaveCount(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Dev pages
// ───────────────────────────────────────────────────────────────────────────

test.describe("dev pages", () => {
  test("/design renders the design system sample", async ({ page }) => {
    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Every lifecycle status is shown with the one badge.
    for (const state of ["draft", "in_review", "changes_requested", "active", "superseded", "revoked"]) {
      await expect(page.locator(`[data-status='${state}']`).first()).toBeVisible();
    }
    await expect(page.locator("[data-slot='share-ring']").first()).toBeVisible();
  });

  test("/editor-lab mounts the editor and the slash menu works", async ({ page }) => {
    await page.goto("/editor-lab");
    await expect(page.getByRole("heading", { level: 1, name: "Editor lab" })).toBeVisible();
    const ed = (await liveEditor(page)).first();
    await expect(ed).toBeVisible();
    await expect(ed).toHaveAttribute("contenteditable", "true");
    await caretAtEndOf(page, ed.locator("p").last());
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(page.getByRole("option").first()).toBeVisible();
    await expect(page.getByRole("option", { name: /Heading 2/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toHaveCount(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Performance: layout shift on library and workspace
// ───────────────────────────────────────────────────────────────────────────

test.describe("CLS (layout-shift, buffered) < 0.01", () => {
  const LIMIT = 0.01;

  async function settle(page: Page) {
    // Hydration, fonts, streamed holes, the live editor swap-in: give them time to land.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
  }

  async function report(label: string, page: Page) {
    const { cls, shifts } = await readCls(page);
    console.log(`CLS ${label}: ${cls.toFixed(4)}${shifts.length ? ` ${JSON.stringify(shifts)}` : ""}`);
    test.info().annotations.push({ type: "cls", description: `${label}: ${cls.toFixed(4)}` });
    expect(cls, `${label} layout shifts: ${JSON.stringify(shifts)}`).toBeLessThan(LIMIT);
  }

  test("the probe itself works: a forced shift is recorded", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await libraryRows(page);
    await settle(page);
    await page.evaluate(() => {
      const box = document.createElement("div");
      box.style.cssText = "height:300px;width:300px;background:#ccc";
      document.querySelector("main")!.prepend(box);
    });
    await page.waitForTimeout(500);
    const { cls } = await readCls(page);
    expect(cls).toBeGreaterThan(LIMIT);
  });

  for (const id of ["maya", "alex", "riley"]) {
    test(`library, hard load as ${id}`, async ({ page }) => {
      await asPersona(page, id);
      await page.goto("/");
      await libraryRows(page);
      await settle(page);
      await report(`library (${id})`, page);
    });
  }

  test("workspace on an Active template, hard load (with the SHARE ring)", async ({ page }) => {
    await page.goto("/coral-offers/library");
    const href = (await libraryRows(page)).find((r) => r.name.startsWith("Balance Transfer"))!.href;
    await page.goto(href);
    await expect(ring(page)).toBeVisible();
    await expect(editor(page)).toBeVisible();
    await settle(page);
    await report("workspace Balance Transfer (hard load)", page);
  });

  test("workspace on an editable draft, hard load", async ({ page }) => {
    await page.goto("/coral-offers/library");
    const href = (await libraryRows(page)).find((r) => r.name.startsWith("Annual Fee"))!.href;
    await page.goto(href);
    await expect(editor(page)).toHaveAttribute("contenteditable", "true");
    await settle(page);
    await report("workspace Annual Fee Waiver (hard load)", page);
  });

  test("library → workspace → library by clicking (soft navigation)", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await libraryRows(page);
    await settle(page);
    await openTemplate(page, "Balance Transfer Intro — Terms");
    await expect(ring(page)).toBeVisible();
    await settle(page);
    await sidebarNav(page).getByRole("link", { name: "Library" }).click();
    await libraryRows(page);
    await openTemplate(page, "Annual Fee Waiver — Terms");
    await expect(editor(page)).toHaveAttribute("contenteditable", "true");
    await settle(page);
    await report("library → workspace → library → workspace (soft)", page);
  });

  test("switching persona does not shift the layout", async ({ page }) => {
    await page.goto("/coral-offers/library");
    await libraryRows(page);
    await settle(page);
    const before = (await readCls(page)).cls;
    await switchVia(page, "Jordan Ellis");
    await libraryRows(page);
    await settle(page);
    const after = (await readCls(page)).cls;
    console.log(`CLS persona switch maya→jordan: delta ${(after - before).toFixed(4)} (total ${after.toFixed(4)})`);
    expect(after - before).toBeLessThan(LIMIT);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Prefetch storm (regression canary)
// ───────────────────────────────────────────────────────────────────────────

test.describe("router prefetch", () => {
  test.use({ calmPrefetch: false });

  // Found in Phase 1 QA: on the production build, the library page re-requested the prefetch of
  // every visible link (~650 requests a second) until the tab closed. Aborting only the
  // `/templates/UC-…` prefetches stopped it, so the template-row links are the trigger.
  test("the library does not re-prefetch its links in a loop", async ({ page }) => {
    let rsc = 0;
    page.on("request", (r) => {
      if (r.url().includes("_rsc=")) rsc++;
    });
    await page.goto("/coral-offers/library");
    await libraryRows(page);
    await page.waitForTimeout(3000);
    console.log(`library RSC requests in ~3s: ${rsc}`);
    // A page with 5 rows and 6 nav links needs a few dozen prefetches at most.
    expect(rsc).toBeLessThan(60);
  });

  test("the workspace does not re-prefetch its links in a loop", async ({ page }) => {
    let rsc = 0;
    page.on("request", (r) => {
      if (r.url().includes("_rsc=")) rsc++;
    });
    // Template ids are deterministic across resets (seeded RNG); the heading check fails loudly if that changes.
    await page.goto("/coral-offers/templates/UC-6X2XWN");
    await expect(page.getByRole("heading", { level: 1, name: "Balance Transfer Intro — Terms" })).toBeVisible();
    await expect(ring(page)).toBeVisible();
    await page.waitForTimeout(3000);
    console.log(`workspace RSC requests in ~3s: ${rsc}`);
    expect(rsc).toBeLessThan(60);
  });
});
