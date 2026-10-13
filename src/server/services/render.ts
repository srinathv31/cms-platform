// Stencil's own preview: a version (or the open draft) rendered for the viewer, never logged as a consumer's
// render (decision 0047). The Java API renders every channel after the port (decision 0067), so this is one
// call to its render endpoint then; the consumer render route (`/api/v1`) is the backend's own and doesn't
// go through the BFF.
//
// Typed for step 2b: the preview route still calls src/server/render/render-template.ts.

import type {
  RenderInput,
  RenderResult,
} from "@/server/render/render-template";
import type { RequestContext } from "./types";

/** What the preview route asks for: the render input without who is asking. */
export type PreviewRequest = Omit<
  RenderInput,
  "preview" | "consumerId" | "viewer" | "correlationId"
>;

export interface RenderService {
  preview(ctx: RequestContext, input: PreviewRequest): Promise<RenderResult>;
}
