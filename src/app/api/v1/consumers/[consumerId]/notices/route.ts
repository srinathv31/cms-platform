import type { NextRequest } from "next/server";
import {
  consumerMismatch,
  consumerNotFound,
  NOTICE_LIMIT,
  parseInstant,
  parseLimit,
  QUERY_MESSAGES,
} from "@/domain/golive/api-errors";
import type { ApiNoticeList } from "@/domain/golive-types";
import { correlationIdOf, errorResponse, jsonResponse, withDemoDate } from "@/server/api/http";
import { now } from "@/server/clock";
import { findConsumer, listNotices, requireConsumer } from "@/server/queries/consumer-api";

// GET /api/v1/consumers/{consumerId}/notices?since=&templateId=&limit=: UCOMP's outbox for one
// consumer, newest first. Contract: ApiNoticeList in src/contracts/api-v1.ts.
//
// X-Consumer-Id must be registered and must be the consumer in the path. The headers are read before
// anything touches the database (request-time under Cache Components).

export const GET = withDemoDate(async function get(request: NextRequest, { params }: { params: Promise<{ consumerId: string }> }) {
  const consumerHeader = request.headers.get("x-consumer-id");
  const correlationId = correlationIdOf(request);
  const search = request.nextUrl.searchParams;
  const { consumerId } = await params;

  const caller = await requireConsumer(consumerHeader);
  if (!caller.ok) return errorResponse(caller.error, correlationId);
  if (!(await findConsumer(consumerId))) return errorResponse(consumerNotFound(consumerId), correlationId);
  if (caller.consumer.id !== consumerId) return errorResponse(consumerMismatch(consumerId), correlationId);

  const since = parseInstant(search.get("since"), QUERY_MESSAGES.sinceDate);
  if (!since.ok) return errorResponse(since.error, correlationId);
  const limit = parseLimit(search.get("limit"), NOTICE_LIMIT, QUERY_MESSAGES.noticeLimit);
  if (!limit.ok) return errorResponse(limit.error, correlationId);
  const templateId = search.get("templateId")?.trim() || undefined;

  const at = await now();
  const body: ApiNoticeList = {
    consumerId,
    asOf: at.toISOString(),
    notices: await listNotices(consumerId, { since: since.value, templateId, limit: limit.value }),
  };
  return jsonResponse(body, correlationId);
});
