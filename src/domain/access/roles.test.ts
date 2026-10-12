import { describe, expect, it } from "vitest";
import { membershipStatusLabel, rolesLabel, sortRoles } from "./roles";

describe("roles", () => {
  it("sorts least to most authority, without repeats", () => {
    expect(sortRoles(["team_admin", "author", "viewer", "author"])).toEqual([
      "viewer",
      "author",
      "team_admin",
    ]);
  });

  it('labels a set of roles "Author & Approver"', () => {
    expect(rolesLabel(["approver", "author"])).toBe("Author & Approver");
  });

  it("labels each membership status in a few words", () => {
    expect(membershipStatusLabel("active", null)).toBe("Active");
    expect(membershipStatusLabel("lapsed", "recert_unconfirmed")).toBe(
      "Lapsed: not recertified",
    );
    expect(membershipStatusLabel("suspended", "inactivity")).toBe(
      "Suspended: inactive",
    );
    expect(membershipStatusLabel("suspended", "inactivity_auto")).toBe(
      "Suspended automatically: inactive",
    );
  });
});
