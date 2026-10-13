import "server-only";
import { db } from "@/server/db/client";
import type { RenderService } from "../render";
import type { LocalDeps } from "./command";
import { runRender } from "./render/render-template";

// Stencil's preview on this app's own database: the render pipeline (./render/render-template.ts) with
// `preview: true`, for the context's viewer, logged under the context's correlation id, at the backend's clock.

export function localRender(deps: LocalDeps): RenderService {
  return {
    async preview(ctx, input) {
      return runRender(
        db,
        {
          ...input,
          preview: true,
          consumerId: null,
          correlationId: ctx.correlationId,
          viewer: ctx.viewer,
        },
        await deps.clock(),
      );
    },
  };
}
