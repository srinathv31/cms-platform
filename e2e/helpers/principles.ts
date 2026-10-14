import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { settled } from "./settled";

// The principle checks, on every route, as the persona(s) that can see it:
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
// THE SIMULATOR IS A DELIBERATELY FOREIGN OUTSIDE SYSTEM (docs/archive/implementation-plan.md §8). It gets rules
// 3, 4 and 5 (placeholders, axe, CLS) but NOT rules 1 and 2: it has its own button language and its own status
// vocabulary, and must not look like UCOMP.
//
// Next 16 keeps visited routes mounted but hidden, so every query looks at visible elements only.
// Read-only: nothing here changes data. Run against the dev server:
//   E2E_PORT=3000 npx playwright test e2e/principles-*.spec.ts --workers=1
//
// The checks and the route matrix live here; the specs that run them are e2e/principles-*.spec.ts, split by what they cover
// so that files run in parallel in about the same time each.

const PERSONA_COOKIE = "ucomp_persona";
export const ALLOWED_PLACEHOLDER = "Type / for blocks";
export const STATUS_WORDS = [
  "Draft",
  "In review",
  "Changes requested",
  "Active",
  "Superseded",
  "Sunset",
  "Revoked",
];

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
export function inspectPage(args: {
  foreign: boolean;
  allowed: string;
  words: string[];
}): PageFindings {
  const { foreign, allowed, words } = args;
  const visible = (el: Element): boolean => {
    const html = el as HTMLElement;
    if (
      !html.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })
    )
      return false;
    const r = html.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = (el: Element): string => {
    const label = (el.getAttribute("aria-label") ?? el.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    const slot = el.getAttribute("data-slot");
    return `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ""} "${label}"`;
  };

  // ── 1. primary buttons ──
  const probe = document.createElement("div");
  probe.className = "bg-primary";
  document.body.append(probe);
  const primaryColor = getComputedStyle(probe).backgroundColor;
  probe.remove();

  const NOT_BUTTONS =
    '[role="switch"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitemradio"],[role="option"]';
  const isPrimary = (el: Element) => {
    if (el.matches(NOT_BUTTONS) || !visible(el)) return false;
    return getComputedStyle(el).backgroundColor === primaryColor;
  };
  const candidates = [
    ...document.querySelectorAll('button, a[href], [role="button"]'),
  ];
  const LAYER =
    '[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover-content"]';
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
      const buttons = candidates
        .filter((el) => dialog.contains(el) && isPrimary(el))
        .map(describe);
      dialogPrimary.push({ dialog: describe(dialog).slice(0, 60), buttons });
    }
  }

  // ── 2. status words outside a StatusBadge ──
  const strayStatus: string[] = [];
  if (!foreign) {
    // A status word on its own, or "Sunset Mar 1": the label of something that is, or shows, a state. Event lines
    // such as "Superseded Jul 11" in a version's history ("Submitted Mar 14 · Activated Mar 20 · …") and
    // "Revoked Oct 20: reason" say when something happened; they are log entries, not a status.
    const exact = new RegExp(
      `^(${words.join("|")}|Sunset( \\w{3} \\d{1,2})?)$`,
      "i",
    );
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
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      // The whole element's text, not one text node of it: "Revoked <time>Oct 20</time>: reason" is a sentence.
      const text = (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || !el || !exact.test(text) || seen.has(el)) continue;
      seen.add(el);
      if (el.closest(SKIP) || !visible(el)) continue;
      // The audit table's Action cell is a sentence about what happened, in a cell of its own.
      if (
        el
          .closest("td, [role=cell]")
          ?.closest("[data-slot=audit-table], [aria-label*=Audit i]")
      )
        continue;
      strayStatus.push(
        `${describe(el)} in ${el.parentElement ? describe(el.parentElement) : "?"}`,
      );
    }
  }

  // ── 3. placeholders ──
  const placeholders: string[] = [];
  for (const el of document.querySelectorAll(
    "[placeholder], [aria-placeholder], [data-placeholder]",
  )) {
    if (!visible(el) && !(el as HTMLElement).closest(".ProseMirror")) continue;
    for (const attr of [
      "placeholder",
      "aria-placeholder",
      "data-placeholder",
    ]) {
      const value = el.getAttribute(attr);
      // A bare data-placeholder (Base UI's Select marks an unfilled trigger with it) has no text of its own.
      if (value === null || value === "" || value === allowed) continue;
      placeholders.push(`${describe(el)} ${attr}="${value}"`);
    }
  }
  // Base UI Select shows its placeholder as the trigger's text; report an unfilled Select too.
  for (const el of document.querySelectorAll(
    '[data-slot="select-value"][data-placeholder]',
  )) {
    if (visible(el))
      placeholders.push(
        `${describe(el)} (unfilled select shows placeholder text)`,
      );
  }
  return { canvasPrimary, dialogPrimary, strayStatus, placeholders };
}

// ── Page plumbing ────────────────────────────────────────────────────────────

/** Before any script of the document: a buffered layout-shift observer. */
export function installCls() {
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
          .map((s) =>
            s.node
              ? `${s.node.nodeName.toLowerCase()}${
                  (s.node as HTMLElement).className
                    ? "." +
                      String((s.node as HTMLElement).className)
                        .split(" ")
                        .slice(0, 3)
                        .join(".")
                    : ""
                }`
              : "?",
          )
          .join(", ");
        w.__cls.shifts.push(
          `${entry.value.toFixed(6)} at ${Math.round(entry.startTime)}ms (${where})`,
        );
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* not supported: the CLS check reports it */
  }
}

export const profileButton = (page: Page) =>
  page.getByRole("button", { name: /profile and persona/ });

async function asPersona(page: Page, id: string) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE, value: id, url: baseURL }]);
}

/** The page has stopped moving: hydrated, streams resolved, skeletons gone, the live editor mounted if there is one. */
export async function settle(page: Page, opts: { shell?: boolean } = {}) {
  if (opts.shell !== false) {
    await page.waitForFunction(() => {
      const el = document.querySelector(
        "button[aria-label$='profile and persona']",
      );
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
    });
  } else {
    await page.waitForLoadState("load");
  }
  await page
    .waitForFunction(
      () => {
        const shown = (el: Element) =>
          (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true }) &&
          el.getClientRects().length > 0;
        const loading = [
          ...document.querySelectorAll(
            '[data-slot="skeleton"], [aria-busy="true"]',
          ),
        ].some(shown);
        const hasEditor = [...document.querySelectorAll(".ProseMirror")].filter(
          shown,
        );
        const live = hasEditor.every((el) => "pmViewDesc" in el);
        return !loading && live;
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => undefined);
  // Let view transitions, fonts and the editor's server-to-live handover finish.
  await settled(page);
}

/** Opens a route as a persona and fails on a server error: another agent may be mid-edit, so wait and go again. */
export async function open(
  page: Page,
  url: string,
  persona: string,
  opts: { shell?: boolean } = {},
) {
  await asPersona(page, persona);
  // Four tries, 4, 8 and 12 seconds apart.
  await expect(async () => {
    const response = await page.goto(url, { waitUntil: "load" });
    expect(response?.status(), `${url} responded`).toBeLessThan(500);
  }).toPass({ intervals: [4_000, 8_000, 12_000], timeout: 30_000 });
  await settle(page, opts);
}

interface Axe {
  serious: string[];
  other: string[];
  passes: number;
}

export async function runAxe(page: Page): Promise<Axe> {
  // Base UI's focus guards (visually hidden, aria-hidden, tabindex 0) only pass focus on. axe lets them through
  // only when it decides a modal is open, by probing five fixed points for a full-screen layer, and a menu's
  // backdrop has a hole over its trigger: the team switcher's trigger sits on one probe at 1440×900.
  const results = await new AxeBuilder({ page })
    .exclude("nextjs-portal")
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  const line = (v: (typeof results.violations)[number]) =>
    `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help} — ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(" | ")}`;
  return {
    passes: results.passes.length,
    serious: results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(line),
    other: results.violations
      .filter((v) => v.impact !== "serious" && v.impact !== "critical")
      .map(line),
  };
}

async function cls(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __cls?: { value: number; shifts: string[] } })
        .__cls ?? null,
  );
}

/** The five checks, softly, so one run reports everything a screen gets wrong. */
export async function checkScreen(
  page: Page,
  label: string,
  opts: { foreign?: boolean } = {},
) {
  const foreign = !!opts.foreign;
  const found = await page.evaluate(inspectPage, {
    foreign,
    allowed: ALLOWED_PLACEHOLDER,
    words: STATUS_WORDS,
  });

  if (!foreign) {
    expect
      .soft(
        found.canvasPrimary.length <= 1,
        `${label}: at most one primary button in the canvas, found ${JSON.stringify(found.canvasPrimary)}`,
      )
      .toBe(true);
    for (const d of found.dialogPrimary) {
      expect
        .soft(
          d.buttons.length <= 1,
          `${label}: at most one primary button in the dialog ${d.dialog}, found ${JSON.stringify(d.buttons)}`,
        )
        .toBe(true);
    }
    expect
      .soft(
        found.strayStatus,
        `${label}: status words only inside <StatusBadge>`,
      )
      .toEqual([]);
  }
  expect
    .soft(
      found.placeholders,
      `${label}: no placeholder other than "${ALLOWED_PLACEHOLDER}"`,
    )
    .toEqual([]);

  const axe = await runAxe(page);
  expect
    .soft(axe.passes, `${label}: axe ran (it checked something)`)
    .toBeGreaterThan(0);
  if (axe.other.length)
    console.log(`[axe moderate/minor] ${label}\n  ${axe.other.join("\n  ")}`);
  expect
    .soft(axe.serious, `${label}: axe serious/critical violations`)
    .toEqual([]);

  const shift = await cls(page);
  expect
    .soft(shift, `${label}: layout-shift observer installed`)
    .not.toBeNull();
  expect
    .soft(shift?.shifts ?? [], `${label}: CLS 0 (excluding shifts after input)`)
    .toEqual([]);
}

// ── The routes ───────────────────────────────────────────────────────────────

// Personas: maya (author), jordan (approver), alex (team admin, Coral Offers), dana (viewer, Legal
// reviewer), priya (author Coral, viewer Deposits), riley (Platform Admin), taylor (Auditor), morgan (no access).
// The seed's template ids: the seed draws them in a fixed order, and its own test pins them (seed.test.ts, "keeps
// the template ids e2e specs … name"). The first test below checks each is still the template named here.
export const COLLECT = "UC-J530DX"; // Cash Back Welcome Bonus: v1 superseded, v2 active, v3 round 1 sent back, v3 round 2 in review
export const BALANCE = "UC-D6KSGY"; // Balance Transfer Intro: v1 superseded, v2 active
export const FEE_WAIVER = "UC-NYP7F0"; // Annual Fee Waiver: v1 round 1 changes requested, and a draft
export const HOLIDAY = "UC-WGGRJH"; // Holiday Points Promo: v1 revoked, v2 active
export const RATE_CHANGE = "UC-PAS9A0"; // Rate Change Notice: v1 active
export const DEPOSIT = "UC-A4S1YT"; // Deposits, Everyday Checking: v1 active
export const HIGH_YIELD = "UC-ZKZSRZ"; // Deposits, High-Yield Savings: v1 superseded, v2 approved on round 3 after two send-backs
export const STATEMENT = "UC-8Y49K2"; // Card Statements, Statement Insert — Rate Change: v1 active
// Coral Offers' alerts (push and SMS, decision 0034).
export const PAYMENT_DUE = "UC-EFXFMS"; // Payment Due Reminder: v1 active
export const CARD_ABROAD = "UC-397J2A"; // Card Used Abroad: v1 in review (Priya's)
export const HEADS_UP = "UC-FYN38M"; // Rate Change Heads-up: a draft

export interface Route {
  url: string;
  personas: string[];
}

export const LIBRARY: Route[] = [
  {
    url: "/coral-offers/library",
    personas: ["maya", "jordan", "alex", "dana", "riley", "taylor"],
  },
  { url: "/deposits/library", personas: ["priya", "riley"] },
  { url: "/card-statements/library", personas: ["riley", "taylor"] },
  { url: "/all/library", personas: ["riley", "taylor"] },
];

export const WORKSPACE_TABS = ["", "/versions", "/usage", "/activity"];
export const WORKSPACE: Route[] = [
  // All four tabs on the template with every kind of version, as the author, an approver and an observer.
  ...WORKSPACE_TABS.map((tab) => ({
    url: `/coral-offers/templates/${COLLECT}${tab}`,
    personas: ["maya", "jordan", "taylor"],
  })),
  // And every tab on a second template, with a superseded and a sunset history.
  ...WORKSPACE_TABS.map((tab) => ({
    url: `/coral-offers/templates/${BALANCE}${tab}`,
    personas: ["maya"],
  })),
  // The other lifecycle states, on the Content tab and Versions.
  ...["", "/versions"].flatMap((tab) =>
    [FEE_WAIVER, HOLIDAY, RATE_CHANGE].map((id) => ({
      url: `/coral-offers/templates/${id}${tab}`,
      personas: ["maya"],
    })),
  ),
  // Read-only viewers and other teams.
  { url: `/coral-offers/templates/${RATE_CHANGE}`, personas: ["dana"] },
  { url: `/deposits/templates/${DEPOSIT}`, personas: ["priya", "riley"] },
  { url: `/deposits/templates/${DEPOSIT}/versions`, personas: ["priya"] },
  // A version approved after two send-backs: "Approved on round 3" and its folded review history.
  { url: `/deposits/templates/${HIGH_YIELD}/versions`, personas: ["priya"] },
  { url: `/card-statements/templates/${STATEMENT}`, personas: ["riley"] },
  { url: `/card-statements/templates/${STATEMENT}/usage`, personas: ["riley"] },
  // An alert's every tab; a draft alert in its composer; one in review, as its author.
  ...WORKSPACE_TABS.map((tab) => ({
    url: `/coral-offers/templates/${PAYMENT_DUE}${tab}`,
    personas: ["maya"],
  })),
  { url: `/coral-offers/templates/${HEADS_UP}`, personas: ["maya", "jordan"] },
  { url: `/coral-offers/templates/${CARD_ABROAD}`, personas: ["priya"] },
];

export const REVIEW: Route[] = [
  { url: "/coral-offers/review", personas: ["jordan", "alex", "maya"] },
  // Recently decided: the round Jordan sent back ("v3 · Round 1").
  { url: "/coral-offers/review?tab=decided", personas: ["jordan"] },
  { url: "/all/review", personas: ["riley", "taylor"] },
  // The review screen for the version in review (v3, round 2): the approver, the author who submitted it, Legal, an observer.
  {
    url: `/coral-offers/review/${COLLECT}/3`,
    personas: ["jordan", "maya", "dana", "taylor"],
  },
  // Its round 1, sent back: a read-only record.
  {
    url: `/coral-offers/review/${COLLECT}/3?round=1`,
    personas: ["jordan", "taylor"],
  },
  { url: `/coral-offers/review/${COLLECT}/2`, personas: ["jordan"] },
  // An alert in review (its fields on the Document view), as the approver and its author, and an Active one.
  {
    url: `/coral-offers/review/${CARD_ABROAD}/1`,
    personas: ["jordan", "priya"],
  },
  { url: `/coral-offers/review/${PAYMENT_DUE}/1`, personas: ["jordan"] },
];

export const USAGE: Route[] = [
  { url: "/coral-offers/usage", personas: ["maya", "jordan", "alex", "riley"] },
  { url: "/coral-offers/usage?tab=consumers", personas: ["jordan", "riley"] },
  { url: "/all/usage?tab=consumers", personas: ["riley"] },
  { url: "/deposits/usage", personas: ["priya", "riley"] },
  { url: "/all/usage", personas: ["riley", "taylor"] },
];

export const AUDIT: Route[] = [
  { url: "/coral-offers/audit", personas: ["alex", "riley", "taylor"] },
  { url: "/deposits/audit", personas: ["riley"] },
  { url: "/all/audit", personas: ["riley", "taylor"] },
];

// The settings sections as hard navigations (reload or a shared link): the dialog over the library.
export const TEAM_SECTIONS = [
  "members",
  "access-requests",
  "recertification",
  "inactivity",
];
export const PLATFORM_SECTIONS = [
  "teams",
  "content-types",
  "channel-rules",
  "approval-chains",
  "time-zone",
];
export const SETTINGS_HARD: Route[] = [
  ...TEAM_SECTIONS.map((s) => ({
    url: `/coral-offers/settings/${s}`,
    personas: ["alex"],
  })),
  ...PLATFORM_SECTIONS.map((s) => ({
    url: `/coral-offers/settings/${s}`,
    personas: ["riley"],
  })),
  { url: "/all/settings/teams", personas: ["riley"] },
];

export const REQUEST_ACCESS: Route[] = [
  { url: "/request-access", personas: ["morgan"] },
];

/** The `test` of the spec that calls it, so the tests are declared on whatever `test` that spec imports. */
type Declares = Pick<typeof test, "describe"> &
  ((title: string, body: (args: { page: Page }) => Promise<void>) => void);

export function describeRoutes(
  declare: Declares,
  group: string,
  routes: Route[],
) {
  declare.describe(group, () => {
    for (const route of routes) {
      for (const persona of route.personas) {
        declare(`${route.url} as ${persona}`, async ({ page }) => {
          await open(page, route.url, persona);
          // The persona must actually be allowed here: a redirect elsewhere means this row of the matrix is wrong.
          expect(
            new URL(page.url()).pathname,
            "the route shows for this persona (no redirect)",
          ).toBe(route.url.split("?")[0]);
          await checkScreen(page, `${route.url} as ${persona}`);
        });
      }
    }
  });
}

/** Lets an opened layer finish its entrance (focus lands a frame after it opens), then runs the checks. */
export async function checkOpened(page: Page, label: string) {
  await settled(page);
  await checkScreen(page, label);
}

export const click = (target: Locator) => target.click({ delay: 90 });
