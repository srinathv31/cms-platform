// A version's variable contract as the consumer API publishes it: the variable list (`apiVariables`)
// and a JSON Schema (draft 2020-12) for the render body's `values` object (`contractJsonSchema`).
// Pure TypeScript.
//
// The schema describes the CANONICAL forms (the ones `Variable.sample` holds and the render route
// turns every value into): "1000", "21.99", "2027-03-04", "20000", "NJ". The route also accepts
// friendly forms ("$1,000", "21.99%", "3/4/2027", "New Jersey") and JSON numbers; the schema doesn't
// advertise them, so a consumer that validates against it always sends something the route accepts,
// with any standard 2020-12 validator (format is only an annotation there, so the date pattern itself
// checks the calendar):
//   - a required text must have a non-blank character (the route reads blank as missing);
//   - numeric types are decimal strings only: a JSON number like 1e21 or 1e-7 stringifies to exponent
//     notation, which the route refuses, and a pattern can't constrain numbers;
//   - a date is a real calendar day from year 0100 on, leap years included.

import { TYPE_META, US_STATES } from "@/editor/model/variables";
import type { ApiJsonSchema, ApiJsonSchemaProperty, ApiVariable, Variable } from "../golive-types";
import type { VariableType } from "../types";

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

/** Where a contract's schema says it lives. Nothing is served there; it names the schema. */
export function jsonSchemaId(templateId: string, versionNumber: number): string {
  return `https://stencil.example/schemas/${templateId}/v${versionNumber}/values.json`;
}

/**
 * A plain decimal: "1000", "1000.50", "-12.5". Every match is accepted by the render route: at most
 * 308 whole digits, so the number stays finite.
 */
export const DECIMAL_PATTERN = "^-?\\d{1,308}(?:\\.\\d+)?$";
/**
 * A real calendar day as YYYY-MM-DD: month lengths and leap years (every 4th year, not centuries
 * unless divisible by 400), years 0100–9999 (the route reads years below 100 as 19xx, so refuses them).
 * `format: "date"` says the same, but validators may treat format as an annotation only.
 */
export const DATE_PATTERN =
  "^(?!00)(?:\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|1\\d|2[0-8]))" +
  "|(?:\\d{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)$";

/** At least one non-blank character: a required text the route won't read as missing. */
export const NON_BLANK_PATTERN = "\\S";

/** The two-letter codes, in the editor's order (50 states plus DC). */
export const US_STATE_CODES: readonly string[] = Object.keys(US_STATES);

const DESCRIPTIONS: Readonly<Record<VariableType, string>> = {
  text: "Text.",
  currency: "Currency, canonical form like 1000 or 1000.50.",
  percent: "Percent, canonical form like 21.99 (no % sign).",
  date: "Date, canonical form YYYY-MM-DD like 2027-03-04.",
  number: "Number, canonical form like 20000.",
  us_state: "US state, the two-letter code like NJ.",
};

/** The variable's sample, or the type's example when the sample is blank. Always canonical. */
export function exampleOf(variable: Pick<Variable, "type" | "sample">): string {
  return variable.sample.trim() === "" ? TYPE_META[variable.type].example : variable.sample;
}

function propertyOf(variable: Variable): ApiJsonSchemaProperty {
  const base = { title: variable.label, description: DESCRIPTIONS[variable.type], examples: [exampleOf(variable)] };
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
