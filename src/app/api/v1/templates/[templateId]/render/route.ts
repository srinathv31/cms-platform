import type { NextRequest } from "next/server";
import { z } from "zod";
import { BAD_REQUEST_MESSAGES, badRequest, consumerRequired, renderFailed } from "@/domain/render";
import type { Base64ResponseBody, EmailRender, EmailResponseBody, RenderError } from "@/domain/render/types";
import { CHANNELS } from "@/domain/types";
import { baseHeaders, correlationIdOf, errorResponse } from "@/server/api/http";
import { renderTemplate, type RenderResult } from "@/server/render/render-template";
import { getViewer } from "@/server/viewer";

// POST /api/v1/templates/{templateId}/render: the render API, shaped like the future Java service.
// The contract (body, headers, every error and its wording) is src/domain/render/types.ts.
//
// A POST handler always runs at request time, Cache Components or not (only GET handlers can be
// prerendered or cached), so reading the body, the headers and the persona cookie here is fine.

/** A render request is a version, a channel and a few values: far under this. */
const MAX_BODY_SIZE = 1_000_000;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const RequestBody = z.object({
  version: z.union([z.int().min(1), z.literal("draft")]),
  channel: z.enum(CHANNELS),
  values: z.custom<Record<string, unknown>>(isPlainObject),
  encoding: z.literal("base64").optional(),
  preview: z.boolean().optional(),
});
type RequestBody = z.infer<typeof RequestBody>;

/** The bad_request sentence for the first field that doesn't fit. */
const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  version: BAD_REQUEST_MESSAGES.version,
  channel: BAD_REQUEST_MESSAGES.channel,
  values: "values must be an object.",
  encoding: "encoding must be base64.",
  preview: "preview must be true or false.",
};

type Parsed = { ok: true; body: RequestBody } | { ok: false; error: RenderError };

function parseBody(text: string): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: badRequest(BAD_REQUEST_MESSAGES.body) };
  }
  const required = ["version", "channel", "values"];
  if (!isPlainObject(json) || !required.every((key) => Object.hasOwn(json, key))) {
    return { ok: false, error: badRequest(BAD_REQUEST_MESSAGES.body) };
  }
  const parsed = RequestBody.safeParse(json);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { ok: false, error: badRequest(FIELD_MESSAGES[field] ?? BAD_REQUEST_MESSAGES.body) };
  }
  return { ok: true, body: parsed.data };
}

// ── Headers ──────────────────────────────────────────────────────────────────
// The correlation id, no-store and nosniff, and the error body, are shared with the consumer GET
// routes: src/server/api/http.ts.

// The web document has no scripts and loads nothing; this keeps it that way if it's opened directly.
const WEB_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'";

// ── Responses ────────────────────────────────────────────────────────────────

const toBase64 = (data: Uint8Array | string) =>
  (typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)).toString("base64");

type Rendered = Extract<RenderResult, { ok: true }>;

function successResponse(
  result: Rendered,
  opts: { templateId: string; preview: boolean; encoding?: "base64"; correlationId: string },
): Response {
  const headers = baseHeaders(opts.correlationId);
  headers.set("X-UCOMP-Template-Id", opts.templateId);
  headers.set("X-UCOMP-Version", result.versionNumber === null ? "draft" : String(result.versionNumber));
  if (result.newerVersion !== null) headers.set("X-UCOMP-Newer-Version", String(result.newerVersion));
  if (opts.preview) headers.set("X-UCOMP-Preview", "true");

  const { newerVersion } = result;

  if (result.channel === "email") {
    const email = result.body as EmailRender;
    const body: EmailResponseBody =
      opts.encoding === "base64"
        ? { ...email, html: toBase64(email.html), text: toBase64(email.text), newerVersion, encoding: "base64" }
        : { ...email, newerVersion };
    return Response.json(body, { headers });
  }

  const contentType = result.channel === "pdf" ? "application/pdf" : "text/html; charset=utf-8";
  const data = result.body as Uint8Array | string;

  if (opts.encoding === "base64") {
    const body: Base64ResponseBody = {
      channel: result.channel,
      contentType,
      encoding: "base64",
      data: toBase64(data),
      newerVersion,
    };
    return Response.json(body, { headers });
  }

  headers.set("Content-Type", contentType);
  if (result.channel === "pdf") {
    headers.set("Content-Disposition", `inline; filename="${result.filename.replace(/[^\w.-]/g, "_")}"`);
    const bytes = data as Uint8Array;
    // A copy on its own ArrayBuffer: the Response body type wants exactly that.
    return new Response(new Uint8Array(bytes), { headers });
  }
  headers.set("Content-Security-Policy", WEB_CSP);
  return new Response(data as string, { headers });
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const correlationId = correlationIdOf(request);

  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_SIZE) return errorResponse(badRequest("The body is too large."), correlationId);
  const text = await request.text();
  if (text.length > MAX_BODY_SIZE) return errorResponse(badRequest("The body is too large."), correlationId);

  const parsed = parseBody(text);
  if (!parsed.ok) return errorResponse(parsed.error, correlationId);
  const { version, channel, values, encoding } = parsed.body;
  const preview = parsed.body.preview === true;

  if (version === "draft" && !preview) return errorResponse(badRequest(BAD_REQUEST_MESSAGES.version), correlationId);
  const consumerId = request.headers.get("x-consumer-id")?.trim() || null;
  if (!preview && !consumerId) return errorResponse(consumerRequired(), correlationId);

  try {
    const result = await renderTemplate({
      templateId,
      version,
      channel,
      values,
      encoding,
      preview,
      consumerId: preview ? null : consumerId,
      correlationId,
      viewer: preview ? await getViewer() : null,
    });
    if (!result.ok) return errorResponse(result.error, correlationId);
    return successResponse(result, { templateId, preview, encoding, correlationId });
  } catch (error) {
    // The database or the log write failed: still a JSON error with the contract's shape.
    console.error(`[render] ${templateId} ${channel} failed outside the pipeline, correlation ${correlationId}`, error);
    return errorResponse(renderFailed(channel), correlationId);
  }
}
