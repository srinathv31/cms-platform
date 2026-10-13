import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  DEFAULT_BUSINESS_ZONE,
  isBusinessZone,
  type BusinessZone,
} from "@/domain/business-zone";
import { sunsetPassed } from "@/domain/lifecycle/sunset";
import type { Db } from "@/server/db/client";
import { settings, versions } from "@/server/db/schema/ucomp";
import type { Tx } from "@/server/services/local/transaction";

// The business time zone sunset dates are read in (decision 0017, rules in domain/business-zone.ts): the
// `settings.business_zone` row, set from Settings > Platform > Time zone. With no row, or one that isn't
// on the list, it is `DEFAULT_BUSINESS_ZONE` (America/New_York).

export const BUSINESS_ZONE_KEY = "business_zone";

type Reader = Pick<Db, "select"> | Pick<Tx, "select">;

/** The zone, read through `reader`: a command reads it in the transaction that uses it, a read through `db`. */
export async function readBusinessZone(reader: Reader): Promise<BusinessZone> {
  const [row] = await reader
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, BUSINESS_ZONE_KEY))
    .limit(1);
  return isBusinessZone(row?.value) ? row.value : DEFAULT_BUSINESS_ZONE;
}

/** Superseded versions whose sunset is set and hasn't passed (`sunsetPassed`): what a change of zone leaves in place. */
export async function countPendingSunsets(
  reader: Reader,
  now: Date,
): Promise<number> {
  const rows = await reader
    .select({ sunsetAt: versions.sunsetAt })
    .from(versions)
    .where(and(eq(versions.state, "superseded"), isNotNull(versions.sunsetAt)));
  return rows.filter((v) => !sunsetPassed(v, now)).length;
}
