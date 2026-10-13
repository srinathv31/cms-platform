import type { NextRequest } from "next/server";
import { parseAuditFilters } from "@/domain/audit";
import { readResponse, signedOutResponse } from "@/server/api/reads";
import { getAuditExport } from "@/server/queries/audit";
import { requestContextOrRefusal } from "@/server/context/request";

// The Audit page's "Export N events": the same filters as the page (`?team&person&action&template&
// from&to`), every matching event (no page limit), as RFC 4180 CSV. Times are ISO instants on the
// backend's clock. Request-time only: it reads the request context, and the audit service checks `audit.view`.
// A refusal (401, 403 or 404) is `{ ok: false, code, reason }` like every other refusal, never the file.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/[team]/audit/export">,
) {
  const { team } = await ctx.params;
  const params: Record<string, string[]> = {};
  for (const [key, value] of request.nextUrl.searchParams)
    (params[key] ??= []).push(value);

  const context = await requestContextOrRefusal();
  if (!context.ok) return signedOutResponse();
  const result = await getAuditExport(
    context.context,
    team,
    parseAuditFilters(params),
  );
  if (!result.ok) return readResponse(result);
  // The BOM makes Excel read the file as UTF-8 (names with accents).
  return new Response(`﻿${result.csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
      "X-Audit-Count": String(result.count),
    },
  });
}
