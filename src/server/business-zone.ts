import "server-only";
import { cache } from "react";
import { and, count, eq, gt } from "drizzle-orm";
import { DEFAULT_BUSINESS_ZONE, isBusinessZone, type BusinessZone } from "@/domain/business-zone";
import { db, type Db } from "./db/client";
import { settings, versions } from "./db/schema/ucomp";
import type { Tx } from "./effects";

// The business time zone sunset dates are read in (decision 0017, rules in domain/business-zone.ts): the
// `settings.business_zone` row, set from Settings > Platform > Time zone. With no row, or one that isn't
// on the list, it is `DEFAULT_BUSINESS_ZONE` (America/New_York).

export const BUSINESS_ZONE_KEY = "business_zone";

type Reader = Pick<Db, "select"> | Pick<Tx, "select">;

/** The zone, read through `reader`: an action reads it in the transaction that uses it. */
export async function readBusinessZone(reader: Reader): Promise<BusinessZone> {
  const [row] = await reader
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, BUSINESS_ZONE_KEY))
    .limit(1);
  return isBusinessZone(row?.value) ? row.value : DEFAULT_BUSINESS_ZONE;
}

/**
 * The zone for a read model, once per request. Like every database read in a read model, call it after
 * a request API (`demoNow()`, `getViewer()`), so Cache Components treats it as request-time.
 */
export const getBusinessZone = cache(async (): Promise<BusinessZone> => readBusinessZone(db));

/** Superseded versions whose sunset is set and still ahead of `now`: what a change of zone leaves in place. */
export async function countPendingSunsets(reader: Reader, now: Date): Promise<number> {
  const [row] = await reader
    .select({ n: count() })
    .from(versions)
    .where(and(eq(versions.state, "superseded"), gt(versions.sunsetAt, now)));
  return row?.n ?? 0;
}
