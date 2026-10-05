import "server-only";
import { headers } from "next/headers";
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
  searchTemplates(input?: { q?: string; limit?: number }): Promise<ApiResult<ApiTemplateSearch>>;
  getTemplate(templateId: string, input?: { version?: number; since?: number }): Promise<ApiResult<ApiTemplateDetail>>;
  listNotices(input?: { since?: string; templateId?: string; limit?: number }): Promise<ApiResult<ApiNoticeList>>;
  /** POST …/render. PDF is always asked for as base64 (JSON); web comes back as the HTML document. */
  render(
    templateId: string,
    body: Omit<ApiRenderRequest, "encoding">,
    correlationId: string,
  ): Promise<ApiResult<RenderOutput>>;
}

type Fetch = typeof globalThis.fetch;

const UNREACHABLE = (detail: string): SimApiError => ({
  status: 0,
  code: "unreachable",
  message: `UCOMP couldn't be reached (${detail}).`,
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
  return { status: response.status, code: "bad_response", message: `UCOMP answered ${response.status} without an error body.` };
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function newerVersionOf(response: Response, fromBody?: number | null): number | null {
  const header = response.headers.get(API_HEADERS.newerVersion);
  const parsed = header === null ? NaN : Number.parseInt(header, 10);
  if (Number.isInteger(parsed)) return parsed;
  return typeof fromBody === "number" ? fromBody : null;
}

export function createUcompApi({ origin, fetch = globalThis.fetch }: { origin: string; fetch?: Fetch }): UcompApi {
  const base = origin.replace(/\/+$/, "");

  async function call(path: string, init: RequestInit = {}): Promise<{ ok: true; response: Response } | { ok: false; error: SimApiError }> {
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set(API_HEADERS.consumer, CONSUMER_ID);
    requestHeaders.set("Accept", "application/json");
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, { ...init, headers: requestHeaders, cache: "no-store" });
    } catch (error) {
      return { ok: false, error: UNREACHABLE((error as Error)?.message || "network error") };
    }
    if (!response.ok) return { ok: false, error: await errorOf(response) };
    return { ok: true, response };
  }

  async function getJson<T>(path: string): Promise<ApiResult<T>> {
    const result = await call(path);
    if (!result.ok) return result;
    try {
      return { ok: true, data: (await result.response.json()) as T };
    } catch {
      return { ok: false, error: { status: result.response.status, code: "bad_response", message: "UCOMP answered with something that isn't JSON." } };
    }
  }

  const id = (templateId: string) => encodeURIComponent(templateId);

  return {
    origin: base,

    searchTemplates: ({ q, limit } = {}) =>
      getJson<ApiTemplateSearch>(`/api/v1/templates${query({ q: q?.trim(), limit })}`),

    getTemplate: (templateId, { version, since } = {}) =>
      getJson<ApiTemplateDetail>(`/api/v1/templates/${id(templateId)}${query({ version, since })}`),

    listNotices: ({ since, templateId, limit } = {}) =>
      getJson<ApiNoticeList>(`/api/v1/consumers/${CONSUMER_ID}/notices${query({ since, templateId, limit })}`),

    async render(templateId, body, correlationId) {
      const channel: ApiChannel = body.channel;
      const request: ApiRenderRequest = channel === "pdf" ? { ...body, encoding: "base64" } : { ...body };
      const result = await call(`/api/v1/templates/${id(templateId)}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [API_HEADERS.correlation]: correlationId },
        body: JSON.stringify(request),
      });
      if (!result.ok) return result;
      const { response } = result;
      try {
        if (channel === "web") {
          return { ok: true, data: { output: await response.text(), newerVersion: newerVersionOf(response) } };
        }
        if (channel === "pdf") {
          const json = (await response.json()) as ApiBase64Response;
          return { ok: true, data: { output: json.data, newerVersion: newerVersionOf(response, json.newerVersion) } };
        }
        const json = (await response.json()) as ApiEmailResponse;
        const email: EmailOutput = { subject: json.subject, preheader: json.preheader, html: json.html, text: json.text };
        return { ok: true, data: { output: JSON.stringify(email), newerVersion: newerVersionOf(response, json.newerVersion) } };
      } catch {
        return { ok: false, error: { status: response.status, code: "bad_response", message: "UCOMP's render answer couldn't be read." } };
      }
    },
  };
}

/**
 * The origin to call: `UCOMP_API_ORIGIN` when set, else the origin of the request being served
 * (the app calls itself). Reads `headers()`, so callers render inside <Stream> or run in an action.
 */
export async function apiOrigin(): Promise<string> {
  const configured = process.env.UCOMP_API_ORIGIN?.trim();
  if (configured) return configured;
  const h = await headers();
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host")) ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = first(h.get("x-forwarded-proto")) ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

/** The client for the current request. */
export async function ucompApi(): Promise<UcompApi> {
  return createUcompApi({ origin: await apiOrigin() });
}
