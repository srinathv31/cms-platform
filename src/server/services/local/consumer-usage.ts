import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { DAY_MS } from "@/domain/dates";
import type { ConsumerUsage } from "@/domain/review-types";
import type { Db } from "@/server/db/client";
import { consumers, renderLog } from "@/server/db/schema/ucomp";

// Who renders a template's versions, from the render log on this app's own database: the Versions tab and the
// review screen show it beside each version.

type Reader = Pick<Db, "select">;

/**
 * Per consumer and version: the last render and the renders in the last 30 days. Registered consumers
 * only, previews excluded, failed renders included (they still show the consumer is on that version).
 * Newest version first, then by consumer name.
 */
export async function loadConsumerUsage(
  reader: Reader,
  templateId: string,
  nowDate: Date,
): Promise<ConsumerUsage[]> {
  const since = nowDate.getTime() - 30 * DAY_MS;
  const rows = await reader
    .select({
      consumerId: consumers.id,
      consumerName: consumers.name,
      versionNumber: renderLog.versionNumber,
      lastRenderAt: sql<number>`max(${renderLog.at})`,
      renders30d: sql<number>`sum(case when ${renderLog.at} >= ${since} then 1 else 0 end)`,
    })
    .from(renderLog)
    .innerJoin(consumers, eq(consumers.id, renderLog.consumerId))
    .where(
      and(
        eq(renderLog.templateId, templateId),
        eq(renderLog.isPreview, false),
        isNotNull(renderLog.versionNumber),
      ),
    )
    .groupBy(consumers.id, renderLog.versionNumber);

  return rows
    .map((r) => ({
      consumerId: r.consumerId,
      consumerName: r.consumerName,
      versionNumber: r.versionNumber!,
      lastRenderAt: new Date(Number(r.lastRenderAt)).toISOString(),
      renders30d: Number(r.renders30d ?? 0),
    }))
    .sort(
      (a, b) =>
        b.versionNumber - a.versionNumber ||
        a.consumerName.localeCompare(b.consumerName),
    );
}
