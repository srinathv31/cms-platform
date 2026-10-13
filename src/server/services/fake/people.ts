import type { Person } from "@/domain/review-types";
import type { FakeState } from "./state";

// The people a read's facts name, as `Person`s, from the fake's users: the twin of services/local/people.ts.

/** The named users, by id. Empty ids are skipped, and an id with no user is left out. */
export function peopleOf(
  state: FakeState,
  ids: Iterable<string | null | undefined>,
): Person[] {
  const named = new Set([...ids].filter((id): id is string => !!id));
  return state.users
    .filter((u) => named.has(u.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((u) => ({
      id: u.id,
      name: u.name,
      initials: u.initials,
      hue: u.avatarHue,
    }));
}
