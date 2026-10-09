# `src/contracts`: the `/api/v1` wire contract

[api-v1.ts](api-v1.ts) holds the TypeScript shapes of Stencil's public consumer API: request and response bodies,
error codes and error bodies, and the response header names (`API_HEADERS`, its only runtime value). Stencil's route
handlers and the Coral simulator both compile against it. It stands in for an OpenAPI document; there is no
machine-readable API description yet (`ApiJsonSchema` covers one version's render `values`, not the endpoints).

## Rules

- **No imports.** Lint (`eslint.config.mjs`) bans every import in `src/contracts/**/*.ts`. The simulator may not
  import `@/domain` or `@/server`, so anything this file pulled in would cross that boundary. A self-contained file
  can also be lifted out or turned into an API description without bringing app code along.
- Only what a consumer can see: `ApiVersionState` is `active | superseded | revoked`, and `ApiRenderRequest` has no
  `"draft"` version or `preview` flag (both CMS-only). Dates are ISO 8601 strings on the demo clock.
- A sunset is an instant. `sunsetAt` (on `ApiVersionSummary` and on a `sunset_scheduled` or `sunset_passed`
  notice) is when renders of that version start failing with 410 `version_sunset`: 00:00 on the sunset date in
  Stencil's business time zone, `America/New_York` unless a Platform Admin chose another, so "March 1, 2027" is
  `2027-03-01T05:00:00.000Z`. Compare it with the time; don't take its UTC date as the day, which is the day
  before for a zone ahead of UTC. A sunset notice also carries the day and the zone (`sunsetDay`, `zone`), and its
  `message` and the 410's message name that day. Changing the zone doesn't move a sunset already announced
  ([decision 0017](../../docs/decisions/0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)).

## Endpoints

| Endpoint | Shapes | Handler |
| --- | --- | --- |
| `GET /api/v1/templates?q=&limit=&after=` | `ApiTemplateSearch`, `ApiTemplateSummary`, `ApiPage` | [templates/route.ts](../app/api/v1/templates/route.ts) |
| `GET /api/v1/templates/{id}?version=&since=` | `ApiTemplateDetail`, `ApiVersionSummary`, `ApiContract`, `ApiVariable`, `ApiJsonSchema`, `ApiContractDiff`, `ApiContractChange` | [templates/[templateId]/route.ts](<../app/api/v1/templates/[templateId]/route.ts>) |
| `GET /api/v1/consumers/{consumerId}/notices?after=&templateId=&limit=` | `ApiNoticeList`, `ApiNotice`, `ApiNoticeKind`, `ApiPage` | [notices/route.ts](<../app/api/v1/consumers/[consumerId]/notices/route.ts>) |
| `POST /api/v1/templates/{id}/render` | `ApiRenderRequest`, `ApiEmailResponse`, `ApiBase64Response` (a raw PDF or HTML answer has no type) | [render/route.ts](<../app/api/v1/templates/[templateId]/render/route.ts>) |

Every request carries `X-Consumer-Id` (a registered consumer); only the render route waives it, for the CMS's own
previews.

## Notices

`GET /api/v1/consumers/{consumerId}/notices` is Stencil's outbox for one consumer. Each `ApiNotice` is about one
version (`versionNumber`, and `template.name` is that version's name) and names the Active version to move to
(`activeVersion`, null when none is Active). There are four kinds:

| Kind | Written when | Also carries |
| --- | --- | --- |
| `new_version` | A version goes Active. | `changes` from the previous Active version. |
| `sunset_scheduled` | A sunset is set or moved, on the Versions tab or in the Approve dialog. | `sunsetAt`, `sunsetDay`, `zone`; `changes` moving to the Active version asks. |
| `sunset_passed` | Stencil's sunset sweep finds the sunset passed. | `sunsetAt`, `sunsetDay`, `zone`. |
| `revoked` | A revoke is confirmed. | `reason`. |

A notice goes to every consumer that rendered the template (not as a preview) from 90 days before the event on;
for `sunset_passed` the event is the sunset. Each version gets one `sunset_passed` notice per consumer, ever.

A `sunset_passed` notice can arrive after the sunset. The sweep runs on Stencil's demo triggers (Advance clock, a
persona switch, an access action) until a scheduled job runs it, so its `createdAt` is when the sweep wrote it,
which can be days after the instant. Its `sunsetAt` is the instant renders stopped, and renders fail from then on
whether or not the notice has arrived ([decision 0032](../../docs/decisions/0032-consumers-are-told-when-a-sunset-passes.md)).

A contract change (`ApiContractChange`, in a template's `since` diff and in a `new_version` or `sunset_scheduled`
notice) is a union on `kind`. `key_renamed`, `type_changed` and `label_changed` carry `from` and `to`; every kind
carries `key` (the later version's, the earlier one's for `removed`), `breaking` and the sentence `text`. A variable
whose key was renamed is one `key_renamed`, so a consumer can move its value from `from` to `to` instead of reading
a removal and a new required variable
([decision 0022](../../docs/decisions/0022-a-variable-keeps-its-identity-across-renames.md)).

A render body is at most 1,000,000 bytes (`MAX_BODY_BYTES`), else 413 `body_too_large`; the route counts the bytes as
it reads, so a chunked body is held to the limit too. Each value is at most 1,000 characters, counted in Unicode code
points (`MAX_VALUE_LENGTH`), else 422 `invalid_values` with `maxLength` on that key's `details.invalid` entry. A value
is never cut, because it prints exactly as sent. The published JSON Schema gives every property the same
`maxLength`. Both limits are in `src/domain/render/types.ts`, and why the value limit is 1,000 is
[decision 0011](../../docs/decisions/0011-cap-each-render-value.md).

The two lists page the same way (`ApiPage`): a call returns `nextCursor` and `hasMore`, and the next call passes
the cursor back as `after`. Notices come oldest first in the order Stencil wrote them, so a consumer that keeps the
last `nextCursor` gets every notice once, however many arrive between polls. A cursor is opaque to consumers and
belongs to its list; anything else, or a notices cursor from before a demo reset, is 400 `bad_request`. Search
compares names and ids by code point, not by locale. The cursor format, and why notices page on
`consumer_notices.seq` rather than on time, are in
[decision 0006](../../docs/decisions/0006-page-notices-by-commit-order.md); the code is
`src/domain/golive/cursor.ts`. The shared response headers (`Cache-Control: no-store`, `X-Correlation-Id`, `nosniff`), the error response
and the demo-clock `Date` header come from [server/api/http.ts](../server/api/http.ts). The GET handlers read through
`src/server/queries/consumer-api.ts` and the pure builders in `src/domain/golive/`.

## Errors

Every error is `ApiErrorBody`, `{ error: { code, message, details? } }`; `message` is one plain sentence shown to
people as is. Each code's status is `API_ERROR_STATUS` in [golive-types.ts](../domain/golive-types.ts), applied by
`errorResponse` in `http.ts`. It is a `Record<ApiErrorCode, number>`, so a new code won't compile without a status.

| Status | Codes |
| --- | --- |
| 400 | `bad_request`, `consumer_required` |
| 403 | `unknown_consumer`, `preview_forbidden`, `consumer_mismatch` |
| 404 | `template_not_found`, `version_not_found`, `consumer_not_found` |
| 409 | `version_not_released` |
| 410 | `version_sunset`, `version_revoked` |
| 413 | `body_too_large` |
| 422 | `channel_not_allowed`, `channel_not_enabled`, `missing_variables`, `invalid_values` |
| 500 | `render_failed` |

`consumer_not_found` and `consumer_mismatch` belong to the notices route. The other 15 are the render codes
(`RenderErrorCode` in `src/domain/render/types.ts`), which the GET routes reuse. That file's `RENDER_ERROR_STATUS`
repeats their statuses and is read only by `src/domain/render/errors.test.ts`; take statuses from `API_ERROR_STATUS`.

## The three type files and the drift checks

- `src/contracts/api-v1.ts`: the wire shapes, shared by both sides.
- [src/domain/golive-types.ts](../domain/golive-types.ts): Stencil's side. It re-exports every contract type
  (`export type * from "@/contracts/api-v1"`); Stencil code imports `Api*` types from there, not from `@/contracts`.
- [src/simulator/types.ts](../simulator/types.ts): Coral's read models, built on the `Api*` types it imports directly.

`_DriftChecks` in `golive-types.ts` is a tuple of `Assert<Fits<A, B>>` types (`Fits`: A is assignable to B), so `tsc`
fails when the domain's types stop fitting the wire shapes: `RenderErrorCode` into `ApiErrorCode`, `RenderErrorBody`
into `ApiErrorBody`, `EmailResponseBody` into `ApiEmailResponse`, `Base64ResponseBody` into `ApiBase64Response`,
`VariableType` and `ApiVariableType` both ways, `ConsumerNoticeKind` into `ApiNotice["kind"]`, and the contract
change kinds (`ContractChange["kind"]` and `ApiContractChange["kind"]`) both ways. `ApiChannel`,
`ApiVersionState` and `ApiRenderRequest` have no explicit check. Only `npm run typecheck` and `next build` run them.

To change the contract: edit `api-v1.ts`, then the Stencil side that builds the shape (`consumer-api.ts`,
`src/domain/golive/`, or `src/domain/render/types.ts` for the render route), run `npm run typecheck`, then update
the simulator's client in `src/simulator/ucomp-api.ts`.

## Testing

Handler tests sit beside each route (`src/app/api/v1/templates/route.test.ts` and siblings); `e2e/api/consumer.spec.ts`
and `e2e/api/render.spec.ts` call the routes as a consumer; `src/simulator/ucomp-api.test.ts` covers the client side.
