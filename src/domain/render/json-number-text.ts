// JSON.parse that keeps the exact text of JSON numbers, for request bodies that carry variable values.
// Pure TypeScript.
//
// A consumer that sends {"purchase_apr": 21.90} means the digits 21.90, which a JS number can't hold:
// it would read 21.9, 1000000000000000000000 would read 1e+21, and 12345678901234567.89 would lose
// digits. The reviver's third argument (`context.source`, ES2025 "JSON.parse source text access",
// Node 21+) gives each number's text as sent, so a value number becomes that string and then follows
// the same grammar as a string (`validateValue`): 21.90 renders 21.90%, and 1e3 is refused.
//
// Without `context.source` (an older runtime) a number's digits can't be known. It becomes
// UNREADABLE_NUMBER, which validation refuses as not fitting the type: refusing beats rendering
// digits the sender didn't send.

/** Stands in for a JSON number whose source text the runtime didn't give. Never a valid value. */
export const UNREADABLE_NUMBER: unique symbol = Symbol("unreadable JSON number");

export interface JsonWithNumberText {
  /** What JSON.parse returns (numbers are JS numbers here). */
  json: unknown;
  /**
   * A copy of `object` (an object from this parse) whose number properties are their exact source
   * text: {"apr": 21.90} gives { apr: "21.90" }. Other properties are kept as
   * they are (nested objects too: only the object's own number properties change).
   */
  numbersAsText(object: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

type SourceReviver = (this: unknown, key: string, value: unknown, context?: { source?: unknown }) => unknown;

/** JSON.parse (throws the same SyntaxError) that remembers every number's source text. */
export function parseJsonWithNumberText(text: string): JsonWithNumberText {
  // holder object → property key → the number's source text (undefined when the runtime gave none).
  const sources = new WeakMap<object, Map<string, string | undefined>>();

  const reviver: SourceReviver = function (key, value, context) {
    if (typeof value === "number" && typeof this === "object" && this !== null) {
      let byKey = sources.get(this);
      if (!byKey) sources.set(this, (byKey = new Map()));
      byKey.set(key, typeof context?.source === "string" ? context.source : undefined);
    }
    return value;
  };
  const json: unknown = JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown);

  return {
    json,
    numbersAsText(object) {
      const byKey = sources.get(object);
      return Object.fromEntries(
        Object.entries(object).map(([key, value]) => [
          key,
          typeof value === "number" ? (byKey?.get(key) ?? UNREADABLE_NUMBER) : value,
        ]),
      );
    },
  };
}
