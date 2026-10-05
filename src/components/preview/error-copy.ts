// What the preview says when the route refuses the values, in an author's words. The route's own
// messages are for the people integrating ("Missing required variables: first_name."): they name
// keys. An author knows the variables by their labels, so the preview rebuilds the sentences from the
// error's `details` and the live variable list. Anything it can't say better (another code, a key the
// list doesn't have) keeps the route's sentence.
//
//   missing, one      "First name needs a value."
//   missing, several  "First name and Purchase APR need values."  /  "A, B, and C need values."
//   invalid           "Purchase APR must be a percentage, like 21.99."  (the route's wording, with the label)
//   both              the missing sentence, then the invalid ones.

import { VALUE_NOUNS } from "@/domain/render/errors";
import type { RenderError, ValueErrorDetails } from "@/domain/render/types";
import type { Variable } from "@/domain/types";

/** "A", "A and B", "A, B, and C". */
export function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** `details`, when it has the shape of ValueErrorDetails. */
function valueDetails(details: RenderError["details"]): ValueErrorDetails | null {
  if (!details || typeof details !== "object") return null;
  const { missing, invalid } = details as Partial<ValueErrorDetails>;
  if (!Array.isArray(missing) || !Array.isArray(invalid)) return null;
  if (!missing.every((key) => typeof key === "string")) return null;
  if (!invalid.every((item) => item && typeof item.key === "string" && item.expected in VALUE_NOUNS)) return null;
  return { missing, invalid };
}

export function authorMessage(error: RenderError, variables: readonly Pick<Variable, "key" | "label">[]): string {
  if (error.code !== "missing_variables" && error.code !== "invalid_values") return error.message;
  const details = valueDetails(error.details);
  if (!details || details.missing.length + details.invalid.length === 0) return error.message;

  const labels = new Map<string, string>();
  for (const { key, label } of variables) if (label.trim() !== "") labels.set(key, label.trim());
  const labelOf = (key: string) => labels.get(key);

  const missing: string[] = [];
  for (const key of details.missing) {
    const label = labelOf(key);
    if (label === undefined) return error.message;
    missing.push(label);
  }
  const sentences: string[] = [];
  if (missing.length === 1) sentences.push(`${missing[0]} needs a value.`);
  else if (missing.length > 1) sentences.push(`${listAnd(missing)} need values.`);
  for (const { key, expected } of details.invalid) {
    const label = labelOf(key);
    if (label === undefined) return error.message;
    sentences.push(`${label} must be ${VALUE_NOUNS[expected]}.`);
  }
  return sentences.join(" ");
}
