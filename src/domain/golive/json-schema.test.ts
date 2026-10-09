import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TYPE_META, US_STATES, validateValue } from "@/editor/model/variables";
import { MAX_VALUE_LENGTH } from "../render/types";
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
/**
 * The same schema with `format` removed: draft 2020-12 makes format an annotation by default, so a
 * standard validator may not check it. The schema must hold without it.
 */
const annotationOnly = (variables: readonly Variable[]) => {
  const schema = schemaFor(variables);
  const properties = Object.fromEntries(Object.entries(schema.properties).map(([k, p]) => [k, { ...p, format: undefined }]));
  return z.fromJSONSchema(JSON.parse(JSON.stringify({ ...schema, properties })) as never);
};
const accepts = (variables: readonly Variable[], values: Record<string, unknown>) => {
  const strict = validator(variables).safeParse(values).success;
  // Whatever the format keyword decides, the patterns alone give the same answer.
  expect(annotationOnly(variables).safeParse(values).success, JSON.stringify(values)).toBe(strict);
  return strict;
};

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
      $id: "https://stencil.example/schemas/UC-4F7K2Q/v2/values.json",
      title: "Spring Travel Rewards — Terms v2: values",
      type: "object",
      required: ["first_name", "annual_fee", "purchase_apr", "home_state"],
      additionalProperties: true,
    });
    expect(Object.keys(schema.properties)).toEqual(ALL.map((x) => x.key));
    expect(jsonSchemaId("UC-ABCDEF", 7)).toBe("https://stencil.example/schemas/UC-ABCDEF/v7/values.json");
  });

  it("types each property: strings (a required text non-blank), numbers as decimal strings, dates, state codes", () => {
    const { properties: p } = schemaFor(ALL);
    expect(p.first_name).toEqual({ title: "first name", description: "Text.", type: "string", minLength: 1, pattern: "\\S", maxLength: 1000, examples: ["Maya"] });
    expect(schemaFor([v("nickname", "text", false)]).properties.nickname).toEqual({ title: "nickname", description: "Text.", type: "string", maxLength: 1000, examples: ["Maya"] });
    expect(p.annual_fee).toMatchObject({
      type: "string",
      description: "Currency, canonical form like 1000 or 1000.50. Renders as $1,000.50, digits exactly as sent.",
      examples: ["1000"],
    });
    expect(p.purchase_apr).toMatchObject({ type: "string", examples: ["21.99"] });
    expect(p.bonus_points).toMatchObject({ type: "string", examples: ["20000"] });
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

  it("numbers are canonical decimal strings, exactly the route's grammar; JSON numbers aren't advertised", () => {
    for (const value of ["1000", "1000.50", "-12.5", "0", "0.5", "0.00", "21.90", "9".repeat(400), "1000000000000000000000"]) {
      expect(accepts(ALL, { ...samples, annual_fee: value }), String(value)).toBe(true);
      expect(validateValue("currency", value)).toEqual({ ok: true, value });
    }
    for (const value of ["$1,000", "1,000", "21.99%", "1e3", ".5", "5.", "+5", "007", "00", "-0", "-0.00", "１２", "", 1000, 1e21, 1e-7]) {
      expect(accepts(ALL, { ...samples, annual_fee: value }), String(value)).toBe(false);
    }
    // Why: a JSON number in exponent notation is refused by the route.
    expect(validateValues([v("x", "currency")], { x: 1e21 }).ok).toBe(false);
    expect(validateValues([v("x", "currency")], { x: 1e-7 }).ok).toBe(false);
    expect(validateValues([v("x", "currency")], { x: 1000 }).ok).toBe(true);
  });

  it("a required text must not be blank; an optional one may be", () => {
    for (const value of ["", "   ", "\t\n"]) {
      expect(accepts(ALL, { ...samples, first_name: value }), JSON.stringify(value)).toBe(false);
      expect(validateValues([v("first_name", "text")], { first_name: value }).ok).toBe(false);
      expect(accepts([v("nickname", "text", false)], { nickname: value })).toBe(true);
    }
    expect(accepts(ALL, { ...samples, first_name: " M " })).toBe(true);
  });

  it("dates must be real calendar days as YYYY-MM-DD, by the pattern alone", () => {
    for (const value of ["2027-02-30", "2027-04-31", "2100-02-29", "2027-13-01", "2027-00-10", "0000-01-01", "２０２７-03-04", "3/4/2027", "March 4, 2027", "2027-3-4"]) {
      expect(accepts(ALL, { ...samples, offer_end_date: value }), value).toBe(false);
    }
    for (const value of ["2028-02-29", "2000-02-29", "2400-02-29", "0001-01-01", "0099-01-01", "0100-01-01", "9999-12-31"]) {
      expect(accepts(ALL, { ...samples, offer_end_date: value }), value).toBe(true);
    }
  });

  it("the date pattern and the route agree on every YYYY-MM-DD across leap and century years", () => {
    const date = [v("d", "date")];
    const pattern = new RegExp(schemaFor(date).properties.d!.pattern!);
    for (const year of ["0000", "0001", "0004", "0099", "0100", "1900", "2000", "2024", "2025", "2100", "2400", "9996"]) {
      for (let month = 0; month <= 13; month++) {
        for (let day = 0; day <= 32; day++) {
          const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          expect(pattern.test(value), value).toBe(validateValues(date, { d: value }).ok);
        }
      }
    }
  });

  it("every value is at most 1000 characters, in the schema and in the route alike", () => {
    expect(MAX_VALUE_LENGTH).toBe(1000);
    for (const property of Object.values(schemaFor(ALL).properties)) expect(property.maxLength).toBe(MAX_VALUE_LENGTH);
    const text = [v("x", "text")];
    const number = [v("x", "number")];
    for (const [variables, atLimit] of [
      [text, "a".repeat(MAX_VALUE_LENGTH)],
      [number, "9".repeat(MAX_VALUE_LENGTH)],
    ] as const) {
      expect(accepts(variables, { x: atLimit })).toBe(true);
      expect(validateValues(variables, { x: atLimit }).ok).toBe(true);
      expect(accepts(variables, { x: `${atLimit}9` })).toBe(false);
      expect(validateValues(variables, { x: `${atLimit}9` }).ok).toBe(false);
    }
  });

  it("states must be the two-letter code", () => {
    expect(accepts(ALL, { ...samples, home_state: "DC" })).toBe(true);
    expect(accepts(ALL, { ...samples, home_state: "New Jersey" })).toBe(false);
    expect(accepts(ALL, { ...samples, home_state: "nj" })).toBe(false);
  });

  it("whatever the schema accepts, the render route accepts", () => {
    // The review's counterexamples are in here: blank text, exponent-notation numbers, impossible days.
    const tricky = ["", " ", "\t", null, 1e21, 1e-7, -1e21, 1e300, 0, -0, "1e3", "9".repeat(309), "0099-12-31", "2027-02-30", "2100-02-29"];
    const candidates: Record<VariableType, unknown[]> = {
      text: ["Maya", "O'Brien", "Zoë", " spaced ", ...tricky],
      currency: ["0", "95", "1000.50", "-3", 1000, 0.5, ...tricky],
      percent: ["21.99", "0", "100", 21.99, ...tricky],
      number: ["20000", "1.5", 7, ...tricky],
      date: ["2027-03-04", "2026-12-31", "2028-02-29", ...tricky],
      us_state: [...US_STATE_CODES, ...tricky],
    };
    for (const type of VARIABLE_TYPES) {
      for (const required of [true, false]) {
        const variable = v("x", type, required);
        for (const value of candidates[type]) {
          if (!accepts([variable], { x: value })) continue;
          expect(validateValues([variable], { x: value }).ok, `${type} ${String(value)}`).toBe(true);
        }
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

  it("the example is the sample's canonical form, or the type's example when the sample no longer fits", () => {
    expect(exampleOf(v("fee", "currency", true, "1,000.50"))).toBe("1000.50");
    expect(exampleOf(v("fee", "currency", true, "1e+21"))).toBe("1000"); // saved before exponents were refused
    expect(exampleOf(v("name", "text", true, " Maya "))).toBe(" Maya ");
    for (const type of VARIABLE_TYPES) {
      for (const sample of ["1e+21", "007", "lots", "", TYPE_META[type].example]) {
        const variable = v("x", type, true, sample);
        expect(accepts([variable], { x: exampleOf(variable) }), `${type} ${sample}`).toBe(true);
      }
    }
  });
});
