import "server-only";
import { z } from "zod";
import type { PaletteResults } from "@/domain/import-types";
import { PALETTE_QUERY_MAX } from "@/domain/palette";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal, type ReadResult } from "@/server/api/reads";
import type { RequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type { PaletteFacts } from "@/server/services/templates";

// The ⌘K palette's search, served by GET /api/palette/[space]?q=&template= when the palette opens and
// as the viewer types. The templates are searched by the backend (`services().templates.palette`: who may see
// what, Recent, the ranking and the caps), not in the browser: no page carries the catalog. A read: it writes
// nothing, and answers a `ReadResult` (src/server/api/reads.ts).

const Input = z.object({
  space: z.string().min(1).max(64),
  q: z.string().max(PALETTE_QUERY_MAX).nullable(),
  template: z.string().min(1).max(64).nullable(),
});

/**
 * What the palette lists for one space and one search (`q`), for this viewer. `template` is the
 * template whose pages they are on: Recent leaves it out, and `current` says whether it is theirs to
 * see here (the palette offers its tabs only then).
 */
export async function searchPalette(
  ctx: RequestContext,
  input: { space: string; q: string | null; template: string | null },
): Promise<ReadResult<PaletteResults>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return refusal(400, REQUEST_REFUSALS.invalidSearch);
  const { space, q, template } = parsed.data;
  // The URL names the space by its slug: resolved to its team once, here (decision 0053).
  const found = await services().identity.space(ctx, { slug: space });
  if (!found.ok) return refusal(404, REQUEST_REFUSALS.spaceUnavailable);

  const palette = await services().templates.palette(ctx, {
    teamId: found.space.teamId,
    q,
    templateId: template,
  });
  if (!palette.ok) return palette;
  return paletteResults(palette, { viewerId: ctx.viewer.userId, space });
}

/** The palette's answer on the wire, from the service's facts. */
export function paletteResults(
  palette: PaletteFacts,
  asked: { viewerId: string; space: string },
): { ok: true } & PaletteResults {
  return {
    ok: true,
    viewerId: asked.viewerId,
    space: asked.space,
    query: palette.query,
    canCreate: palette.can.create.ok,
    current: palette.current,
    recent: palette.recent,
    templates: palette.templates,
  };
}
