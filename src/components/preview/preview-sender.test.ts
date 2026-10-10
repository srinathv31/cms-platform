import { describe, expect, it } from "vitest";
import { phoneSenders, recipientOf, senderOf } from "./preview-sender";

describe("phoneSenders", () => {
  it("sends as the team's app, from its short code", () => {
    expect(phoneSenders({ appName: "Coral", smsSender: "26725" }, "Coral Offers")).toEqual({ appName: "Coral", smsSender: "26725" });
  });

  it("names the app after the team when it has no app name, so the app is never blank", () => {
    expect(phoneSenders({ appName: null, smsSender: null }, "Home Loans").appName).toBe("Home Loans");
    expect(phoneSenders({ appName: "  ", smsSender: null }, " Home Loans ").appName).toBe("Home Loans");
  });

  it("has no SMS sender without a short code: never the team's name, which a US text can't show there", () => {
    expect(phoneSenders({ appName: "Coral", smsSender: null }, "Coral Offers").smsSender).toBe("");
    expect(phoneSenders({ appName: "Coral", smsSender: "   " }, "Coral Offers").smsSender).toBe("");
  });
});

describe("senderOf", () => {
  it("sends from the team, at a no-reply address made from its name", () => {
    expect(senderOf("Coral Offers")).toEqual({ name: "Coral Offers", address: "no-reply@coraloffers.example" });
    expect(senderOf("Card Statements").address).toBe("no-reply@cardstatements.example");
    expect(senderOf("Deposits & Savings").address).toBe("no-reply@depositssavings.example");
  });

  it("still has an address for a name with nothing in it to use: Stencil's, on a reserved example domain", () => {
    expect(senderOf("—")).toEqual({ name: "—", address: "no-reply@stencil.example" });
    expect(senderOf("").address).toBe("no-reply@stencil.example");
    expect(senderOf("日本").address).toBe("no-reply@stencil.example");
  });
});

describe("recipientOf", () => {
  it("is the first and last name together", () => {
    expect(recipientOf({ first_name: "Maya", last_name: "Chen", purchase_apr: "21.99" })).toBe("Maya Chen");
  });

  it("is whichever of the two the set has", () => {
    expect(recipientOf({ first_name: "Maya" })).toBe("Maya");
    expect(recipientOf({ last_name: "Chen" })).toBe("Chen");
  });

  it("skips an emptied name", () => {
    expect(recipientOf({ first_name: "  ", last_name: "Chen" })).toBe("Chen");
  });

  it("falls back to a full-name value", () => {
    expect(recipientOf({ customer_name: "Maya Chen" })).toBe("Maya Chen");
    expect(recipientOf({ name: "Maya Chen" })).toBe("Maya Chen");
  });

  it("is null when the set has no name in it", () => {
    expect(recipientOf({ purchase_apr: "21.99", product_name: "Rewards" })).toBeNull();
    expect(recipientOf({})).toBeNull();
  });
});
