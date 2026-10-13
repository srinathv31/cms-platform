# 0056. `/api/v1` errors follow the existing UCOMP API's error format, with a stable code

Status: Accepted
Date: 2026-10-12

## Context

Every `/api/v1` error is `{ "error": { "code", "message", "details"? } }` with the status `API_ERROR_STATUS` gives its
code (`errorResponse` in `src/server/api/http.ts`, `src/domain/golive-types.ts`). `details` is a union that ends in
`Record<string, unknown>` (`src/contracts/api-v1.ts`), so there is no single DTO. The CMS preview route returns the
same body ([0047](0047-stencils-preview-is-its-own-route-and-api-v1-serves-consumers-only.md)), read by
`src/components/preview/render-preview.ts` and the approver's output gate; Coral reads it in
`src/simulator/ucomp-api.ts`. Decision [0041](0041-routes-refuse-in-the-actions-shape.md) gave the browser's own
routes `{ ok: false, code, reason }` and left `/api/v1` until the Java API decided.

Consumers write their error handling once, and when Java serves `/api/v1` it will otherwise answer with Spring's
default body. The existing UCOMP Spring Boot API already has an error format of its own.

## Decision

- **`/api/v1` errors follow the existing UCOMP API's error format**, so consumers of the bank's APIs meet one shape.
- **Whatever that format is, each error carries a stable, machine-readable code** (today's 18 codes, extended by
  [0057](0057-consumers-authenticate-with-client-credentials.md)'s 401) **and that code's details** (`missing`,
  `invalid`, `version`, `sunsetDay`, …), so a consumer branches on the code, never the sentence
  ([0025](0025-refusals-carry-stable-codes.md)).
- **The CMS preview route moves with `/api/v1`**, as 0047 anticipated. The browser's own routes keep 0041's
  `{ ok: false, code, reason }`.
- **Open, for the handoff package (wave 4):** the format itself, and the mapping of today's codes and details onto it.
  It is specific to the enterprise's API and isn't in this repository.

## Alternatives considered

- **RFC 9457 problem details** (the IETF error body, `application/problem+json`, built into Spring Framework 6). A
  standard with framework support, but a second format beside UCOMP's within one enterprise's APIs.
- **Keep `{ error: { … } }`.** A house format no other API there uses.

## Consequences

- **Node now:** nothing in wave 2. Lane J's brief says: errors follow the existing UCOMP API's error format; it must
  carry a stable machine-readable code and each code's details; today's codes are mapped onto it in the handoff
  document. The preview route, `render-preview.ts` and Coral's client change in the PR that points them at Java.
- **Java side:** one exception handler that maps each code to its status and the UCOMP body; `API_ERROR_STATUS`
  becomes an enum with a status.
- The golden files don't change: they hold the render engine's error object, not the HTTP envelope.
