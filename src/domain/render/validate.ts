// Checks a render request's values against the version's variable list and turns them into
// canonical strings. Pure TypeScript.
//
// Walks the list in order. A value is absent when it's undefined, null or blank. Required and absent
// is missing; optional and absent is left out (it renders empty). A present value must be a string,
// at most MAX_VALUE_LENGTH characters as sent, and fit its type (`validateValue`, which also accepts
// friendly forms like "21.99%" or "New Jersey"). A longer value is invalid, never cut. A JSON number
// is invalid whatever its digits: a value is a JSON string (spec section 5, decision 0058), because a
// number's text doesn't survive every parser and "21.90" must not become 21.9. Keys that aren't in
// the list are ignored. Messages never echo a value.
//
// Canonical decimals are the digits as sent ("21.90" stays "21.90").

import {
  MAX_VALUE_LENGTH,
  longerThan,
  validateValue,
} from "@/editor/model/variables";
import type { Variable } from "../types";
import { valuesError } from "./errors";
import type { CanonicalValues, InvalidValue, RenderError } from "./types";

export type ValidateResult =
  { ok: true; values: CanonicalValues } | { ok: false; error: RenderError };

function isAbsent(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

export function validateValues(
  variables: readonly Variable[],
  values: Readonly<Record<string, unknown>>,
): ValidateResult {
  const canonical: Record<string, string> = {};
  const missing: string[] = [];
  const invalid: InvalidValue[] = [];

  for (const variable of variables) {
    // Own keys only: a variable named `constructor` mustn't read Object.prototype.
    const value = Object.prototype.hasOwnProperty.call(values, variable.key)
      ? values[variable.key]
      : undefined;

    if (isAbsent(value)) {
      if (variable.required) missing.push(variable.key);
      continue;
    }

    // A JSON number is refused as such, so the sentence can say how to send it (as a string).
    if (typeof value === "number") {
      invalid.push({
        key: variable.key,
        expected: variable.type,
        sent: "number",
      });
      continue;
    }

    if (typeof value === "string" && longerThan(value, MAX_VALUE_LENGTH)) {
      invalid.push({
        key: variable.key,
        expected: variable.type,
        maxLength: MAX_VALUE_LENGTH,
      });
      continue;
    }

    const checked =
      typeof value === "string" ? validateValue(variable.type, value) : null;
    if (checked?.ok) canonical[variable.key] = checked.value;
    else invalid.push({ key: variable.key, expected: variable.type });
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, error: valuesError({ missing, invalid }) };
  }
  return { ok: true, values: canonical };
}
