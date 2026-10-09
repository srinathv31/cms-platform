# Architecture

Stencil is a CMS for regulated customer content. Teams write templates with typed variables, send each version
through an approval chain, and publish it. Consumer systems then render the Active version over `/api/v1` as a web
page, an email, or a PDF, sending their own values for the variables.

It is one Next.js 16 app (App Router, Cache Components) on one local SQLite file. Three things share the app: the
CMS itself, **Coral**, a simulated consumer that calls `/api/v1` the way an outside system would, and a set of
dev-only design mocks. It is a working prototype on its way to production. The production backend isn't decided:
either the existing Spring Boot "UCOMP API" with this app as its BFF, or this app's own server code. Changes should
keep both open, which mostly means: rules in `src/domain`, database access only in `src/server`.

## Layers

| Folder | What it is | README |
| --- | --- | --- |
| `src/app` | Routes, layouts, and route handlers. Thin: pages render a `<Stream>` around a component; handlers parse HTTP and call `src/server`. | [src/app](../src/app/README.md) |
| `src/components` | The React UI: generated shadcn kit, shared primitives, motion, app shell, one folder per feature. | [src/components](../src/components/README.md) |
| `src/editor` | The document editor (TipTap v3), framework-agnostic and liftable into another app. | [src/editor](../src/editor/README.md) |
| `src/domain` | The business rules as pure TypeScript: lifecycle, permissions, access, approval chain, render rules, import, and every sentence people read about them. | [src/domain](../src/domain/README.md) |
| `src/server` | Everything that touches the database, the persona cookie, the clock, or the file system: server actions, read models, schema, render pipeline, import, autosave, seed. | [src/server](../src/server/README.md) |
| `src/contracts` | The `/api/v1` wire types, with no imports, shared by the API and Coral. | [src/contracts](../src/contracts/README.md) |
| `src/simulator` | Coral, the simulated consumer, with routes in `src/app/(simulator)`. | [src/simulator](../src/simulator/README.md) |
| `src/hooks`, `src/lib`, `src/styles` | `useIsMobile`; `cn` and the SQLite write lock; design tokens and fonts. | Covered in [src/components](../src/components/README.md#srchooks-srclib-srcstyles) |
| `e2e` | Playwright specs, helpers, and fixtures. | [Testing](#testing) |
| `scripts` | `db:migrate`, `db:reset`, `docs:check`. | |
| `data` | The SQLite file and uploaded originals. Gitignored; `npm run db:reset` creates it. | |

## What may import what

```text
  src/contracts          imports nothing
       ^      ^
       |      +------------ src/simulator, src/app/(simulator)
       |                      may also use @/server/db/schema/sim, @/components, @/lib; never @/server, @/domain, @/editor
  src/domain             pure: no react, next, drizzle, @/server, @/components, @/app, @/simulator
       |                      from the editor, only @/editor/model/*
       v
  src/editor/model       (the editor itself: react, TipTap, @/components/ui only; no next/*, no app code)

  src/app/(product), src/app/api, src/components  -->  server, domain, editor, lib, contracts   (never simulator data)
  src/server                                     -->  domain, editor modules (not bare @/editor), lib   (never simulator data)
  src/server/seed, src/server/reset.ts           -->  may also write the simulator's tables
```

Every rule above is lint-enforced in [eslint.config.mjs](../eslint.config.mjs). Flat config replaces the rule per
file, so its blocks cover disjoint globs; when you add a rule, list everything that applies to those files.

Conventions that nothing enforces yet, and where the code already breaks them:

- **Only `src/server` reads the database.** True today: about 40 files under `src/server` import the `db` client,
  and none elsewhere (apart from `scripts/db-migrate.ts` and route tests). Keep it that way; it is the seam a Spring
  Boot backend would replace.
- **New business rules go in `src/domain`.** About a dozen live in actions, queries, and components today; the
  [domain README](../src/domain/README.md#rules-that-live-outside-srcdomain) lists them.
- **`src/server` doesn't import `src/components`.** Two files do (`queries/submit-summary.ts`,
  `actions/create-template.ts`).
- **Components get permissions decided.** Read models carry `can` results; a few components still call `can()`
  themselves.

## How requests flow

### A page: the Versions tab

1. [versions/page.tsx](../src/app/(product)/[team]/templates/[templateId]/versions/page.tsx) is synchronous. It
   renders `<Stream fallback={<VersionsSkeleton />}>` around `VersionsContent` and passes the `params` promise
   down unawaited.
2. Above it, the layouts: the root layout mounts fonts and `<Providers>`; `(product)/layout.tsx` renders the static
   `AppFrame` with viewer-dependent parts streamed in; `[team]/layout.tsx` checks the team slug; the workspace layout
   renders the header and tab bar.
3. [versions-content.tsx](../src/components/versions/versions-content.tsx), a server component, awaits `params` and
   calls `getVersions()` from [queries/versions.ts](../src/server/queries/versions.ts).
4. The read model checks access (`requireTemplate`), reads the demo time, queries the tables, and returns
   `VersionsData`: plain, serializable, dates as ISO strings, with `can` results decided per version.
5. Client components (`version-actions.tsx`, `sunset-dialog.tsx`) receive it as props.

Request data (cookies, `params`, database reads, the clock) is read only inside `<Stream>`. With Cache Components,
anything else is a build error. If `VersionsContent` throws, the template's error boundary shows "This tab didn't
load." in the tab's place, under the header and the tab bar ([Errors](../src/app/README.md#errors)).

### A mutation: setting a sunset date

1. [sunset-dialog.tsx](../src/components/versions/sunset-dialog.tsx) calls the `setSunset` server action inside
   `useActionDialog` ([action-dialog.tsx](../src/components/versions/action-dialog.tsx)): one request at a time,
   closes on `ok`, shows `reason` otherwise.
2. `setSunset` in [actions/review.ts](../src/server/actions/review.ts): `getViewer()`, zod parse, permission check,
   `now()` once, then one transaction. Inside it: re-read the version, call the domain transition, write the changes
   with a compare-and-set on `state`, `rev`, and `currentStage`, and write the effects (audit row, notifications,
   consumer notices) with `writeEffects`. On success, `revalidatePath()` and `refresh()`.
3. The transition (`setSunset` in [lifecycle.ts](../src/domain/lifecycle.ts)) decides; the action only writes. A
   refusal is a value whose `reason` is the sentence the person reads.

The [server README](../src/server/README.md#anatomy-of-a-mutation) walks through it line by line, with the
variations to avoid.

### An autosave

1. The workspace's autosave ([use-draft-autosave.ts](../src/components/workspace/autosave/use-draft-autosave.ts))
   debounces edits (800 ms, at most 5 s), sends one request at a time, and flushes on page hide. While anything
   typed isn't saved, closing or reloading the page asks first. It runs the server's document check first, so a
   patch the server would refuse is never sent. The workspace header binds it to the draft on every tab. A
   refusal retrying can't fix (a conflict) stops it for good: the page turns read-only and offers Reload
   ([decision 0020](decisions/0020-autosave-never-drops-edits-silently.md)).
2. `PUT /api/drafts/[versionId]` is a route handler, not a server action, because actions run one at a time per
   client. It checks that the viewer may edit the draft before reading a byte of the body, reads the body with a
   byte counter that stops at 2 MB (413 past it), parses the patch, and calls `saveDraft`.
3. [apply-patch.ts](../src/server/drafts/apply-patch.ts) prepares the body and email fields with
   [prepare.ts](../src/server/documents/prepare.ts): normalized, checked against the document limits and the editor
   schema, block ids added. Import stores documents through the same function. Then, in one transaction, it checks
   permission, the `draft` state, and `rev` (tolerating a lost response from the same session), writes with a
   compare-and-set, adds the saver to the version's `writers` (nobody decides a version they wrote), and keeps one
   `draft.edited` audit row per editing session. Nothing is refreshed; the client already has the content.

### A consumer render, and the preview that shares it

`POST /api/v1/templates/{id}/render`
([route.ts](../src/app/api/v1/templates/[templateId]/render/route.ts)) runs
[render-template.ts](../src/server/render/render-template.ts), whose header lists every step and the error each
returns. The rules are specified in [render-spec.md](render-spec.md). The one behind all of them: every channel
prints exactly what the author typed and saw, with no rounding, dropping, renumbering, or rewording.

1. Find the template and version (404). Check the consumer (`X-Consumer-Id`, 403), or for a preview, the viewer.
2. Version rules, consumers only (`checkVersion` in
   [version-rules.ts](../src/domain/render/version-rules.ts)): Active renders; Superseded renders until its sunset,
   then 410; Revoked is 410; unreleased states are 409.
3. Channel allowed and enabled (422). The rest is the engine ([engine.ts](../src/server/render/engine.ts)), which
   needs no database, clock, or request: values valid (422; each at most 1,000 characters, and a JSON number keeps
   its exact source text), then the document check.
4. Resolve the TipTap JSON to a `RenderDoc` (`src/domain/render`), then a channel adapter renders web HTML, an email,
   or a PDF.
5. One `render_log` row, success or error. It never stores the values.

The golden files run the same engine on frozen inputs, so a golden file is exactly what the API returns.

The CMS preview posts to the same URL with `preview: true` and the persona cookie instead of `X-Consumer-Id`. It
skips the version rules and is logged as a preview. Coral calls the URL over HTTP from the server, as a real
consumer would. Because the preview shares the endpoint, another backend can't take over `/api/v1` until the two
are split.

## Data

One SQLite file, `data/ucomp.db`, through libSQL and Drizzle. `DATABASE_URL` and `DATABASE_AUTH_TOKEN` can point
at Turso instead. Two schema files:

- [schema/ucomp.ts](../src/server/db/schema/ucomp.ts), the CMS:
  - **Settings:** `settings` (demo clock offset, seed version).
  - **People and teams:** `users`, `teams`, `memberships`, `membership_roles`.
  - **Platform configuration:** `content_types` (required sections, allowed channels), `approval_stages`.
  - **Templates:** `templates` (id, team, content type; no name); `versions` (the name, body as TipTap JSON,
    variables, channels, state, `rev`, `writers`, the approval `stages` recorded at submit, sunset and revoke
    fields); `approvals` (each decision's stage id). The name is a version field, so a rename goes through
    review ([decision 0016](decisions/0016-the-name-is-versioned.md)).
  - **Review:** `comment_threads`, `comments`.
  - **Import:** `uploads`.
  - **Consumers:** `consumers`; `render_log`; `consumer_notices` (an outbox, written with the change that causes it
    and numbered in commit order by `seq`, which the notices API pages on).
  - **Audit and access:** `audit_events`, `notifications`, `access_requests`, `recertifications`, `recert_items`.
- [schema/sim.ts](../src/server/db/schema/sim.ts), Coral's `sim_*` tables. Only the simulator, the seed, and the
  reset may import it.

Conventions: JSON columns are typed with domain types; timestamps are millisecond integers read as `Date`, and become
ISO strings at the read-model boundary. Partial unique indexes allow one open draft and one Active version per
template. Every write in the process takes turns on one lock (`createAppClient` in `src/lib/serialized-writes.ts`),
and `inTransaction` retries `SQLITE_BUSY`. Migrations are in `src/server/db/migrations`; the
[server README](../src/server/README.md#database) says how to add one.

## Time, identity, and demo data

- **The demo clock.** `now()` in [clock.ts](../src/server/clock.ts) is real time plus `settings.clock_offset_days`.
  It is the only reader of the current time on the server; domain functions take `now` as an argument. The Demo
  pill's "Advance clock" moves the offset, and `/api/v1` responses carry it in their `Date` header.
- **Identity.** There is no login. `getViewer()` reads the `ucomp_persona` cookie. A missing or unknown cookie acts
  as Maya.
- **Seed** ([src/server/seed](../src/server/seed/index.ts)), deterministic, rebuilt by `npm run db:reset`:

  | | |
  | --- | --- |
  | Teams | `coral-offers`, `deposits`, `card-statements` (ids equal slugs); `all` is the cross-team space |
  | Switchable personas | `maya` (default), `jordan`, `alex`, `priya`, `sam`, `riley` (Platform Admin), `taylor` (Auditor), `morgan`, `dana` (Legal reviewer) |
  | Content type | `disclosure`: required sections `offer_details`, `rates_and_fees`, `legal_notices`; channels `pdf`, `web`, `email` |
  | Template ids | `UC-` plus 6 Crockford base32 characters, e.g. `UC-4F7K2Q` |
  | Consumer | `coral`, with offers, customers, and links in the `sim_*` tables |

## Configuration

- [next.config.ts](../next.config.ts): `cacheComponents: true`, `typedRoutes: true`, dev indicators off, and libSQL
  kept out of the bundle (`serverExternalPackages`). Partial prefetching stays off: on 16.3.8 it re-requests every
  link's route tree in a loop in this app. The "router prefetch" tests in `e2e/phase-1.spec.ts` guard against it.
- Environment variables: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`; `UCOMP_API_ORIGIN` (where Coral sends requests;
  default this server over loopback) and `PORT`. E2E reads `E2E_PORT` and `E2E_GATE_PORT`.
- Uploaded originals are stored under `data/uploads/`. PDF fonts are read from `node_modules` at render time.

## Not production-ready yet

Facts about the code today. Each line goes away in the PR that fixes it.

- No real authentication: the persona cookie, failing open to Maya, identifies every request.
- Demo controls are ungated: reset, advance clock, and persona switch work in any build, for anyone.
- `/design/*`, `/editor-lab`, and `/pdf-lab` are prerendered into production builds and answer by URL.
- A consumer is identified by the `X-Consumer-Id` header alone, with no credential or rate limit.
- Access deadlines (recertification, inactivity) apply only when the sweep runs: on a clock advance, a persona
  switch, or an access action. There is no scheduled job.
- Several invariants rely on SQLite's single writer and would need constraints or locks on another database.
- No CI, no Node version pin, no `.env.example`, and no machine-readable API description (OpenAPI).

## Testing

- **Unit:** Vitest, `npm test`, about 10 seconds for the whole suite. Tests sit beside their code. The environment
  is `node`; a test that needs a DOM starts with `// @vitest-environment happy-dom`. Database tests use temporary
  files and never touch `data/ucomp.db`. Each layer README covers its own helpers.
- **End to end:** Playwright, `npm run e2e`, against the production build on port 3100, so run `npm run build`
  first. When nothing is listening there, it runs `npm run db:reset` and starts `next start`. The helpers in
  `e2e/api/helpers.ts` open `data/ucomp.db` directly and write to it, so `DATABASE_URL` can't isolate a run. To keep
  your local demo data, run the suite from a copy of the working tree. The full suite takes about 12 minutes.
- **Golden files:** [src/server/render/golden](../src/server/render/golden/README.md) freezes every channel's
  output for a set of documents and checks that web, email, and PDF show the same content. Any change to render
  output fails `npm test` until it is regenerated with `npm run golden:update` and the diff is read. They are also
  the acceptance test for a second render engine.
- **Principles:** `e2e/principles.spec.ts` checks every screen as every persona that can see it: one primary
  button per canvas or dialog, status words only in `StatusBadge`, no placeholder text, no serious axe violations,
  and zero layout shift. It is read-only and can run against a dev server:
  `E2E_PORT=3000 npx playwright test e2e/principles.spec.ts --workers=1`.
- **Docs:** `npm run docs:check` ([scripts/docs-check.ts](../scripts/docs-check.ts)).
