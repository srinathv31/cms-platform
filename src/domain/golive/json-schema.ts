// A version's variable contract as the consumer API publishes it: the variable list (`apiVariables`)
// and a JSON Schema (draft 2020-12) for the render body's `values` object (`contractJsonSchema`).
// Pure TypeScript.
//
// The schema describes the CANONICAL forms (the ones `Variable.sample` holds and the render route
// turns every value into): "1000", "21.99", "2027-03-04", "20000", "NJ". The route also accepts
// friendly forms ("$1,000", "21.99%", "3/4/2027", "New Jersey"); the schema doesn't advertise them,
// so a consumer that validates against it always sends something the route accepts.

import { TYPE_META, US_STATES } from "@/editor/model/variables";
import type { ApiJsonSchema, ApiJsonSchemaProperty, ApiVariable, Variable } from "../golive-types";
import type { VariableType } from "../types";

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

/** Where a contract's schema says it lives. Nothing is served there; it names the schema. */
export function jsonSchemaId(templateId: string, versionNumber: number): string {
  return `https://ucomp.example/schemas/${templateId}/v${versionNumber}/values.json`;
}

/** A plain decimal: "1000", "1000.50", "-12.5". Every match is accepted by the render route. */
export const DECIMAL_PATTERN = "^-?\\d+(?:\\.\\d+)?$";
/** A calendar day as YYYY-MM-DD (the `format: "date"` keyword also checks it's a real day). */
export const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

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
      return { ...base, type: "string" };
    case "currency":
    case "percent":
    case "number":
      // A JSON number is fine too; `pattern` only applies to strings.
      return { ...base, type: ["string", "number"], pattern: DECIMAL_PATTERN };
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
