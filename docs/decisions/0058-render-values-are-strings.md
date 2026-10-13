# 0058. Render values are JSON strings; a JSON number is refused

Status: Accepted
Amended 2026-10-12: built (wave 2, lane I). The refusal's `details.invalid` entry carries `"sent": "number"`, which is what lets the message name the string form; the sentence is `{key} must be a JSON string, like "21.90", not a number.`, the same example for every key so that no value is echoed. `json-number-text.ts` is gone (its path in the Context is no longer in backticks, so `docs:check` passes). `VariableValue` in the editor model is `string` now, and the `values-formats` case sends its former number rows as strings (`percent_whole`, `number_whole`).
Date: 2026-10-12

## Context

The render route reads a JSON number in `values` from its exact source text (`parseJsonWithNumberText` in
src/domain/render/json-number-text.ts (removed), called from `src/server/api/render-http.ts`): `{"purchase_apr": 21.90}`
becomes `"21.90"` and renders `21.90%`, `1e3` is refused, and a 22-digit integer keeps every digit
([render spec](../render-spec.md) §5, "JSON numbers"). Autosave does the same for sample values
(`src/server/drafts/parse-patch.ts`). The published JSON Schema already says strings: every property is
`"type": "string"`, and numbers were accepted "but not advertised" (prototype log, review #7).

A Java port can't keep this rule with ordinary tools. Jackson reads numbers by value: a `double` makes `21.90` into
`21.9`, and `BigDecimal.toPlainString()` makes `1e3` into `1000`; only a custom deserializer reading the token's raw
text is faithful. And any hop that parses and re-serializes the body (a gateway policy, a proxy, the consumer's own
client library) may drop the trailing zero. JSON itself (RFC 8259) promises interoperability only within IEEE double
precision, not that a number's text survives. The render rule, "values keep every digit sent", would then fail before
the request reached us, silently.

## Decision

- **Every value in `values` is a JSON string.** A JSON number is refused: 422 `invalid_values`, with a sentence that
  names the string form (send `"21.90"`). `true`, `false`, objects and arrays are refused as before.
- **The route accepts exactly what the published schema accepts.** A consumer that validates against the schema never
  sends a body the route refuses, and the other way round.
- **Sample values in an autosave patch follow the same rule.**

## Alternatives considered

- **Keep the source-text rule.** Correct in Node, but Java needs a custom deserializer, every hop must pass the body
  through byte for byte, and a hop that doesn't breaks the rule invisibly.
- **Accept numbers by value** (`21.90` read as `21.9`). Breaks the render rule.

## Consequences

- **Node now (a wave 2 item, not yet given a lane; render work, so lane I is the natural home):** `validateValue`
  refuses numbers; `json-number-text.ts` goes from the render route and from `parse-patch.ts`;
  `ApiRenderRequest.values` becomes `Record<string, string>`; the `values-formats` golden case sends strings and a new
  `error-json-number` case pins the refusal; render spec §5 is rewritten. The prototype log's two notes on JSON numbers
  are amended.
- **Java side:** `values` is a `Map<String, String>` with a check that each value is a string.
- A consumer whose serializer writes decimals as JSON numbers (a Java `BigDecimal` or a .NET `decimal` does by
  default) must send strings; it finds out on its first call, from a sentence that says how. There are no consumers
  yet, so the change breaks nobody.
- Decision [0011](0011-cap-each-render-value.md)'s 1,000-character cap, counted in code points, is unchanged.
