import "server-only";
import { z } from "zod";
import { assertNever } from "@/domain/assert-never";
import { PUSH_PLATFORMS } from "@/domain/messages/push";
import {
  BAD_REQUEST_MESSAGES,
  MAX_BODY_BYTES,
  badRequest,
  bodyTooLarge,
} from "@/domain/render";
import type {
  Base64ResponseBody,
  EmailRender,
  EmailResponseBody,
  PushRender,
  PushResponseBody,
  RenderError,
  SmsRender,
  SmsResponseBody,
} from "@/domain/render/types";
import { CHANNELS } from "@/domain/types";
import { baseHeaders } from "@/server/api/http";
import { readBodyCapped } from "@/server/api/read-body";
import type { RenderResult } from "@/server/services/render";

// What the two routes that render share: the consumer API's (POST /api/v1/templates/{id}/render) and
// Stencil's own preview (POST /api/templates/{id}/preview). Each reads the same request body (this
// file reads and checks it) and answers with the same bodies and headers (`renderSuccessResponse`).
// They differ in who is asking: a registered consumer, or the signed-in person. Neither route's auth
// is here.
//
// The body is read with a byte counter (`readBodyCapped`) that stops at MAX_BODY_BYTES: a declared
// Content-Length is only a hint, and a chunked body has none, so nothing past the limit is buffered.

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const RequestBody = z.object({
  version: z.union([z.int().min(1), z.literal("draft")]),
  channel: z.enum(CHANNELS),
  platform: z.enum(PUSH_PLATFORMS).optional(),
  values: z.custom<Record<string, unknown>>(isPlainObject),
  encoding: z.literal("base64").optional(),
  // The preview's round (`?round=` on the review screen). Not in the consumer contract: only the
  // preview route reads it, and checks it there. Any other field of the body is dropped unread.
  round: z.unknown().optional(),
});

/** What a render request holds once its shape is checked. `"draft"` and `round` are the preview's alone. */
export type RenderRequestBody = z.infer<typeof RequestBody>;

/** The bad_request sentence for the first field that doesn't fit. */
const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  version: BAD_REQUEST_MESSAGES.version,
  channel: BAD_REQUEST_MESSAGES.channel,
  platform: BAD_REQUEST_MESSAGES.platform,
  values: "values must be an object.",
  encoding: "encoding must be base64.",
};

/** The bad_request sentence for a preview's `round` that isn't a whole number from 1. */
export const ROUND_MESSAGE = "round must be a whole number from 1.";

export type ReadRender =
  { ok: true; body: RenderRequestBody } | { ok: false; error: RenderError };

/**
 * The body, read within the limit and checked. `values` is left as parsed: validation (`validateValues`)
 * refuses a value that isn't a JSON string, a number included (decision 0058).
 */
export async function readRenderRequest(request: Request): Promise<ReadRender> {
  // Too large: refused from the declared length when there is one, else as soon as the count passes it.
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
    return { ok: false, error: bodyTooLarge() };
  const read = await readBodyCapped(request.body, MAX_BODY_BYTES);
  if (!read.ok) return { ok: false, error: bodyTooLarge() };
  return parseRenderBody(new TextDecoder().decode(read.bytes));
}

function parseRenderBody(text: string): ReadRender {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: badRequest(BAD_REQUEST_MESSAGES.body) };
  }
  const required = ["version", "channel", "values"];
  if (
    !isPlainObject(json) ||
    !required.every((key) => Object.hasOwn(json, key))
  ) {
    return { ok: false, error: badRequest(BAD_REQUEST_MESSAGES.body) };
  }
  const parsed = RequestBody.safeParse(json);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return {
      ok: false,
      error: badRequest(FIELD_MESSAGES[field] ?? BAD_REQUEST_MESSAGES.body),
    };
  }
  return { ok: true, body: parsed.data };
}

// ── Responses ────────────────────────────────────────────────────────────────

// The web document has no scripts and loads nothing; this keeps it that way if it's opened directly.
const WEB_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'";

const toBase64 = (data: Uint8Array | string) =>
  (typeof data === "string"
    ? Buffer.from(data, "utf8")
    : Buffer.from(data)
  ).toString("base64");

type Rendered = Extract<RenderResult, { ok: true }>;

/** The 200 for a render: the channel's body, and the X-Stencil headers (`X-Stencil-Preview` on a preview only). */
export function renderSuccessResponse(
  result: Rendered,
  opts: {
    templateId: string;
    preview: boolean;
    encoding?: "base64";
    correlationId: string;
  },
): Response {
  const headers = baseHeaders(opts.correlationId);
  headers.set("X-Stencil-Template-Id", opts.templateId);
  headers.set(
    "X-Stencil-Version",
    result.versionNumber === null ? "draft" : String(result.versionNumber),
  );
  if (result.newerVersion !== null)
    headers.set("X-Stencil-Newer-Version", String(result.newerVersion));
  if (opts.preview) headers.set("X-Stencil-Preview", "true");

  const { newerVersion } = result;
  // PDF and web are files: as they are, or wrapped in JSON as base64.
  const base64 = (
    channel: Base64ResponseBody["channel"],
    contentType: Base64ResponseBody["contentType"],
    data: Uint8Array | string,
  ) => {
    const body: Base64ResponseBody = {
      channel,
      contentType,
      encoding: "base64",
      data: toBase64(data),
      newerVersion,
    };
    return Response.json(body, { headers });
  };

  switch (result.channel) {
    case "pdf": {
      const bytes = result.body as Uint8Array;
      if (opts.encoding === "base64")
        return base64("pdf", "application/pdf", bytes);
      headers.set("Content-Type", "application/pdf");
      headers.set(
        "Content-Disposition",
        `inline; filename="${result.filename.replace(/[^\w.-]/g, "_")}"`,
      );
      // A copy on its own ArrayBuffer: the Response body type wants exactly that.
      return new Response(new Uint8Array(bytes), { headers });
    }
    case "web": {
      const html = result.body as string;
      if (opts.encoding === "base64")
        return base64("web", "text/html; charset=utf-8", html);
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Content-Security-Policy", WEB_CSP);
      return new Response(html, { headers });
    }
    case "email": {
      const email = result.body as EmailRender;
      const body: EmailResponseBody =
        opts.encoding === "base64"
          ? {
              ...email,
              html: toBase64(email.html),
              text: toBase64(email.text),
              newerVersion,
              encoding: "base64",
            }
          : { ...email, newerVersion };
      return Response.json(body, { headers });
    }
    // Messages are JSON already: the platform's push, or the SMS as sent.
    case "push": {
      const body: PushResponseBody = {
        ...(result.body as PushRender),
        newerVersion,
      };
      return Response.json(body, { headers });
    }
    case "sms": {
      const body: SmsResponseBody = {
        ...(result.body as SmsRender),
        newerVersion,
      };
      return Response.json(body, { headers });
    }
    default:
      return assertNever(result.channel, "channel");
  }
}
