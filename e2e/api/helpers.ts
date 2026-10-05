import { createClient, type Client, type InValue } from "@libsql/client";
import { expect, type APIRequestContext, type APIResponse, type PlaywrightWorkerArgs } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Shared by the API specs: the database (read for what the seed holds and for render_log; written
// only through `withTemporarily`, which always puts the row back), the render call, and the
// assertions every error response has to pass.

// ── The database ─────────────────────────────────────────────────────────────

export const openDb = (): Client => createClient({ url: `file:${path.resolve(process.cwd(), "data", "ucomp.db")}` });

export type Channel = "pdf" | "web" | "email";
export type VariableType = "text" | "currency" | "percent" | "date" | "number" | "us_state";

export interface Variable {
  key: string;
  type: VariableType;
  required: boolean;
}

export interface SeedVersion {
  id: string;
  templateId: string;
  templateName: string;
  teamId: string;
  /** null for an open draft. */
  number: number | null;
  state: string;
  channels: Channel[];
  variables: Variable[];
  /** ms since the epoch. */
  sunsetAt: number | null;
  /** ISO timestamp of the confirmed revoke. */
  revokedAt: string | null;
  /** The number of the template's Active version, whatever this version's state is. */
  activeNumber: number | null;
}

/** Every version in the seed, with what the render rules look at. Nothing is hardcoded by id. */
export async function allVersions(db: Client): Promise<SeedVersion[]> {
  const { rows } = await db.execute(`
    SELECT v.id, v.template_id, t.name AS template_name, t.team_id, v.number, v.state, v.channels, v.variables,
           v.sunset_at, v.revoke,
           (SELECT a.number FROM versions a WHERE a.template_id = v.template_id AND a.state = 'active') AS active_number
    FROM versions v JOIN templates t ON t.id = v.template_id
    ORDER BY v.template_id, v.number`);
  return rows.map((r) => {
    const revoke = r.revoke ? (JSON.parse(String(r.revoke)) as { confirmedAt?: string }) : null;
    return {
      id: String(r.id),
      templateId: String(r.template_id),
      templateName: String(r.template_name),
      teamId: String(r.team_id),
      number: r.number === null ? null : Number(r.number),
      state: String(r.state),
      channels: JSON.parse(String(r.channels)) as Channel[],
      variables: JSON.parse(String(r.variables)) as Variable[],
      sunsetAt: r.sunset_at === null ? null : Number(r.sunset_at),
      revokedAt: revoke?.confirmedAt ?? null,
      activeNumber: r.active_number === null ? null : Number(r.active_number),
    };
  });
}

/** The first version that fits, or a failure that says what the seed is missing. */
export function pick(versions: readonly SeedVersion[], what: string, fits: (v: SeedVersion) => boolean): SeedVersion {
  const found = versions.find(fits);
  if (!found) throw new Error(`The seed has no ${what}.`);
  return found;
}

/** The demo clock: real time plus the "advance N days" offset. */
export async function demoNow(db: Client): Promise<number> {
  const { rows } = await db.execute("SELECT value FROM settings WHERE key = 'clock_offset_days'");
  const days = rows[0] ? Number(JSON.parse(String(rows[0].value))) : 0;
  return Date.now() + days * 86_400_000;
}

/**
 * Sets columns on one row for the length of `fn`, then puts back exactly what was there, even when
 * `fn` throws. For the rules the seed has no row for (a sunset that has passed, a content type that
 * narrows its channels).
 */
export async function withTemporarily<T>(
  db: Client,
  table: "versions" | "content_types",
  id: string,
  set: Record<string, InValue>,
  fn: () => Promise<T>,
): Promise<T> {
  const columns = Object.keys(set);
  const before = (await db.execute({ sql: `SELECT ${columns.join(", ")} FROM ${table} WHERE id = ?`, args: [id] })).rows[0];
  if (!before) throw new Error(`${table} row ${id} doesn't exist.`);
  const assign = columns.map((column) => `${column} = ?`).join(", ");
  try {
    await db.execute({ sql: `UPDATE ${table} SET ${assign} WHERE id = ?`, args: [...columns.map((c) => set[c]), id] });
    return await fn();
  } finally {
    await db.execute({
      sql: `UPDATE ${table} SET ${assign} WHERE id = ?`,
      args: [...columns.map((c) => before[c] as InValue), id],
    });
  }
}

// ── render_log ───────────────────────────────────────────────────────────────

export const LOG_COLUMNS = [
  "id",
  "at",
  "template_id",
  "version_id",
  "version_number",
  "consumer_id",
  "channel",
  "is_preview",
  "correlation_id",
  "outcome",
  "error_code",
  "duration_ms",
] as const;

export type LogRow = Record<(typeof LOG_COLUMNS)[number], string | number | null>;

/** Every render_log row for a correlation id, oldest first, every column. */
export async function logFor(db: Client, correlationId: string): Promise<LogRow[]> {
  const { columns, rows } = await db.execute({
    sql: "SELECT * FROM render_log WHERE correlation_id = ? ORDER BY at, id",
    args: [correlationId],
  });
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])) as LogRow);
}

// ── Values ───────────────────────────────────────────────────────────────────

const VALID: Record<VariableType, string> = {
  text: "Casey",
  currency: "1234.56",
  percent: "21.99",
  date: "2027-03-04",
  number: "20000",
  us_state: "NJ",
};

/** A value for every variable (optional ones too) that fits its type; `overrides` replace by key. */
export function validValues(variables: readonly Variable[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...Object.fromEntries(variables.map((v) => [v.key, VALID[v.type]])), ...overrides };
}

/** What a value of each type must be, as the 422 message words it: "{key} must be {noun}." */
export const NOUNS: Record<VariableType, string> = {
  text: "text",
  currency: "an amount, like 1000.00",
  percent: "a percentage, like 21.99",
  date: "a date, like 2027-03-04",
  number: "a number, like 20000",
  us_state: "a US state, like NJ",
};

/** A value that no variable of that type accepts. */
export const JUNK: Record<VariableType, unknown> = {
  text: { not: "text" },
  currency: "twelve dollars",
  percent: "abc",
  date: "someday",
  number: "many",
  us_state: "Narnia",
};

// ── The call ─────────────────────────────────────────────────────────────────

export const renderPath = (templateId: string) => `/api/v1/templates/${templateId}/render`;

export const correlation = (label: string) => `e2e-render-${label}-${randomUUID().slice(0, 8)}`;

export interface Call {
  templateId: string;
  body: unknown;
  /** The X-Consumer-Id; `null` sends none. */
  consumer?: string | null;
  correlationId?: string | null;
  headers?: Record<string, string>;
}

/** POSTs to the render route. A correlation id is added unless `correlationId` is null. */
export async function render(
  request: APIRequestContext,
  { templateId, body, consumer = "coral", correlationId, headers = {} }: Call,
): Promise<{ res: APIResponse; correlationId: string | null }> {
  const cid = correlationId === null ? null : (correlationId ?? correlation("call"));
  const res = await request.post(renderPath(templateId), {
    data: body,
    headers: {
      ...(consumer === null ? {} : { "X-Consumer-Id": consumer }),
      ...(cid === null ? {} : { "X-Correlation-Id": cid }),
      ...headers,
    },
  });
  return { res, correlationId: cid };
}

/**
 * Runs `fn` with a request context that carries the persona cookie (as the persona switcher sets
 * it), then disposes the context. The cookie only matters to previews.
 */
export async function asPersona<T>(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
  persona: string,
  fn: (request: APIRequestContext) => Promise<T>,
): Promise<T> {
  const context = await playwright.request.newContext({
    baseURL,
    storageState: {
      cookies: [
        { name: "ucomp_persona", value: persona, domain: new URL(baseURL).hostname, path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    },
  });
  try {
    return await fn(context);
  } finally {
    await context.dispose();
  }
}

// ── Assertions ───────────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** An error response: status, JSON, no-store, and the `{ error: { code, message } }` shape. Returns the error. */
export async function expectError(res: APIResponse, status: number, code: string, message?: string | RegExp): Promise<ApiError> {
  expect(res.status(), `status for ${code}`).toBe(status);
  expect(res.headers()["content-type"]).toBe("application/json");
  expect(res.headers()["cache-control"]).toBe("no-store");
  const body = (await res.json()) as { error: ApiError };
  expect(Object.keys(body)).toEqual(["error"]);
  expect(body.error.code).toBe(code);
  if (typeof message === "string") expect(body.error.message).toBe(message);
  else if (message) expect(body.error.message).toMatch(message);
  return body.error;
}

export const LABEL: Record<Channel, string> = { pdf: "PDF", web: "Web", email: "Email" };

/** "PDF", "PDF and Web", "PDF, Web and Email". */
export function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "March 1, 2027": how the messages write a date (en-US, UTC). */
export const longDate = (when: Date | string | number) =>
  new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(when));
