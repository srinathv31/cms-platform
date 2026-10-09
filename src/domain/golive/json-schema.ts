// A version's variable contract as the consumer API publishes it: the variable list (`apiVariables`)
// and a JSON Schema (draft 2020-12) for the render body's `values` object (`contractJsonSchema`).
// Pure TypeScript.
//
// The schema describes the CANONICAL forms (the ones `Variable.sample` holds and the render route
// turns every value into, `validateValue`): "1000", "21.90", "2027-03-04", "20000", "NJ". The route
// also accepts friendly forms ("$1,000", "21.99%", "3/4/2027", "New Jersey") and JSON numbers (read
// from their source text, same grammar); the schema doesn't advertise them, so a consumer that
// validates against it always sends something the route accepts, with any standard 2020-12 validator
// (format is only an annotation there, so the date pattern itself checks the calendar):
//   - every value is at most MAX_VALUE_LENGTH characters (`maxLength`, which counts code points, as the
//     route does);
//   - a required text must have a non-blank character (the route reads blank as missing);
//   - numeric types are decimal strings only, exactly the route's canonical grammar (no leading
//     zeros, no negative zero, no exponent, a point only between digits); a pattern can't constrain
//     a JSON number;
//   - a date is a real calendar day, years 0001–9999, leap years included.
// Patterns use [0-9], not \d: some validators (Python's re, for one) read \d as any Unicode digit.

import { TYPE_META, US_STATES, validateValue } from "@/editor/model/variables";
import type { ApiJsonSchema, ApiJsonSchemaProperty, ApiVariable, Variable } from "../golive-types";
import { MAX_VALUE_LENGTH } from "../render/types";
import type { VariableType } from "../types";

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

/** Where a contract's schema says it lives. Nothing is served there; it names the schema. */
export function jsonSchemaId(templateId: string, versionNumber: number): string {
  return `https://stencil.example/schemas/${templateId}/v${versionNumber}/values.json`;
}

/**
 * A canonical decimal, exactly what the render route accepts and produces once decoration is off:
 * "1000", "1000.50", "-12.5", "0", "0.5". Not "007", ".5", "5.", "-0" or "1e3". The digits render as
 * sent (no rounding), so the only limit on them is every value's `maxLength`.
 */
export const DECIMAL_PATTERN = "^(?!-0(?:\\.0+)?$)-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$";
/**
 * A real calendar day as YYYY-MM-DD: month lengths and leap years (every 4th year, not centuries
 * unless divisible by 400), years 0001–9999. `format: "date"` says the same, but validators may treat
 * format as an annotation only.
 */
export const DATE_PATTERN =
  "^(?!0000)(?:[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))" +
  "|(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)$";

/** At least one non-blank character: a required text the route won't read as missing. */
export const NON_BLANK_PATTERN = "\\S";

/** The two-letter codes, in the editor's order (50 states plus DC). */
export const US_STATE_CODES: readonly string[] = Object.keys(US_STATES);

const DESCRIPTIONS: Readonly<Record<VariableType, string>> = {
  text: "Text.",
  currency: "Currency, canonical form like 1000 or 1000.50. Renders as $1,000.50, digits exactly as sent.",
  percent: "Percent, canonical form like 21.99 (no % sign). Renders as 21.99%, digits exactly as sent.",
  date: "Date, canonical form YYYY-MM-DD like 2027-03-04. Renders as March 4, 2027.",
  number: "Number, canonical form like 20000 or 1.5. Renders as 20,000, digits exactly as sent.",
  us_state: "US state, the two-letter code like NJ.",
};

/**
 * The variable's sample in canonical form, or the type's example when the sample is blank or doesn't
 * fit the type (a sample saved before the grammar tightened, like "1e+21"): it always passes the schema.
 */
export function exampleOf(variable: Pick<Variable, "type" | "sample">): string {
  if (variable.sample.trim() === "") return TYPE_META[variable.type].example;
  if (variable.type === "text") return variable.sample;
  const checked = validateValue(variable.type, variable.sample);
  return checked.ok ? checked.value : TYPE_META[variable.type].example;
}

function propertyOf(variable: Variable): ApiJsonSchemaProperty {
  const base = {
    title: variable.label,
    description: DESCRIPTIONS[variable.type],
    examples: [exampleOf(variable)],
    maxLength: MAX_VALUE_LENGTH,
  };
  switch (variable.type) {
    case "text":
      return variable.required ? { ...base, type: "string", minLength: 1, pattern: NON_BLANK_PATTERN } : { ...base, type: "string" };
    case "currency":
    case "percent":
    case "number":
      // Strings only: `pattern` can't constrain a JSON number, and some don't stringify plainly.
      return { ...base, type: "string", pattern: DECIMAL_PATTERN };
    case "date":
      return { ...base, type: "string", format: "date", pattern: DATE_PATTERN };
    case "us_state":
      return { ...base, type: "string", enum: [...US_STATE_CODES] };
  }
}

/** JSON Schema for the render body's `values`: one property per variable, the required keys, unknown keys allowed. */
export function contractJsonSchema(input: {
  templateId: string;
  /** The name of the version whose contract this is (`versionNumber`'s), for the title. */
  templateName: string;
  versionNumber: number;
  variables: readonly Variable[];
}): ApiJsonSchema {
  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: jsonSchemaId(input.templateId, input.versionNumber),
    title: `${input.templateName} v${input.versionNumber}: values`,
    type: "object",
    properties: Object.fromEntries(input.variables.map((v) => [v.key, propertyOf(v)])),
    required: input.variables.filter((v) => v.required).map((v) => v.key),
    additionalProperties: true,
  };
}

/** The contract's variable list, in the version's order. */
export function apiVariables(variables: readonly Variable[]): ApiVariable[] {
  return variables.map((v) => ({ key: v.key, label: v.label, type: v.type, required: v.required, example: exampleOf(v) }));
}
