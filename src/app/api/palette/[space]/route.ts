import type { NextRequest } from "next/server";
import { readResponse } from "@/server/api/reads";
import { searchPalette } from "@/server/queries/palette";
import { getViewer } from "@/server/viewer";

// The ⌘K palette's search, asked when it opens and as the viewer types:
// GET ?q=<what was typed>&template=<the template whose pages they are on> →
// { ok: true, …PaletteResults } | { ok: false, reason }, with 400 (a search that doesn't parse) or 404
// (a space the viewer can't see). Request-time only: it reads the persona cookie first.

export async function GET(request: NextRequest, ctx: RouteContext<"/api/palette/[space]">) {
  const viewer = await getViewer();
  const { space } = await ctx.params;
  const query = request.nextUrl.searchParams;
  return readResponse(await searchPalette(viewer, { space, q: query.get("q"), template: query.get("template") }));
}
