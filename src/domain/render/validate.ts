// Checks a render request's values against the version's variable list and turns them into
// canonical strings. Pure TypeScript.
//
// Walks the list in order. A value is absent when it's undefined, null or blank. Required and absent
// is missing; optional and absent is left out (it renders empty). A present value must be a string
// or a finite number and fit its type (`validateValue`, which also accepts friendly forms like
// "21.99%" or "New Jersey"). Keys that aren't in the list are ignored. Messages never echo a value.

import { validateValue } from "@/editor/model/variables";
import type { Variable } from "../types";
import { valuesError } from "./errors";
import type { CanonicalValues, InvalidValue, RenderError } from "./types";

export type ValidateResult = { ok: true; values: CanonicalValues } | { ok: false; error: RenderError };

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
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
    const value = Object.prototype.hasOwnProperty.call(values, variable.key) ? values[variable.key] : undefined;

    if (isAbsent(value)) {
      if (variable.required) missing.push(variable.key);
      continue;
    }

    const usable = typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
    const checked = usable ? validateValue(variable.type, value) : null;
    if (checked?.ok) canonical[variable.key] = checked.value;
    else invalid.push({ key: variable.key, expected: variable.type });
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, error: valuesError({ missing, invalid }) };
  }
  return { ok: true, values: canonical };
}
