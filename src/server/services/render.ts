// Stencil's own preview: a version (or the open draft) rendered for the viewer, never logged as a consumer's
// render (decision 0047). The Java API renders every channel after the port (decision 0067), so this is one
// call to its render endpoint then; the consumer render route (`/api/v1`) is the backend's own and doesn't
// go through the BFF.
//
// Typed for step 2b: the preview route still calls src/server/render/render-template.ts.

import type { PushPlatform } from "@/domain/messages/push";
import type { Channel } from "@/domain/types";
import type { RequestContext, Unsettled } from "./types";

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

export interface RenderService {
  preview(
    ctx: RequestContext,
    input: PreviewRequest,
  ): Promise<Unsettled<"P5: the render result">>;
}
