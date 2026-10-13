import "server-only";
import type { Named } from "@/domain/access-types";
import type { Person } from "@/domain/review-types";
import type { PlatformRole } from "@/domain/types";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema/ucomp";

// The users the settings reads name: every user once per read (the table is small: personas plus a few seeded
// colleagues), looked up by id. A read answers the `Person` list for the ids its facts name, and the BFF finds
// each by id.

export interface UserRow extends Person {
  title: string;
  email: string;
  platformRole: PlatformRole | null;
  /** The user's last sign-in. */
  lastActiveAt: Date | null;
}

export type Users = ReadonlyMap<string, UserRow>;

export async function loadUsers(): Promise<Users> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      initials: users.initials,
      hue: users.avatarHue,
      title: users.title,
      email: users.email,
      platformRole: users.platformRole,
      lastActiveAt: users.lastActiveAt,
    })
    .from(users);
  return new Map(rows.map((r) => [r.id, r]));
}

/** The person's name, or their id when the user row is gone. */
export const nameOf = (all: Users, id: string): string =>
  all.get(id)?.name ?? id;

export const named = (all: Users, id: string): Named => ({
  id,
  name: nameOf(all, id),
});

export const titleOf = (all: Users, id: string): string =>
  all.get(id)?.title ?? "";

/** Compares two user ids by the people's names. */
export const byName =
  (all: Users) =>
  (a: string, b: string): number =>
    nameOf(all, a).localeCompare(nameOf(all, b));

/** The people the facts name, by id (those whose user row is still there). */
export function peopleOf(
  all: Users,
  ids: Iterable<string | null | undefined>,
): Person[] {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
  return wanted.sort().flatMap((id) => {
    const u = all.get(id);
    return u ? [{ id, name: u.name, initials: u.initials, hue: u.hue }] : [];
  });
}
