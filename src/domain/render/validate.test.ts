import { describe, expect, it } from "vitest";
import type { Variable, VariableType } from "../types";
import type { ValueErrorDetails } from "./types";
import { validateValues } from "./validate";

const v = (key: string, type: VariableType, required = true): Variable => ({
  key,
  label: key,
  type,
  required,
  sample: "",
});

const VARIABLES: Variable[] = [
  v("first_name", "text"),
  v("annual_fee", "currency"),
  v("purchase_apr", "percent"),
  v("offer_end_date", "date"),
  v("bonus_points", "number"),
  v("home_state", "us_state"),
  v("promo_code", "text", false),
];

const GOOD = {
  first_name: "Maya",
  annual_fee: "95",
  purchase_apr: "21.99",
  offer_end_date: "2027-03-04",
  bonus_points: 20000,
  home_state: "NJ",
};

function failure(result: ReturnType<typeof validateValues>) {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

describe("validateValues: success", () => {
  it("returns canonical strings for every present value", () => {
    expect(validateValues(VARIABLES, GOOD)).toEqual({
      ok: true,
      values: {
        first_name: "Maya",
        annual_fee: "95",
        purchase_apr: "21.99",
        offer_end_date: "2027-03-04",
        bonus_points: "20000",
        home_state: "NJ",
      },
    });
  });

  it("accepts friendly forms and canonicalizes them", () => {
    const result = validateValues(VARIABLES, {
      ...GOOD,
      annual_fee: "$1,000.50",
      purchase_apr: "21.99%",
      offer_end_date: "3/4/2027",
      bonus_points: "20,000",
      home_state: "new jersey",
    });
    expect(result).toMatchObject({
      ok: true,
      values: {
        annual_fee: "1000.50",
        purchase_apr: "21.99",
        offer_end_date: "2027-03-04",
        bonus_points: "20000",
        home_state: "NJ",
      },
    });
  });

  it("accepts finite numbers for numeric types and for text", () => {
    const result = validateValues(VARIABLES, { ...GOOD, first_name: 7, annual_fee: 95.5, purchase_apr: 0 });
    expect(result).toMatchObject({ ok: true, values: { first_name: "7", annual_fee: "95.5", purchase_apr: "0" } });
  });

  it("leaves absent optional variables out", () => {
    for (const absent of [undefined, null, "", "   "]) {
      const result = validateValues(VARIABLES, { ...GOOD, promo_code: absent });
      expect(result.ok).toBe(true);
      if (result.ok) expect("promo_code" in result.values).toBe(false);
    }
  });

  it("keeps a present optional value", () => {
    expect(validateValues(VARIABLES, { ...GOOD, promo_code: "SPRING" })).toMatchObject({
      ok: true,
      values: { promo_code: "SPRING" },
    });
  });

  it("ignores unknown keys", () => {
    const result = validateValues(VARIABLES, { ...GOOD, surprise: "x", promo: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.values).sort()).toEqual(Object.keys(GOOD).sort());
  });

  it("returns an empty set for an empty list", () => {
    expect(validateValues([], { anything: 1 })).toEqual({ ok: true, values: {} });
  });

  it("reads only own keys (a variable named like an Object method)", () => {
    const list = [v("constructor", "text")];
    expect(failure(validateValues(list, {})).code).toBe("missing_variables");
    expect(validateValues(list, { constructor: "Yes" })).toEqual({ ok: true, values: { constructor: "Yes" } });
  });
});

describe("validateValues: missing", () => {
  it("lists missing required keys in the version's order", () => {
    const error = failure(validateValues(VARIABLES, { annual_fee: "95", offer_end_date: "2027-03-04", bonus_points: 1, home_state: "NJ" }));
    expect(error).toEqual({
      code: "missing_variables",
      message: "Missing required variables: first_name, purchase_apr.",
      details: { missing: ["first_name", "purchase_apr"], invalid: [] },
    });
  });

  it("treats undefined, null, empty and blank as missing", () => {
    for (const absent of [undefined, null, "", " \t\n "]) {
      const error = failure(validateValues(VARIABLES, { ...GOOD, first_name: absent }));
      expect(error.message).toBe("Missing required variables: first_name.");
    }
  });

  it("puts invalid sentences after the missing one, under missing_variables", () => {
    const error = failure(validateValues(VARIABLES, { ...GOOD, first_name: "", purchase_apr: "high", home_state: "Narnia" }));
    expect(error.code).toBe("missing_variables");
    expect(error.message).toBe(
      "Missing required variables: first_name. purchase_apr must be a percentage, like 21.99. home_state must be a US state, like NJ.",
    );
    expect(error.details).toEqual({
      missing: ["first_name"],
      invalid: [
        { key: "purchase_apr", expected: "percent" },
        { key: "home_state", expected: "us_state" },
      ],
    } satisfies ValueErrorDetails);
  });
});

describe("validateValues: invalid", () => {
  it.each([
    ["annual_fee", "lots", "annual_fee must be an amount, like 1000 or 1000.50."],
    ["purchase_apr", "twenty", "purchase_apr must be a percentage, like 21.99."],
    ["offer_end_date", "2027-02-30", "offer_end_date must be a date, like 2027-03-04."],
    ["bonus_points", "many", "bonus_points must be a number, like 20000."],
    ["home_state", "ZZ", "home_state must be a US state, like NJ."],
  ])("%s = %j", (key, value, message) => {
    const error = failure(validateValues(VARIABLES, { ...GOOD, [key]: value }));
    expect(error.code).toBe("invalid_values");
    expect(error.message).toBe(message);
    const expected = VARIABLES.find((x) => x.key === key)!.type;
    expect(error.details).toEqual({ missing: [], invalid: [{ key, expected }] });
  });

  it("rejects values that are neither strings nor finite numbers", () => {
    for (const bad of [true, false, {}, [], ["Maya"], Number.NaN, Number.POSITIVE_INFINITY, () => "Maya"]) {
      const error = failure(validateValues(VARIABLES, { ...GOOD, first_name: bad }));
      expect(error.code).toBe("invalid_values");
      expect(error.message).toBe("first_name must be text.");
    }
  });

  it("checks optional values when they're present", () => {
    const list = [v("bonus_points", "number", false)];
    expect(failure(validateValues(list, { bonus_points: "lots" })).message).toBe("bonus_points must be a number, like 20000.");
  });

  it("lists several invalid keys in the version's order, one sentence each", () => {
    const error = failure(validateValues(VARIABLES, { ...GOOD, home_state: "ZZ", annual_fee: "x" }));
    expect(error.message).toBe("annual_fee must be an amount, like 1000 or 1000.50. home_state must be a US state, like NJ.");
  });

  it("never echoes a submitted value", () => {
    const secret = "Zq9-SECRET-value";
    const error = failure(
      validateValues(VARIABLES, {
        first_name: { secret },
        annual_fee: secret,
        purchase_apr: secret,
        offer_end_date: secret,
        bonus_points: secret,
        home_state: secret,
      }),
    );
    expect(JSON.stringify(error)).not.toContain("SECRET");
  });
});
