import { describe, expect, it } from "vitest";
import { navKeyOf, pendingViewFor } from "./pending-routes";

const LIBRARY = "/coral-offers/library";
const TEMPLATE = "/coral-offers/templates/UC-4F7K2Q";

describe("pendingViewFor", () => {
  it("gives each sidebar page its own canvas view", () => {
    expect(pendingViewFor("/coral-offers/library", TEMPLATE)).toEqual({ scope: "canvas", page: "library" });
    expect(pendingViewFor("/coral-offers/review", LIBRARY)).toEqual({ scope: "canvas", page: "review" });
    expect(pendingViewFor("/coral-offers/usage", LIBRARY)).toEqual({ scope: "canvas", page: "usage" });
    expect(pendingViewFor("/all/audit", "/all/library")).toEqual({ scope: "canvas", page: "audit" });
  });

  it("opens a template from elsewhere as a whole workspace, on the tab it links to", () => {
    expect(pendingViewFor(TEMPLATE, LIBRARY)).toEqual({ scope: "canvas", page: "template", tab: "content" });
    expect(pendingViewFor(`${TEMPLATE}/usage`, "/coral-offers/usage")).toEqual({
      scope: "canvas",
      page: "template",
      tab: "usage",
    });
  });

  it("swaps only the tab between tabs of the template already open", () => {
    expect(pendingViewFor(`${TEMPLATE}/versions`, TEMPLATE)).toEqual({ scope: "workspace", tab: "versions" });
    expect(pendingViewFor(TEMPLATE, `${TEMPLATE}/activity`)).toEqual({ scope: "workspace", tab: "content" });
  });

  it("treats another template, or the same id in another team, as a new workspace", () => {
    expect(pendingViewFor(`${TEMPLATE}/versions`, "/coral-offers/templates/UC-ZZZZZZ")).toMatchObject({
      scope: "canvas",
      page: "template",
    });
    expect(pendingViewFor(`${TEMPLATE}/versions`, "/all/templates/UC-4F7K2Q")).toMatchObject({ scope: "canvas" });
  });

  it("opens a version under review as the review screen", () => {
    expect(pendingViewFor("/coral-offers/review/UC-4F7K2Q/3", "/coral-offers/review")).toEqual({
      scope: "canvas",
      page: "review-version",
    });
  });

  it("has no view for the settings modal, a team's home, or addresses it doesn't know", () => {
    expect(pendingViewFor("/coral-offers/settings/members", LIBRARY)).toBeNull();
    expect(pendingViewFor("/coral-offers", LIBRARY)).toBeNull();
    expect(pendingViewFor("/request-access", LIBRARY)).toBeNull();
    expect(pendingViewFor(`${TEMPLATE}/nothing`, LIBRARY)).toBeNull();
    expect(pendingViewFor("/coral-offers/library/extra", LIBRARY)).toBeNull();
    expect(pendingViewFor("/coral-offers/review/UC-4F7K2Q", LIBRARY)).toBeNull();
  });
});

describe("navKeyOf", () => {
  it("lights the sidebar item the page belongs to", () => {
    expect(navKeyOf({ scope: "canvas", page: "template", tab: "content" })).toBe("library");
    expect(navKeyOf({ scope: "canvas", page: "review-version" })).toBe("review");
    expect(navKeyOf({ scope: "canvas", page: "audit" })).toBe("audit");
  });

  it("leaves the sidebar alone for a tab of the open template", () => {
    expect(navKeyOf({ scope: "workspace", tab: "versions" })).toBeNull();
  });
});
