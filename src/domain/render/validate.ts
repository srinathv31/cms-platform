// Checks a render request's values against the version's variable list and turns them into
// canonical strings. Pure TypeScript.
//
// Walks the list in order. A value is absent when it's undefined, null or blank. Required and absent
// is missing; optional and absent is left out (it renders empty). A present value must be a string
// or a finite number, at most MAX_VALUE_LENGTH characters as sent, and fit its type (`validateValue`,
// which also accepts friendly forms like "21.99%" or "New Jersey"). A longer value is invalid, never
// cut. Keys that aren't in the list are ignored. Messages never echo a value.
//
// Canonical decimals are the digits as sent ("21.90" stays "21.90"). The render route hands JSON
// numbers over as their exact source text (`parseJsonWithNumberText`), so they arrive here as strings;
// a JS number from an internal caller is read as its JSON text (`String(n)`, see `validateValue`).

import { validateValue } from "@/editor/model/variables";
import type { Variable } from "../types";
import { valuesError } from "./errors";
import { MAX_VALUE_LENGTH, type CanonicalValues, type InvalidValue, type RenderError } from "./types";

export type ValidateResult = { ok: true; values: CanonicalValues } | { ok: false; error: RenderError };

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * True when `text` has more than `max` characters, counted in code points as JSON Schema's `maxLength`
 * counts them (an emoji is one). Stops counting at `max + 1`, so a huge value costs no more than that.
 */
function longerThan(text: string, max: number): boolean {
  if (text.length <= max) return false; // never more code points than UTF-16 units
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    // A surrogate pair is one code point; a lone surrogate counts as one, as the string iterator does.
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    if (++count > max) return true;
  }
  return false;
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

    if (typeof value === "string" && longerThan(value, MAX_VALUE_LENGTH)) {
      invalid.push({ key: variable.key, expected: variable.type, maxLength: MAX_VALUE_LENGTH });
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
