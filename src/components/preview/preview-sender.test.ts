import { describe, expect, it } from "vitest";
import { recipientOf, senderOf } from "./preview-sender";

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
