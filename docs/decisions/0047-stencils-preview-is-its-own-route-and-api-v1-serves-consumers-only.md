# 0047. Stencil's preview is its own route, and `/api/v1` serves consumers only

Status: Accepted
Amended 2026-10-12: the render engine moves to Java ([0067](0067-java-renders-every-channel.md)), so after the port the preview route calls Java's render endpoint with the viewer's identity, as the first Consequences line foresaw, and its error body moves with `/api/v1`'s to the UCOMP API's format ([0056](0056-api-v1-errors-follow-the-ucomp-api-error-format.md)).
Amended 2026-10-13: the preview route asks the backend to render through the service interfaces (`services().render.preview`, with the request's context and its correlation id), which on this app's database runs the consumer route's pipeline (`runRender` in `src/server/services/local/render/render-template.ts`, where `previewAllowed` is). Nobody signed in is refused `preview_forbidden` by the route, without asking the backend.
Amended 2026-10-13 (PR #79 review): a template, version or draft the viewer may not preview reads as 404
`template_not_found`, as one that isn't there, and is not logged
([0052](0052-what-a-viewer-cant-see-reads-as-not-found.md)): a 403 after the template and the version were found told
anyone signed in which templates, versions and drafts another team has. No route returns `preview_forbidden` now.
Date: 2026-10-11

## Context

`POST /api/v1/templates/{id}/render` answered two callers. A consumer named itself with `X-Consumer-Id` and got a
released version by number. The CMS's own Preview sent `preview: true` with no consumer, and the route then read the
persona cookie (`getViewer()`), accepted `version: "draft"` and a `round`, rendered any state, and tagged the answer
`X-Stencil-Preview`. Two ways of knowing who is asking, and two sets of rules, shared one public URL
([A1](../handoff-review.md#a1--high-the-public-consumer-endpoint-also-serves-cms-previews)).

`/api/v1` is the contract the Java API takes over. If it still carried the preview, either the Preview would break
the day Spring owns the URL, or Spring would have to accept the browser's session cookie and serve unapproved drafts.
The handoff review's order for real sign-in puts this first: keep the session off `/api/v1`.

## Decision

- **The Preview calls `POST /api/templates/{templateId}/preview`**, a Stencil route beside the other on-demand
  reads ([0019](0019-on-demand-reads-are-get-routes.md)). It is a POST because it carries the sample values, and it
  writes no application state. `getViewer()` says who is previewing, and the route renders only for someone who may
  see that version (`previewAllowed` in `render-template.ts`, unchanged: the template's team, the stage a version in
  review waits on, or a decider who still has active access), else 404 `template_not_found` (amended above). Any state previews: a
  draft, a version in review, revoked, Superseded. It takes `version` as `"draft"` or a number, an optional `round`,
  the channel, a push's `platform`, `values` and `encoding`, with the same limits as the consumer route.
- **The same engine and the same answers.** Both routes read the request with `readRenderRequest` and answer with
  `renderSuccessResponse` (`src/server/api/render-http.ts`), and both call `renderTemplate`, so bodies, headers
  (`X-Stencil-Preview: true` on the preview only), the render engine's `{ error: { code, message, details? } }` and
  its statuses are the ones the Preview always had: the approver gate's "can't be shown" ([0037](0037-an-approver-views-every-output-before-approving.md))
  reads the same `render_failed` and `details`. Previews are still logged as previews (`is_preview`, no consumer) and
  never count in Usage.
- **`/api/v1/.../render` serves consumers only.** It requires `X-Consumer-Id`, serves a released number (Active, or
  Superseded until its sunset), never a draft or a version in review, and never reads the session or any cookie. A
  request that used to be a preview is refused like any consumer request that doesn't qualify: a draft is 400
  `bad_request` ("version must be a version number."); a number with no consumer is 400 `consumer_required`; an
  unreleased number with a consumer is 409 `version_not_released`. `preview` and `round` are no longer in the body's
  schema, so they are ignored like any other field the contract doesn't list.
- **Nothing in Stencil's UI calls `/api/v1`.** `renderPreview` (`src/components/preview/render-preview.ts`) is the
  one caller, behind the editor's and workspace's Preview and the review screen's. Coral still reaches Stencil only
  over `/api/v1`.

## Alternatives considered

- **A `mode` or a header on the one route.** It keeps two auth models on one public URL, which is the finding.
- **A server action for the preview.** A client's actions run one at a time with its mutations; a preview per
  keystroke would queue behind Edit and Submit, the reason reads became routes ([0019](0019-on-demand-reads-are-get-routes.md)).
- **Reshape the preview's errors as `{ ok: false, code, reason }` now** ([0041](0041-routes-refuse-in-the-actions-shape.md)).
  The Preview reads the render engine's error body and its `details` (the characters a PDF font can't draw), and the
  same bodies are what a Java port of the engine will return. It moves with the rest of the error shapes (A3).

## Consequences

- When the Java API takes `/api/v1`, it serves consumers and needs no browser session. The preview stays in this app
  (or its BFF) and calls the render engine with the session; if the render engine moves to Java, the BFF forwards
  the viewer's identity and the Java service decides, as it does for every other call.
- The `preview_forbidden` code stays in the shared `RenderErrorCode` and the published `ApiErrorCode`, but `/api/v1`
  never returns it. Removing it from the public contract needs the render types split into a consumer set and a
  preview set; it is not done here.
- Until real sign-in, `getViewer()` still returns Maya for a missing or unknown cookie, so an anonymous caller can
  preview Coral Offers' drafts through the new route, as it could through the old one. That is the finding filed
  with the persona cookie, not this one, and it now has one route to close it on.
- `e2e/api/render.spec.ts` covers the consumer route, including that a preview-shaped request is refused;
  `e2e/api/preview.spec.ts` covers the preview route.
