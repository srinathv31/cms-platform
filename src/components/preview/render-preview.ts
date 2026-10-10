// The preview's one call to the render API: POST /api/v1/templates/{id}/render with `preview: true`,
// the same route (and so the same output) the review screen and the consumer simulator get. The
// contract is src/domain/render/types.ts.
//
// Only the document channels (PDF, Web, Email) come from the route. Push and SMS are plain text, so
// the preview renders them in the browser with the route's own function (message-preview.ts,
// decision 0036): no request.
//
// `renderPreview` resolves with something the UI can show in every case: the output, or `{ error }`
// carrying the route's own message. It rejects only when `signal` aborts (a newer request replaced
// this one), with the AbortError fetch throws, so a caller can drop the result without a branch.

import { assertNever } from "@/domain/assert-never";
import type { EmailResponseBody, RenderError, RenderErrorBody } from "@/domain/render/types";
import type { DocumentChannel, VariableValues } from "@/domain/types";

export interface RenderPreviewRequest {
  templateId: string;
  /** The open draft, or a version number. */
  version: "draft" | number;
  /**
   * Which round of `version` (a preview only, which this always is): without it the route renders the
   * number's head, its released row or else its latest round.
   */
  round?: number | null;
  channel: DocumentChannel;
  values: VariableValues;
  signal?: AbortSignal;
}

export type PreviewOutput =
  /** The exact bytes, and the file name the route gave them (Content-Disposition), for Download PDF. */
  | { kind: "pdf"; bytes: Uint8Array; filename: string }
  | { kind: "web"; html: string }
  | { kind: "email"; subject: string; preheader: string; html: string; text: string };

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

export async function renderPreview({
  templateId,
  version,
  round = null,
  channel,
  values,
  signal,
}: RenderPreviewRequest): Promise<RenderPreviewResult> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/templates/${encodeURIComponent(templateId)}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, ...(version !== "draft" && round !== null ? { round } : {}), channel, values, preview: true }),
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
