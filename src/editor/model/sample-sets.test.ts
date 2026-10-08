import { describe, expect, it } from "vitest";
import { DEFAULT_SAMPLE_SETS, defaultSampleSets, sampleSetValues } from "./sample-sets";
import type { SampleSet, Variable, VariableType } from "./types";
import { US_STATES, formatValue, validateValue } from "./variables";

const TODAY = "2026-10-04";

const v = (key: string, type: VariableType, sample = "", label = key, required = true): Variable => ({
  key,
  label,
  type,
  required,
  sample,
});

const VARIABLES: Variable[] = [
  v("first_name", "text", "Maya", "First name"),
  v("last_name", "text", "", "Last name"),
  v("purchase_apr", "percent", "21.99", "Purchase APR"),
  v("home_state", "us_state", "NJ", "Home state"),
  v("offer_end_date", "date", "2026-11-18", "Offer end date", false),
  v("annual_fee", "currency", "95", "Annual fee"),
  v("bonus_points", "number", "", "Bonus points"),
  v("promo_code", "text", "", "Promo code", false),
];

const byId = (sets: SampleSet[], id: string) => sets.find((s) => s.id === id)!.values;

describe("DEFAULT_SAMPLE_SETS", () => {
  it("names the three sets like the seed does", () => {
    expect(DEFAULT_SAMPLE_SETS).toEqual([
      { id: "typical", name: "Typical customer" },
      { id: "long", name: "Long name and maximum values" },
      { id: "minimum", name: "Minimum values" },
    ]);
  });
});

describe("defaultSampleSets", () => {
  const sets = defaultSampleSets(VARIABLES, TODAY);

  it("makes the three sets in order, each with a value for every variable", () => {
    expect(sets.map((s) => [s.id, s.name])).toEqual(DEFAULT_SAMPLE_SETS.map((s) => [s.id, s.name]));
    for (const set of sets) expect(Object.keys(set.values)).toEqual(VARIABLES.map((x) => x.key));
  });

  it("gives canonical values that are valid for their type", () => {
    for (const set of sets) {
      for (const variable of VARIABLES) {
        const value = set.values[variable.key]!;
        const checked = validateValue(variable.type, value);
        expect(checked, `${set.id}.${variable.key}`).toEqual({ ok: true, value });
      }
    }
  });

  it("is deterministic for a given day", () => {
    expect(defaultSampleSets(VARIABLES, TODAY)).toEqual(sets);
  });

  it("makes empty sets for an empty list", () => {
    expect(defaultSampleSets([], TODAY).map((s) => s.values)).toEqual([{}, {}, {}]);
  });

  describe("typical", () => {
    const typical = byId(sets, "typical");

    it("uses each variable's sample when it's valid", () => {
      expect(typical).toMatchObject({
        first_name: "Maya",
        purchase_apr: "21.99",
        home_state: "NJ",
        offer_end_date: "2026-11-18",
        annual_fee: "95",
      });
    });

    it("canonicalizes a friendly sample", () => {
      const [set] = defaultSampleSets([v("apr", "percent", "21.99%"), v("st", "us_state", "new jersey")], TODAY);
      expect(set!.values).toEqual({ apr: "21.99", st: "NJ" });
    });

    it("keeps a sample's digits exactly: no rounding, no exponent, trailing zeros kept", () => {
      const [set] = defaultSampleSets(
        [v("big", "currency", "1000000000000000000000"), v("tiny", "number", "0.0000001"), v("apr", "percent", "21.90")],
        TODAY,
      );
      expect(set!.values).toEqual({ big: "1000000000000000000000", tiny: "0.0000001", apr: "21.90" });
    });

    it("falls back to a realistic default when the sample is missing or invalid", () => {
      expect(typical.last_name).toBe("Chen");
      expect(typical.bonus_points).toBe("20000");
      const [set] = defaultSampleSets(
        [
          v("fee", "currency", "lots"),
          v("apr", "percent", "high"),
          v("when", "date", "someday"),
          v("st", "us_state", "Narnia"),
        ],
        TODAY,
      );
      expect(set!.values).toEqual({ fee: "1000", apr: "21.99", when: "2026-11-03", st: "NJ" });
    });

    it("uses the label for text it can't place", () => {
      expect(typical.promo_code).toBe("Promo code");
    });
  });

  describe("long", () => {
    const long = byId(sets, "long");

    it("uses long, realistic names", () => {
      expect(long.first_name).toBe("Alexandria-Marguerite");
      expect(long.last_name).toBe("Featherstonehaugh-Villiers");
    });

    it("uses a realistic phrase of about 60 characters for other text", () => {
      const phrase = String(long.promo_code);
      expect(phrase.length).toBeGreaterThanOrEqual(55);
      expect(phrase.length).toBeLessThanOrEqual(65);
      expect(phrase.toLowerCase()).not.toMatch(/lorem|ipsum/);
    });

    it("uses large amounts and a high percent", () => {
      expect(long.annual_fee).toBe("1000000");
      expect(formatValue("currency", long.annual_fee!)).toBe("$1,000,000");
      expect(long.bonus_points).toBe("1000000");
      expect(Number(long.purchase_apr)).toBeGreaterThanOrEqual(29.99);
    });

    it("uses the next September 30 on or after today", () => {
      expect(long.offer_end_date).toBe("2027-09-30");
      expect(formatValue("date", long.offer_end_date!)).toBe("September 30, 2027");
      expect(byId(defaultSampleSets(VARIABLES, "2026-09-30"), "long").offer_end_date).toBe("2026-09-30");
      expect(byId(defaultSampleSets(VARIABLES, "2026-03-15"), "long").offer_end_date).toBe("2026-09-30");
      expect(byId(defaultSampleSets(VARIABLES, "2026-12-31"), "long").offer_end_date).toBe("2027-09-30");
    });

    it("uses the state with the longest name", () => {
      const longest = Math.max(...Object.values(US_STATES).map((name) => name.length));
      expect(US_STATES[String(long.home_state)]!.length).toBe(longest);
      expect(long.home_state).toBe("DC");
    });
  });

  describe("minimum", () => {
    const minimum = byId(sets, "minimum");

    it("uses short names", () => {
      expect(minimum.first_name).toBe("Al");
      expect(minimum.last_name).toBe("Li");
      expect(String(minimum.promo_code).length).toBeLessThanOrEqual(5);
    });

    it("uses zero amounts", () => {
      expect(minimum.annual_fee).toBe("0");
      expect(minimum.bonus_points).toBe("0");
      expect(minimum.purchase_apr).toBe("0");
    });

    it("uses a short date: the next May 1 on or after today", () => {
      expect(minimum.offer_end_date).toBe("2027-05-01");
      expect(formatValue("date", minimum.offer_end_date!)).toBe("May 1, 2027");
      expect(byId(defaultSampleSets(VARIABLES, "2027-05-01"), "minimum").offer_end_date).toBe("2027-05-01");
    });

    it("uses a state with the shortest name", () => {
      const shortest = Math.min(...Object.values(US_STATES).map((name) => name.length));
      expect(US_STATES[String(minimum.home_state)]!.length).toBe(shortest);
    });
  });

  describe("text kinds, judged by key and then label", () => {
    const value = (variable: Variable, id: "typical" | "long" | "minimum") =>
      byId(defaultSampleSets([variable], TODAY), id)[variable.key];

    it.each([
      ["first_name", "Maya", "Alexandria-Marguerite", "Al"],
      ["given_name", "Maya", "Alexandria-Marguerite", "Al"],
      ["last_name", "Chen", "Featherstonehaugh-Villiers", "Li"],
      ["surname", "Chen", "Featherstonehaugh-Villiers", "Li"],
      ["full_name", "Maya Chen", "Alexandria-Marguerite Featherstonehaugh-Villiers", "Al Li"],
      ["cardholder_name", "Maya Chen", "Alexandria-Marguerite Featherstonehaugh-Villiers", "Al Li"],
      ["name", "Maya Chen", "Alexandria-Marguerite Featherstonehaugh-Villiers", "Al Li"],
      ["city", "Newark", "Rancho Santa Margarita", "Ada"],
      ["email_address", "maya.chen@example.com", "alexandria-marguerite.featherstonehaugh-villiers@example.com", "al@li.co"],
      ["mailing_address", "120 Harbor Street", "12500 Northwest Old Settlers Boulevard, Apartment 1204", "1 A St"],
      ["employer_name", "Harbor Supply Co.", "Featherstonehaugh-Villiers Agricultural Holdings Incorporated", "Ace"],
    ])("%s", (key, typical, long, minimum) => {
      const variable = v(key, "text");
      expect([value(variable, "typical"), value(variable, "long"), value(variable, "minimum")]).toEqual([typical, long, minimum]);
    });

    it("doesn't take a product name for a person's name", () => {
      expect(value(v("product_name", "text", "", "Product name"), "typical")).toBe("Product name");
    });

    it("reads the label when the key says nothing", () => {
      expect(value(v("fld_1", "text", "", "First name"), "long")).toBe("Alexandria-Marguerite");
    });
  });

  it("rejects a malformed day", () => {
    expect(() => defaultSampleSets(VARIABLES, "10/04/2026")).toThrow();
  });

  it("accepts a full ISO timestamp as the day", () => {
    expect(defaultSampleSets(VARIABLES, "2026-10-04T23:00:00.000Z")).toEqual(sets);
  });
});

describe("sampleSetValues", () => {
  it("uses the set's own values when present", () => {
    const set: SampleSet = { id: "typical", name: "Typical customer", values: { first_name: "Jordan", annual_fee: 120 } };
    expect(sampleSetValues(set, VARIABLES, TODAY)).toMatchObject({ first_name: "Jordan", annual_fee: 120 });
  });

  it("fills missing and empty values from the set's kind", () => {
    const set: SampleSet = { id: "long", name: "Long name and maximum values", values: { first_name: "", annual_fee: "  " } };
    const values = sampleSetValues(set, VARIABLES, TODAY);
    expect(values.first_name).toBe("Alexandria-Marguerite");
    expect(values.annual_fee).toBe("1000000");
    expect(values.home_state).toBe("DC");
  });

  it("treats null like empty (sets come from JSON)", () => {
    const set = { id: "minimum", name: "Minimum values", values: { annual_fee: null } } as unknown as SampleSet;
    expect(sampleSetValues(set, VARIABLES, TODAY).annual_fee).toBe("0");
  });

  it("falls back to typical for a custom set", () => {
    const set: SampleSet = { id: "s_custom", name: "Texas customer", values: { home_state: "TX" } };
    const values = sampleSetValues(set, VARIABLES, TODAY);
    expect(values.home_state).toBe("TX");
    expect(values.first_name).toBe("Maya");
    expect(values.purchase_apr).toBe("21.99");
  });

  it("drops keys that aren't in the list, and covers every variable", () => {
    const set: SampleSet = { id: "typical", name: "Typical customer", values: { removed_key: "x", first_name: "Maya" } };
    const values = sampleSetValues(set, VARIABLES, TODAY);
    expect(Object.keys(values)).toEqual(VARIABLES.map((x) => x.key));
    expect("removed_key" in values).toBe(false);
  });

  it("passes the set's values through as given, even invalid ones", () => {
    const set: SampleSet = { id: "typical", name: "Typical customer", values: { purchase_apr: "high" } };
    expect(sampleSetValues(set, VARIABLES, TODAY).purchase_apr).toBe("high");
  });

  it("matches defaultSampleSets for an empty set of the same kind", () => {
    for (const set of defaultSampleSets(VARIABLES, TODAY)) {
      expect(sampleSetValues({ ...set, values: {} }, VARIABLES, TODAY)).toEqual(set.values);
    }
  });

  it("needs a valid day only when it has to fill something", () => {
    const set: SampleSet = { id: "typical", name: "Typical", values: { a: "x" } };
    expect(sampleSetValues(set, [v("a", "text")], "not a day")).toEqual({ a: "x" });
  });
});
