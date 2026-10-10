import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { RELEASED_STATES } from "@/domain/rounds";
import type { Db } from "@/server/db/client";
import { versions } from "@/server/db/schema/ucomp";

type Reader = Pick<Db, "select">;

/**
 * A version row by number and round. With a round it is exactly that row. Without one it is the
 * number's head, as `headOf` in domain/rounds.ts picks it: its released row (Active, Superseded or
 * Revoked; there is at most one), else its latest round. The review screen, the review actions and the
 * render pipeline look a version up through it, so a bare `/review/{id}/{n}` and a consumer's pinned
 * number mean the same row.
 */
export async function findRound(
  reader: Reader,
  templateId: string,
  number: number,
  round?: number | null,
): Promise<typeof versions.$inferSelect | undefined> {
  const [row] = await reader
    .select()
    .from(versions)
    .where(
      and(
        eq(versions.templateId, templateId),
        eq(versions.number, number),
        round == null ? undefined : eq(versions.round, round),
      ),
    )
    .orderBy(desc(inArray(versions.state, [...RELEASED_STATES])), desc(versions.round))
    .limit(1);
  return row;
}
