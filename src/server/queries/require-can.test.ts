import { describe, expect, it } from "vitest";
import type { Viewer } from "@/domain/types";
import { requireCan } from "./require-can";

// The read models' one answer to "you may not read this": the domain's `can()` decides, and a refusal of
// any kind is Next's 404.

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;

const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  userId: "u1",
  name: "Uma One",
  initials: "UO",
  title: "Team Admin",
  platformRole: null,
  memberships: [
    {
      teamId: "t_coral",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      roles: ["team_admin"],
      status: "active",
    },
  ],
  ...over,
});

describe("requireCan", () => {
  it("goes on when the domain allows the action", () => {
    expect(() =>
      requireCan(viewer(), "team.manageMembers", { teamId: "t_coral" }),
    ).not.toThrow();
  });

  it("is Not found when no role grants it", () => {
    expect(() =>
      requireCan(viewer(), "team.manageMembers", { teamId: "t_deposits" }),
    ).toThrow(NOT_FOUND);
    expect(() =>
      requireCan(viewer(), "platform.manage", { teamId: null }),
    ).toThrow(NOT_FOUND);
  });

  it("is Not found when a guard blocks it, the same as a missing role", () => {
    expect(() =>
      requireCan(viewer(), "team.manageMembers", {
        teamId: "t_coral",
        subjectUserId: "u1",
      }),
    ).toThrow(NOT_FOUND);
  });

  it("is Not found when the membership isn't active", () => {
    const suspended = viewer({
      memberships: [{ ...viewer().memberships[0]!, status: "suspended" }],
    });
    expect(() =>
      requireCan(suspended, "team.manageMembers", { teamId: "t_coral" }),
    ).toThrow(NOT_FOUND);
  });
});
