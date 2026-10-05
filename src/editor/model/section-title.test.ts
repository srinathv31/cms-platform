import { describe, expect, it } from "vitest";
import { matchesSectionTitle, sectionTitleKey } from "./section-title";

describe("sectionTitleKey", () => {
  it.each([
    ["Offer details", "offer details"],
    ["  2. Rates  and Fees: ", "rates and fees"],
    ["A) Legal notices", "legal notices"],
    ["iv. Legal notices", "legal notices"],
    ["LEGAL NOTICES:", "legal notices"],
    ["A fee schedule", "a fee schedule"],
    ["", ""],
  ])("%j → %j", (text, key) => {
    expect(sectionTitleKey(text)).toBe(key);
  });
});

describe("matchesSectionTitle", () => {
  it("matches the same title written differently", () => {
    expect(matchesSectionTitle("1. Offer Details:", "Offer details")).toBe(true);
    expect(matchesSectionTitle("Offer", "Offer details")).toBe(false);
    expect(matchesSectionTitle("   ", "")).toBe(false);
  });
});
