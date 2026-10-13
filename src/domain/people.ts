import type { Person } from "./review-types";

// The people a screen names, by id: every read behind the seam answers the `Person` list for the ids its facts
// carry, and the read model that words it looks each one up here.

export type People = ReadonlyMap<string, Person>;

/** The people a read answered, by id. */
export function peopleById(people: readonly Person[]): People {
  return new Map(people.map((p) => [p.id, p]));
}

/** The person, or a stand-in built from the id when the read named nobody for it (a user row that is gone). */
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
