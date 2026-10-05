import type { NextRequest } from "next/server";
import { parseAuditFilters } from "@/domain/audit";
import { getAuditExport } from "@/server/queries/audit";
import { getViewer } from "@/server/viewer";

// The Audit page's "Export N events": the same filters as the page (`?team&person&action&template&
// from&to`), every matching event (no page limit), as RFC 4180 CSV. Times are ISO instants on the
// demo clock. Request-time only: it reads the persona cookie, and checks `audit.view` itself.

export async function GET(request: NextRequest, ctx: RouteContext<"/[team]/audit/export">) {
  const { team } = await ctx.params;
  const params: Record<string, string[]> = {};
  for (const [key, value] of request.nextUrl.searchParams) (params[key] ??= []).push(value);

  const result = await getAuditExport(await getViewer(), team, parseAuditFilters(params));
  if (!result.ok) {
    return new Response(result.reason, {
      status: result.status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
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
