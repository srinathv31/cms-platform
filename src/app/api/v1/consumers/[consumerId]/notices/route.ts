import type { NextRequest } from "next/server";
import { consumerMismatch, consumerNotFound, NOTICE_LIMIT, parseLimit, QUERY_MESSAGES } from "@/domain/golive/api-errors";
import { readNoticeCursor } from "@/domain/golive/cursor";
import type { ApiNoticeList } from "@/domain/golive-types";
import { correlationIdOf, errorResponse, jsonResponse, withDemoDate } from "@/server/api/http";
import { now } from "@/server/clock";
import { findConsumer, listNotices, noticeEpoch, requireConsumer } from "@/server/queries/consumer-api";

// GET /api/v1/consumers/{consumerId}/notices?after=&templateId=&limit=: UCOMP's outbox for one
// consumer, oldest first, paged with an opaque cursor. Contract: ApiNoticeList in src/contracts/api-v1.ts.
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

  const templateId = search.get("templateId")?.trim() || undefined;
  const epoch = await noticeEpoch();
  const after = readNoticeCursor(search.get("after"), { consumerId, templateId: templateId ?? null, epoch });
  if (!after.ok) return errorResponse(after.error, correlationId);
  const limit = parseLimit(search.get("limit"), NOTICE_LIMIT, QUERY_MESSAGES.noticeLimit);
  if (!limit.ok) return errorResponse(limit.error, correlationId);

  const at = await now();
  const page = await listNotices(consumerId, { after: after.value, templateId, limit: limit.value, epoch });
  const body: ApiNoticeList = { consumerId, asOf: at.toISOString(), ...page };
  return jsonResponse(body, correlationId);
});
