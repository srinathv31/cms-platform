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

## Endpoints

| Endpoint | Shapes | Handler |
| --- | --- | --- |
| `GET /api/v1/templates?q=&limit=&after=` | `ApiTemplateSearch`, `ApiTemplateSummary`, `ApiPage` | [templates/route.ts](../app/api/v1/templates/route.ts) |
| `GET /api/v1/templates/{id}?version=&since=` | `ApiTemplateDetail`, `ApiVersionSummary`, `ApiContract`, `ApiVariable`, `ApiJsonSchema`, `ApiContractDiff`, `ApiContractChange` | [templates/[templateId]/route.ts](<../app/api/v1/templates/[templateId]/route.ts>) |
| `GET /api/v1/consumers/{consumerId}/notices?after=&templateId=&limit=` | `ApiNoticeList`, `ApiNotice`, `ApiNoticeKind`, `ApiPage` | [notices/route.ts](<../app/api/v1/consumers/[consumerId]/notices/route.ts>) |
| `POST /api/v1/templates/{id}/render` | `ApiRenderRequest`, `ApiEmailResponse`, `ApiBase64Response` (a raw PDF or HTML answer has no type) | [render/route.ts](<../app/api/v1/templates/[templateId]/render/route.ts>) |

Every request carries `X-Consumer-Id` (a registered consumer); only the render route waives it, for the CMS's own
previews.

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
| 422 | `channel_not_allowed`, `channel_not_enabled`, `missing_variables`, `invalid_values` |
| 500 | `render_failed` |

`consumer_not_found` and `consumer_mismatch` belong to the notices route. The other 14 are the render codes
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
`VariableType` and `ApiVariableType` both ways, and `ConsumerNoticeKind` into `ApiNotice["kind"]`. `ApiChannel`,
`ApiVersionState` and `ApiRenderRequest` have no explicit check. Only `npm run typecheck` and `next build` run them.

To change the contract: edit `api-v1.ts`, then the Stencil side that builds the shape (`consumer-api.ts`,
`src/domain/golive/`, or `src/domain/render/types.ts` for the render route), run `npm run typecheck`, then update
the simulator's client in `src/simulator/ucomp-api.ts`.

## Testing

Handler tests sit beside each route (`src/app/api/v1/templates/route.test.ts` and siblings); `e2e/api/consumer.spec.ts`
and `e2e/api/render.spec.ts` call the routes as a consumer; `src/simulator/ucomp-api.test.ts` covers the client side.
