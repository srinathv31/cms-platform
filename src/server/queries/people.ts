import "server-only";
import { cache } from "react";
import type { Person } from "@/domain/review-types";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema/ucomp";

// The people a screen names, as the read models word them: every user as a `Person` by id, and the stand-in for
// an id whose user row is gone. `getPeople` still reads the database; a read model that moves behind the seam gets
// its people with its facts (the `Person` lists the services answer) and stops calling it.

export type People = ReadonlyMap<string, Person>;

/** Every user as a `Person` (the table is small: personas plus a few seeded colleagues). */
export const getPeople = cache(async (): Promise<People> => {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      initials: users.initials,
      hue: users.avatarHue,
    })
    .from(users);
  return new Map(rows.map((r) => [r.id, r]));
});

/** The person, or a stand-in built from the id when the user row is gone. */
export function personOf(people: People, id: string): Person {
  return (
    people.get(id) ?? {
      id,
      name: id,
      initials: id.slice(0, 2).toUpperCase(),
      hue: 0,
    }
  );
}
