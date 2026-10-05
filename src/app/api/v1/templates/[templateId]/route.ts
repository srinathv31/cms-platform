import type { NextRequest } from "next/server";
import { parseVersionNumber, QUERY_MESSAGES } from "@/domain/golive/api-errors";
import { correlationIdOf, errorResponse, jsonResponse } from "@/server/api/http";
import { now } from "@/server/clock";
import { getTemplateDetail, requireConsumer } from "@/server/queries/consumer-api";

// GET /api/v1/templates/{templateId}?version=&since=: a template's released versions and one
// version's contract (+ the changes since an older one). Contract: ApiTemplateDetail in
// src/contracts/api-v1.ts.
//
// The headers are read before anything touches the database (request-time under Cache Components).

export async function GET(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const consumerHeader = request.headers.get("x-consumer-id");
  const correlationId = correlationIdOf(request);
  const search = request.nextUrl.searchParams;
  const { templateId } = await params;

  const consumer = await requireConsumer(consumerHeader);
  if (!consumer.ok) return errorResponse(consumer.error, correlationId);

  const version = parseVersionNumber(search.get("version"), QUERY_MESSAGES.version);
  if (!version.ok) return errorResponse(version.error, correlationId);
  const since = parseVersionNumber(search.get("since"), QUERY_MESSAGES.since);
  if (!since.ok) return errorResponse(since.error, correlationId);

  const result = await getTemplateDetail(templateId, { version: version.value, since: since.value }, await now());
  if (!result.ok) return errorResponse(result.error, correlationId);
  return jsonResponse(result.detail, correlationId);
}
