import { describe, expect, it } from "vitest";
import { invalidValues, missingVariables, renderFailed } from "@/domain/render/errors";
import type { Variable } from "@/domain/types";
import { authorMessage, listAnd } from "./error-copy";

const VARIABLES: Pick<Variable, "key" | "label">[] = [
  { key: "first_name", label: "First name" },
  { key: "purchase_apr", label: "Purchase APR" },
  { key: "offer_end_date", label: "Offer end date" },
  { key: "credit_limit", label: "Credit limit" },
];

describe("listAnd", () => {
  it("is an Oxford list", () => {
    expect(listAnd([])).toBe("");
    expect(listAnd(["A"])).toBe("A");
    expect(listAnd(["A", "B"])).toBe("A and B");
    expect(listAnd(["A", "B", "C"])).toBe("A, B, and C");
    expect(listAnd(["A", "B", "C", "D"])).toBe("A, B, C, and D");
  });
});

describe("authorMessage", () => {
  it("names one missing variable by its label", () => {
    const error = missingVariables({ missing: ["first_name"], invalid: [] });
    expect(error.message).toBe("Missing required variables: first_name.");
    expect(authorMessage(error, VARIABLES)).toBe("First name needs a value.");
  });

  it("names several missing variables as a list", () => {
    expect(authorMessage(missingVariables({ missing: ["first_name", "purchase_apr"], invalid: [] }), VARIABLES)).toBe(
      "First name and Purchase APR need values.",
    );
    expect(
      authorMessage(missingVariables({ missing: ["first_name", "purchase_apr", "offer_end_date"], invalid: [] }), VARIABLES),
    ).toBe("First name, Purchase APR, and Offer end date need values.");
  });

  it("says what an invalid value must be, with the label", () => {
    const error = invalidValues({ missing: [], invalid: [{ key: "purchase_apr", expected: "percent" }] });
    expect(error.message).toBe("purchase_apr must be a percentage, like 21.99.");
    expect(authorMessage(error, VARIABLES)).toBe("Purchase APR must be a percentage, like 21.99.");
  });

  it("says every invalid value, one sentence each, for each type", () => {
    const error = invalidValues({
      missing: [],
      invalid: [
        { key: "offer_end_date", expected: "date" },
        { key: "credit_limit", expected: "currency" },
      ],
    });
    expect(authorMessage(error, VARIABLES)).toBe(
      "Offer end date must be a date, like 2027-03-04. Credit limit must be an amount, like 1000.00.",
    );
  });

  it("says the missing sentence, then the invalid ones, when both are wrong", () => {
    const error = missingVariables({
      missing: ["first_name"],
      invalid: [{ key: "purchase_apr", expected: "percent" }],
    });
    expect(error.code).toBe("missing_variables");
    expect(authorMessage(error, VARIABLES)).toBe(
      "First name needs a value. Purchase APR must be a percentage, like 21.99.",
    );
  });

  it("keeps the route's sentence for a key the list doesn't have", () => {
    const missing = missingVariables({ missing: ["first_name", "ghost_key"], invalid: [] });
    expect(authorMessage(missing, VARIABLES)).toBe(missing.message);
    const invalid = invalidValues({ missing: [], invalid: [{ key: "ghost_key", expected: "text" }] });
    expect(authorMessage(invalid, VARIABLES)).toBe(invalid.message);
  });

  it("keeps the route's sentence when a label is blank", () => {
    const error = missingVariables({ missing: ["first_name"], invalid: [] });
    expect(authorMessage(error, [{ key: "first_name", label: "  " }])).toBe(error.message);
  });

  it("keeps the route's sentence for any other code, and when there are no details to build from", () => {
    const failed = renderFailed("pdf");
    expect(authorMessage(failed, VARIABLES)).toBe("The PDF couldn't be rendered. Try again.");
    const bare = { code: "missing_variables", message: "Missing required variables: first_name." } as const;
    expect(authorMessage(bare, VARIABLES)).toBe(bare.message);
    const odd = { ...bare, details: { missing: "first_name" } };
    expect(authorMessage(odd, VARIABLES)).toBe(bare.message);
    const empty = { ...bare, details: { missing: [], invalid: [] } };
    expect(authorMessage(empty, VARIABLES)).toBe(bare.message);
  });
});
