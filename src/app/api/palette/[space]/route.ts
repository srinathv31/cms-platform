import { getPaletteContext } from "@/server/queries/palette";

// The palette's per-space facts (can the viewer create, their recent templates). Reads the persona
// cookie, so it is request-time only; the client fetches it once per space and keeps it.
export async function GET(_request: Request, { params }: { params: Promise<{ space: string }> }) {
  const { space } = await params;
  const context = await getPaletteContext(space);
  if (!context) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(context, { headers: { "Cache-Control": "no-store" } });
}
