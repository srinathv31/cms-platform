import "server-only";
import type { RenderLogEntry } from "@/domain/render/types";
import type { Db } from "@/server/db/client";
import { renderLog } from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";

// One render_log row per render that reached a known template and version. The row is exactly the
// RenderLogEntry fields plus an id and a time: never variable values, the request body or output.
// Fields are copied one by one, so an entry object carrying anything extra can't leak it into a column.

export async function writeRenderLog(db: Db, entry: RenderLogEntry, at: Date): Promise<void> {
  await db.insert(renderLog).values({
    id: newId("rl"),
    at,
    templateId: entry.templateId,
    versionId: entry.versionId,
    versionNumber: entry.versionNumber,
    consumerId: entry.isPreview ? null : entry.consumerId,
    channel: entry.channel,
    isPreview: entry.isPreview,
    correlationId: entry.correlationId,
    outcome: entry.outcome,
    errorCode: entry.errorCode,
    durationMs: Math.max(0, Math.round(entry.durationMs)),
  });
}
