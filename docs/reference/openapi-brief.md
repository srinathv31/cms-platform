# Brief for the `/api/v1` OpenAPI specification

`/api/v1` is Stencil's public API. Consumer systems (online banking, a statement run, an alerts service) search the
templates, read a template's variable contract, poll for notices about its versions, and render a released version as
a PDF, a web page, an email, a push notification or an SMS. The Java API will serve it, and the Java team writes its
OpenAPI 3.1 document, because the Java API's shape is theirs. This page is what they write it from: every endpoint and
field, the rules behind them, and the owner's decisions on how the contract changes.

It is written for a Java developer who has never opened this repository, and for their AI agents. Each rule names the
code it was read from and the decision record behind it, so it can be checked.

## How to read this page

- **It describes the contract as decided.** Where the Node prototype still does something else, a line starting
  **Node today** says what it does, and what changes it: a change in the pre-handoff work (the plan is `to-do.md`),
  the port to Java, or a choice left to the handoff package.
- **A decision record wins** over this page and over the code. The records are in
  [docs/decisions](../decisions/README.md) and are linked where they apply. Where a record leaves something open,
  [section 15](#15-open-for-the-handoff) lists it instead of guessing.
- _Suggestion_ marks a name or an OpenAPI construct this brief proposes. The Java team decides.
- The wire shapes' TypeScript source is `src/contracts/api-v1.ts`, explained by
  [src/contracts/README.md](../../src/contracts/README.md). The render rules are in
  [docs/render-spec.md](../render-spec.md), which is normative.
- Stencil is the product. UCOMP is its former name, still in some code comments, and the name of the existing Spring
  Boot API ("the UCOMP API") whose error format `/api/v1` adopts.

## 1. The API at a glance

| Operation (_suggestion_) | Method and path                              | App role (section 3)   | What it does                                                                                     |
| ------------------------ | -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `searchTemplates`        | `GET /api/v1/templates`                      | open (section 15)      | Search the templates that have an Active version, a page at a time.                              |
| `getTemplate`            | `GET /api/v1/templates/{templateId}`         | open (section 15)      | A template's released versions, one version's variable contract, and what changed since another. |
| `listNotices`            | `GET /api/v1/consumers/{consumerId}/notices` | `Stencil.Notices.Read` | The caller's outbox: new versions, sunsets scheduled and passed, revokes, oldest first.          |
| `renderTemplate`         | `POST /api/v1/templates/{templateId}/render` | `Stencil.Render`       | Render a released version to one channel with the caller's values.                               |

Conventions on every operation:

- **Callers are systems, not people.** `/api/v1` reads no session and no cookie, serves only released versions, and
  is never called by Stencil's own screens
  ([0047](../decisions/0047-stencils-preview-is-its-own-route-and-api-v1-serves-consumers-only.md)). There is no CORS.
- **JSON** is UTF-8, `application/json`, with camelCase field names.
- **Instants** are ISO 8601 in UTC with milliseconds and `Z`: `2027-03-01T05:00:00.000Z` (JavaScript's
  `toISOString()`; stored as UTC `DATETIME2(3)`,
  [0063](../decisions/0063-instants-are-utc-datetime2-ordered-by-at-and-seq.md)). **Days** are `YYYY-MM-DD`. **Zones**
  are IANA ids (`America/New_York`).
- **Version numbers** are integers from 1. A consumer never sees a draft, a version in review, or a review round.
- **Nullable fields are always present**, as `null` when empty. The few fields that can be absent are marked
  "absent" in [section 6](#6-schemas). In OpenAPI 3.1 a nullable string is `type: [string, "null"]`, listed in
  `required`.
- **Closed enums** are closed: a new channel or notice kind is a contract change. `contentType.key` is open-ended.
- **Every response**, success or error, carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and
  `X-Correlation-Id` ([section 3.2](#32-headers)).

What isn't `/api/v1`: the Next.js app's own routes (`/api/templates/*` including the CMS preview, `/api/drafts`,
`/api/imports`, `/api/palette`, the audit export) stay in the app, which becomes the BFF and calls the Java service
behind them.

## 2. What differs from the Node code today

| Area                                  | Node today                                                                                                    | Decided                                                                                  | Changed by                                                                          | Record                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a consumer proves who it is       | An `X-Consumer-Id: coral` header, with no credential                                                          | OAuth 2.0 client credentials with Entra ID; 401 and 403 as in section 3                  | The Java API, at the port                                                           | [0057](../decisions/0057-consumers-authenticate-with-client-credentials.md)                                                                             |
| Error body                            | `{ "error": { "code", "message", "details"? } }`                                                              | The UCOMP API's error format, carrying a stable code and that code's details             | The Java API at the port; the CMS preview route in the same change                  | [0056](../decisions/0056-api-v1-errors-follow-the-ucomp-api-error-format.md)                                                                            |
| An unexpected failure on a GET route  | Next.js's default HTML 500 ([A4](../handoff-review.md#a4--medium-get-apiv1-routes-can-return-a-non-json-500)) | The error format, with a code and the correlation id                                     | The Java API                                                                        | A4                                                                                                                                                      |
| The HTTP `Date` header                | The demo clock (`withDemoDate` in `src/server/services/local/consumer-api.ts`)                                | Real time; a demo clock, if one survives, in a header of its own                         | The Java API from the start; Node when the demo clock goes                          | [A7](../handoff-review.md#a7--medium-the-http-date-header-carries-the-demo-clock)                                                                       |
| The clock behind `asOf` and the rules | The demo clock (real time plus an offset the demo moves)                                                      | The server's clock, with a test-only offset in demo and test environments                | The Java API                                                                        | [0068](../decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)                                                                    |
| Search                                | Loads every Active version and ranks in memory                                                                | Filters, ranks and pages in SQL, with the same matches and order                         | The Java API                                                                        | [0059](../decisions/0059-template-search-ranks-and-pages-in-sql.md)                                                                                     |
| `team.id`                             | An opaque id (`t_coral`), never the slug: done in the backend seam work                                       | An opaque id, never equal to a slug                                                      | Node, in the backend seam work (to-do item 3)                                       | [0053](../decisions/0053-team-ids-are-opaque-and-slugs-resolve-at-the-url.md)                                                                           |
| `templateId`                          | `UC-` and six characters, described by its format in code comments                                            | An opaque string with a maximum length and examples, no pattern                          | The spec                                                                            | [0060](../decisions/0060-template-ids-are-random-and-retried-on-a-collision.md)                                                                         |
| Which check runs first on a render    | The body, then the consumer header, then the template and version, then whether the consumer is registered    | _Proposed:_ authentication and the consumer first, before the body is read (section 4.4) | The gateway and Spring Security                                                     | None: 0057 fixes the statuses, not an order (section 15)                                                                                                |
| Rate limits                           | None                                                                                                          | Per client id, at the gateway                                                            | The gateway                                                                         | 0057                                                                                                                                                    |
| Stored notice payloads                | Facts only, one shape per kind: done in the backend seam work and the seed work (section 12)                  | Facts only, one shape per kind. Nothing a consumer receives changes                      | Done in Node (the backend seam work, `contractLines`; the seed work, the spellings) | [0055](../decisions/0055-notifications-store-facts-and-are-worded-on-read.md), [0064](../decisions/0064-payloads-are-facts-with-one-shape-per-event.md) |
| Rendering                             | The Node engine                                                                                               | A Java engine, held to the render spec and the golden files                              | The Java API, at the port                                                           | [0067](../decisions/0067-java-renders-every-channel.md)                                                                                                 |

## 3. Security

Decision [0057](../decisions/0057-consumers-authenticate-with-client-credentials.md).

### 3.1 Authentication and authorization

- **OAuth 2.0 client credentials with Entra ID.** Each consumer system has its own app registration and calls with an
  access token issued to it (no person): `Authorization: Bearer <token>`. The gateway validates the token, and Spring
  Security validates it again.
- **The token names the consumer.** Its client id (`azp` in v2.0 tokens, `appid` in v1.0) is looked up in
  `consumers.entra_app_id`, unique, which replaces today's `client_name`. That row's `id` (`coral`) is the consumer id
  the API uses in paths, cursors and notices.
- **App roles** scope what a consumer may do, in the token's `roles` claim: `Stencil.Render` and
  `Stencil.Notices.Read` (the names are 0057's; this brief reads them as guarding the render and the notices route).
  Which role the two template reads need isn't decided ([section 15](#15-open-for-the-handoff)).
- **Statuses.** No token, or a bad one (expired, wrong audience, bad signature): **401**. A valid token whose client
  isn't a registered consumer: **403** `unknown_consumer`. _Proposed (0057 doesn't say):_ a registered consumer without
  the operation's role: **403**, code to be named. A notices path naming any consumer but the caller: **403** `consumer_mismatch`, whether or not that
  id exists, so no answer says which consumers exist. _Suggestion:_ send `WWW-Authenticate: Bearer` on the 401
  (RFC 6750).
- **401 and 403 use the error format** of [section 4](#4-errors) even when the gateway or Spring Security answers
  before a controller runs. _Suggestion:_ an `AuthenticationEntryPoint` and an `AccessDeniedHandler` that write it.
- **Rate limits per client id, at the gateway.** _Suggestion:_ 429 with `Retry-After`, in the error format.
- **No `render_log` row until the caller is authenticated and registered.** The gateway's logs keep the trail of
  failed attempts.
- The path `/api/v1/consumers/{consumerId}/notices` keeps its `{consumerId}`.

_Suggestion_ for the security scheme:

```yaml
components:
  securitySchemes:
    entra:
      type: oauth2
      description: >
        Entra ID client credentials. Request the scope "<Stencil API application ID URI>/.default"; the app roles
        Stencil.Render and Stencil.Notices.Read arrive in the token's roles claim.
      flows:
        clientCredentials:
          tokenUrl: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
          scopes: {}
security:
  - entra: []
```

**Node today:** a consumer names itself in `X-Consumer-Id` and proves nothing (`requireConsumer` in
`src/server/services/local/consumer-api.ts`). No header is 400 `consumer_required`; an id that isn't in `consumers` is 403
`unknown_consumer`; a notices path that isn't the header's id is 403 `consumer_mismatch`. Two leaks are already
stopped: an unregistered caller writes no `render_log` row, and the notices route no longer has a
`consumer_not_found` code that told callers which ids exist. Consumers come from the seed. Coral, the simulated consumer in this repo,
will call Java with a dev token, or with the header on a demo-only path behind `DEMO_MODE`; that is decided when Coral
is pointed at Java.

### 3.2 Headers

| Header                            | Direction                          | Rule                                                                                                                                                                                              |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization`                   | request                            | `Bearer <token>` (section 3.1). Replaces `X-Consumer-Id`.                                                                                                                                         |
| `X-Correlation-Id`                | request, optional                  | Echoed back when it is 1 to 128 visible ASCII characters (`0x21` to `0x7E`) after trimming; otherwise the server makes one, `req_` and 12 characters. The render route's failure log names it.    |
| `X-Correlation-Id`                | every response                     | The request's, or the one the server made.                                                                                                                                                        |
| `Cache-Control: no-store`         | every response                     | No response is cached.                                                                                                                                                                            |
| `X-Content-Type-Options: nosniff` | every response                     | Always.                                                                                                                                                                                           |
| `Date`                            | every response                     | Real time ([section 8](#8-time-days-and-sunsets)).                                                                                                                                                |
| `X-Stencil-Template-Id`           | render 200                         | The template id from the path.                                                                                                                                                                    |
| `X-Stencil-Version`               | render 200                         | The rendered version's number.                                                                                                                                                                    |
| `X-Stencil-Newer-Version`         | render 200                         | The Active version's number, only when the rendered version is Superseded and a version is Active.                                                                                                |
| `Content-Disposition`             | render 200, PDF without `encoding` | `inline; filename="UC-4F7K2Q-v2.pdf"`: the template id and version, with any character outside `[A-Za-z0-9_.-]` replaced by `_`.                                                                  |
| `Content-Security-Policy`         | render 200, web without `encoding` | `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'`: the document has no scripts and loads nothing, and stays that way if opened directly. |

The header names are `API_HEADERS` in `src/contracts/api-v1.ts`; the shared ones are set in `src/server/api/http.ts`,
the render ones in `src/server/api/render-http.ts`.

## 4. Errors

Decision [0056](../decisions/0056-api-v1-errors-follow-the-ucomp-api-error-format.md).

### 4.1 Requirements on the error format

`/api/v1` errors follow the existing UCOMP API's error format, so the bank's consumers meet one shape across its APIs.
That format, and the mapping of today's codes and details onto it, are written in the handoff package; they are
specific to the enterprise and aren't in this repository. Whatever the format is, it must:

1. **Carry a stable, machine-readable code**: today's snake_case codes ([section 4.2](#42-codes-and-statuses)), plus
   the new ones the port needs. Consumers branch on the code, never on the sentence
   ([0025](../decisions/0025-refusals-carry-stable-codes.md)).
2. **Carry that code's details**, with the fields of [section 4.3](#43-details-per-code) under the same names
   (`missing`, `invalid`, `version`, `sunsetDay`, and the rest).
3. **Give each code one status**, the one in the table below. _Suggestion:_ one Java enum with the status on each
   constant, as `API_ERROR_STATUS` in `src/domain/golive-types.ts` is a `Record<ApiErrorCode, number>` today.
4. **Keep a sentence for people**, if the format has a place for one. The render engine's sentences are part of the
   render spec ([section 11 of the spec](../render-spec.md#11-errors), and each golden case's `error.json`); the GET
   routes' sentences are informational and can be reworded. No sentence ever echoes a variable's value; the one
   exception is the PDF's unrenderable characters, named one by one.
5. **Answer every failure in the format**, an unexpected one included, with the correlation id
   ([A4](../handoff-review.md#a4--medium-get-apiv1-routes-can-return-a-non-json-500)).
6. **Move the CMS preview route with it** ([section 4.5](#45-the-cms-preview-route-moves-with-it)).

**Node today:** every error is `{ "error": { "code": "…", "message": "…", "details": { … } } }`, `details` absent when
a code has none (`errorResponse` in `src/server/api/http.ts`):

```json
{
  "error": {
    "code": "version_sunset",
    "message": "Version 1 was sunset on March 1, 2027. Version 2 is active.",
    "details": {
      "version": 1,
      "activeVersion": 2,
      "at": "2027-03-01T05:00:00.000Z",
      "sunsetDay": "2027-03-01",
      "zone": "America/New_York"
    }
  }
}
```

### 4.2 Codes and statuses

`API_ERROR_STATUS` in `src/domain/golive-types.ts` is the table. The render route's codes and sentences are built in
`src/domain/render/errors.ts`, the GET routes' own in `src/domain/golive/api-errors.ts`.

| Status | Code                     | Returned by           | When                                                                                                                                                                  |
| ------ | ------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `bad_request`            | all four              | A parameter or the body doesn't fit (each route's sentences are in section 5).                                                                                        |
| 400    | `consumer_required`      | Node only             | No `X-Consumer-Id`. Retires with the header: its case becomes the 401.                                                                                                |
| 401    | new, name open           | all four (Java)       | No token or a bad one. _Suggestion:_ `unauthenticated`.                                                                                                               |
| 403    | `unknown_consumer`       | all four              | The caller isn't a registered consumer.                                                                                                                               |
| 403    | new, name open           | all four (Java)       | _Proposed (0057 doesn't say):_ a registered consumer without the operation's app role. _Suggestion:_ `role_required`.                                                 |
| 403    | `consumer_mismatch`      | notices               | The path names a consumer other than the caller.                                                                                                                      |
| 403    | `preview_forbidden`      | never `/api/v1`       | The CMS preview route's: the viewer may not see that version. In `ApiErrorCode` only so the code lists match.                                                         |
| 404    | `template_not_found`     | template, render      | No template with that id; for the template read, also a template with no released version.                                                                            |
| 404    | `version_not_found`      | template, render      | The template has no version with that number.                                                                                                                         |
| 409    | `version_not_released`   | template, render      | The number exists but isn't released: in review, or sent back for changes. A draft has no number yet, so a number only a draft would take is 404 `version_not_found`. |
| 410    | `version_sunset`         | render                | A Superseded version whose sunset has passed.                                                                                                                         |
| 410    | `version_revoked`        | render                | A revoked version.                                                                                                                                                    |
| 413    | `body_too_large`         | render                | The body is over 1,000,000 bytes.                                                                                                                                     |
| 422    | `channel_not_allowed`    | render                | The template's content type doesn't allow the channel (any more).                                                                                                     |
| 422    | `channel_not_enabled`    | render                | The version doesn't have the channel turned on.                                                                                                                       |
| 422    | `missing_variables`      | render                | A required variable has no value (and any invalid values are reported with it).                                                                                       |
| 422    | `invalid_values`         | render                | A value doesn't fit its type, is over 1,000 characters, or isn't a JSON string.                                                                                       |
| 422    | `push_payload_too_large` | render                | The push, with these values, is over 4,096 bytes on its platform.                                                                                                     |
| 422    | `sms_too_long`           | render                | The SMS, with these values, is over 10 parts.                                                                                                                         |
| 429    | new, name open           | all four (gateway)    | Over the client's rate limit.                                                                                                                                         |
| 500    | `render_failed`          | render                | The render couldn't be produced (section 4.3 says when the caller can act on it).                                                                                     |
| 500    | new, name open           | the GET routes (Java) | An unexpected failure. Node has no code for it today (A4). _Suggestion:_ `internal_error`.                                                                            |

`consumer_not_found` is gone: the notices route answers `consumer_mismatch` for every path but the caller's.

### 4.3 Details per code

This resolves `ApiError.details`, which the TypeScript declares as a union ending in `Record<string, unknown>`: the
`channel_not_allowed`, `channel_not_enabled` and `render_failed` shapes below reach it only through that catch-all. Model `details` per code.

| Code                                  | `details`                                                                                                                                                                                                                                                       | Example                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `missing_variables`, `invalid_values` | `missing`: keys (string array); `invalid`: `{ key, expected, maxLength? }` array. Both always present, in the version's variable order. `expected` is the variable's type; `maxLength` (1000) only for a value over the length limit.                           | `{"missing":["first_name"],"invalid":[{"key":"purchase_apr","expected":"percent"}]}` |
| `version_not_released`                | `version` (integer); `activeVersion` (integer or null).                                                                                                                                                                                                         | `{"version":3,"activeVersion":2}`                                                    |
| `version_sunset`                      | `version`; `activeVersion`; `at` (the sunset instant); `sunsetDay`; `zone` (section 8).                                                                                                                                                                         | as in section 4.1                                                                    |
| `version_revoked`                     | `version`; `activeVersion`; `at` (the instant the revoke was confirmed). Stencil always records it, so `at` is always there.                                                                                                                                    | `{"version":1,"activeVersion":2,"at":"2026-09-14T15:20:00.000Z"}`                    |
| `channel_not_allowed`                 | `channel` (the one asked for).                                                                                                                                                                                                                                  | `{"channel":"push"}`                                                                 |
| `channel_not_enabled`                 | `channel`; `channels` (the version's channels, in the order pdf, web, email, push, sms).                                                                                                                                                                        | `{"channel":"email","channels":["pdf","web"]}`                                       |
| `push_payload_too_large`              | `platform` (`ios` or `android`); `payloadBytes`; `maxBytes` (4096).                                                                                                                                                                                             | `{"platform":"ios","payloadBytes":4321,"maxBytes":4096}`                             |
| `sms_too_long`                        | `parts`; `maxParts` (10); `encoding` (`GSM-7` or `UCS-2`); `characters`.                                                                                                                                                                                        | `{"parts":11,"maxParts":10,"encoding":"UCS-2","characters":700}`                     |
| `render_failed`                       | `{ reason: "document" }` when the stored document or a channel field fails the document check, or the resolver refuses the document; `{ reason: "glyphs", characters: ["U+1EA1", …] }` when the PDF's font can't draw characters; absent for any other failure. | `{"reason":"glyphs","characters":["U+1EA1"]}`                                        |
| every other code                      | none                                                                                                                                                                                                                                                            |                                                                                      |

When values are both missing and invalid, the code is `missing_variables`, the details carry both lists, and the
sentence is the missing sentence followed by the invalid ones. _Suggestion:_ in OpenAPI, one schema per details shape,
and the error as a `oneOf` discriminated on `code` with a `mapping` from each code to its variant.

### 4.4 Which check runs first

When several errors apply, the first check that fails answers. Today's order, per route:

- **Search:** the consumer; `limit`; `after`.
- **Template:** the consumer; `version`'s format; `since`'s format; `since` lower than `version` when both are given;
  the template (404, also when it has no released version); `version` (404, 409); `since` lower than the version read;
  `since` (404, 409).
- **Notices:** the consumer; the path's consumer is the caller (403); `after`; `limit`.
- **Render** (the pipeline, [render spec section 1](../render-spec.md#1-pipeline)): the body's size (413); the body's
  shape (400); `version: "draft"` (400); the channel, platform and encoding together (400); `X-Consumer-Id` present
  (400); the template (404); the version (404); the consumer registered (403); the version rules (409, 410); the
  channel (422); the values (422); the document check, resolving and the channel adapter (500), where a push or an SMS
  over its limit is 422. Anything that fails outside the engine (the database, the log write) is 500 `render_failed`
  with "… Try again.".

**Proposed for Java** (0057 fixes the statuses, not an order; section 15 lists it as open): authentication, the
registered consumer and the app role come first on every route, before the body is read, and the rest keeps today's
order. The GET routes already check the consumer before anything else (403 `unknown_consumer`), so for them only the token
and the role are new. On the render route an unregistered caller asking for a template that doesn't exist gets 403
`unknown_consumer`, where Node answers 404 today, and the body of a caller that fails these checks is never read.

### 4.5 The CMS preview route moves with it

Stencil's own preview, `POST /api/templates/{templateId}/preview`, is a route of the Next.js app, not of `/api/v1`
([0047](../decisions/0047-stencils-preview-is-its-own-route-and-api-v1-serves-consumers-only.md)). It answers with
the same bodies and the same error body as the render route today, and the approver's output gate reads its
`render_failed` details. After the port it calls Java's render endpoint with the viewer's identity
([0067](../decisions/0067-java-renders-every-channel.md)), and its error body changes to the UCOMP format in the same
change as `/api/v1`'s, together with its readers (`src/components/preview/render-preview.ts`) and Coral's client
(`src/simulator/ucomp-api.ts`). Java's preview endpoint is internal and outside this spec: it takes `version` as
`"draft"` or a number, an optional `round`, and the viewer, renders any state, and refuses with 403
`preview_forbidden`. The app's other routes keep their `{ ok: false, code, reason }` shape
([0041](../decisions/0041-routes-refuse-in-the-actions-shape.md)).

## 5. Endpoints

Every operation also answers the 401, 403 and 429 of [section 3](#3-security), and an unexpected 500.

### 5.1 Search templates

`GET /api/v1/templates?q=&limit=&after=` answers `ApiTemplateSearch`. Code: `src/app/api/v1/templates/route.ts` and
`searchActiveTemplates` in `src/server/services/local/consumer-api.ts`.

| Parameter | In    | Type             | Required | Meaning                                                                                                                                             | Example                         |
| --------- | ----- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `q`       | query | string           | no       | Search text, trimmed. Absent or blank lists every template with an Active version. Matching and order: [section 10](#10-search-matching-and-order). | `travel`, `UC-4F7K2Q`, `4f7k2q` |
| `limit`   | query | integer, 1 to 50 | no       | Results per page. Absent or blank: 20. Anything but a whole number in range is 400 (grammar below).                                                 | `20`                            |
| `after`   | query | string           | no       | The `nextCursor` of an earlier page of the same search ([section 9](#9-paging-and-cursors)).                                                        |                                 |

**Parameter grammar.** Every query parameter is trimmed (JavaScript's whitespace set, [render spec section
5](../render-spec.md#5-values)), and a blank one is absent. `limit` is then ASCII digits only (`^[0-9]+$`) and a safe
integer in range: a leading zero is accepted (`007` is 7), and a sign, a decimal point or an exponent is 400.
When a parameter is repeated, Node reads the first.

Only templates with an Active version are listed: a consumer can't start using anything else. A template whose
versions are all Superseded or Revoked isn't listed, but can still be read by id (section 5.2).

Errors: 400 `bad_request` "limit must be a number from 1 to 50." or "after must be the nextCursor of an earlier page
of this list.".

```json
{
  "query": "travel",
  "asOf": "2026-10-04T12:00:00.000Z",
  "results": [
    {
      "id": "UC-4F7K2Q",
      "name": "Spring Travel Rewards — Terms",
      "team": { "id": "t_coral", "name": "Coral Offers" },
      "contentType": { "key": "disclosure", "name": "Disclosure" },
      "activeVersion": 3,
      "activatedAt": "2026-09-20T14:05:00.000Z",
      "channels": ["pdf", "web", "email"],
      "variableCount": 3,
      "requiredCount": 3
    }
  ],
  "nextCursor": "eyJ2IjoxLCJsaXN0Ijoic2VhcmNoIiwicSI6InRyYXZlbCIsImxhc3QiOnsicmFuayI6MiwibmFtZSI6IlNwcmluZyBUcmF2ZWwgUmV3YXJkcyDigJQgVGVybXMiLCJpZCI6IlVDLTRGN0syUSJ9fQ",
  "hasMore": false
}
```

### 5.2 Get a template

`GET /api/v1/templates/{templateId}?version=&since=` answers `ApiTemplateDetail`. Code:
[the route](../../src/app/api/v1/templates/[templateId]/route.ts) and `getTemplateDetail` in
`src/server/services/local/consumer-api.ts`.

| Parameter    | In    | Type           | Required | Meaning                                                                                                                                                                                        | Example     |
| ------------ | ----- | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `templateId` | path  | string         | yes      | The template id, opaque ([section 7](#7-identifiers)).                                                                                                                                         | `UC-4F7K2Q` |
| `version`    | query | integer from 1 | no       | The version whose contract to return. Absent: the Active version. Any released version may be named, Superseded and Revoked included, so a consumer pinned to one can still read its contract. | `2`         |
| `since`      | query | integer from 1 | no       | A lower released version. Adds `changes`: what changed in the contract from `since` to the contract's version.                                                                                 | `1`         |

`version` and `since`, after trimming (blank is absent), are ASCII digits with no leading zero (`^[1-9][0-9]*$`) and a
safe integer: `0`, `007`, `+2`, `2.0`, `1e1` and a number past 2^53 are 400 `bad_request`. Repeated parameters read as in
[section 5.1](#51-search-templates).

- **A template with no released version doesn't exist** for a consumer: 404 `template_not_found`, the same answer as
  for an unknown id.
- `versions` lists the released versions (Active, Superseded, Revoked), newest first.
- `contract` is the contract of `version`, or of the Active version; null when nothing is Active and `version` is
  absent. `activeVersion` is null when nothing is Active: the Active version was revoked and nothing replaced it.
- `changes` is present only when `since` is given and there is a contract. With no contract, `since` is checked for
  its format only.
- This is how a consumer pinned on v2 learns what moving to the Active version asks: `?since=2`.

Errors: 400 `bad_request` "version must be a version number.", "since must be a version number." or "since must be
lower than version." (also when `version` is absent and `since` isn't lower than the Active version); 404
`template_not_found`; 404 `version_not_found` (for `version` or `since`); 409 `version_not_released` (for `version`
or `since`).

```json
{
  "id": "UC-4F7K2Q",
  "name": "Spring Travel Rewards — Terms",
  "team": { "id": "t_coral", "name": "Coral Offers" },
  "contentType": { "key": "disclosure", "name": "Disclosure" },
  "asOf": "2026-10-04T12:00:00.000Z",
  "activeVersion": 3,
  "versions": [
    {
      "number": 3,
      "state": "active",
      "activatedAt": "2026-09-20T14:05:00.000Z",
      "supersededAt": null,
      "sunsetAt": null,
      "sunsetDay": null,
      "zone": null,
      "sunsetPassed": false,
      "revokedAt": null,
      "renders": true,
      "channels": ["pdf", "web", "email"]
    },
    {
      "number": 2,
      "state": "superseded",
      "activatedAt": "2026-05-02T13:30:00.000Z",
      "supersededAt": "2026-09-20T14:05:00.000Z",
      "sunsetAt": "2027-03-01T05:00:00.000Z",
      "sunsetDay": "2027-03-01",
      "zone": "America/New_York",
      "sunsetPassed": false,
      "revokedAt": null,
      "renders": true,
      "channels": ["pdf", "web"]
    }
  ],
  "contract": {
    "version": 3,
    "state": "active",
    "channels": ["pdf", "web", "email"],
    "variables": [
      {
        "key": "given_name",
        "label": "First name",
        "type": "text",
        "required": true,
        "example": "Maya"
      },
      {
        "key": "purchase_apr",
        "label": "Purchase APR",
        "type": "percent",
        "required": true,
        "example": "21.99"
      },
      {
        "key": "annual_fee",
        "label": "Annual fee",
        "type": "currency",
        "required": true,
        "example": "95"
      }
    ],
    "jsonSchema": {}
  },
  "changes": {
    "since": 2,
    "to": 3,
    "breaking": true,
    "items": [
      {
        "kind": "key_renamed",
        "key": "given_name",
        "breaking": true,
        "from": "first_name",
        "to": "given_name",
        "text": "v3 renames `first_name` to `given_name`."
      },
      {
        "kind": "added",
        "key": "annual_fee",
        "breaking": true,
        "text": "v3 adds required `annual_fee` (Currency)."
      }
    ],
    "newRequired": ["given_name", "annual_fee"]
  }
}
```

Here v2's contract was `first_name` and `purchase_apr`, both required, and v3 renamed one and added one. The
`jsonSchema` is left out; [section 6.6](#66-apicontract-apivariable-and-apijsonschema) shows one.

### 5.3 List a consumer's notices

`GET /api/v1/consumers/{consumerId}/notices?after=&templateId=&limit=` answers `ApiNoticeList`. Code:
[the route](../../src/app/api/v1/consumers/[consumerId]/notices/route.ts) and `listNotices` in
`src/server/services/local/consumer-api.ts`.

| Parameter    | In    | Type              | Required | Meaning                                                                                                      | Example     |
| ------------ | ----- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------ | ----------- |
| `consumerId` | path  | string            | yes      | The caller's own consumer id. Any other is 403 `consumer_mismatch`.                                          | `coral`     |
| `after`      | query | string            | no       | The `nextCursor` of an earlier page of this list. Absent or blank: from the consumer's oldest notice.        |             |
| `templateId` | query | string            | no       | One template's notices only. Trimmed; blank is absent. An id with no notices answers an empty page, not 404. | `UC-4F7K2Q` |
| `limit`      | query | integer, 1 to 200 | no       | Notices per page. Absent or blank: 50. Grammar as in section 5.1.                                            | `50`        |

Notices come oldest first, in the order Stencil wrote them ([section 9](#9-paging-and-cursors)). To poll, keep the
last `nextCursor` and call with it: every notice arrives once and in order, however many were written between polls.
To start without the history, page to the end once and keep that cursor. A cursor keeps to the `templateId` it was
made with. What each kind carries is [section 12](#12-notices).

Errors: 403 `consumer_mismatch` "X-Consumer-Id doesn't match consumer coral." (the sentence names the header, and
changes with it); 400 `bad_request` "after must be the nextCursor of an earlier page of this list.", "after is from
before the notices were reset. Start again without after." or "limit must be a number from 1 to 200.".

```json
{
  "consumerId": "coral",
  "asOf": "2026-10-04T12:00:00.000Z",
  "notices": [
    {
      "id": "cn_7k2m9q4x1p",
      "kind": "sunset_scheduled",
      "createdAt": "2026-10-04T12:00:00.000Z",
      "template": {
        "id": "UC-4F7K2Q",
        "name": "Spring Travel Rewards — Terms"
      },
      "versionNumber": 2,
      "activeVersion": 3,
      "sunsetAt": "2027-03-01T05:00:00.000Z",
      "sunsetDay": "2027-03-01",
      "zone": "America/New_York",
      "reason": null,
      "changes": [
        {
          "kind": "key_renamed",
          "key": "given_name",
          "breaking": true,
          "from": "first_name",
          "to": "given_name",
          "text": "v3 renames `first_name` to `given_name`."
        },
        {
          "kind": "added",
          "key": "annual_fee",
          "breaking": true,
          "text": "v3 adds required `annual_fee` (Currency)."
        }
      ],
      "message": "Spring Travel Rewards — Terms v2 stops rendering on March 1, 2027. Move to v3."
    }
  ],
  "nextCursor": "eyJ2IjoxLCJsaXN0Ijoibm90aWNlcyIsImNvbnN1bWVyIjoiY29yYWwiLCJ0ZW1wbGF0ZSI6bnVsbCwiZXBvY2giOiIyMDI2LTEwLTA4VDEyOjAwOjAwLjAwMFoiLCJzZXEiOjQyfQ",
  "hasMore": false
}
```

### 5.4 Render a version

`POST /api/v1/templates/{templateId}/render` with an `ApiRenderRequest` body. Code:
[the route](../../src/app/api/v1/templates/[templateId]/render/route.ts), `readRenderRequest` and
`renderSuccessResponse` in `src/server/api/render-http.ts`, and the pipeline in `src/server/services/local/render/render-template.ts`.

The body is JSON, at most 1,000,000 bytes: refused from a declared `Content-Length` before anything is read, and
otherwise as soon as the bytes read pass the limit (a chunked body has no length). Nothing past the limit is buffered.

**Node today:** the route never looks at `Content-Type`: any body that parses as JSON is read. Spring answers 415 to a
media type it doesn't map. Whether `application/json` is required, and the code a 415 carries, is open
([section 15](#15-open-for-the-handoff)).

| Field      | Type                                 | Required       | Meaning                                                                                                                                                         | Example                                        |
| ---------- | ------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `version`  | integer from 1                       | yes            | The released version to render. `"draft"` is 400 here: drafts are the CMS preview's.                                                                            | `2`                                            |
| `channel`  | `pdf`, `web`, `email`, `push`, `sms` | yes            | The channel. A document template renders to pdf, web and email; a message template (an Alert) to push and sms.                                                  | `"pdf"`                                        |
| `platform` | `ios`, `android`                     | with push only | Required with `push`, refused with any other channel.                                                                                                           | `"ios"`                                        |
| `values`   | object of string to string or `null` | yes            | A value per variable key ([section 11](#11-values-are-strings)); a `null` is no value, and a JSON number is refused. Keys the version doesn't have are ignored. | `{"given_name":"Maya","purchase_apr":"21.90"}` |
| `encoding` | `base64`                             | no             | PDF, web and email only: the answer as JSON with the output base64-encoded.                                                                                     | `"base64"`                                     |

Any other field (`preview`, `round`) is ignored.

What a 200 is, by channel:

| `channel` | `encoding` | `Content-Type`             | Body                                                                                     |
| --------- | ---------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `pdf`     | none       | `application/pdf`          | The PDF, with `Content-Disposition: inline; filename="UC-4F7K2Q-v2.pdf"`.                |
| `pdf`     | `base64`   | `application/json`         | `ApiBase64Response`, `contentType` `application/pdf`.                                    |
| `web`     | none       | `text/html; charset=utf-8` | A complete, responsive HTML document, with the `Content-Security-Policy` of section 3.2. |
| `web`     | `base64`   | `application/json`         | `ApiBase64Response`, `contentType` `text/html; charset=utf-8`.                           |
| `email`   | none       | `application/json`         | `ApiEmailResponse`.                                                                      |
| `email`   | `base64`   | `application/json`         | `ApiEmailResponse` with `html` and `text` base64-encoded and `encoding: "base64"`.       |
| `push`    | (none)     | `application/json`         | `ApiPushResponse`, for the platform asked for.                                           |
| `sms`     | (none)     | `application/json`         | `ApiSmsResponse`.                                                                        |

The media type follows the body's `channel` and `encoding`, not `Accept`, so OpenAPI can list the three media types
of the 200 but not say which applies; say it in the description. A raw PDF or web answer has no JSON body, so its
newer version is only in `X-Stencil-Newer-Version`.

Which versions render:

| The version is                                              | Answer                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Active                                                      | renders; `newerVersion` null                                                                 |
| Superseded, with no sunset or one still to come             | renders; `newerVersion` and `X-Stencil-Newer-Version` name the Active version (null if none) |
| Superseded, its sunset passed (`sunsetAt` at or before now) | 410 `version_sunset`                                                                         |
| Revoked                                                     | 410 `version_revoked`                                                                        |
| A number with no released round (in review, or sent back)   | 409 `version_not_released`                                                                   |

A draft has no number until it is submitted, so a number that only a draft would take is 404 `version_not_found`, not 409. A
version whose revoke was started but not yet confirmed by a second approver is still Active or Superseded, and
renders. The rules are `checkVersion` in `src/domain/render/version-rules.ts`.

Errors, in the order they are checked (section 4.4): 413 `body_too_large` "The body must be at most 1,000,000
bytes."; 400 `bad_request` with one of "The body must be JSON with version, channel and values.", "version must be a
version number.", "channel must be one of pdf, web, email, push, sms.", "platform must be ios or android.", "values
must be an object.", "encoding must be base64.", "platform is only for channel push." or "encoding is only for
channels pdf, web and email."; 404 `template_not_found`; 404 `version_not_found`; 409 `version_not_released`; 410
`version_sunset`; 410 `version_revoked`; 422 `channel_not_allowed`; 422 `channel_not_enabled`; 422
`missing_variables`; 422 `invalid_values`; 422 `push_payload_too_large`; 422 `sms_too_long`; 500 `render_failed`.
The engine's sentences are in [render spec section 11](../render-spec.md#11-errors).

Every request that reaches a registered consumer and a known version writes one `render_log` row, success or error:
the channel, a push's platform, the correlation id and the error code, never a value. A `render_failed` also goes to
the server log, without the error's message, which could quote a value.

## 6. Schemas

Every DTO, field by field. "Absent" means the field may be left out; every other field is always present.
`src/contracts/api-v1.ts` holds them as TypeScript.

### 6.1 ApiPage

The paging fields `ApiTemplateSearch` and `ApiNoticeList` share.

| Field        | Type    | Meaning                                                                                                              |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `nextCursor` | string  | Pass back as `after` to continue. Always present: on the last page, even an empty one, it marks the end of the list. |
| `hasMore`    | boolean | True when more items follow this page right now.                                                                     |

### 6.2 ApiTemplateSearch

`ApiPage` plus:

| Field     | Type                   | Meaning                                        | Example                      |
| --------- | ---------------------- | ---------------------------------------------- | ---------------------------- |
| `query`   | string                 | `q` as the search read it: trimmed, case kept. | `"travel"`                   |
| `asOf`    | instant                | When the answer was computed.                  | `"2026-10-04T12:00:00.000Z"` |
| `results` | `ApiTemplateSummary[]` | This page, in search order.                    |                              |

### 6.3 ApiTemplateSummary

Everything describes the template's Active version.

| Field           | Type            | Meaning                                                                                                                                                                                        | Example                                    |
| --------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `id`            | string          | The template id ([section 7](#7-identifiers)).                                                                                                                                                 | `"UC-4F7K2Q"`                              |
| `name`          | string          | The Active version's name. Each version keeps the name it was approved with, so a rename arrives with a new version ([0016](../decisions/0016-the-name-is-versioned.md)). 1 to 120 characters. | `"Spring Travel Rewards — Terms"`          |
| `team`          | `{ id, name }`  | The team that owns the template. `id` is opaque.                                                                                                                                               | `{"id":"t_coral","name":"Coral Offers"}`   |
| `contentType`   | `{ key, name }` | The template's content type. `key` is stable and open-ended.                                                                                                                                   | `{"key":"disclosure","name":"Disclosure"}` |
| `activeVersion` | integer         | The Active version's number.                                                                                                                                                                   | `3`                                        |
| `activatedAt`   | instant         | When it went Active ([section 14](#14-the-fields-the-review-called-ambiguous)).                                                                                                                | `"2026-09-20T14:05:00.000Z"`               |
| `channels`      | `ApiChannel[]`  | The channels it renders: turned on for the version and still allowed by its content type, in the order pdf, web, email, push, sms.                                                             | `["pdf","web","email"]`                    |
| `variableCount` | integer         | Variables in its contract.                                                                                                                                                                     | `3`                                        |
| `requiredCount` | integer         | Of those, the required ones.                                                                                                                                                                   | `3`                                        |

### 6.4 ApiTemplateDetail

| Field           | Type                      | Meaning                                                                                                | Example       |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| `id`            | string                    | The template id.                                                                                       | `"UC-4F7K2Q"` |
| `name`          | string                    | The three-way rule of [section 14](#14-the-fields-the-review-called-ambiguous).                        |               |
| `team`          | `{ id, name }`            | As in `ApiTemplateSummary`.                                                                            |               |
| `contentType`   | `{ key, name }`           | As in `ApiTemplateSummary`.                                                                            |               |
| `asOf`          | instant                   | When the answer was computed. `renders`, `sunsetPassed`, `sunsetDay` and `zone` are as of this moment. |               |
| `activeVersion` | integer or null           | The Active version's number; null when none is Active.                                                 | `3`           |
| `versions`      | `ApiVersionSummary[]`     | Released versions only, newest first.                                                                  |               |
| `contract`      | `ApiContract` or null     | The contract of `version`, or of the Active version; null when neither exists.                         |               |
| `changes`       | `ApiContractDiff`, absent | Only with `since`.                                                                                     |               |

### 6.5 ApiVersionSummary

| Field          | Type                              | Meaning                                                                                                                                                                               | Example                      |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `number`       | integer                           | The version number.                                                                                                                                                                   | `2`                          |
| `state`        | `active`, `superseded`, `revoked` | `ApiVersionState`: the only states a consumer sees.                                                                                                                                   | `"superseded"`               |
| `activatedAt`  | instant                           | When the version went Active.                                                                                                                                                         |                              |
| `supersededAt` | instant or null                   | When a newer version replaced it; null if that never happened (an Active version, or one revoked while Active).                                                                       |                              |
| `sunsetAt`     | instant or null                   | When renders of it stop: 00:00 on `sunsetDay` in `zone` ([section 8](#8-time-days-and-sunsets)). Null when no sunset is set.                                                          | `"2027-03-01T05:00:00.000Z"` |
| `sunsetDay`    | day or null                       | The sunset's day in `zone`: the day to show. Null when `sunsetAt` is.                                                                                                                 | `"2027-03-01"`               |
| `zone`         | IANA zone or null                 | The business time zone in force now. Null when `sunsetAt` is.                                                                                                                         | `"America/New_York"`         |
| `sunsetPassed` | boolean                           | `sunsetAt` is at or before now. For a Superseded version, renders fail with `version_sunset`; a Revoked version keeps the sunset it had, and its renders fail with `version_revoked`. | `false`                      |
| `revokedAt`    | instant or null                   | When the revoke was confirmed; null unless `state` is `revoked`.                                                                                                                      |                              |
| `renders`      | boolean                           | A render of it would succeed now: Active, or Superseded before its sunset.                                                                                                            | `true`                       |
| `channels`     | `ApiChannel[]`                    | Its channels that its content type still allows, in the order pdf, web, email, push, sms.                                                                                             | `["pdf","web"]`              |

### 6.6 ApiContract, ApiVariable and ApiJsonSchema

`ApiContract`:

| Field        | Type              | Meaning                                                            |
| ------------ | ----------------- | ------------------------------------------------------------------ |
| `version`    | integer           | Whose contract this is.                                            |
| `state`      | `ApiVersionState` | That version's state.                                              |
| `channels`   | `ApiChannel[]`    | As in `ApiVersionSummary`.                                         |
| `variables`  | `ApiVariable[]`   | In the version's order. At most 200.                               |
| `jsonSchema` | `ApiJsonSchema`   | JSON Schema (draft 2020-12) for the render body's `values` object. |

`ApiVariable`:

| Field      | Type              | Meaning                                                                                                                                              | Example          |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `key`      | string            | The key to send in `values`: lower-case snake_case, starting with a letter, at most 64 characters (`isValidKey` in `src/editor/model/variables.ts`). | `"purchase_apr"` |
| `label`    | string            | What authors call it. At most 200 characters.                                                                                                        | `"Purchase APR"` |
| `type`     | `ApiVariableType` | `text`, `currency`, `percent`, `date`, `number` or `us_state`.                                                                                       | `"percent"`      |
| `required` | boolean           | A render without a value for it is `missing_variables`.                                                                                              | `true`           |
| `example`  | string            | A valid value in canonical form: the author's sample, or the type's example when the sample is blank or doesn't fit.                                 | `"21.99"`        |

`ApiJsonSchema` is generated per version by `contractJsonSchema` in `src/domain/golive/json-schema.ts`, whose header
lists every rule. It publishes the canonical forms only, so a consumer that validates against it always sends values
the route accepts. For a version with a required text, a required percent, an optional US state and an optional date:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://stencil.example/schemas/UC-7Q2M4K/v2/values.json",
  "title": "Rate Change Notice v2: values",
  "type": "object",
  "properties": {
    "given_name": {
      "title": "First name",
      "description": "Text.",
      "examples": ["Maya"],
      "maxLength": 1000,
      "type": "string",
      "minLength": 1,
      "pattern": "\\S"
    },
    "purchase_apr": {
      "title": "Purchase APR",
      "description": "Percent, canonical form like 21.99 (no % sign). Renders as 21.99%, digits exactly as sent.",
      "examples": ["21.99"],
      "maxLength": 1000,
      "type": "string",
      "pattern": "^(?!-0(?:\\.0+)?$)-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$"
    },
    "state": {
      "title": "State",
      "description": "US state, the two-letter code like NJ.",
      "examples": ["NJ"],
      "maxLength": 1000,
      "type": "string",
      "enum": ["AL", "AK", "AZ", "…", "WY"]
    },
    "offer_end": {
      "title": "Offer ends",
      "description": "Date, canonical form YYYY-MM-DD like 2027-03-04. Renders as March 4, 2027.",
      "examples": ["2027-03-04"],
      "maxLength": 1000,
      "type": "string",
      "format": "date",
      "pattern": "(the calendar pattern, DATE_PATTERN in json-schema.ts)"
    }
  },
  "required": ["given_name", "purchase_apr"],
  "additionalProperties": true
}
```

- Every property is `type: "string"` with `maxLength: 1000`. A required text adds `minLength: 1` and `pattern: "\\S"`
  (blank counts as missing). Currency, percent and number share one decimal pattern; a date has `format: "date"` and
  a pattern that checks the calendar (validators may treat `format` as an annotation only); `us_state` is an `enum`
  of the 50 states and DC. Patterns use `[0-9]`, never `\d`.
- `$id` names the schema; nothing is served at it. Its `https://stencil.example` base is a placeholder
  ([section 15](#15-open-for-the-handoff)).
- `title` is `"<the version's name> v<number>: values"`, so it names the contract's own version, whose name can differ
  from the template's `name`.

### 6.7 ApiContractDiff and ApiContractChange

`ApiContractDiff` (`contractDiff` in `src/domain/golive/contract-diff.ts`):

| Field         | Type                  | Meaning                                                                                                                                           |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `since`       | integer               | The earlier version.                                                                                                                              |
| `to`          | integer               | The later version (the contract's).                                                                                                               |
| `breaking`    | boolean               | Any item is breaking.                                                                                                                             |
| `items`       | `ApiContractChange[]` | The changes, in the later version's variable order, removals last.                                                                                |
| `newRequired` | string[]              | Required keys a consumer moving from `since` must newly send: added as required, renamed, made required or retyped, in the later version's order. |

`ApiContractChange` is a union tagged by `kind` ([section 14](#14-the-fields-the-review-called-ambiguous)).

### 6.8 ApiNoticeList and ApiNotice

`ApiNoticeList` is `ApiPage` plus `consumerId` (string, the caller), `asOf` (instant) and `notices` (`ApiNotice[]`,
oldest first).

`ApiNotice` is flat: every notice has every field, null (or `[]`) where its kind doesn't use it. Per-kind rules are
[section 12](#12-notices).

| Field           | Type                  | Meaning                                                                                                                                                 | Example                      |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `id`            | string                | The notice's id, opaque. Don't order by it.                                                                                                             | `"cn_7k2m9q4x1p"`            |
| `kind`          | `ApiNoticeKind`       | `new_version`, `sunset_scheduled`, `sunset_passed` or `revoked`.                                                                                        | `"sunset_scheduled"`         |
| `createdAt`     | instant               | When Stencil wrote it. Not the order: page order is. For `sunset_passed`, when the sweep found the sunset passed.                                       | `"2026-10-04T12:00:00.000Z"` |
| `template`      | `{ id, name }`        | The template, and the name of the version the notice is about as it was when the notice was written.                                                    |                              |
| `versionNumber` | integer               | The version the notice is about.                                                                                                                        | `2`                          |
| `activeVersion` | integer or null       | The Active version when the notice was written: the one to move to. Null when none was Active.                                                          | `3`                          |
| `sunsetAt`      | instant or null       | Sunset kinds: when renders stop (or stopped).                                                                                                           | `"2027-03-01T05:00:00.000Z"` |
| `sunsetDay`     | day or null           | Sunset kinds: the sunset's day in `zone`, as recorded.                                                                                                  | `"2027-03-01"`               |
| `zone`          | IANA zone or null     | Sunset kinds: the zone `sunsetDay` is a day in, as recorded when the notice was written.                                                                | `"America/New_York"`         |
| `reason`        | string or null        | `revoked` only: the revoker's reason, in their own words, up to 2,000 characters.                                                                       |                              |
| `changes`       | `ApiContractChange[]` | `new_version` and `sunset_scheduled` (section 12); `[]` for the others.                                                                                 |                              |
| `message`       | string                | One or two short sentences for people, worded when read. Informational ([0055](../decisions/0055-notifications-store-facts-and-are-worded-on-read.md)). |                              |

### 6.9 ApiRenderRequest and the render responses

`ApiRenderRequest` is the table in [section 5.4](#54-render-a-version).

`ApiEmailResponse`:

| Field          | Type             | Meaning                                                                                                    |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `subject`      | string           | The subject line, values resolved.                                                                         |
| `preheader`    | string           | The preview text, values resolved; may be empty.                                                           |
| `html`         | string           | A complete HTML email (inline styles, table layout, the preheader as hidden text). Base64 with `encoding`. |
| `text`         | string           | The plain-text alternative. Base64 with `encoding`.                                                        |
| `newerVersion` | integer or null  | The Active version's number when the rendered one is Superseded; else null.                                |
| `encoding`     | `base64`, absent | Present only when the request asked for it.                                                                |

`ApiBase64Response` (PDF or web with `encoding: "base64"`): `channel` (`pdf` or `web`), `contentType`
(`application/pdf` or `text/html; charset=utf-8`), `encoding` (`base64`), `data` (the PDF's bytes, or the HTML's
UTF-8, in standard base64 with padding), `newerVersion`.

`ApiPushResponse`:

| Field          | Type            | Meaning                                                                                                                                                                                                                                                                |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`        | string          | In full: the phone cuts what doesn't fit, never Stencil.                                                                                                                                                                                                               |
| `subtitle`     | string, absent  | iPhone only, and only when it has text. Never present for `android`.                                                                                                                                                                                                   |
| `body`         | string          | In full.                                                                                                                                                                                                                                                               |
| `payloadBytes` | integer         | The UTF-8 size of the compact notification JSON this text makes: APNs' `{"aps":{"alert":…}}` for iOS, FCM's `{"message":{"notification":…}}` for Android. The consumer's own keys add to it: 4,096 − `payloadBytes` is left for them (2,048 for an FCM topic message). |
| `newerVersion` | integer or null | As for email.                                                                                                                                                                                                                                                          |

`ApiSmsResponse`:

| Field          | Type             | Meaning                                                                                                                                                          |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`         | string           | The message exactly as it must be sent: the author's text and, when the version has a footer, a line break and the footer (brand and opt-out, frozen at submit). |
| `encoding`     | `GSM-7`, `UCS-2` | GSM-7 unless one character is outside it; a value can switch it. A value is never transliterated.                                                                |
| `parts`        | integer          | Segments: 160 GSM-7 or 70 UCS-2 characters in one, 153 or 67 each once split. At most 10.                                                                        |
| `characters`   | integer          | Characters as a reader counts them (grapheme clusters).                                                                                                          |
| `newerVersion` | integer or null  | As for email.                                                                                                                                                    |

Send `text` as is, and turn off provider rewriting such as Twilio's Smart Encoding: the counts are for this text
([0035](../decisions/0035-sms-characters-and-length.md)).

## 7. Identifiers

Decisions [0060](../decisions/0060-template-ids-are-random-and-retried-on-a-collision.md) and
[0053](../decisions/0053-team-ids-are-opaque-and-slugs-resolve-at-the-url.md).

| Id                 | Where                                                                                       | Today                                                                                           | Publish as                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `templateId`       | paths, `id`, a notice's `template.id`, `X-Stencil-Template-Id`, the schema's `$id`, the PDF | `UC-` and six Crockford base32 characters, `UC-4F7K2Q` (`newTemplateId` in `src/server/ids.ts`) | An opaque string: a maximum length and examples, no pattern. _Suggestion:_ `maxLength: 64`. |
| `team.id`          | search results and template reads                                                           | An opaque id, `t_coral`, never the slug (0053)                                                  | An opaque string, never a slug.                                                             |
| `consumerId`       | the notices path, `ApiNoticeList.consumerId`, inside notice cursors                         | `coral`, `deposits-online` (`consumers.id`)                                                     | An opaque string.                                                                           |
| A notice's `id`    | `ApiNotice.id`                                                                              | `cn_` and ten lower-case Crockford base32 characters                                            | An opaque string. Unique; not an order.                                                     |
| `contentType.key`  | search results and template reads                                                           | `disclosure`, `alert`                                                                           | A stable, open-ended string.                                                                |
| A variable's `key` | `ApiVariable.key`, `values`, change items, error details                                    | `^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`, at most 64 characters                                        | As is. This one is a real rule: authors' keys follow it.                                    |

The template id is random, the primary key, and immutable; a create inserts and retries the whole transaction with a
new id on a unique violation, at most three times. Consumers keep it, so it never changes. A readable id, if the
product owner defines one, is a separate field and never `templateId` unless the product owner says so; whether the
`UC-` prefix stays is the product owner's question too.

**Node today:** the local implementation's create draws an id, inserts, and writes again with another id when the
insert finds it taken, three attempts in all (`src/server/services/template-id.ts`, decision 0060); the Java create
does the same around its transaction.

Two details for the port:

- **The path lookup is exact.** SQLite compares the id case-sensitively, so `uc-4f7k2q` in a path is 404. Under SQL
  Server's usual case-insensitive collation it would match; keep it exact (a binary or case-sensitive collation on the
  column) unless the spec says otherwise.
- **Search's exact-id match** reads the query as an id ignoring case and an optional `UC-` prefix
  ([section 10](#10-search-matching-and-order)). That rule knows today's format; if the id scheme ever changes, it
  changes with it.

## 8. Time, days and sunsets

Decisions [0017](../decisions/0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md),
[0038](../decisions/0038-a-sunset-is-sent-with-its-day-and-zone.md) and
[0032](../decisions/0032-consumers-are-told-when-a-sunset-passes.md).

- **The business time zone** is one platform setting, `America/New_York` unless a Platform Admin picks another from a
  short list: `America/New_York`, `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`,
  `America/Anchorage`, `Pacific/Honolulu`, `UTC` (`src/domain/business-zone.ts`).
- **A sunset is a day.** "Sunset on March 1" stops renders at 00:00 on March 1 in the business zone, so `sunsetAt` is
  `2027-03-01T05:00:00.000Z` in New York. Don't take the UTC date of `sunsetAt` as the day: for a zone ahead of UTC it
  is the day before. Show `sunsetDay`.
- **Wherever the API sends a sunset it sends all three**, `sunsetAt`, `sunsetDay` and `zone`: on each
  `ApiVersionSummary` (all null with no sunset), on `sunset_scheduled` and `sunset_passed` notices, and in the details
  of a `version_sunset` 410 (`at`, `sunsetDay`, `zone`).
- **Which zone.** A version summary and a 410 read the day in the zone in force now. A notice keeps the day and zone it
  recorded when it was written. After a change of zone the two can differ for a sunset set before it; a sunset already
  set never moves (its instant is what is stored).
- **The conversions**, from 0017:

  | Rule                  | Java                                                             |
  | --------------------- | ---------------------------------------------------------------- |
  | the instant of a day  | `LocalDate.parse(day).atStartOfDay(ZoneId.of(zone)).toInstant()` |
  | the day of an instant | `instant.atZone(ZoneId.of(zone)).toLocalDate()`                  |

- **Passed** means `sunsetAt` is at or before now. Renders fail from that instant whether or not the `sunset_passed`
  notice has been written; a passed sunset is final and can't be moved ([0002](../decisions/0002-a-passed-sunset-is-final.md)).
- **`asOf`** on the GET answers is the moment the answer was computed: `renders` and `sunsetPassed` are as of it.
- **The `Date` header is real time** ([A7](../handoff-review.md#a7--medium-the-http-date-header-carries-the-demo-clock)).
  If a demo mode survives, its clock travels in a header of its own (the backlog suggests `X-Stencil-Clock`). Java
  provides a test-only clock offset in demo and test environments
  ([0068](../decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)); it moves `asOf` and the
  rules, not `Date`.

**Node today:** every `/api/v1` response's `Date` header, and every `asOf`, is the demo clock (real time plus an
offset the demo's "Advance clock" moves; `withDemoDate` in `src/server/services/local/consumer-api.ts`). Coral stamps what it receives
with that header. Both go with the demo clock.

## 9. Paging and cursors

Decisions [0006](../decisions/0006-page-notices-by-commit-order.md) and
[0059](../decisions/0059-template-search-ranks-and-pages-in-sql.md). Code: `src/domain/golive/cursor.ts`.

**For consumers:**

- A list answers `nextCursor` and `hasMore`; the next call passes the cursor back as `after`. Read on until `hasMore`
  is false.
- `nextCursor` is always present. On the last page it marks the end, so a later call with it returns only what came
  after: for notices, exactly the ones written since.
- A cursor is opaque: keep it as is; never build, read or edit one.
- A cursor belongs to its list: the same consumer and `templateId` for notices, the same `q` for search (trimmed, any
  case). Anything else is 400 `bad_request`, "after must be the nextCursor of an earlier page of this list."
- **Notice cursors may be stored**: polling is keeping the last one. **Search cursors are for paging one search**, not
  for keeping.

**For the implementation:**

- **Notices page on `seq`**, a number each notice takes inside the transaction that writes it, so numbers follow
  commit order and a consumer paging by them never skips a notice. A number is never handed out twice: the last one
  taken is kept and only goes up. Ordering by `createdAt` would skip notices (an action reads the clock before its
  transaction, and one action's notices share an instant). On SQL Server the number comes from a counter row updated
  inside the writing transaction, `UPDATE notice_counter SET last = last + @n OUTPUT inserted.last`, whose row lock
  holds until commit; not a `SEQUENCE`, which isn't commit-ordered
  ([0062](../decisions/0062-invariants-hold-in-the-database-not-in-one-writer.md)).
- **The epoch** names a numbering of the outbox. A notice cursor from another epoch is 400 `bad_request`, "after is
  from before the notices were reset. Start again without after.", rather than read against numbers it would skip.
  It must change whenever the numbering starts again. Node uses `settings.seeded_at`, which only the seed writes (a
  demo reset rewrites it); a database that was never seeded has `epoch: null`. What epoch Java sends in production, and
  how a cursor stored from Node keeps validating (a cursor is refused unless its `epoch` equals the server's), is open
  ([section 15](#15-open-for-the-handoff)).
- **Search pages on its sort key** `(rank, name, id)`: the page holds the results after the cursor's key. Pages never
  overlap, and a template leaving the list doesn't shift the pages after it.
- **Read one more row than `limit`** to learn `hasMore` without a second query (`cutPage`). An empty page's
  `nextCursor` carries the same position as its `after`.
- **The format is version 1**: base64url without padding, of a JSON object. Cursors aren't signed: a consumer only
  reads its own notices, so an edited cursor shows it nothing it couldn't read anyway.

  ```text
  notices  {"v":1,"list":"notices","consumer":"coral","template":null,"epoch":"2026-10-08T12:00:00.000Z","seq":42}
           seq: the last seq on the page (0 before the first notice); template: the templateId filter or null;
           epoch: null for an unseeded database
  search   {"v":1,"list":"search","q":"travel","last":{"rank":2,"name":"Spring Travel Rewards — Terms","id":"UC-4F7K2Q"}}
           q: trimmed and lower-cased; last: the page's last sort key, null before the first result
  ```

  A cursor is refused (400, the "after must be…" sentence) when it isn't base64url of a JSON object, `v` isn't 1,
  `list` is the other list, the consumer, `template` or `q` differ, `seq` isn't a non-negative whole number, or `last`
  isn't null or `{rank 0 to 2, name, id}`. An absent or blank `after` is the start.

- **Keep reading version 1 notice cursors** for as long as a consumer may hold one; a new format takes a new `v` and
  reads the old ones too. The search cursor's inner format may change with a `v` bump.

## 10. Search: matching and order

Decision [0059](../decisions/0059-template-search-ranks-and-pages-in-sql.md); code: `searchActiveTemplates` in
`src/server/services/local/consumer-api.ts` and `compareSearchKeys` in `src/domain/golive/cursor.ts`.

1. The candidates are the templates with an Active version. A template's name, for matching, ordering, the cursor and
   the result, is its Active version's.
2. The query is `q` trimmed and lower-cased. Its words are the query split on runs of whitespace.
3. **Rank 0, the id:** the query upper-cased equals the template's id, or `UC-` followed by it does. Any case, with or
   without `UC-`: `uc-4f7k2q`, `4F7K2Q`.
4. **Otherwise every word must be a substring of the lower-cased name.** Rank 1 when the lower-cased name starts with
   the whole query (inner spaces as typed); rank 2 otherwise. An empty query matches every candidate, all at rank 1.
5. **Order:** rank, then name, then id, names and ids compared by Unicode code point: not by a locale, and not ignoring
   case (capitals sort before lower case). Every implementation must sort exactly this way, because pages are cut on it.

How Java does it (0059): one `LOWER(name) LIKE '%' + @word + '%' ESCAPE '\'` per word, with `%`, `_` and `\` in the
query escaped; the rank as a `CASE` in a CTE; the keyset on `(rank, name, id)` written out as `OR`s;
`ORDER BY rank, name, id` under a binary collation (`Latin1_General_100_BIN2`); `TOP (@limit + 1)`. A full-text index
would change what matches, so it isn't a port detail. Two known differences from the Node code, which the contract
suite probes on both ([0068](../decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)): a binary
collation compares UTF-16 code units, as Java's `String.compareTo` does, which differs from code-point order only for
characters outside the Basic Multilingual Plane; and SQL `LOWER` and JavaScript's `toLowerCase` differ on a few
letters (`İ`, `ß`).

**Node today:** loads every Active version and ranks in memory; the same matches and order.

## 11. Values are strings

Decision [0058](../decisions/0058-render-values-are-strings.md); the grammar is
[render spec section 5](../render-spec.md#5-values).

- `values` is a JSON object from variable key to value. **Every value is a JSON string.** A JSON number is refused:
  422 `invalid_values`, with a sentence that names the string form (send `"21.90"`, not `21.90`). `true`, `false`,
  objects and arrays are refused the same way, "{key} must be {noun}.". The key is in `details.invalid`. Only
  `values` changes: `version` stays a JSON number.
- `null`, and a string that is empty after trimming, are no value: a required variable is then missing, an optional
  one renders nothing.
- Each value is at most 1,000 characters as sent, counted in Unicode code points before any trimming (Java:
  `codePointCount`, never `length()`), else `invalid_values` with `maxLength: 1000`
  ([0011](../decisions/0011-cap-each-render-value.md)). A value is never cut: it prints exactly as sent, or is refused.
- The absent check comes before the length check: a string that is blank after trimming is no value at any length, so a
  whitespace-only value over 1,000 characters is absent, not `invalid_values` (0011; render spec section 5, "Length").
- Keys the version doesn't have are ignored. When a key repeats in the JSON, the last one counts.
- Each type's accepted forms, canonical and friendly (`$1,000`, `21.99%`, `3/4/2027`, `New Jersey`), are render spec
  section 5. Decimals are exact strings: never converted to a binary number, never rounded, trailing zeros kept.
- _Suggestion for Java:_ bind `values` as a `Map<String, JsonNode>` (or check the token type while reading) and
  answer a non-string with 422 `invalid_values`. A `Map<String, String>` alone lets Jackson coerce a number to a
  string, or fail the whole body with a 400.

**Node today:** the same. A JSON number in `values` is refused with 422 `invalid_values` and the sentence
`{key} must be a JSON string, like "21.90", not a number.` (the same example for every key, so no value is echoed;
`details.invalid` carries `"sent": "number"`). The `values-formats` golden case sends strings and an
`error-json-number` case pins the refusal. `true`, `false`, objects and arrays are refused too.

## 12. Notices

Decisions [0006](../decisions/0006-page-notices-by-commit-order.md),
[0032](../decisions/0032-consumers-are-told-when-a-sunset-passes.md),
[0055](../decisions/0055-notifications-store-facts-and-are-worded-on-read.md) and
[0064](../decisions/0064-payloads-are-facts-with-one-shape-per-event.md). Code: `noticeView` in
`src/domain/golive/notices.ts` (the wire shape and the sentence) and the `consumer_notice` effect in
`src/server/services/local/effects.ts` (who gets one).

A notice is Stencil's word to one consumer that something happened to one version of one template. Read state is the
consumer's business.

**Who gets one:** every registered consumer with a non-preview render of the template, successful or not, from 90
days before the event on; for `sunset_passed` the event is the sunset instant. Not only the consumers of that
version: a consumer on the Active version also learns that an old one is gone. A consumer that never rendered the
template gets nothing. Each event writes one notice per consumer, each with its own `seq`, in the transaction that
records the event. After the port the 90-day audience is read from the daily render rollup, with the same rule
([0066](../decisions/0066-the-audit-log-is-the-record-and-render-events-roll-up.md)).

| Kind               | Written when                                                                                                                                                                                                                            | `versionNumber`          | `activeVersion`                                                                                                      | `sunsetAt`, `sunsetDay`, `zone` | `reason`                                                                                                                                                                                                                                                                           | `changes`                                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new_version`      | A version goes Active (its last approval).                                                                                                                                                                                              | the new version          | the same number                                                                                                      | null                            | The contract changes the version was submitted with, against what consumers could render then (the Active version, or with none the newest Superseded one still rendering); `[]` when nothing was rendering at submit, which is not only a first version, or when nothing changed. | The contract changes the version was submitted with, against what consumers rendered then (the Active version, or with none the newest still rendering); `[]` for a first version.                                                                                            |
| `sunset_scheduled` | A sunset is set or moved: on the Versions tab, or in the approve dialog for the version being replaced. Setting the day it already has writes nothing.                                                                                  | the version being sunset | the Active version; null when none is Active (a sunset set on the Versions tab after the Active version was revoked) | set                             | null                                                                                                                                                                                                                                                                               | The contract changes the Active version was submitted with, worded for it; `[]` when none is Active or the Active version brought none. When the version being sunset is older than the one the Active version replaced, they aren't the whole move: read `?since=` for that. |
| `sunset_passed`    | Stencil's sunset sweep finds the sunset passed. Once per version, to each consumer in the audience. Not written for a version revoked at or before its sunset: the revoke had already ended its renders, so nothing records the sunset. | the version              | the Active version at the sweep, or null                                                                             | set                             | null                                                                                                                                                                                                                                                                               | `[]`: the `sunset_scheduled` notice carried them.                                                                                                                                                                                                                             |
| `revoked`          | A revoke is confirmed by a second approver.                                                                                                                                                                                             | the revoked version      | null if the revoked version was the Active one; else the Active version, or null when none is                        | null                            | the revoker's words                                                                                                                                                                                                                                                                | `[]`                                                                                                                                                                                                                                                                          |

- **Facts only.** What Stencil stores for a notice is facts: numbers, instants, and names as they were. `message` and
  each change's `text` are worded when read and are informational: consumers branch on `kind`, never on a sentence.
  `reason` is a person's own words, stored as typed.
- **`createdAt` is not the order.** Page order (`seq`) is. A `sunset_passed` notice is written by the sweep after the
  sunset, so its `createdAt` can be days after its `sunsetAt` until a scheduled job runs the sweep promptly (handoff
  review S4).
- **Sentences** (from `noticeView`; examples): "Spring Travel Rewards — Terms v3 is available. It adds the required
  variable annual_fee."; "… v2 stops rendering on March 1, 2027. Move to v3."; "… v2 stopped rendering: its sunset
  passed on March 1, 2027. Move to v3."; "Balance Transfer Intro — Terms v1 was revoked: Wrong intro APR in the legal
  notices."

_Suggestion for Java:_ one record with nullable fields serialized with nulls included gives exactly this JSON; a
sealed hierarchy per kind is fine if it serializes the same way, with every field present.

**Node today:** stored payloads hold facts only (0055): `contractChanges` is always present on `new_version` and
`sunset_scheduled`, empty when there are none, and no sentence is stored. The seed writes the same fields as the runtime (0064). The full catalogue
of stored notice payloads is in the [data model page](data-model.md#payloads).

## 13. Rendering

Decision [0067](../decisions/0067-java-renders-every-channel.md).

- **Java renders every channel**: the engine is ported, with PDFBox or OpenPDF for the PDF, its own line breaking
  under the spec's rules, and its own check for characters the font can't draw.
- **The render spec and the golden files are the acceptance test**, run in the Java build:
  [docs/render-spec.md](../render-spec.md) (the pipeline, the stored document, values, links, lists, the `RenderDoc`,
  each channel, the errors, determinism) and the cases under
  [src/server/render/golden](../../src/server/render/golden/README.md). Each case's `expected/` files are engine-neutral
  and Java must match them: the `RenderDoc`, the web HTML, the email HTML, subject, preheader and text, the content
  text, the links, the PDF metadata, the push and SMS JSON, and `error.json` for a case that must fail. PDF bytes
  aren't compared; the `node/` files depend on Node's fonts and layout and aren't Java's to match.
- **The CMS preview calls Java's render endpoint** with the viewer's identity, so an approver sees what a consumer gets.
- **Before the PDF port starts:** whether customer PDFs must be PDF/UA or PDF/A, and the enterprise font's licence and
  coverage (handoff review R3).

## 14. The fields the review called ambiguous

The routes report of the [October 12 review](../quality-review-2026-10-12.md) named four fields whose meaning lived only
in comments. What the code does:

**`ApiTemplateDetail.name`** (`getTemplateDetail`, with `contractBaseline` in `src/domain/lifecycle/baselines.ts`):

1. the Active version's name;
2. with none Active, the name of the highest-numbered Superseded version whose sunset hasn't passed, the newest one
   consumers can still render;
3. with nothing rendering, the highest-numbered released version's name, whatever its state.

`ApiTemplateSummary.name` is always case 1, since search lists only templates with an Active version. The name of the
contract's own version is in `contract.jsonSchema.title`; `ApiVersionSummary` carries no name.

**`activatedAt`** (`ApiTemplateSummary` and `ApiVersionSummary`): the Node code writes
`activatedAt ?? createdAt`, but the fallback never fires. A version gets `activated_at` when its last approval makes
it Active (`src/domain/lifecycle/approve.ts`), nothing clears it afterwards, and every released version the seed
writes has one. Every released version was Active once, Superseded and Revoked ones included. Publish it as a required,
non-null instant: when the version went Active.

**`ApiError.details`** has one shape per code: [section 4.3](#43-details-per-code).

**`ApiContractChange`** is a union tagged by `kind` (`apiChanges` in `src/domain/golive/contract-diff.ts`, the diff
in `src/editor/model/contract.ts`):

| `kind`          | Fields besides `kind`, `key`, `breaking`, `text` | `key` is        | `breaking`               |
| --------------- | ------------------------------------------------ | --------------- | ------------------------ |
| `added`         | none                                             | the new key     | true when it is required |
| `removed`       | none                                             | the removed key | true                     |
| `made_required` | none                                             | the key         | true                     |
| `made_optional` | none                                             | the key         | false                    |
| `key_renamed`   | `from`, `to`: the old key and the new one        | the new key     | true                     |
| `type_changed`  | `from`, `to`: `ApiVariableType`s                 | the key         | true                     |
| `label_changed` | `from`, `to`: the old label and the new one      | the key         | false                    |

- A renamed variable is one `key_renamed` item, so a consumer moves its value from `from` to `to` instead of reading a
  removal and a new required variable. Variables pair by an internal identity first, then by key
  ([0022](../decisions/0022-a-variable-keeps-its-identity-across-renames.md)); a rename and a type change on one
  variable are two items.
- `added` and `removed` carry no `type` or `required` on the wire, though the domain has them.
- `text` is one sentence, worded for the later version and informational: "v3 adds required `annual_fee` (Currency)."
- _Suggestion:_ a sealed interface with `@JsonTypeInfo(use = NAME, property = "kind")` and `@JsonSubTypes`; in
  OpenAPI, `oneOf` with a `discriminator` on `kind`.

## 15. Open for the handoff

Each of these needs a decision this brief doesn't make.

- **The UCOMP error format** and the mapping of every code and its details onto it (0056).
- **Names for the new codes:** the 401, the 403 for a missing app role, the 429, and an unexpected 500 on the GET
  routes (section 4.2 suggests some).
- **The order of checks on Java, and the 403 for a missing app role.** 0057 fixes the 401 and the 403 statuses, not
  an order and not the role-less 403. This brief proposes authentication, the registered consumer and the app role
  before the body is read (section 4.4).
- **Request details Node leaves loose.** Render's `Content-Type`: Node never checks it, Spring answers 415; is
  `application/json` required, and with which code? A repeated query parameter: Node reads the first (section 5.1).
- **The notice cursor's epoch in production** (section 9): what Java sends, and how a cursor stored from Node keeps
  validating.
- **Which app role the two template reads need.** _Suggestion:_ either role, since both consumers that render and
  consumers that read notices need a template's contract.
- **`templateId`'s maximum length** (_suggestion:_ 64) and whether the path lookup stays case-sensitive (section 7).
- **A readable template id and the `UC-` prefix**: product owner questions (0060).
- **The schema and the route accept different sets of values.** 0058 says the route accepts exactly what the
  published schema accepts. For JSON types that holds once Node refuses numbers, but the schema is still stricter in
  four places the route accepts: the friendly forms of render spec section 5 (`$1,000`, `21.99%`, `March 4, 2027`,
  `New Jersey`), surrounding whitespace on a value that isn't text (`" 21.99 "`), `null`, and a blank value for an
  optional currency, percent, number, date or US state. Either the
  route narrows (a render spec change, with golden updates), or the schema stays the stricter subset, which is what
  `json-schema.ts` describes today.
- **A template with no released version.** The template read answers 404 `template_not_found` so such a template is
  invisible, but the render route finds it and answers 409 `version_not_released` (or 404 `version_not_found`),
  which tells a consumer it exists. _Suggestion:_ 404 `template_not_found` on both.
- **The JSON Schema's `$id` base**, `https://stencil.example`, names nothing real.
- **`preview_forbidden` in the published code list.** `/api/v1` never returns it; removing it needs the render
  types split into a consumer set and a preview set (0047). _Suggestion:_ leave it out of `/api/v1`'s spec.
- **A consumer registry** that registers a consumer and links it to its app registration (0057); consumers come from
  the seed until then.
- **The demo clock's header name**, if a demo mode survives (A7).
- **PDF/UA, PDF/A and the enterprise font**, before the PDF port (0067).

## 16. Where each rule lives in the code

| What                                                                          | Where                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The wire shapes                                                               | `src/contracts/api-v1.ts`, [src/contracts/README.md](../../src/contracts/README.md)                                                                         |
| The status table and the drift checks between the domain's types and the wire | `src/domain/golive-types.ts`                                                                                                                                |
| The four handlers                                                             | [src/app/api/v1](../../src/app/api/v1/templates/route.ts) and its siblings                                                                                  |
| Shared headers and the error response                                         | `src/server/api/http.ts`                                                                                                                                    |
| The render body and the render responses                                      | `src/server/api/render-http.ts`                                                                                                                             |
| The GET routes' reads                                                         | `src/server/services/local/consumer-api.ts`                                                                                                                 |
| Cursors                                                                       | `src/domain/golive/cursor.ts`                                                                                                                               |
| The GET routes' parameters and sentences                                      | `src/domain/golive/api-errors.ts`                                                                                                                           |
| Notices on the wire                                                           | `src/domain/golive/notices.ts`                                                                                                                              |
| Contract changes and the JSON Schema                                          | `src/domain/golive/contract-diff.ts`, `src/domain/golive/json-schema.ts`, `src/editor/model/contract.ts`                                                    |
| The render pipeline, version rules, values and errors                         | `src/server/services/local/render/render-template.ts`, `src/domain/render/version-rules.ts`, `src/domain/render/validate.ts`, `src/domain/render/errors.ts` |
| Who gets a notice, and `seq`                                                  | `src/server/services/local/effects.ts`                                                                                                                      |
| Sunset days and zones                                                         | `src/domain/business-zone.ts`                                                                                                                               |
| A consumer's client (Coral)                                                   | `src/simulator/ucomp-api.ts`                                                                                                                                |
| Executable examples                                                           | the `route.test.ts` beside each handler, `e2e/api/consumer.spec.ts`, `e2e/api/render.spec.ts`, and the golden cases                                         |
