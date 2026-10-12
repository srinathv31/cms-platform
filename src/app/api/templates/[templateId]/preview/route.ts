import type { NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, renderFailed, renderTarget } from "@/domain/render";
import { correlationIdOf, errorResponse } from "@/server/api/http";
import {
  ROUND_MESSAGE,
  readRenderRequest,
  renderSuccessResponse,
} from "@/server/api/render-http";
import { renderTemplate } from "@/server/render/render-template";
import { getViewer } from "@/server/viewer";

// Stencil's own preview of a version or the open draft: POST { version: "draft" | n, round?, channel,
// platform?, values, encoding? } → the render engine's output for the signed-in person, with the same
// bodies, headers and `{ error: { code, message, details? } }` errors the render API gives a consumer
// (src/domain/render/types.ts), plus `X-Stencil-Preview: true`. The consumer API is POST
// /api/v1/templates/{id}/render and serves consumers only (decision 0047).
//
// The person comes from the session (`getViewer()`), never from a header the caller names, and may
// preview what `previewAllowed` says (render-template.ts): the template's team, the stage a version in
// review waits on, or a decider with active access. Any state previews: a draft, a version in review,
// a revoked or a Superseded one. Every request that reaches a known version is logged as a preview
// (`is_preview`, no consumer) and never counts in Usage.
//
// A POST handler always runs at request time, Cache Components or not. The body is read within
// MAX_BODY_BYTES (render-http.ts).

/** A preview's round: a whole number from 1. */
const Round = z.int().min(1);

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/templates/[templateId]/preview">,
) {
  const { templateId } = await ctx.params;
  const correlationId = correlationIdOf(request);

  const read = await readRenderRequest(request);
  if (!read.ok) return errorResponse(read.error, correlationId);
  const {
    version,
    round: askedRound,
    channel,
    platform,
    values,
    encoding,
  } = read.body;

  let round: number | undefined;
  if (askedRound !== undefined) {
    const checked = Round.safeParse(askedRound);
    if (!checked.success)
      return errorResponse(badRequest(ROUND_MESSAGE), correlationId);
    round = checked.data;
  }
  // A push asks for its platform; nothing else takes one, and push and SMS take no encoding.
  const target = renderTarget(channel, platform, encoding);
  if (!target.ok) return errorResponse(target.error, correlationId);

  try {
    const result = await renderTemplate({
      templateId,
      version,
      ...(round !== undefined ? { round } : {}),
      channel,
      platform,
      values,
      encoding,
      preview: true,
      consumerId: null,
      correlationId,
      viewer: await getViewer(),
    });
    if (!result.ok) return errorResponse(result.error, correlationId);
    return renderSuccessResponse(result, {
      templateId,
      preview: true,
      encoding,
      correlationId,
    });
  } catch (error) {
    // The database or the log write failed: still a JSON error with the render engine's shape.
    console.error(
      `[preview] ${templateId} ${channel} failed outside the pipeline, correlation ${correlationId}`,
      error,
    );
    return errorResponse(renderFailed(channel), correlationId);
  }
}
