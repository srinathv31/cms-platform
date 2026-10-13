import type { NextRequest } from "next/server";
import { readResponse, signedOutResponse } from "@/server/api/reads";
import { requestContextOrRefusal } from "@/server/context/request";
import { searchPalette } from "@/server/queries/palette";

// The ⌘K palette's search, asked when it opens and as the viewer types:
// GET ?q=<what was typed>&template=<the template whose pages they are on> →
// { ok: true, …PaletteResults } | { ok: false, code, reason }, with 400 (a search that doesn't parse) or 404
// (a space the viewer can't see). Request-time only: it reads the persona cookie first.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/palette/[space]">,
) {
  const context = await requestContextOrRefusal();
  if (!context.ok) return signedOutResponse();
  const { viewer } = context.context;
  const { space } = await ctx.params;
  const query = request.nextUrl.searchParams;
  return readResponse(
    await searchPalette(viewer, {
      space,
      q: query.get("q"),
      template: query.get("template"),
    }),
  );
}
