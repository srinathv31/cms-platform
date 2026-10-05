import type { NextRequest } from "next/server";
import { parseLimit, QUERY_MESSAGES, SEARCH_LIMIT } from "@/domain/golive/api-errors";
import type { ApiTemplateSearch } from "@/domain/golive-types";
import { correlationIdOf, errorResponse, jsonResponse, withDemoDate } from "@/server/api/http";
import { now } from "@/server/clock";
import { requireConsumer, searchActiveTemplates } from "@/server/queries/consumer-api";

// GET /api/v1/templates?q=&limit=: search the templates a consumer can link (Active ones only).
// Contract: ApiTemplateSearch in src/contracts/api-v1.ts.
//
// The headers are read before anything touches the database: that makes the handler request-time
// under Cache Components (a database read first would try to prerender it).

export const GET = withDemoDate(async function get(request: NextRequest) {
  const consumerHeader = request.headers.get("x-consumer-id");
  const correlationId = correlationIdOf(request);
  const params = request.nextUrl.searchParams;

  const consumer = await requireConsumer(consumerHeader);
  if (!consumer.ok) return errorResponse(consumer.error, correlationId);

  const limit = parseLimit(params.get("limit"), SEARCH_LIMIT, QUERY_MESSAGES.searchLimit);
  if (!limit.ok) return errorResponse(limit.error, correlationId);

  const query = (params.get("q") ?? "").trim();
  const at = await now();
  const body: ApiTemplateSearch = {
    query,
    asOf: at.toISOString(),
    results: await searchActiveTemplates(query, limit.value),
  };
  return jsonResponse(body, correlationId);
});
