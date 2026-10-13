import "server-only";
import { inArray } from "drizzle-orm";
import type { Person } from "@/domain/review-types";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema/ucomp";

// The people a read's facts name, as `Person`s (the `people` beside the facts): the BFF shows a name and an avatar
// for each id. An id whose user row is gone is left out; the BFF shows a stand-in for it (`personOf`).

/** The named users, by id. Empty ids are skipped. */
export async function loadPeople(
  ids: Iterable<string | null | undefined>,
): Promise<Person[]> {
  const named = [...new Set([...ids].filter((id): id is string => !!id))];
  if (named.length === 0) return [];
  return db
    .select({
      id: users.id,
      name: users.name,
      initials: users.initials,
      hue: users.avatarHue,
    })
    .from(users)
    .where(inArray(users.id, named))
    .orderBy(users.id);
}
