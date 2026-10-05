import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TYPE_META, US_STATES, validateValue } from "@/editor/model/variables";
import { validateValues } from "../render/validate";
import { VARIABLE_TYPES, type Variable, type VariableType } from "../types";
import { apiVariables, contractJsonSchema, exampleOf, jsonSchemaId, US_STATE_CODES } from "./json-schema";

// The schema is checked with a real JSON Schema validator (zod's `fromJSONSchema`, draft 2020-12),
// against the render route's own validation: what the schema accepts, the route accepts.

const v = (key: string, type: VariableType, required = true, sample = TYPE_META[type].example): Variable => ({
  key,
  label: key.replace(/_/g, " "),
  type,
  required,
  sample,
});

const ALL: Variable[] = [
  v("first_name", "text"),
  v("annual_fee", "currency"),
  v("purchase_apr", "percent"),
  v("offer_end_date", "date", false),
  v("bonus_points", "number", false),
  v("home_state", "us_state"),
];

const schemaFor = (variables: readonly Variable[]) =>
  contractJsonSchema({ templateId: "UC-4F7K2Q", templateName: "Spring Travel Rewards — Terms", versionNumber: 2, variables });
const validator = (variables: readonly Variable[]) => z.fromJSONSchema(schemaFor(variables) as never);
const accepts = (variables: readonly Variable[], values: Record<string, unknown>) => validator(variables).safeParse(values).success;

const without = (values: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(values).filter(([key]) => !keys.includes(key)));

/** Values no variable of the type accepts (as e2e/api/helpers.ts JUNK). */
const JUNK: Record<VariableType, unknown> = {
  text: { not: "text" },
  currency: "twelve dollars",
  percent: "abc",
  date: "someday",
  number: "many",
  us_state: "Narnia",
};

describe("contractJsonSchema", () => {
  it("is a draft 2020-12 object schema with one property per variable and the required keys", () => {
    const schema = schemaFor(ALL);
    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://ucomp.example/schemas/UC-4F7K2Q/v2/values.json",
      title: "Spring Travel Rewards — Terms v2: values",
      type: "object",
      required: ["first_name", "annual_fee", "purchase_apr", "home_state"],
      additionalProperties: true,
    });
    expect(Object.keys(schema.properties)).toEqual(ALL.map((x) => x.key));
    expect(jsonSchemaId("UC-ABCDEF", 7)).toBe("https://ucomp.example/schemas/UC-ABCDEF/v7/values.json");
  });

  it("types each property: strings, numbers as strings or JSON numbers, dates, state codes", () => {
    const { properties: p } = schemaFor(ALL);
    expect(p.first_name).toEqual({ title: "first name", description: "Text.", type: "string", examples: ["Maya"] });
    expect(p.annual_fee).toMatchObject({ type: ["string", "number"], description: "Currency, canonical form like 1000 or 1000.50.", examples: ["1000"] });
    expect(p.purchase_apr).toMatchObject({ type: ["string", "number"], examples: ["21.99"] });
    expect(p.bonus_points).toMatchObject({ type: ["string", "number"], examples: ["20000"] });
    expect(p.offer_end_date).toMatchObject({ type: "string", format: "date", examples: ["2027-03-04"] });
    expect(p.home_state).toMatchObject({ type: "string", examples: ["NJ"] });
    expect(p.home_state!.enum).toEqual(Object.keys(US_STATES));
    expect(US_STATE_CODES).toHaveLength(51);
  });

  it("an empty variable list is an empty object schema", () => {
    expect(schemaFor([])).toMatchObject({ properties: {}, required: [] });
    expect(accepts([], { anything: 1 })).toBe(true);
  });
});

describe("contractJsonSchema: validated", () => {
  const samples = Object.fromEntries(ALL.map((x) => [x.key, x.sample]));

  it("the samples validate, unknown keys are allowed, and optional keys may be left out", () => {
    expect(accepts(ALL, samples)).toBe(true);
    expect(accepts(ALL, { ...samples, unknown_key: { any: "thing" } })).toBe(true);
    expect(accepts(ALL, without(samples, "offer_end_date", "bonus_points"))).toBe(true);
  });

  it("a missing required key fails", () => {
    expect(accepts(ALL, without(samples, "annual_fee"))).toBe(false);
  });

  it.each(VARIABLE_TYPES.map((type) => [type]))("JUNK %s fails", (type) => {
    const variable = ALL.find((x) => x.type === type)!;
    expect(accepts(ALL, { ...samples, [variable.key]: JUNK[type] })).toBe(false);
    // The render route rejects it too.
    expect(validateValues([variable], { [variable.key]: JUNK[type] }).ok).toBe(false);
  });

  it("numbers may be JSON numbers or decimal strings", () => {
    for (const value of [1000, 1000.5, "1000", "1000.50", "-12.5", "0"]) {
      expect(accepts(ALL, { ...samples, annual_fee: value }), String(value)).toBe(true);
    }
    for (const value of ["$1,000", "1,000", "21.99%", "1e3", ".5", "5.", ""]) {
      expect(accepts(ALL, { ...samples, annual_fee: value }), value).toBe(false);
    }
  });

  it("dates must be real calendar days as YYYY-MM-DD", () => {
    for (const value of ["2027-02-30", "3/4/2027", "March 4, 2027", "2027-3-4"]) {
      expect(accepts(ALL, { ...samples, offer_end_date: value }), value).toBe(false);
    }
    expect(accepts(ALL, { ...samples, offer_end_date: "2028-02-29" })).toBe(true);
  });

  it("states must be the two-letter code", () => {
    expect(accepts(ALL, { ...samples, home_state: "DC" })).toBe(true);
    expect(accepts(ALL, { ...samples, home_state: "New Jersey" })).toBe(false);
    expect(accepts(ALL, { ...samples, home_state: "nj" })).toBe(false);
  });

  it("whatever the schema accepts, the render route accepts", () => {
    const candidates: Record<VariableType, unknown[]> = {
      text: ["Maya", "O'Brien", "Zoë", " spaced "],
      currency: ["0", "95", "1000.50", "-3", 1000, 0.5],
      percent: ["21.99", "0", "100", 21.99],
      number: ["20000", "1.5", 7],
      date: ["2027-03-04", "2026-12-31", "2028-02-29"],
      us_state: [...US_STATE_CODES],
    };
    for (const type of VARIABLE_TYPES) {
      const variable = v("x", type);
      for (const value of candidates[type]) {
        if (!accepts([variable], { x: value })) continue;
        expect(validateValues([variable], { x: value }).ok, `${type} ${String(value)}`).toBe(true);
      }
    }
  });

  it("every canonical form the route produces (from friendly input too) passes the schema", () => {
    const friendly: Record<VariableType, string[]> = {
      text: ["Maya"],
      currency: ["$1,000.00", "1000", "-$5", "12.5"],
      percent: ["21.99%", "0%", "7"],
      number: ["20,000", "3.25"],
      date: ["3/4/2027", "March 4, 2027", "2027-3-4"],
      us_state: ["New Jersey", "nj", "DC"],
    };
    for (const type of VARIABLE_TYPES) {
      for (const input of friendly[type]) {
        const checked = validateValue(type, input);
        expect(checked.ok, `${type} ${input}`).toBe(true);
        if (checked.ok) expect(accepts([v("x", type)], { x: checked.value }), `${type} ${checked.value}`).toBe(true);
      }
    }
  });
});

describe("apiVariables", () => {
  it("lists the contract in order, example = sample", () => {
    expect(apiVariables(ALL.slice(0, 2))).toEqual([
      { key: "first_name", label: "first name", type: "text", required: true, example: "Maya" },
      { key: "annual_fee", label: "annual fee", type: "currency", required: true, example: "1000" },
    ]);
  });

  it("a blank sample falls back to the type's example", () => {
    expect(exampleOf(v("fee", "currency", true, ""))).toBe("1000");
    expect(apiVariables([v("when", "date", false, "  ")])[0]!.example).toBe("2027-03-04");
  });
});
