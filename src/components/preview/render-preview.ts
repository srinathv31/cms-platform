// The preview's one call to the render API: POST /api/v1/templates/{id}/render with `preview: true`,
// the same route (and so the same output) the review screen and the consumer simulator get. The
// contract is src/domain/render/types.ts.
//
// `renderPreview` resolves with something the UI can show in every case: the output, or `{ error }`
// carrying the route's own message. It rejects only when `signal` aborts (a newer request replaced
// this one), with the AbortError fetch throws, so a caller can drop the result without a branch.

import { assertNever } from "@/domain/assert-never";
import type { PushPlatform } from "@/domain/messages/push";
import type {
  EmailResponseBody,
  PushRender,
  PushResponseBody,
  RenderError,
  RenderErrorBody,
  SmsRender,
  SmsResponseBody,
} from "@/domain/render/types";
import type { Channel, VariableValues } from "@/domain/types";

export interface RenderPreviewRequest {
  templateId: string;
  /** The open draft, or a version number. */
  version: "draft" | number;
  channel: Channel;
  values: VariableValues;
  signal?: AbortSignal;
}

export type PreviewOutput =
  /** The exact bytes, and the file name the route gave them (Content-Disposition), for Download PDF. */
  | { kind: "pdf"; bytes: Uint8Array; filename: string }
  | { kind: "web"; html: string }
  | { kind: "email"; subject: string; preheader: string; html: string; text: string }
  /** The push for each platform (two requests: Android's never has the subtitle). */
  | { kind: "push"; ios: PushRender; android: PushRender }
  | { kind: "sms"; sms: SmsRender };

export type RenderPreviewResult = PreviewOutput | { kind: "error"; error: RenderError };

/** Shown when the request itself fails (offline, the server is down): there is no route message to show. */
export const UNREACHABLE: RenderError = {
  code: "render_failed",
  message: "The preview couldn't be loaded. Check your connection and try again.",
};

const UNREADABLE: RenderError = {
  code: "render_failed",
  message: "The preview couldn't be rendered. Try again.",
};

export async function renderPreview(request: RenderPreviewRequest): Promise<RenderPreviewResult> {
  // Temporary, until the message composer renders push and SMS in the browser (Phase 2b): a push
  // asks the route once per platform, and the first refusal is the answer.
  if (request.channel === "push") {
    const [ios, android] = await Promise.all([callRoute(request, "ios"), callRoute(request, "android")]);
    if (ios.kind === "error") return ios;
    if (android.kind === "error") return android;
    if (ios.kind !== "push-platform" || android.kind !== "push-platform") return { kind: "error", error: UNREADABLE };
    return { kind: "push", ios: ios.push, android: android.push };
  }
  const result = await callRoute(request);
  return result.kind === "push-platform" ? { kind: "error", error: UNREADABLE } : result;
}

type RouteResult = RenderPreviewResult | { kind: "push-platform"; push: PushRender };

async function callRoute(
  { templateId, version, channel, values, signal }: RenderPreviewRequest,
  platform?: PushPlatform,
): Promise<RouteResult> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/templates/${encodeURIComponent(templateId)}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, channel, ...(platform ? { platform } : {}), values, preview: true }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "error", error: UNREACHABLE };
  }

  try {
    if (!response.ok) return { kind: "error", error: await readError(response) };

    switch (channel) {
      case "pdf": {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { kind: "pdf", bytes, filename: filenameOf(response, templateId) };
      }
      case "web":
        return { kind: "web", html: await response.text() };
      case "email": {
        const body = (await response.json()) as EmailResponseBody;
        return { kind: "email", subject: body.subject, preheader: body.preheader, html: body.html, text: body.text };
      }
      case "push": {
        const body = (await response.json()) as PushResponseBody;
        const push: PushRender = { title: body.title, body: body.body, payloadBytes: body.payloadBytes };
        return { kind: "push-platform", push: body.subtitle === undefined ? push : { ...push, subtitle: body.subtitle } };
      }
      case "sms": {
        const body = (await response.json()) as SmsResponseBody;
        return { kind: "sms", sms: { text: body.text, encoding: body.encoding, parts: body.parts, characters: body.characters } };
      }
      default:
        return assertNever(channel, "channel");
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "error", error: response.ok ? UNREADABLE : UNREACHABLE };
  }
}

/** The route's `{ error: { code, message } }`; a reply that isn't that is a plain failure. */
async function readError(response: Response): Promise<RenderError> {
  try {
    const body = (await response.json()) as Partial<RenderErrorBody>;
    const error = body.error;
    if (error && typeof error.code === "string" && typeof error.message === "string") return error;
  } catch {
    // Not JSON: fall through.
  }
  return UNREADABLE;
}

/** `inline; filename="UC-4F7K2Q-draft.pdf"` → `UC-4F7K2Q-draft.pdf`. */
export function filenameOf(response: Response, templateId: string): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  const quoted = /filename="([^"]+)"/i.exec(header)?.[1];
  const bare = /filename=([^;\s"]+)/i.exec(header)?.[1];
  const name = (quoted ?? bare)?.trim();
  return name ? name : `${templateId}.pdf`;
}
