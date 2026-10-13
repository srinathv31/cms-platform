import { beforeAll, describe, expect, it, vi } from "vitest";
import { ALL_SPACE, canSeeSpace } from "@/domain/permissions";
import type { Db } from "@/server/db/client";
import { teams, users } from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { requireSpace } from "./spaces";

// The `[team]` guard against a temporary database filled by the real seed: Maya is an Author on Coral
// Offers only, Riley the Platform Admin, Morgan on no team.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-spaces-queries-");
});
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;

let db: Db;

seededDatabasePerTest({ base: new Date("2026-10-04T12:00:00.000Z") });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

async function as(userId: string) {
  const viewer = await loadPersona(db, userId);
  vi.mocked(getViewer).mockResolvedValue(viewer);
  return viewer;
}

describe("requireSpace", () => {
  it("lets a viewer into a space they can see", async () => {
    await as("maya");
    await expect(requireSpace("coral-offers")).resolves.toMatchObject({
      slug: "coral-offers",
      isAll: false,
      teamId: "coral-offers",
      name: "Coral Offers",
    });
    await as("riley");
    await expect(requireSpace(ALL_SPACE)).resolves.toMatchObject({
      slug: ALL_SPACE,
      isAll: true,
      teamId: null,
    });
  });

  it("is Not found for a team that doesn't exist and, the same way, for one the viewer can't see", async () => {
    await as("maya");
    await expect(requireSpace("nope")).rejects.toThrow(NOT_FOUND);
    await expect(requireSpace("deposits")).rejects.toThrow(NOT_FOUND);
    await expect(requireSpace(ALL_SPACE)).rejects.toThrow(NOT_FOUND);
    await as("morgan");
    await expect(requireSpace("coral-offers")).rejects.toThrow(NOT_FOUND);
  });

  // The persona switch stays on the page when `canSeeSpace` says the new persona sees it, so the two
  // must agree, or the switch would land on a 404.
  it("lets in exactly the people `canSeeSpace` says see the space", async () => {
    const slugs = [
      ALL_SPACE,
      ...(await db.select({ slug: teams.slug }).from(teams)).map((t) => t.slug),
    ];
    for (const { id } of await db.select({ id: users.id }).from(users)) {
      const viewer = await as(id);
      for (const slug of slugs) {
        const got = await requireSpace(slug).then(
          () => true,
          (error: unknown) => {
            if (!NOT_FOUND.test(String((error as Error).message))) throw error;
            return false;
          },
        );
        expect(got, `${id} in ${slug}`).toBe(canSeeSpace(viewer, slug));
      }
    }
  });
});
