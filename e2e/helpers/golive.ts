import type { Client, InValue } from "@libsql/client";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { correlation, render, validValues, type Variable } from "../api/helpers";
import { beat, expect, isDemo, tap, untilUncovered } from "./scenario";

// Shared by the going-live specs (scenarios 4, 5 and 6): the Spring Travel fixture, the cleanup that puts
// the database back, the pieces of the simulator ("Coral — simulated") a person drives, and the persona
// switcher. Additive: nothing here changes what the other specs import.

export const SPRING_NAME = "Spring Travel Rewards — Terms";
export const SPRING_OFFER = "offer_spring_travel";
export const SPRING_OFFER_NAME = "Spring Travel Rewards";
export const TEAM = "coral-offers";
/** Marks the fixture's template rows, so a run that died half way can be cleaned by the next one. */
const FIXTURE_MARK = "e2e-golive-fixture";

export const CUSTOMERS = {
  olivia: { name: "Olivia Bennett", first: "Olivia", last: "Bennett", email: "olivia.bennett@example.com", apr: "21.99" },
  marcus: { name: "Marcus Delgado", first: "Marcus", last: "Delgado", email: "marcus.delgado@example.com", apr: "24.49" },
  anjali: { name: "Anjali Kapoor", first: "Anjali", last: "Kapoor", email: "anjali.kapoor@example.com", apr: "19.24" },
  fatima: { name: "Fatima Al-Sayed", first: "Fatima", last: "Al-Sayed", email: "fatima.al-sayed@example.com", apr: "26.99" },
  long: {
    name: "Maximiliano-Bartholomew Featherstonehaugh-Villiers-Montgomery",
    first: "Maximiliano-Bartholomew",
    last: "Featherstonehaugh-Villiers-Montgomery",
    email: "maximiliano-bartholomew.featherstonehaugh-villiers-montgomery@example.com",
    apr: "29.99",
  },
} as const;
export type Customer = (typeof CUSTOMERS)[keyof typeof CUSTOMERS];

/** The five customers scenario 4 sends to: four ordinary ones and the long-name one. */
export const FIVE: readonly Customer[] = [CUSTOMERS.olivia, CUSTOMERS.marcus, CUSTOMERS.anjali, CUSTOMERS.fatima, CUSTOMERS.long];

// ── The database ─────────────────────────────────────────────────────────────

export type Row = Record<string, InValue>;

/** The file has no busy timeout, and the app writes to it: a read or write waits its turn. */
export async function busy<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const text = String((error as { code?: unknown; message?: unknown })?.code ?? "") + String((error as Error)?.message ?? "");
      if (attempt >= 8 || !/SQLITE_BUSY|database is locked/i.test(text)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    }
  }
}

export async function rows(db: Client, sql: string, args: InValue[] = []): Promise<Row[]> {
  const result = await busy(() => db.execute({ sql, args }));
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column) => [column, row[column] as InValue])));
}

export async function run(db: Client, sql: string, args: InValue[] = []) {
  await busy(() => db.execute({ sql, args }));
}

export const json = (value: InValue) => (value === null || value === undefined ? null : JSON.parse(String(value)));

// ── The fixture: Spring Travel Rewards — Terms, v2 Active ───────────────────

export interface SpringFixture {
  templateId: string;
  v2Id: string;
  /** What v2 asks of a consumer, for the API calls and the mapping. */
  variables: Variable[];
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newTemplateId = () => `UC-${Array.from({ length: 6 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join("")}`;

const variable = (key: string) => ({ type: "variable", attrs: { key } });
const text = (value: string) => ({ type: "text", text: value });

/**
 * Inserts the template a person would have made in scenarios 2 and 3, already live: Maya's
 * "Spring Travel Rewards — Terms", v2 Active, with first_name, last_name, purchase_apr, home_state and an
 * optional offer_end_date, on PDF, Web and Email. It clones a seeded Coral version (Cash Back v2) for the
 * body's structure, the sample sets and the stage, and rewrites the offer text. A fixture left by a run
 * that died is removed first.
 */
export async function createSpringTravel(db: Client): Promise<SpringFixture> {
  for (const stale of await rows(db, "SELECT id FROM templates WHERE starter_key = ?", [FIXTURE_MARK])) await removeTemplate(db, String(stale.id));

  const [base] = await rows(
    db,
    `SELECT v.* FROM versions v JOIN templates t ON t.id = v.template_id
     WHERE t.team_id = ? AND v.name = 'Cash Back Welcome Bonus — Terms' AND v.number = 2 AND v.state = 'active'`,
    [TEAM],
  );
  if (!base) throw new Error("The seed has no Cash Back Welcome Bonus v2 (Active) to clone. Run npm run db:reset.");
  const [baseTemplate] = await rows(db, "SELECT * FROM templates WHERE id = ?", [base.template_id]);

  const templateId = newTemplateId();
  const v2Id = `v_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`;
  const at = Date.now() - 3 * 86_400_000;

  const body = JSON.parse(String(base.body)) as { content: { type: string; attrs?: { id?: string }; content?: unknown[] }[] };
  // The offer text: first name and last name in the greeting (so the long name shows), then the terms.
  const greeting = body.content.find((block) => block.type === "paragraph");
  if (!greeting) throw new Error("The cloned body has no paragraph.");
  greeting.content = [
    text("Hi "),
    variable("first_name"),
    text(" "),
    variable("last_name"),
    text(", spend $1,000 on travel in your first 3 months and earn $200 back. Your purchase APR is "),
    variable("purchase_apr"),
    text("."),
  ];

  const variables: Variable[] = [
    { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
    { key: "last_name", label: "Last name", type: "text", required: true, sample: "Chen" },
    { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
    { key: "home_state", label: "Home state", type: "us_state", required: true, sample: "NJ" },
    { key: "offer_end_date", label: "Offer end date", type: "date", required: false, sample: "2026-11-19" },
  ] as unknown as Variable[];
  const keys = variables.map((v) => v.key);
  const sampleSets = (JSON.parse(String(base.sample_sets)) as { id: string; values: Record<string, string> }[]).map((set) => ({
    ...set,
    values: Object.fromEntries(Object.entries(set.values).filter(([key]) => keys.includes(key))),
  }));

  await run(db, "INSERT INTO templates (id, team_id, content_type_id, created_by, created_at, starter_key) VALUES (?, ?, ?, ?, ?, ?)", [
    templateId,
    TEAM,
    baseTemplate.content_type_id,
    "maya",
    at - 86_400_000,
    FIXTURE_MARK,
  ]);

  const version: Row = {
    ...base,
    id: v2Id,
    template_id: templateId,
    number: 2,
    state: "active",
    name: SPRING_NAME,
    based_on_version_id: null,
    body: JSON.stringify(body),
    email_subject: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [variable("first_name"), text(", your Spring Travel Rewards terms")] }] }),
    email_preheader: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [text("What to know before you spend.")] }] }),
    channels: JSON.stringify(["pdf", "web", "email"]),
    variables: JSON.stringify(variables),
    sample_sets: JSON.stringify(sampleSets),
    contract_changes: null,
    current_stage: 0,
    rev: 0,
    created_by: "maya",
    created_at: at - 86_400_000,
    updated_at: at,
    submitted_by: "maya",
    submitted_at: at - 3_600_000,
    submit_note: null,
    activated_at: at,
    superseded_at: null,
    sunset_at: null,
    sunset_set_by: null,
    revoke: null,
    import_upload_id: null,
  };
  const columns = Object.keys(version);
  await run(db, `INSERT INTO versions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((c) => version[c]));
  await run(
    db,
    "INSERT INTO approvals (id, version_id, stage_id, stage_position, stage_name, actor_id, decision, reason, sample_sets_seen, decided_at) VALUES (?, ?, 'stage_disclosure_0', 0, 'Team approver', 'jordan', 'approved', NULL, ?, ?)",
    [`ap_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`, v2Id, JSON.stringify(sampleSets.map((s) => s.id)), at],
  );
  await run(db, "INSERT INTO audit_events (id, at, actor_id, team_id, template_id, version_id, action, details) VALUES (?, ?, 'jordan', ?, ?, ?, 'version.activated', ?)", [
    `ae_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`,
    at,
    TEAM,
    templateId,
    v2Id,
    JSON.stringify({ number: 2, supersedes: null, stage: "Team approver" }),
  ]);
  return { templateId, v2Id, variables };
}

/** Removes a template and every row that points at it, children first. */
export async function removeTemplate(db: Client, id: string) {
  const own = "(SELECT id FROM versions WHERE template_id = ?)";
  const threads = "(SELECT id FROM comment_threads WHERE template_id = ?)";
  const statements: [string, InValue[]][] = [
    // Coral's own reads of this template's notices.
    ["DELETE FROM sim_notice_reads WHERE notice_id IN (SELECT id FROM consumer_notices WHERE template_id = ?)", [id]],
    ["DELETE FROM sim_deliveries WHERE template_id = ?", [id]],
    ["DELETE FROM sim_links WHERE template_id = ?", [id]],
    [`DELETE FROM comments WHERE thread_id IN ${threads}`, [id]],
    ["DELETE FROM comment_threads WHERE template_id = ?", [id]],
    [`DELETE FROM approvals WHERE version_id IN ${own}`, [id]],
    ["DELETE FROM audit_events WHERE template_id = ?", [id]],
    ["DELETE FROM notifications WHERE href LIKE ?", [`%/${id}%`]],
    ["DELETE FROM consumer_notices WHERE template_id = ?", [id]],
    ["DELETE FROM render_log WHERE template_id = ?", [id]],
    ["DELETE FROM uploads WHERE template_id = ?", [id]],
    ["DELETE FROM versions WHERE template_id = ?", [id]],
    ["DELETE FROM templates WHERE id = ?", [id]],
  ];
  for (const [sql, args] of statements) await run(db, sql, args);
}

// ── What a run leaves behind, so it can be put back ─────────────────────────

export interface Snapshot {
  /** The raw `clock_offset_days` value, or null when the setting wasn't there. */
  clock: string | null;
  simNoticeReads: Set<string>;
  simDeliveries: Set<string>;
  /** Coral's links, as they were. */
  simLinks: Row[];
}

const idSet = async (db: Client, sql: string) => new Set((await rows(db, sql)).map((r) => String(Object.values(r)[0])));

export async function takeSnapshot(db: Client): Promise<Snapshot> {
  const [clock] = await rows(db, "SELECT value FROM settings WHERE key = 'clock_offset_days'");
  return {
    clock: clock ? String(clock.value) : null,
    simNoticeReads: await idSet(db, "SELECT notice_id FROM sim_notice_reads"),
    simDeliveries: await idSet(db, "SELECT id FROM sim_deliveries"),
    simLinks: await rows(db, "SELECT * FROM sim_links"),
  };
}

export interface RestoreScope {
  /** Fixture templates to remove with every row that points at them. */
  templates?: readonly string[];
  /** Offers whose deliveries (and the render_log rows those made) and link this run touched. */
  offers?: readonly string[];
  /** Templates whose notices Coral may have read during the run (the reads go back to the snapshot). */
  noticeTemplates?: readonly string[];
  /** Put the demo clock back (the default). Leave it alone when the run never moved it. */
  clock?: boolean;
}

/**
 * Puts the database back as the snapshot found it, for what this run touched and nothing else (the dev
 * database is shared with other people's sessions): the clock first (a spec that advances it must never
 * leave it advanced), then the deliveries of the named offers and the render_log rows they made, those
 * offers' links, the reads of the named templates' notices, and the fixture's own rows.
 */
export async function restore(db: Client, snapshot: Snapshot, scope: RestoreScope = {}) {
  const { templates = [], offers = [], noticeTemplates = [], clock = true } = scope;
  const problems: unknown[] = [];
  const attempt = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      problems.push(error);
    }
  };
  const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

  await attempt(async () => {
    if (!clock) return;
    if (snapshot.clock === null) await run(db, "DELETE FROM settings WHERE key = 'clock_offset_days'");
    else
      await run(db, "INSERT INTO settings (key, value) VALUES ('clock_offset_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [snapshot.clock]);
  });

  await attempt(async () => {
    if (offers.length === 0) return;
    const all = await rows(db, `SELECT id, correlation_id FROM sim_deliveries WHERE offer_id IN (${marks(offers.length)})`, [...offers]);
    const fresh = all.filter((r) => !snapshot.simDeliveries.has(String(r.id)));
    for (let i = 0; i < fresh.length; i += 200) {
      const chunk = fresh.slice(i, i + 200);
      await run(db, `DELETE FROM render_log WHERE correlation_id IN (${marks(chunk.length)})`, chunk.map((r) => r.correlation_id));
      await run(db, `DELETE FROM sim_deliveries WHERE id IN (${marks(chunk.length)})`, chunk.map((r) => r.id));
    }
  });

  for (const id of templates) await attempt(() => removeTemplate(db, id));

  await attempt(async () => {
    // Links: each named offer goes back to what it was (the fixture's offer: none).
    for (const offer of offers) {
      const was = snapshot.simLinks.find((r) => String(r.offer_id) === offer);
      const now = (await rows(db, "SELECT * FROM sim_links WHERE offer_id = ?", [offer]))[0];
      if (now && was && JSON.stringify(now) === JSON.stringify(was)) continue;
      await run(db, "DELETE FROM sim_links WHERE offer_id = ?", [offer]);
      if (was) {
        const columns = Object.keys(was);
        await run(db, `INSERT INTO sim_links (${columns.join(", ")}) VALUES (${marks(columns.length)})`, columns.map((c) => was[c]));
      }
    }
  });

  await attempt(async () => {
    for (const template of noticeTemplates) {
      const reads = await rows(db, "SELECT r.notice_id FROM sim_notice_reads r JOIN consumer_notices n ON n.id = r.notice_id WHERE n.template_id = ?", [template]);
      for (const read of reads) if (!snapshot.simNoticeReads.has(String(read.notice_id))) await run(db, "DELETE FROM sim_notice_reads WHERE notice_id = ?", [read.notice_id]);
    }
  });

  if (problems.length > 0) throw problems[0];
}

/** The demo clock's day as the app sees it (UTC), `plusDays` from today: YYYY-MM-DD. */
export async function clockDay(db: Client, plusDays = 0): Promise<string> {
  const [row] = await rows(db, "SELECT value FROM settings WHERE key = 'clock_offset_days'");
  const offset = row ? Number(JSON.parse(String(row.value))) : 0;
  return new Date(Date.now() + (offset + plusDays) * 86_400_000).toISOString().slice(0, 10);
}

// ── Coral, as the API sees it ────────────────────────────────────────────────

/** One render as Coral's send service would make it: its own consumer id, a real version, never a preview. */
export function coralRender(request: APIRequestContext, fixture: SpringFixture, version: number, label: string) {
  return render(request, {
    templateId: fixture.templateId,
    consumer: "coral",
    correlationId: correlation(label),
    body: { version, channel: "web", values: validValues(fixture.variables) },
  });
}

/** Coral's link of the offer to the fixture, as a person would have left it after scenario 4: pinned to v2, mapped. */
export async function linkSpringOffer(db: Client, fixture: SpringFixture) {
  await run(db, "DELETE FROM sim_links WHERE offer_id = ?", [SPRING_OFFER]);
  await run(db, "INSERT INTO sim_links (id, offer_id, template_id, template_name, pinned_version, channels, mapping, linked_at) VALUES (?, ?, ?, ?, 2, ?, ?, ?)", [
    `lnk_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`,
    SPRING_OFFER,
    fixture.templateId,
    SPRING_NAME,
    JSON.stringify(["pdf", "web", "email"]),
    JSON.stringify({
      first_name: "customer.firstName",
      last_name: "customer.lastName",
      purchase_apr: "customer.purchaseApr",
      home_state: "customer.homeState",
      offer_end_date: "offer.endsOn",
    }),
    Date.now() - 86_400_000,
  ]);
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

export const profileButton = (page: Page) => page.getByRole("button", { name: /profile and persona/ });

/** Through the persona switcher, as a presenter would: the URL stays, the page re-reads as the new person. */
export async function switchPersona(page: Page, person: string) {
  const url = page.url();
  await click(profileButton(page));
  await click(page.getByRole("menuitemradio", { name: new RegExp(escapeRe(person)) }));
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(profileButton(page)).toHaveAccessibleName(new RegExp(`^${escapeRe(person)},`));
  await expect(page).toHaveURL(url);
}

/** React has attached its handlers to the element (an interactive element of a simulator page). */
export async function reactReady(target: Locator) {
  await expect
    .poll(() => target.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { message: "the page is interactive" })
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
  await reactReady(page.getByRole("table", { name: "Offers" }).getByRole("link").first());
}

/** From the simulator: "Back to Stencil". */
export async function backToUcomp(page: Page) {
  await click(page.getByRole("link", { name: "Back to Stencil" }));
  await expect(page.getByRole("link", { name: "Back to Stencil" })).toHaveCount(0);
}

/** Opens one offer from the simulator's offers table. */
export async function openOffer(page: Page, offerName: string) {
  await click(page.getByRole("table", { name: "Offers" }).getByRole("link", { name: offerName, exact: true }));
  await expect(page.getByRole("heading", { level: 1, name: offerName })).toBeVisible();
  await reactReady(page.getByRole("tab", { name: "Template" }));
}

/** The offer's tab, picked in the page (the URL follows). */
export async function openOfferTab(page: Page, tab: "Template" | "Values" | "Send") {
  const control = page.getByRole("tab", { name: tab, exact: true });
  await reactReady(control);
  await click(control);
  await expect(control).toHaveAttribute("aria-selected", "true");
}

/** The Send tab's customer picker: ticks each name, as a person would. */
export async function selectCustomers(page: Page, customers: readonly { name: string }[]) {
  for (const customer of customers) {
    const box = page.getByRole("checkbox", { name: `Select ${customer.name}`, exact: true });
    await reactReady(box);
    // A page that has just changed (a relink lands on Send) can reset the picker once more as it settles:
    // a person would see the box still empty and press it again.
    for (let attempt = 0; attempt < 4 && (await box.getAttribute("aria-checked")) !== "true"; attempt++) {
      await click(box);
      await page.waitForTimeout(350);
    }
    await expect(box).toHaveAttribute("aria-checked", "true");
  }
}

/** The results headline ("15 delivered", "0 delivered, 4 failed") of the newest send. */
export const resultsHeadline = (page: Page) => page.getByRole("heading", { level: 3 }).filter({ hasText: /\d+ delivered/ });

/** The results grid's rows (one per customer). */
export const resultsRows = (page: Page) => page.getByRole("table", { name: "Results" }).locator("tbody tr");

/** The Send button: "Send", or "Send to 2 customers" once some are chosen. */
export const sendButton = (page: Page) => page.getByRole("button", { name: /^Send( to \d+ customers?)?$/ });

/** Send, once the page can take it. */
export async function send(page: Page) {
  const button = sendButton(page);
  await expect(button).toBeEnabled();
  await reactReady(button);
  await click(button);
}

// ── Demo-mode noise ──────────────────────────────────────────────────────────

/**
 * In the `demo` project only, takes out the console lines the recording harness itself causes, so a
 * real error still fails the run:
 *  - "Blocked script execution" in a PDF frame (the harness's init scripts reach the PDF viewer's sandboxed frame);
 *  - "duplicate view-transition-name: ucomp-demo-cursor" and the aborted transition that follows it (the
 *    cursor dot named for view transitions, mounted twice by two overlapping injections after a full page load).
 * Call it from an afterEach: it runs before the `problems` fixture checks the list.
 */
export function dropDemoNoise(problems: string[]) {
  if (!isDemo()) return;
  const noise = [
    /Blocked script execution in '[^']*\/sim\/deliveries\/[^/']+\/file'/,
    /Unexpected duplicate view-transition-name: ucomp-demo-cursor/,
    /^pageerror: Transition was aborted because of invalid state/,
  ];
  for (let i = problems.length - 1; i >= 0; i--) if (noise.some((pattern) => pattern.test(problems[i]))) problems.splice(i, 1);
}

/**
 * The failed renders of the newest send: `count` failed cells, each with the API's status and code, and the
 * API's message verbatim on screen. When every failure shares one message the grid says it once, in the
 * results header; when they differ each cell carries its own. Either way the sentence is shown as received.
 */
export async function expectFailed(page: Page, count: number, error: { status: number; code: string; message: string }) {
  const cells = page.getByRole("table", { name: "Results" }).locator("td").filter({ hasText: "Failed" });
  await expect(cells).toHaveCount(count);
  for (let i = 0; i < count; i++) await expect(cells.nth(i)).toContainText(`${error.status} ${error.code}`);
  await expect(page.getByText(error.message, { exact: false }).filter({ visible: true }).first(), "the API's message, verbatim").toBeVisible();
}
