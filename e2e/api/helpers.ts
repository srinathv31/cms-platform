import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";

// Shared by the API specs: the render call, a chunked upload with no Content-Length, and the assertions
// every error response has to pass. What the specs read from the database (the seed's versions, the render
// log) comes from ../helpers/state.

export type Channel = "pdf" | "web" | "email" | "push" | "sms";
export type VariableType =
  "text" | "currency" | "percent" | "date" | "number" | "us_state";

export interface Variable {
  key: string;
  type: VariableType;
  required: boolean;
}

export interface SeedVersion {
  id: string;
  templateId: string;
  /** The name this version has (the name is a version field). */
  templateName: string;
  teamId: string;
  /** null for an open draft. */
  number: number | null;
  /** Which submission of its number this row is (decision 0033); null for an open draft. */
  round: number | null;
  /**
   * The row a consumer's version number means: the number's released row, else its latest round. A round
   * sent back before a later one is a record only, and asking for its number gets the later round's answer.
   */
  head: boolean;
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

/**
 * A document's version (PDF, Web, Email), not an alert's (Push, SMS): what the specs that render and
 * check documents pick from. The seed has both (decision 0034).
 */
export const isDocument = (v: SeedVersion) =>
  v.channels.some((c) => c === "pdf" || c === "web" || c === "email");

/** The first version that fits, or a failure that says what the seed is missing. */
export function pick(
  versions: readonly SeedVersion[],
  what: string,
  fits: (v: SeedVersion) => boolean,
): SeedVersion {
  const found = versions.find(fits);
  if (!found) throw new Error(`The seed has no ${what}.`);
  return found;
}

// ── render_log ───────────────────────────────────────────────────────────────

/** The fields a render log row has. None of them holds a variable value. */
export const LOG_FIELDS = [
  "id",
  "at",
  "templateId",
  "versionId",
  "versionNumber",
  "consumerId",
  "channel",
  "platform",
  "isPreview",
  "correlationId",
  "outcome",
  "errorCode",
  "durationMs",
] as const;

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
export function validValues(
  variables: readonly Variable[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...Object.fromEntries(variables.map((v) => [v.key, VALID[v.type]])),
    ...overrides,
  };
}

/** What a value of each type must be, as the 422 message words it: "{key} must be {noun}." */
export const NOUNS: Record<VariableType, string> = {
  text: "text",
  currency: "an amount, like 1000 or 1000.50",
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

export const renderPath = (templateId: string) =>
  `/api/v1/templates/${templateId}/render`;

export const correlation = (label: string) =>
  `e2e-render-${label}-${randomUUID().slice(0, 8)}`;

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
  const cid =
    correlationId === null ? null : (correlationId ?? correlation("call"));
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

export const previewPath = (templateId: string) =>
  `/api/templates/${templateId}/preview`;

/**
 * POSTs to Stencil's own preview route, which reads the person from the persona cookie (a context from
 * `asPersona`). It takes no X-Consumer-Id. A correlation id is added unless `correlationId` is null.
 */
export async function preview(
  request: APIRequestContext,
  { templateId, body, correlationId, headers = {} }: Omit<Call, "consumer">,
): Promise<{ res: APIResponse; correlationId: string | null }> {
  const cid =
    correlationId === null ? null : (correlationId ?? correlation("preview"));
  const res = await request.post(previewPath(templateId), {
    data: body,
    headers: {
      ...(cid === null ? {} : { "X-Correlation-Id": cid }),
      ...headers,
    },
  });
  return { res, correlationId: cid };
}

/**
 * Runs `fn` with a request context that carries the persona cookie (as the persona switcher sets
 * it), then disposes the context. The cookie only matters to the preview route.
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
        {
          name: "ucomp_persona",
          value: persona,
          domain: new URL(baseURL).hostname,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
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

export interface ChunkedAnswer {
  status: number;
  body: string;
  /** Megabytes written before the answer came. */
  sentMb: number;
}

/**
 * POSTs up to `megabytes` of `fill` bytes in 1 MB chunks with `Transfer-Encoding: chunked` (no
 * Content-Length), after `head` and before `tail`, and stops sending once the server answers.
 *
 * The answer is read to its end before the request is torn down. Tearing it down as soon as the
 * status arrives can drop a body still on its way, and then the answer never ends and the test hangs
 * until its timeout. An answer that closes before its end fails the call straight away.
 */
export function postChunked(
  url: URL,
  {
    headers,
    megabytes,
    fill,
    head = "",
    tail = "",
  }: {
    headers: Record<string, string>;
    megabytes: number;
    fill: number;
    head?: string;
    tail?: string;
  },
): Promise<ChunkedAnswer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: "POST",
      headers: { ...headers, "Transfer-Encoding": "chunked" },
    });
    let sentMb = 0;
    let answered = false;
    req.on("response", (res) => {
      answered = true;
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (text: string) => (body += text));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body, sentMb });
        req.destroy(); // the rest of the body is never sent
      });
      res.on("close", () => {
        if (!res.complete)
          reject(
            new Error(
              `The ${res.statusCode} answer closed before its body ended.`,
            ),
          );
      });
    });
    // Once there is an answer, the request's own errors (the server closing its side) don't matter.
    req.on("error", (error) => (answered ? undefined : reject(error)));
    if (head) req.write(head);
    const chunk = Buffer.alloc(1024 * 1024, fill);
    const pump = () => {
      if (answered) return; // stop sending; the request goes once the answer has been read
      if (sentMb >= megabytes) return void req.end(tail);
      sentMb += 1;
      if (req.write(chunk)) setImmediate(pump);
      else req.once("drain", pump);
    };
    pump();
  });
}

// ── Assertions ───────────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** An error response: status, JSON, no-store, and the `{ error: { code, message } }` shape. Returns the error. */
export async function expectError(
  res: APIResponse,
  status: number,
  code: string,
  message?: string | RegExp,
): Promise<ApiError> {
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

export const LABEL: Record<Channel, string> = {
  pdf: "PDF",
  web: "Web",
  email: "Email",
  push: "Push",
  sms: "SMS",
};

/** "PDF", "PDF and Web", "PDF, Web and Email". */
export function andList(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "March 1, 2027": how the messages write a date (en-US, UTC). */
export const longDate = (when: Date | string | number) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(when));
