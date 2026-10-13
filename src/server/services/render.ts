// Stencil's own preview: a version (or the open draft) rendered for the viewer, never logged as a consumer's
// render (decision 0047). The Java API renders every channel after the port (decision 0067), so this is one
// call to its render endpoint then; the consumer render route (`/api/v1`) is the backend's own and doesn't
// go through the BFF.
//
// Its answer is the render API's own (src/domain/render/types.ts): the rendered body, or the render error with its
// code, message and details, the same as `/api/v1` gives a consumer, so the preview route answers both exactly as
// the consumer API does. That error format is the backend's public contract (decision 0056), the one exception to
// "no English but a refusal's reason" across the seam.

import type { PushPlatform } from "@/domain/messages/push";
import type {
  EmailRender,
  PushRender,
  RenderError,
  SmsRender,
} from "@/domain/render/types";
import type { Channel } from "@/domain/types";
import type { RequestContext } from "./types";

/** What the preview route asks for. */
export interface PreviewRequest {
  templateId: string;
  version: number | "draft";
  /** Which round of `version`; its head when absent. */
  round?: number;
  channel: Channel;
  /** Required with push, refused with any other channel. */
  platform?: PushPlatform;
  /** The sample values, by variable key (strings only, decision 0058). */
  values: Readonly<Record<string, unknown>>;
  encoding?: "base64";
}

/** pdf: bytes; web: the HTML document; email: subject, preheader, html and text; push and sms: their JSON. */
export type RenderBody =
  Uint8Array | string | EmailRender | PushRender | SmsRender;

/** A render's answer: the body and what the response headers say about it, or the render error. */
export type RenderResult =
  | {
      ok: true;
      channel: Channel;
      /** null for the open draft. */
      versionNumber: number | null;
      /** The Active version's number when the rendered one is Superseded. */
      newerVersion: number | null;
      /** "UC-4F7K2Q-v2.pdf", "UC-4F7K2Q-draft.html", or "UC-4F7K2Q-v3-round-2.pdf" for a labelled preview round. */
      filename: string;
      body: RenderBody;
    }
  | { ok: false; error: RenderError };

export interface RenderService {
  /**
   * Renders a version (by number, and round: its head when none is named) or the template's open draft for the
   * viewer, in any state: the version rules a consumer meets are skipped, but a Superseded version still names its
   * successor (`newerVersion`). The viewer may preview what they may see: the template's team, the stage a version
   * in review waits on, or a version they decided while they still have active access somewhere. Refuses, in the
   * render API's order and statuses: `bad_request` (the target), `template_not_found`, `version_not_found`,
   * `preview_forbidden`, the channel (`channel_not_allowed`, `channel_not_enabled`), then the engine's (values,
   * the document, a message's limits). Every request that reaches a known version is logged as a preview (the
   * context's correlation id, no consumer, never a value) and never counts in Usage.
   */
  preview(ctx: RequestContext, input: PreviewRequest): Promise<RenderResult>;
}
