# 0011. Each render value is at most 1,000 characters

Status: Accepted
Date: 2026-10-09

## Context

The render route takes a value per variable from an anonymous caller. Until October 2026 a value had no length
limit, only the 1 MB body did
([handoff review S6](../handoff-review.md#s6--medium-body-size-limits-trust-the-declared-content-length)): one
100,000-word value cost about a second of main-thread CPU in the PDF, and the published JSON Schema promised
nothing about length, so a consumer couldn't know where the edge was.

The render rule leaves one way to handle a value that's too long. Every channel prints a value exactly as sent, with
no rounding, dropping or rewording ([render-spec.md](../render-spec.md), section 5), so the route can't cut it. It
can only refuse it.

## Decision

- Every value, of every type, is at most 1,000 characters as sent (`MAX_VALUE_LENGTH` in
  [render/types.ts](../../src/domain/render/types.ts)). A longer one is `invalid_values` (422), "first_name must be
  at most 1,000 characters.", with `maxLength: 1000` on its `details.invalid` entry. It's never cut.
- Characters are Unicode code points, counted before any trimming: what JSON Schema's `maxLength` counts, so a
  consumer that validates against the published schema never sends a value the route refuses. An emoji is one.
- The check runs in `validateValues` ([validate.ts](../../src/domain/render/validate.ts)), after the absent check
  (whitespace only is no value, at any length) and before the type check. The CMS preview runs the same function,
  so an author sees the same refusal, with the variable's label.
- The published JSON Schema gives every property `"maxLength": 1000`.

1,000, because:

- A variable fills a slot in a sentence: a name, an amount, a date, a reference, an address, a sentence or two. A
  long postal address is under 200 characters. 1,000 is five such addresses, or a paragraph of about 170 words.
  Content longer than that is a document, and belongs in the template, where it is written, reviewed and approved.
- It's the limit the CMS already puts on what an author can type as a sample value (`z.string().max(1000)` in
  [parse-patch.ts](../../src/server/drafts/parse-patch.ts)), so the longest value a consumer may send is one an
  author can preview.
- It bounds what one value costs. 100,000 words is over 500,000 characters, so a value at the limit is under a
  five-hundredth of the measured case. The 1 MB body limit stays the bound on the request as a whole.

## Alternatives considered

- **Cut long values to the limit.** Breaks the render rule: the customer would get text nobody sent.
- **A limit for text only.** The numeric types already render every digit sent, so a 100,000-digit number costs the
  same as 100,000 characters of text. One limit for every value is one rule to port and to publish.
- **A larger limit, such as 10,000.** It would still let one value carry a document that never went through
  review, and an author couldn't preview it. Raising the limit later is backward compatible; lowering it isn't, so
  start low.
- **Count UTF-16 units, as JavaScript's `length` does.** A consumer validating with a standard JSON Schema
  validator counts code points, and would send strings of emoji the route refused.

## Consequences

- A consumer sending a value over 1,000 characters gets 422 where it used to get a render. None of the seeded
  consumers or golden cases come near the limit.
- The limit is part of the `/api/v1` contract. A Java port counts with `codePointCount`, not `length()`.
- The sample values editor in the CMS doesn't stop typing at 1,000 characters. Past it, the preview shows the
  refusal and autosave refuses the sample.
