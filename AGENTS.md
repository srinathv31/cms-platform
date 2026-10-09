# Stencil

A CMS for regulated customer content. Teams write templates with typed variables, approve versions through an
approval chain, and publish them; consumer systems render the Active version over `/api/v1` as web, email, or PDF.
Next.js 16.3.8 (App Router, Cache Components), React 19, TipTap v3, Drizzle on SQLite, shadcn on Base UI.

It's a prototype being prepared for a dev team to build to production. The backend isn't decided (the existing
Spring Boot API with this app as its BFF, or this app's own server), so keep every change portable: business rules
go in `src/domain`, and only `src/server` touches the database.

Read [docs/architecture.md](docs/architecture.md), then the README of the layer you're changing. The map of all docs
is [docs/README.md](docs/README.md). Ignore `docs/archive/`: it records how the prototype was built, not the code.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3000. |
| `npm run db:reset` | Drops and reseeds `data/ucomp.db` and empties `data/uploads`. Needed once after cloning. |
| `npm run typecheck` | `next typegen && tsc --noEmit`. Run it after adding or renaming a route. |
| `npm run lint` | ESLint, including the import boundaries below. |
| `npm test` | Vitest, about 10 seconds. Never touches `data/ucomp.db`. |
| `npm run docs:check` | Fails on broken doc links and paths, and on a `src/` folder without a README. |
| `npm run golden:update` | Regenerates the render golden files after an intended change to render output. Read the diff. |
| `npm run build` | The production build. It is the only check that enforces the Cache Components rules. |
| `npm run e2e` | Playwright against the production build on port 3100. Resets `data/ucomp.db` and writes to it. |
| `npm run db:generate`, `npm run db:migrate` | Generate a migration from the schema; apply migrations. |

Before you finish: `npm run typecheck`, `npm run lint`, `npm test`, and `npm run docs:check`. Add `npm run build`
when you changed a page, a layout, a route handler, or anything a server component reads. Don't run `npm run e2e` or
`npm run db:reset` in someone's working copy without asking: both wipe the demo database.

## Layers and boundaries

| Folder | Holds | README |
| --- | --- | --- |
| `src/app` | Routes, layouts, route handlers. Thin. | [src/app](src/app/README.md) |
| `src/components` | The React UI. `ui/` is generated shadcn. | [src/components](src/components/README.md) |
| `src/editor` | The TipTap document editor, framework-agnostic. | [src/editor](src/editor/README.md) |
| `src/domain` | Business rules, pure TypeScript. | [src/domain](src/domain/README.md) |
| `src/server` | Database, identity, clock, server actions, read models, render, import, seed. | [src/server](src/server/README.md) |
| `src/contracts` | `/api/v1` wire types. No imports. | [src/contracts](src/contracts/README.md) |
| `src/simulator` | Coral, a simulated consumer that reaches Stencil only over `/api/v1`. | [src/simulator](src/simulator/README.md) |

Lint-enforced ([eslint.config.mjs](eslint.config.mjs)):

- `src/domain` imports no React, Next.js, Drizzle, `@/server`, `@/components`, `@/app`, or `@/simulator`, and from
  the editor only `@/editor/model/*`.
- `src/editor` imports no `next/*` and no app code; from `src/components`, only `@/components/ui/*`.
- `src/contracts` imports nothing.
- `src/simulator` and `src/app/(simulator)` import nothing from `@/server`, `@/domain`, or `@/editor`, except
  `@/server/db/schema/sim`. Nothing outside them (but the seed and reset) imports simulator code or tables.
- There is no `@/editor` barrel. Import each export from the module that defines it.

Not enforced yet; follow them anyway:

- New business rules go in `src/domain`. Never add one to an action, a query, or a component.
- Only `src/server` imports the database client.
- `src/server` doesn't import `src/components`. Shared types go in `src/domain`.
- Read models return permissions decided (`can: { action: PermissionResult }`). Components render them; they don't
  call `can()` or compare refusal sentences.

## Next.js 16 rules for this repo

This isn't the Next.js in your training data. Read the guide in `node_modules/next/dist/docs/` before you use a
Next.js API; Next's own note about it is at the end of this file.

- **Cache Components is on.** Read request data (cookies, `getViewer()`, `params`, `searchParams`, the database,
  `now()`) only inside `<Stream fallback={…}>` from `@/components/primitives/stream`. A page's default export stays
  synchronous and passes the `params` promise down; the streamed child awaits it. Type pages with
  `PageProps<"/route">`. Never add `loading.tsx`. The fallback has the final geometry: layout shift must be zero.
- **Time.** Use `now()` from `@/server/clock`, never `new Date()` or `Date.now()` in server code. Domain functions
  take `now` as an argument. A database read that runs before any request API needs `await connection()` first.
- **After a mutation**, a server action calls `refresh()` from `next/cache` (and `revalidatePath()` for other routes
  that show the change). Route handlers can't call `refresh()`; they use `revalidatePath()`. `redirect()` comes last.
- **Typed routes are on.** `<Link href>` takes a known route; a computed string needs `as Route`.
- There is no `middleware.ts` (renamed `proxy.ts` in Next 16), and the app doesn't need one.

## Server code

- A server action: `getViewer()`, parse with zod, check permission, `now()` once, then one `inTransaction`. Inside
  it, re-read, ask the domain, write with a compare-and-set, and write the effects (audit rows, notifications,
  consumer notices) in the same transaction. Return `ActionResult` (`{ ok: true } | { ok: false, reason }`); throw
  only for bugs. Inside a transaction, read and write through `tx`, never `db`.
- A domain rule takes facts and `now`, writes nothing, and returns a refusal with the sentence people read, or what
  to write plus `effects`.
- Refusal sentences are UI copy, and some UI code compares them. Search a constant's uses before you reword it.
- Never store or log variable values. The render log, messages, and notices hold keys only.
- Every stored document goes through `prepareBody` or `prepareField` in `src/server/documents/prepare.ts`.

## Rendering

- Every channel (web, email, PDF) prints exactly what the author typed and saw in the editor: no rounding,
  dropping, renumbering, or rewording. Values keep every digit sent. Only styling may differ by channel.
- When a channel can't reproduce something, restrict it in the editor rather than render it approximately.
- The rules are in [docs/render-spec.md](docs/render-spec.md). Where the spec and the code disagree, one has a bug.
- A change that moves render output fails the golden files
  ([src/server/render/golden](src/server/render/golden/README.md)). Regenerate them only when the change is
  intended, and say so in the PR.

## UI

- shadcn here is the `base-nova` style on Base UI. Compose with the `render` prop, never `asChild`:
  `<Button render={<Link href={href} />} nativeButton={false}>`. Don't edit `src/components/ui/`; add a component
  with `npx shadcn add <name> -y`.
- Tokens only: no hex, rgb, or oklch values in components. Utilities come from `src/app/globals.css` and
  `src/styles/tokens.css`. Light theme only, so no `dark:` classes.
- Use the shared primitives in `src/components/primitives/` (`StatusBadge` for any version state, `PageHeader`,
  `Stream`, `Keycap`, `TemplateId`, `LinkPending`) rather than writing new ones.
- Animate with `m.*` from `motion/react` (`LazyMotion` is strict), with timings from `@/components/motion/presets`.
- One black primary button per screen. No hint or instruction text: explain only when an action is blocked, at the
  control. Show an unavailable control disabled, with its reason, rather than hiding it.
- Check every screen against [docs/reference/ui-checklist.md](docs/reference/ui-checklist.md).

## Copy these

| To… | Copy |
| --- | --- |
| Write a server action | `setSunset` in [src/server/actions/review.ts](src/server/actions/review.ts) |
| Write a domain transition | `setSunset`, `startRevoke` in [src/domain/lifecycle.ts](src/domain/lifecycle.ts) |
| Build a read model with permissions | `getVersions` in [src/server/queries/versions.ts](src/server/queries/versions.ts) |
| Stream a page | [versions/page.tsx](src/app/(product)/[team]/templates/[templateId]/versions/page.tsx) with [versions-content.tsx](src/components/versions/versions-content.tsx) |
| Run an action from a dialog, with validation | [src/components/review/request-dialog.tsx](src/components/review/request-dialog.tsx) on [action-dialog.tsx](src/components/versions/action-dialog.tsx) |
| Render server-decided actions | [src/components/settings/team/members-table.tsx](src/components/settings/team/members-table.tsx) |
| Update optimistically | [use-review-threads.ts](src/components/comments/use-review-threads.ts) with [thread-list.tsx](src/components/comments/thread-list.tsx) |
| Load heavy code on demand | [compare-dialog.tsx](src/components/versions/compare-dialog.tsx), [load-pdfjs.ts](src/components/preview/pdf/load-pdfjs.ts) |
| Add an `/api/v1` route | [src/app/api/v1/templates/route.ts](src/app/api/v1/templates/route.ts) |
| Format a date | [src/domain/dates.ts](src/domain/dates.ts) |
| Test an action against a database | [src/server/actions/review.test.ts](src/server/actions/review.test.ts) |

Each layer README has a longer list, and a "Don't copy" list of the deviations you'll find first. The common ones:
actions that throw instead of returning a result (`startDraft`, `createTemplate`); private copies of `Refusal`,
`check`, and `transact` in three action files; bare `<Suspense>` instead of `<Stream>`; reads done through
`"use server"` functions; and copied `plural`, "days ago", and number formatters. Never copy from `src/app/(dev)`:
those are design mocks on fixture data.

## Keeping the docs true

- Change the docs in the same change as the code. If you change how a layer works, update its README.
- A new folder under `src/` needs a README (`docs:check` fails without one).
- A choice someone might question later gets a record in [docs/decisions/](docs/decisions/README.md).
- Describe what the code does now, not how it got there.

## Known issues

[docs/handoff-review.md](docs/handoff-review.md) lists every open finding from the October 2026 codebase review, with where it is and how to fix it. Pick work from its "Fix first" list, in order. Findings under "Waits for the enterprise work" get fixed with real sign-in, the Java API or the enterprise font, not before. When a change fixes a finding, update that finding's Status line in the same change.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
