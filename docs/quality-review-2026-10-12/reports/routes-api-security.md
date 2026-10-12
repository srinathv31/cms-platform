# Review: routes, API contract, simulator, security posture

Slice: `src/app/**`, `src/contracts/api-v1.ts`, `src/simulator/**` + `src/app/(simulator)/**`, `src/server/api/*`,
`src/server/queries/consumer-api.ts`, `src/server/queries/integration.ts`, and the app's security posture.
Repo at `main` @ 0cca665, 2026-10-12. Every file named below was read; "measured" means a command was run.

What was run (all read-only): `npx vitest run src/contracts src/app src/server/api src/simulator` (22 files, 261
tests, all pass, 3.8 s); `npx tsc --noEmit` (exit 0); `npx eslint src/app src/simulator src/contracts src/server/api`
(clean); `npm audit --omit=dev` (3 moderate, one chain); `find src/app -name loading.tsx` (none); `grep` for
`as Route`, `sql\``, `dangerouslySetInnerHTML`, `connection()`, `"use client"`, `"use server"`, `process.env`, secrets.

## 1. Summary

The app layer is genuinely thin and genuinely consistent: 22 pages, every default export synchronous, every one
passing `params` into a `<Stream>` child, no `loading.tsx`, four error boundaries that match decision 0013, and
19 route handlers that each fit on one screen and hand off to one function in `src/server`. The `/api/v1` handlers
read headers first, validate with domain parsers, answer through one `http.ts`, and the cursor paging (decision
0006) is correct and well tested, including the reset-epoch case. The contract file `src/contracts/api-v1.ts` is
the best-documented 447 lines in the slice: a Java developer can write DTOs from it in an afternoon, with five or
six fields they will have to ask about (listed in section 6). Coral really does reach Stencil only over HTTP: no
product, component or server file imports `@/simulator` (grep empty, lint-enforced), `apiOrigin()` never trusts the
request's Host, and the client is tested against a forged Host.

The weaknesses are known and listed, which is the right state for a prototype: identity fails open to Maya
(S2), consumer identity is a bare header (S5), demo reset and clock are callable by anyone (S1), and the `/api/v1`
GET handlers can still answer a non-JSON 500 (A4). What the backlog does not have: the app sends no security headers
at all (no `proxy.ts`, no `headers()` in `next.config.ts`), so nothing stops it being framed, and a CSP for the app
pages will be structurally awkward under Cache Components; the `@modal/[...catchAll]` slot makes
`/[team]/[...catchAll]` a typed route, so the typed-routes check accepts any `/<team>/<anything>` string and the 41
`as Route` casts are mostly noise; there is no `not-found.tsx` for `/sim`; and the preview route reads up to 1 MB of
body before it asks who is calling. Error shapes are down to three (`ApiErrorBody`, `ActionResult`, `SimResult`),
not one, exactly as A3's "partly fixed" says. Every Fixed status I spot-checked in this slice is true.

## 2. Scores

| # | Dimension | Score | One line |
| --- | --- | --- | --- |
| 1 | Architecture & layering | 8 | Routes are thin and lint keeps the simulator, contracts and server apart; the seam the Java team needs (`/api/v1` consumer-only, preview on its own route, Coral over HTTP) is real. Loses points for `requestOrigin()` reading `X-Forwarded-Host` and the preview route resolving identity after the body. |
| 2 | Correctness & robustness | 7 | 261 route tests pass against real temp databases; body caps are counted, not declared; cursors refuse stale epochs. A4's unhandled 500 on three GET routes, the 404-before-403 ordering in two places, and the default Next 404 for `/sim/*` are the open holes. |
| 4 | API & contract | 6 | Coherent, versioned in the path, one status table, machine-checked drift against the domain. But TypeScript-only (no OpenAPI), three error shapes across the app, `details` typed as a union that ends in `Record<string, unknown>`, number values with "source text" semantics, and the `Date` header carrying the demo clock. |
| 6 | Readability for humans | 7 | Route files read in under two minutes each; `api-v1.ts` and `cursor.ts` are models. `simulator/queries.ts` (525 lines) and `simulator/types.ts` (comment blocks that drifted, admitted in the README) are the files a newcomer will struggle with; "Phase 5"/"UCOMP"/"slice S1" history leaks into `api-v1.ts`, `golive-types.ts` and `types.ts`. |
| 9 | Security posture | 5 | Inputs are validated (zod or domain parsers everywhere, path ids regex-checked, CSV formula-escaped, HTML served with nosniff and a scriptless CSP), no injection surface found, and every gap is written down. The gaps themselves are large: fail-open identity, header-only consumer auth, ungated reset, no security headers, no rate limit, every render attempt a DB write. |
| 11 | Handoff readiness (Java/MSSQL/Azure) | 7 | The contract, the status table, the cursor format and the search order are each documented with the Java caveat spelled out (`compareCodePoints`, Postgres sequence note). Missing: OpenAPI, problem details, client credentials; and the search ranking cannot be a SQL keyset as written. |

## 3. Strengths

- **Every page is synchronous and streams.** All 22 `page.tsx` files were read: each default export is a plain
  function; request data is awaited only inside a `<Stream>` child (`versions/page.tsx`, `usage/page.tsx`,
  `sim/offers/[offerId]/page.tsx`, `request-access/page.tsx` are representative). `find src/app -name loading.tsx`
  returns nothing (measured). The two labs under `(dev)` are sync, fixture-only and `notFound()` in production
  (`editor-lab/page.tsx:12`, `pdf-lab/page.tsx:10`).
- **Body limits are counted, not trusted.** `src/server/api/read-body.ts` cancels the stream past the cap; the
  drafts route (`api/drafts/[versionId]/route.ts:28-36`) and imports (`api/imports/route.ts:33-42`) check
  permission before reading a byte, then cap at 2,000,000 and 10 MiB + 64 KiB; render and preview cap at 1,000,000
  through `readRenderRequest` (`render-http.ts:67-73`). The tests send chunked bodies with no Content-Length and
  assert the rest is never pulled (`drafts/route.test.ts:39-50`, `render/route.test.ts:319`).
- **Cursor paging is right.** `src/domain/golive/cursor.ts` is 174 lines a Java developer can port line by line:
  base64url JSON, list-scoped, epoch-checked, with `compareCodePoints` and the `String.compareTo` surrogate caveat
  written next to it. `notices/route.test.ts:140` covers the stale-epoch refusal; `:71` reads every notice once
  across pages.
- **The consumer API is consumer-only.** `render/route.ts` reads no cookie, refuses `"draft"` at line 27, ignores
  `preview`/`round`; the preview is `api/templates/[templateId]/preview/route.ts` on the session. Both share
  `readRenderRequest`/`renderSuccessResponse`, so bodies and headers cannot diverge. `e2e/api/render.spec.ts:635-674`
  prove the persona cookie has no say.
- **One `http.ts` for `/api/v1`.** Correlation id validated by regex (`http.ts:11-17`), `no-store`, `nosniff`,
  status from `API_ERROR_STATUS` which is `Record<ApiErrorCode, number>` so a new code cannot compile without one.
- **Upload serving is traversal-proof by construction.** `src/server/import/store.ts:14-15` regex-checks the id
  (`^up_[0-9a-z]{10}$`) and the stored path; file names are fixed; the client's file name never reaches the file
  system. `api/imports/[uploadId]/file/route.ts` sends the kind's MIME, `nosniff`, RFC 5987 `Content-Disposition`.
- **CSV export escapes formulas.** `src/domain/audit.ts:464` applies the OWASP leading-apostrophe rule.
- **Coral is separable.** `grep -rn "@/simulator" src/app/(product) src/components src/server` (excluding seed and
  reset) is empty (measured); `eslint.config.mjs:117-124,192-201` enforce both directions. `apiOrigin()`
  (`ucomp-api.ts:221-227`) uses `UCOMP_API_ORIGIN` or loopback and never the request's Host; `ucomp-api.test.ts`
  covers a forged Host.
- **Error boundaries match their decision.** Four boundaries (`(product)/error.tsx`, `templates/[templateId]/error.tsx`,
  `(simulator)/error.tsx`, `global-error.tsx`) and one view module (`route-error.tsx`) that shows the digest, never
  the message, and runs `retry` in a transition. The README's table of what each keeps is accurate.
- **Route tests are at the right layer.** `/api/v1` and preview tests run the exported handler against a seeded
  temp database with a mocked clock; drafts/imports tests mock the server function and test only the HTTP mapping
  (order of permission before body, cap, parse, status). 261 tests in 3.8 s (measured).

## 4. Findings

Severity is in the prototype's context (pre-auth, demo). "Structural" means hard to add later; "trivial" means a
flag or a few lines.

### High

**H1. Identity fails open to the default persona (S2, deferred).** verified. `src/server/viewer.ts:57-62`: a
missing or unknown `ucomp_persona` cookie loads Maya. Every internal route (`getViewer()` in all nine
`src/app/api/*` handlers and the audit export) and every page inherits it, so an anonymous `POST
/api/templates/UC-…/preview {version:"draft"}` renders Coral Offers' unreleased drafts. Structural in one sense: the
fix is one function, but no route today has a 401 path (`ReadRefusal.status` is `400 | 403 | 404 | 409`,
`reads.ts:19`), and `src/app/README.md:224` and decision 0019 both say 401 waits for sign-in. Fix: make `getViewer()`
return `Viewer | null`, add 401 to `ReadRefusal`, and have `requireSpace` redirect to sign-in; keep the persona
switcher as a dev-only provider.

**H2. Consumer identity is a self-asserted header, and every attempt is a write (S5, open).** verified.
`consumer-api.ts:67-74` and `render-template.ts:224-227`: `X-Consumer-Id` has no credential. In `runRender`
(`render-template.ts:150-170`) every request that finds a template and version writes a `render_log` row, including
`unknown_consumer` refusals, through the process-wide write lock. An anonymous loop on one public template id
becomes write pressure that autosaves and approvals wait behind. Structural: credentials belong at a gateway or in
the BFF; the log-on-failure rule should change now. Fix: write no row for `unknown_consumer`/`consumer_required`
(return before `renderVersion` as the route already does for `bad_request`), add rate limiting at the edge, and say
in `api-v1.ts` how a consumer authenticates.

### Medium

**M1. Demo reset and clock are callable by anyone (S1, deferred).** verified. `src/server/actions/demo.ts:18-27,
34-44`: no permission, no environment check. `resetDemo()` (`reset.ts:67-86`) drops every table on whatever
`DATABASE_URL` points at, including `libsql://`. Trivial to gate (`DEMO_MODE` from one config module); the
`file:`-only guard in `resetDemo()` should land before anyone points the app at Turso.

**M2. No security headers anywhere.** verified. There is no `proxy.ts`, and `next.config.ts` has no `headers()`.
App pages are served without `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`,
`Strict-Transport-Security` or `Permissions-Policy`; only `/api/v1`, the render HTML (`render-http.ts:99`), the
import file route and Coral's file route set `nosniff` (and the two HTML routes a scriptless CSP). The static
ones are trivial via `headers()` in `next.config.ts`. A page CSP is structural: the Next guide
(`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) requires a per-request nonce from
`proxy.ts` and dynamic rendering, which fights the static shell Cache Components builds; the team should decide
early between a hash-based CSP, `'strict-dynamic'`, or none. Not in the backlog.

**M3. `/api/v1` GET handlers can answer a non-JSON 500 (A4, open).** verified. `api/v1/templates/route.ts:15-33`,
`api/v1/templates/[templateId]/route.ts`, `api/v1/consumers/[consumerId]/notices/route.ts` have no `try/catch`;
only the render route (`render/route.ts:34-53`) and preview map a thrown error to `render_failed`. A database error
on search answers Next's default 500 without `ApiErrorBody` or a correlation id. Trivial: a `withApiErrors`
wrapper beside `withDemoDate`, with a test that mocks `db` to throw.

**M4. Three error shapes remain (A3, partly fixed).** verified. `/api/v1` and preview answer `{ error: { code,
message, details? } }`; the browser's routes answer `{ ok: false, code, reason }`; Coral's two reads answer
`{ ok: false, reason }` with no code (`read-response.ts`), and Coral's file route answers `text/plain` on 404
(`sim/deliveries/[deliveryId]/file/route.ts:16-19`). The README documents all three. The decision to wait for the
Java API's problem details is reasonable; the risk is that `preview` (a BFF route the Java team will not own)
shares the public shape and will have to change twice. Fix: when `/api/v1` moves to RFC 9457, convert the preview
route in the same PR, and give `SimResult` a `code` so Coral's error view can branch like Stencil's.

**M5. The integration panel builds consumer URLs from request headers (A8, open).** verified.
`src/server/queries/integration.ts:128-134` reads `x-forwarded-host`/`x-forwarded-proto` with a `localhost:3000`
default; the curl samples a template author copies therefore name whatever host the browser used. Trivial once a
config module exists (`CONSUMER_API_BASE_URL`), and it is the one place in the slice that trusts a forwarded header
(the simulator's `apiOrigin()` explicitly refuses to, `ucomp-api.ts:215-219`).

**M6. The contract is TypeScript only (A5, partly fixed).** verified. `src/contracts/api-v1.ts` stands in for an
OpenAPI document; `_DriftChecks` (`golive-types.ts:49-71`) catch drift at compile time only, and
`npm run typecheck` is the only thing that runs them. The simulator's `actions.test.ts` runs against a hand-written
fake Stencil behind `fetch` (README says so), so a wording change in a real route would not fail it. Section 6 lists
what an OpenAPI 3.1 document needs that the TypeScript cannot say.

### Low

**L1. No Origin or Sec-Fetch-Site check on the mutating routes (S10, open).** verified. `PUT /api/drafts/…` and
`POST /api/imports` rely on SameSite=Lax (`persona.ts:41-45`). Today it is moot: with no cookie the request acts as
Maya anyway (H1), so CSRF buys an attacker nothing they do not already have. It becomes real the day sign-in lands.
Trivial then. The 404-before-403 ordering S10 mentions is still there: `draftAccessRefusal` → `accessRefusal`
(`apply-patch.ts:45-54`) looks the version up first and answers `version_gone` for an unknown id, `generic` for a
known one on another team. traced.

**L2. The notices route is a consumer-existence oracle.** verified. `notices/route.ts:23-24` answers
404 `consumer_not_found` before 403 `consumer_mismatch`, so any registered consumer can learn which other consumer
ids exist by probing the path. Trivial: check mismatch first, or answer 403 for both. Not in the backlog.

**L3. The preview route resolves identity after reading the body.** verified.
`api/templates/[templateId]/preview/route.ts:31,57`: `readRenderRequest` buffers up to 1,000,000 bytes, then
`getViewer()` is called inside the `renderTemplate` arguments. Drafts and imports do the opposite on purpose
("Permission first, before a byte of the body is read"). Trivial to reorder; worth doing before sign-in so the
fail-closed viewer refuses before the buffer. Not in the backlog.

**L4. `@modal/[...catchAll]` weakens typed routes, and most `as Route` casts are noise.** measured.
`.next/types/routes.d.ts:4` lists `"/[team]/[...catchAll]"` among `AppRoutes`, so any `/<segment>/<anything>`
template literal satisfies the typed-routes check without a cast; the safety net the README describes
(`src/app/README.md:42-46`) does not catch a broken `/${team}/foo` link. Of the 41 `as Route` casts in non-test
source (2 in `src/app`, both Coral; 25 in `src/components`; 14 in `src/simulator`), four cast string literals that
the type would have accepted (`"/sim/notices"` in `sim/page.tsx:38`, `"/sim"` in `offer-view.tsx:178` and
`link-flow.tsx:135`, `"/"`-style in `route-error.tsx:35`), and about 25 cast template literals of real routes that
also type-check unaided. The ones doing real work hide stored hrefs (`command-palette.tsx:173`,
`notifications-popover.tsx:104,136`, `sidebar-card.tsx:129`, A9) and a value from `sessionStorage`
(`back-to-ucomp.tsx:45`, validated by `usable()`). None hides a broken link today (every target exists in
`routes.d.ts`). Fix: consider `@modal/[...catchAll]/page.tsx` → `default.tsx` returning null plus a `notFound()`
default (the Next `default.md` doc describes this), then remove the casts that compile without one.

**L5. No `not-found.tsx` for `/sim` or at the root.** traced. `src/app/(product)/not-found.tsx` is the only one.
`sim/offers/[offerId]/page.tsx:21` and `link/page.tsx:29` call `notFound()`, which lands on Next's default
unstyled 404 with no Coral layout and no way back; the same for `/editor-lab` in production. Trivial: a
`(simulator)/not-found.tsx` built from `SimError`'s pieces, and a root `not-found.tsx`. Not in the backlog.

**L6. Coral pages are not all "thin".** verified. `sim/customers/page.tsx` (56 lines) and `sim/deliveries/page.tsx`
(64) render whole tables inline in the page file, against the README's rule that a page renders chrome and a
`<Stream>` around a component from a feature folder (the other 20 pages follow it). The `(dev)` labs put 630 lines
of client components under `src/app` (`editor-lab.tsx` 232, `fixtures.ts` 226, `pdf-lab.tsx` 146); labelled as labs,
but a newcomer reading `src/app` meets them first. Readability, Low.

**L7. `getSimHome` fans out to the API on every `/sim` page and in the layout.** verified.
`simulator/queries.ts:252-288`: per offer, `loadLinkState` makes one or two GETs, plus `allNotices` pages the whole
outbox (up to 50 pages of 200); `NoticeBadge` in `(simulator)/layout.tsx:43` calls it again on every `/sim` page.
The README's "Don't copy" admits it. Fine for a demo; it is the first thing to fall over against a real backend.

**L8. The persona cookie has no `httpOnly` or `secure`.** verified. `persona.ts:41-45`, `demo.ts:20-24`: `path`,
`sameSite: "lax"`, `maxAge` only. Demo-only cookie; goes away with sign-in. Trivial.

**L9. `npm audit --omit=dev`: 3 moderate.** measured. `sprintf-js` (unbounded precision DoS) via
`mammoth → argparse`; the suggested fix downgrades mammoth to 0.3.29, which is wrong. An `overrides` entry for
`sprintf-js` or an upstream mammoth bump. Trivial.

**L10. Machine-specific config in the repo.** verified. `next.config.ts:12-17` `allowedDevOrigins` lists the
owner's LAN IP, tailnet IP and hostname. Belongs in an untracked local config or an env var. Relates to T8.

**L11. History leaks into the contract and type files.** verified. `api-v1.ts:1-20` says "UCOMP", "Phase 5
(going live)", "(Phase 3; …)"; `golive-types.ts:1-9,96-135,165-180,333-338` carries "written by the lead", "slice
S1/S2/D1/U3", "Added by S2", and 60 lines of signature comments restating code that lives elsewhere;
`simulator/types.ts:57-66,294-323` restates helper and action signatures the README already admits have drifted.
AGENTS.md's own rule is "describe what the code does now, not how it got there". A Java developer reading the
contract first will wonder what Phase 5 and UCOMP are. Delete the phase labels and the signature blocks; the
functions have doc comments of their own.

**L12. Three generated shadcn files import `cn` from the npm package `cn`, not `@/lib/utils`.** measured (outside
the slice, found while checking dependencies). `src/components/ui/alert-dialog.tsx:5`, `sheet.tsx:5`, `card.tsx:2`;
`package.json` lists `"cn": "^0.4.0"`. A different function with a different merge behaviour. Trivial.

**L13. Minor route inconsistencies.** verified. `imports/[uploadId]/view` sends no `nosniff` while its sibling
`file` route does; `imports/[uploadId]/file` sends `filename*=` with no plain `filename=` fallback; the audit export
lives under `(product)/[team]/audit/export/route.ts` while every other handler is under `/api` (documented, but one
more place to look). Trivial.

### Checked and clean

- SQL: every `sql\`` fragment in `src/server` and `src/simulator` (16, grep) is a column reference, a bound
  parameter or a constant; `reset.ts:27,38,48` interpolates table names read from `sqlite_master`, quoted, not
  attacker-reachable. No injection surface.
- XSS: one `dangerouslySetInnerHTML` (`components/import/docx-source.tsx:16`), fed by HTML allowlisted at import in
  `src/server/import/dom.ts` (traced, other slice; note it runs through `happy-dom`, a test DOM used as the server's
  sanitizer). Preview iframes use `srcDoc` with `sandbox="allow-same-origin"` and no `allow-scripts`
  (`buffered-frame.tsx:116`); Coral's web and email iframes use `sandbox=""` on a same-origin URL served with a
  scriptless CSP; the PDF iframe has no sandbox, which the browser's PDF viewer needs. `e2e/api/render.spec.ts:386`
  checks a value cannot break out of the HTML.
- Secrets: none in the tree (grep for key/token/secret patterns finds only a test string and a vendored skill doc);
  `.env*` is gitignored; no `.env.example` (T4).
- Open redirect: `back-to-ucomp.tsx:15-17` accepts only same-origin, non-`//`, non-`/sim` paths;
  `pdf-lab.tsx:32-35` rejects a cross-origin `?src=`.
- SSRF: `apiOrigin()` ignores request headers; tested.
- Request-time correctness under Cache Components: `now()` awaits `connection()` (`clock.ts:20`); Coral's three
  routes and its queries call `connection()` before `simDb`; the `/api/v1` GETs read `request.headers` first. No
  page awaits `params` at the top. The deviations are the documented ones: bare `Suspense` in `[team]/layout.tsx:13`,
  the two settings pages and `settings-shell.tsx:57`; `params.then` in `workspace-tab-bar.tsx:19`.

## 5. Backlog check

| Finding | Status line | True? | Evidence |
| --- | --- | --- | --- |
| S1 Critical, demo tools ungated | Deferred | Yes | `actions/demo.ts` has no check; `reset.ts` accepts any URL. verified |
| S2 High, identity fails open | Deferred | Yes | `viewer.ts:58-59`. verified |
| S5 High, consumer header | Open | Yes, and under-described | `render-template.ts:150-170` logs `unknown_consumer` attempts too. verified |
| S6 Medium, body limits trust Content-Length | Fixed | Yes | `read-body.ts`; drafts, imports, render, preview all count; tests send chunked bodies. measured |
| S8 Medium, mocks and labs in production | Fixed | Yes | `(dev)` holds two labs that `notFound()` in production; no `/design`. verified |
| S10 Low, no Origin check | Open | Yes | No check in drafts or imports; 404-before-403 still there. verified/traced |
| A1 High, public endpoint serves previews | Fixed | Yes | `render/route.ts` reads no cookie, refuses `"draft"`; preview is its own route; e2e proves it. verified |
| A2 High, polling misses a revoke | Fixed | Yes | `cursor.ts`, `listNotices` on `seq`, epoch check; tests. measured |
| A3 Medium, six error shapes | Partly fixed | Yes | Three shapes (plus a text/plain 404 in Coral); only `/api/v1` and preview keep the old one. verified |
| A4 Medium, non-JSON 500 | Open | Yes | No try/catch in the three GET handlers. verified |
| A5 Medium, TypeScript-only contract | Partly fixed | Yes | No OpenAPI; simulator tests use a fake. verified |
| A6 Medium, reads as server actions | Fixed | Yes | Five GET routes with zod in their queries; lint rule at `eslint.config.mjs:179-191`. verified |
| A7 Medium, Date header is the demo clock | Deferred | Yes | `http.ts:44-50`. verified |
| A8 Low, sample URLs from headers | Open | Yes | `integration.ts:128-134`. verified |
| N9 Low, error-boundary loose ends | Fixed | Yes | `(simulator)/error.tsx` exists; `TabError` blocks the tab bar (per README). verified/traced |
| N15 Low, Coral drops a mapping / UTC sunset | Fixed | Yes | `sunsetDay`/`zone` on `ApiVersionSummary`; Coral shows `sunsetDay` (`queries.ts:85`). verified |
| N18 Low, readBodyCapped in import folder | Fixed | Yes | `src/server/api/read-body.ts`. verified |
| N19 Low, simulator reads as actions | Fixed | Yes | `actions.ts` exports four writes; two GET routes under `(simulator)/sim`. verified |

New, not in the backlog: M2 (no security headers), L2 (consumer oracle), L3 (preview reads body before viewer),
L4 (catchAll weakens typed routes), L5 (no `not-found.tsx` for `/sim`/root), L9 (audit), L10 (`allowedDevOrigins`),
L11 (history in the contract files), L12 (`cn` package).

## 6. For the Java team

**Ports cleanly**

- `src/contracts/api-v1.ts` → DTOs. Field names are camelCase, dates are ISO strings, ids are strings, enums are
  closed unions. `API_ERROR_STATUS` (`golive-types.ts:74-94`) is the status table; copy it as an enum with a status.
- `src/domain/golive/cursor.ts` → the cursor codec. Consumers store cursors, so the format (decision 0006) is part
  of the contract even though it is "opaque": base64url of `{"v":1,"list":"notices","consumer","template","epoch","seq"}`
  and `{"v":1,"list":"search","q","last":{rank,name,id}}`. The Postgres note in the decision applies to MSSQL too:
  notice `seq` must be commit-ordered (serialize the insert, or only serve rows below the oldest open transaction).
- `src/domain/golive/api-errors.ts` → the fixed sentences and the `limit`/`version` parsers.
- The handler shape: headers → consumer → parse → query → `jsonResponse`/`errorResponse`. Every handler is a
  controller method already.
- `renderSuccessResponse` (`render-http.ts:107-160`): the per-channel response matrix (PDF bytes vs base64 JSON,
  web HTML with CSP, email JSON, push/SMS JSON) and the `X-Stencil-*` headers.

**Needs rethinking**

- `ApiRenderRequest.values: Record<string, string | number>` with "a JSON number keeps its exact source text"
  (`api-v1.ts:338-340`, `render-http.ts:63-66`). Jackson will parse `21.90` to a `double` or a `BigDecimal` with scale
  2 (`new BigDecimal("21.90").toPlainString()` is `"21.90"`, but `1e1` becomes `1E+1`, which the domain refuses as
  text). Either parse `values` as a raw tree and keep the token text, or restrict the contract to strings.
- `ApiError.details` is a union that ends in `Record<string, unknown>` (`api-v1.ts:61-71`), so there is no single
  DTO; discriminate by `error.code` and document each code's `details` shape as `oneOf`.
- `ApiNotice` has fields that are null except for some kinds (`sunsetAt`, `sunsetDay`, `zone`, `reason`,
  `changes`), and `ApiContractChange` is a union on `kind` with literal `breaking: true`. Model both as sealed
  hierarchies with `@JsonTypeInfo(property = "kind")`.
- `ApiTemplateDetail.name` follows a three-way rule written only in a comment (`api-v1.ts:186-189`,
  `consumer-api.ts:228-230`): Active version's, else the newest still-rendering version's (`contractBaseline`), else
  the newest released. `ApiVersionSummary.activatedAt` is non-null because the code falls back to `createdAt`
  (`consumer-api.ts:172`). Write both into the OpenAPI description.
- `renders`, `sunsetPassed`, `sunsetDay`, `zone` are computed at read time from `now` and the current platform
  zone (`versionSummary`, `consumer-api.ts:161-188`); a notice keeps the zone it was written under. Decision 0038
  explains; the DTO comments say it too. Keep that asymmetry.
- Search (`searchActiveTemplates`, `consumer-api.ts:99-155`) loads every Active version into memory and ranks in
  JS (exact id, name starts with query, the rest), then pages on `(rank, name, id)` by code point. The rank is
  computed, so this is not a SQL keyset; either compute rank in SQL (a `CASE`) with a collation that matches
  `compareCodePoints` (MSSQL `Latin1_General_BIN2`), or accept in-memory paging with a cap.
- `X-Consumer-Id` → client credentials (Entra app registration), and `unknown_consumer` must not write
  `render_log`. The `Date` header → real time; if a demo clock survives, its own header.
- The three error shapes: decide RFC 9457 for `/api/v1`, and change the preview route (a BFF route this app keeps)
  in the same change, since it shares the shape today.
- `/api/v1` is the only part the Java team must serve; the internal routes (`/api/templates/*`, `/api/drafts`,
  `/api/imports`, `/api/palette`, the audit export) stay in the BFF and call the Java service behind them.

**Read first**

1. `src/contracts/api-v1.ts` (447 lines; the contract and its examples).
2. `src/contracts/README.md` (the sunset rule, the notices table, the status table, the drift checks).
3. `src/server/queries/consumer-api.ts` (how each DTO is built; the name and `activatedAt` rules).
4. `src/domain/golive/cursor.ts` with `docs/decisions/0006-page-notices-by-commit-order.md`.
5. `src/server/render/render-template.ts` (the header comment is the render pipeline; `docs/render-spec.md`
   specifies it) and `src/server/api/render-http.ts`.

## 7. Files

**Models of good code in this slice**

- `src/app/api/v1/templates/route.ts` (33 lines): the whole public-route pattern in one screen.
- `src/app/api/drafts/[versionId]/route.ts` (42 lines): permission, then declared length, then counted length, then
  parse, then save; the comment says why it is a route and not an action.
- `src/server/api/read-body.ts` (29 lines): one job, tested with chunked bodies.
- `src/domain/golive/cursor.ts`: the cursor codec with its Java caveat written where a porter will see it.
- `src/server/api/render-http.ts`: the two render routes' shared body read and response matrix, with `assertNever`.
- `src/simulator/ucomp-api.ts`: a small, honest HTTP client that keeps the API's errors verbatim and refuses to
  trust the Host header.
- `src/components/app-shell/route-error.tsx`: what every error boundary shows, and why it never shows the message.
- `src/app/README.md`: the route map, the handler table and the "Don't copy" list are true to the code (checked
  against every handler and page).

**Files a human will struggle with**

- `src/simulator/queries.ts` (525 lines): six read models, batch grouping, SMS thread assembly and the file-serving
  read in one module; `getSimHome` fans out N+1 API calls. Split by page, as the README's "Don't copy" half-suggests.
- `src/simulator/types.ts` (326 lines): a third of it is comment blocks restating signatures that live in
  `mapping.ts` and `actions.ts`, admitted to have drifted. Delete the blocks.
- `src/domain/golive-types.ts` (392 lines): re-exports, drift checks, three unrelated read-model families and 60
  lines of "slice S1/S2" signature comments. The drift checks and `API_ERROR_STATUS` deserve their own small file
  next to the contract.
- `src/app/(dev)/editor-lab/editor-lab.tsx` and `fixtures.ts` (458 lines): client code under `src/app`, the one
  place the "thin" rule is visibly suspended.
- `src/simulator/ui/link-flow.tsx` (335) and `offer-view.tsx` (278): dense client state machines with `as Route`
  casts and a `key` built from three fields (`link/page.tsx:30`); readable, but not in ten minutes.
