import "server-only";
import { connection } from "next/server";
import type {
  ApiBase64Response,
  ApiChannel,
  ApiEmailResponse,
  ApiErrorBody,
  ApiNoticeList,
  ApiRenderRequest,
  ApiTemplateDetail,
  ApiTemplateSearch,
} from "@/contracts/api-v1";
import { API_HEADERS } from "@/contracts/api-v1";
import { assertNever } from "./assert-never";
import type { SimApiError } from "./types";

// Coral's client for UCOMP's /api/v1. It runs on the server only (server components and actions) and
// calls the app's own origin over HTTP like any outside consumer would, so the browser never sees a
// 4xx. Every request carries `X-Consumer-Id: coral`. Errors come back as the API wrote them.

export const CONSUMER_ID = "coral";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: SimApiError };

/** What Coral keeps from a successful render (sim_deliveries.output) and the upgrade hint. */
export interface RenderOutput {
  /** pdf: base64 of the PDF bytes · web: the HTML document · email: JSON of EmailOutput. */
  output: string;
  newerVersion: number | null;
}

/** The stored email: what an inbox needs. */
export interface EmailOutput {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export interface UcompApi {
  readonly origin: string;
  /** One page of search results; `after` is an earlier page's `nextCursor` for the same `q`. */
  searchTemplates(input?: { q?: string; limit?: number; after?: string }): Promise<ApiResult<ApiTemplateSearch>>;
  getTemplate(templateId: string, input?: { version?: number; since?: number }): Promise<ApiResult<ApiTemplateDetail>>;
  /** One page of Coral's notices, oldest first; `after` is an earlier page's `nextCursor`. */
  listNotices(input?: { after?: string; templateId?: string; limit?: number }): Promise<ApiResult<ApiNoticeList>>;
  /**
   * POST …/render. PDF is always asked for as base64 (JSON); web comes back as the HTML document.
   * `at` is when UCOMP answered, by its HTTP `Date` header (`answeredAt`).
   */
  render(
    templateId: string,
    body: Omit<ApiRenderRequest, "encoding">,
    correlationId: string,
  ): Promise<ApiResult<RenderOutput> & { at: Date }>;
}

type Fetch = typeof globalThis.fetch;

const UNREACHABLE = (detail: string): SimApiError => ({
  status: 0,
  code: "unreachable",
  message: `Stencil couldn't be reached (${detail}).`,
});

/** The API's error body, verbatim; a sentence of our own only when the body isn't the contract's. */
async function errorOf(response: Response): Promise<SimApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    const error = body?.error;
    if (error && typeof error.code === "string" && typeof error.message === "string") {
      return { status: response.status, code: error.code, message: error.message };
    }
  } catch {
    // fall through
  }
  return { status: response.status, code: "bad_response", message: `Stencil answered ${response.status} without an error body.` };
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * When UCOMP answered: its response's HTTP `Date` header, which UCOMP sets from its own clock (the
 * demo's world clock, so a delivery reads on the same day as UCOMP's sunsets). Real time when there's
 * no usable header, or no answer at all.
 */
export function answeredAt(response?: Response): Date {
  const header = response?.headers.get("date");
  const parsed = header ? Date.parse(header) : Number.NaN;
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}

/** Coral stores text, so it asks for the PDF as base64 JSON; the page and the email come as they are. */
function asBase64(channel: ApiChannel): boolean {
  switch (channel) {
    case "pdf":
      return true;
    case "web":
    case "email":
      return false;
    default:
      return assertNever(channel, "channel");
  }
}

function newerVersionOf(response: Response, fromBody?: number | null): number | null {
  const header = response.headers.get(API_HEADERS.newerVersion);
  const parsed = header === null ? NaN : Number.parseInt(header, 10);
  if (Number.isInteger(parsed)) return parsed;
  return typeof fromBody === "number" ? fromBody : null;
}

export function createUcompApi({ origin, fetch = globalThis.fetch }: { origin: string; fetch?: Fetch }): UcompApi {
  const base = origin.replace(/\/+$/, "");

  async function call(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: true; response: Response } | { ok: false; error: SimApiError; response?: Response }> {
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set(API_HEADERS.consumer, CONSUMER_ID);
    requestHeaders.set("Accept", "application/json");
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, { ...init, headers: requestHeaders, cache: "no-store" });
    } catch (error) {
      return { ok: false, error: UNREACHABLE((error as Error)?.message || "network error") };
    }
    if (!response.ok) return { ok: false, error: await errorOf(response), response };
    return { ok: true, response };
  }

  async function getJson<T>(path: string): Promise<ApiResult<T>> {
    const result = await call(path);
    if (!result.ok) return { ok: false, error: result.error };
    try {
      return { ok: true, data: (await result.response.json()) as T };
    } catch {
      return { ok: false, error: { status: result.response.status, code: "bad_response", message: "Stencil answered with something that isn't JSON." } };
    }
  }

  const id = (templateId: string) => encodeURIComponent(templateId);

  return {
    origin: base,

    searchTemplates: ({ q, limit, after } = {}) =>
      getJson<ApiTemplateSearch>(`/api/v1/templates${query({ q: q?.trim(), limit, after })}`),

    getTemplate: (templateId, { version, since } = {}) =>
      getJson<ApiTemplateDetail>(`/api/v1/templates/${id(templateId)}${query({ version, since })}`),

    listNotices: ({ after, templateId, limit } = {}) =>
      getJson<ApiNoticeList>(`/api/v1/consumers/${CONSUMER_ID}/notices${query({ templateId, limit, after })}`),

    async render(templateId, body, correlationId) {
      const channel: ApiChannel = body.channel;
      const request: ApiRenderRequest = asBase64(channel) ? { ...body, encoding: "base64" } : { ...body };
      const result = await call(`/api/v1/templates/${id(templateId)}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [API_HEADERS.correlation]: correlationId },
        body: JSON.stringify(request),
      });
      const at = answeredAt(result.response);
      if (!result.ok) return { ok: false, error: result.error, at };
      const { response } = result;
      try {
        switch (channel) {
          case "web":
            return { ok: true, data: { output: await response.text(), newerVersion: newerVersionOf(response) }, at };
          case "pdf": {
            const json = (await response.json()) as ApiBase64Response;
            return { ok: true, data: { output: json.data, newerVersion: newerVersionOf(response, json.newerVersion) }, at };
          }
          case "email": {
            const json = (await response.json()) as ApiEmailResponse;
            const email: EmailOutput = { subject: json.subject, preheader: json.preheader, html: json.html, text: json.text };
            return { ok: true, data: { output: JSON.stringify(email), newerVersion: newerVersionOf(response, json.newerVersion) }, at };
          }
          default:
            return assertNever(channel, "channel");
        }
      } catch {
        return { ok: false, error: { status: response.status, code: "bad_response", message: "Stencil's render answer couldn't be read." }, at };
      }
    },
  };
}

/**
 * The origin to call: `UCOMP_API_ORIGIN` when set, else this server itself on loopback, at the port
 * it listens on (`next dev` / `next start` set PORT: 3000 in dev, 3100 for the e2e gate, 3200 for the
 * demo). Never from the request's Host or X-Forwarded-* headers: the client controls those, and the
 * server fetches this origin and stores what it answers (server-side request forgery otherwise).
 * Calls `connection()`, so callers stay dynamic: they render inside <Stream> or run in an action.
 */
export async function apiOrigin(): Promise<string> {
  await connection();
  const configured = process.env.UCOMP_API_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = Number(process.env.PORT);
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 ? port : 3000}`;
}

/** The client for the current request. */
export async function ucompApi(): Promise<UcompApi> {
  return createUcompApi({ origin: await apiOrigin() });
}
