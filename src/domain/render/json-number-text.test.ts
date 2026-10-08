import { afterEach, describe, expect, it, vi } from "vitest";
import { parseJsonWithNumberText, UNREADABLE_NUMBER } from "./json-number-text";
import { validateValues } from "./validate";

describe("parseJsonWithNumberText", () => {
  it("parses like JSON.parse and throws on bad JSON the same way", () => {
    const text = '{"version":2,"channel":"web","values":{"a":1},"list":[1,"x",null]}';
    expect(parseJsonWithNumberText(text).json).toEqual(JSON.parse(text));
    expect(() => parseJsonWithNumberText("{nope")).toThrow(SyntaxError);
  });

  it("gives each number of an object its exact source text, digits as sent", () => {
    const { json, numbersAsText } = parseJsonWithNumberText(
      '{"version":2,"values":{"apr":21.90,"big":1000000000000000000000,"tiny":0.0000001,"long":12345678901234567.89,"exp":1e3,"neg":-0,"s":"21.90","n":null,"o":{"x":1.50}}}',
    );
    const body = json as { version: number; values: Record<string, unknown> };
    expect(body.version).toBe(2); // the object itself is untouched
    expect(numbersAsText(body.values)).toEqual({
      apr: "21.90",
      big: "1000000000000000000000",
      tiny: "0.0000001",
      long: "12345678901234567.89",
      exp: "1e3",
      neg: "-0",
      s: "21.90",
      n: null,
      o: { x: 1.5 }, // only the object's own numbers change
    });
  });

  it("keeps a __proto__ key an ordinary own property", () => {
    const { json, numbersAsText } = parseJsonWithNumberText('{"values":{"__proto__":5}}');
    const values = numbersAsText((json as { values: Record<string, unknown> }).values);
    expect(Object.hasOwn(values, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
  });

  it("then follows the string grammar: 21.90 stays 21.90, exponents and negative zero are refused", () => {
    const { json, numbersAsText } = parseJsonWithNumberText('{"apr":21.90,"fee":1e3,"pts":-0}');
    const values = numbersAsText(json as Record<string, unknown>);
    const variables = [
      { key: "apr", label: "APR", type: "percent" as const, required: true, sample: "" },
      { key: "fee", label: "Fee", type: "currency" as const, required: true, sample: "" },
      { key: "pts", label: "Points", type: "number" as const, required: true, sample: "" },
    ];
    expect(validateValues(variables.slice(0, 1), values)).toEqual({ ok: true, values: { apr: "21.90" } });
    const refused = validateValues(variables, values);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.details).toEqual({ missing: [], invalid: [{ key: "fee", expected: "currency" }, { key: "pts", expected: "number" }] });
  });

  describe("on a runtime without the reviver's source text", () => {
    afterEach(() => vi.restoreAllMocks());

    it("marks numbers unreadable, and validation refuses them instead of guessing digits", () => {
      const parse = JSON.parse;
      vi.spyOn(JSON, "parse").mockImplementation((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) =>
        // An older engine calls the reviver with two arguments only.
        parse(text, reviver && function (this: unknown, key: string, value: unknown) { return reviver.call(this, key, value); }),
      );
      const { json, numbersAsText } = parseJsonWithNumberText('{"apr":21.90,"name":"Maya"}');
      const values = numbersAsText(json as Record<string, unknown>);
      expect(values).toEqual({ apr: UNREADABLE_NUMBER, name: "Maya" });
      const checked = validateValues([{ key: "apr", label: "APR", type: "percent", required: true, sample: "" }], values);
      expect(checked.ok).toBe(false);
    });
  });
});
