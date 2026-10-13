import type { NextRequest } from "next/server";
import {
  BAD_REQUEST_MESSAGES,
  badRequest,
  consumerRequired,
  renderFailed,
  renderTarget,
} from "@/domain/render";
import { correlationIdOf, errorResponse } from "@/server/api/http";
import { withDemoDate } from "@/server/services/local/consumer-api";
import {
  readRenderRequest,
  renderSuccessResponse,
} from "@/server/api/render-http";
import { renderTemplate } from "@/server/render/render-template";

// POST /api/v1/templates/{templateId}/render: the render API, shaped like the future Java service.
// The contract (body, headers, every error and its wording) is src/domain/render/types.ts.
//
// Consumers only. A consumer names itself with X-Consumer-Id and gets a released version by number
// (Active, or Superseded until its sunset); a draft or a version in review is never served here. The
// route reads no session and no cookie: Stencil's own previews are POST /api/templates/{id}/preview
// (decision 0047). A field that isn't in the contract (`preview`, `round`) is ignored.
//
// A POST handler always runs at request time, Cache Components or not (only GET handlers can be
// prerendered or cached), so reading the body and the headers here is fine. The body is read within
// MAX_BODY_BYTES by `readRenderRequest`: the route is anonymous, so nothing past the limit is buffered.

export const POST = withDemoDate(async function post(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params;
  const correlationId = correlationIdOf(request);

  const read = await readRenderRequest(request);
  if (!read.ok) return errorResponse(read.error, correlationId);
  const { version, channel, platform, values, encoding } = read.body;

  if (version === "draft")
    return errorResponse(
      badRequest(BAD_REQUEST_MESSAGES.version),
      correlationId,
    );
  // A push asks for its platform; nothing else takes one, and push and SMS take no encoding.
  const target = renderTarget(channel, platform, encoding);
  if (!target.ok) return errorResponse(target.error, correlationId);
  const consumerId = request.headers.get("x-consumer-id")?.trim() || null;
  if (!consumerId) return errorResponse(consumerRequired(), correlationId);

  try {
    const result = await renderTemplate({
      templateId,
      version,
      channel,
      platform,
      values,
      encoding,
      preview: false,
      consumerId,
      correlationId,
      viewer: null,
    });
    if (!result.ok) return errorResponse(result.error, correlationId);
    return renderSuccessResponse(result, {
      templateId,
      preview: false,
      encoding,
      correlationId,
    });
  } catch (error) {
    // The database or the log write failed: still a JSON error with the contract's shape.
    console.error(
      `[render] ${templateId} ${channel} failed outside the pipeline, correlation ${correlationId}`,
      error,
    );
    return errorResponse(renderFailed(channel), correlationId);
  }
});
