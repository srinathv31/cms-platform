import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  badRequest,
  renderFailed,
  renderTarget,
  signedOut,
} from "@/domain/render";
import { correlationIdOf, errorResponse } from "@/server/api/http";
import {
  ROUND_MESSAGE,
  readRenderRequest,
  renderSuccessResponse,
} from "@/server/api/render-http";
import { findRequestContext } from "@/server/context/request";
import { services } from "@/server/services";

// Stencil's own preview of a version or the open draft: POST { version: "draft" | n, round?, channel,
// platform?, values, encoding? } → the render engine's output for the signed-in person, with the same
// bodies, headers and `{ error: { code, message, details? } }` errors the render API gives a consumer
// (src/domain/render/types.ts), plus `X-Stencil-Preview: true`. The consumer API is POST
// /api/v1/templates/{id}/render and serves consumers only (decision 0047).
//
// The person comes from the session (the request context), never from a header the caller names. The backend
// renders (`render.preview`, src/server/services/render.ts): it decides who may preview what, renders any state,
// and logs every request that reaches a known version as a preview under this request's correlation id. The route
// reads and checks the body, and answers the result as HTTP.
//
// A POST handler always runs at request time, Cache Components or not. The person is resolved first, then the body
// is read within MAX_BODY_BYTES (render-http.ts). Nobody signed in previews nothing: 401 `signed_out`, as every
// other route answers it (in the render API's error shape), before a byte of the body is read, and nothing is
// rendered or logged.

/** A preview's round: a whole number from 1. */
const Round = z.int().min(1);

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/templates/[templateId]/preview">,
) {
  const { templateId } = await ctx.params;
  const correlationId = correlationIdOf(request);
  // The person first, before a byte of the body is read (as drafts and imports do).
  const context = await findRequestContext();
  if (!context) return errorResponse(signedOut(), correlationId);

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
    const result = await services().render.preview(
      // The backend logs the render under the correlation id this response carries.
      { ...context, correlationId },
      {
        templateId,
        version,
        ...(round !== undefined ? { round } : {}),
        channel,
        ...(platform !== undefined ? { platform } : {}),
        values,
        ...(encoding !== undefined ? { encoding } : {}),
      },
    );
    if (!result.ok) return errorResponse(result.error, correlationId);
    return renderSuccessResponse(result, {
      templateId,
      preview: true,
      encoding,
      correlationId,
    });
  } catch (error) {
    // The backend failed outside the pipeline (the database, the log write): still a JSON error with the render
    // engine's shape.
    console.error(
      `[preview] ${templateId} ${channel} failed outside the pipeline, correlation ${correlationId}`,
      error,
    );
    return errorResponse(renderFailed(channel), correlationId);
  }
}
