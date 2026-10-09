# `src/components`: Stencil's React UI

Every product screen is built from this folder: the generated shadcn kit (`ui/`), shared primitives, motion,
the app shell, and one folder per feature. Route files in `src/app` stay thin and render a view from here; most
data-reading server components live here too, inside `<Stream>`. Business rules belong in `src/domain`, queries
and server actions in `src/server`. The portable editor is its own layer ([README](../editor/README.md)).

## Rules

Lint-enforced ([eslint.config.mjs](../../eslint.config.mjs)):
- Nothing under `src/components` may import the simulator (`@/simulator`, `@/server/db/schema/sim`).
- `src/editor` may import only `@/components/ui` from this folder, so `ui/` is part of the editor's surface.

Convention only (nothing checks these):
- Don't edit `ui/`. It is generated.
- Nothing here imports from `src/app`.
- A client component imports server code only as `import type`, as a server action, or as a pure module.
  Query modules start with `import "server-only"`, so a value import from one into a client file breaks the build.
- `cacheComponents` is on ([next.config.ts](../../next.config.ts)). A server component that reads request
  data (`params`, cookies, the viewer) must render inside `<Stream>`. There is no `loading.tsx`.
- Colors, radii, fonts, and motion come from tokens and presets (see below). Links take typed routes (`as Route`).
- The screen-level UI rules (one black primary button per screen, one segmented style, one tab idiom, 32px
  controls in rails, skeletons with the real geometry, focus return, zero console errors) live in
  [docs/reference/ui-checklist.md](../../docs/reference/ui-checklist.md). Read it before you build a screen.

## Layout

| Path | What it holds |
| --- | --- |
| [ui/](ui) | shadcn components, `base-nova` style on Base UI (`@base-ui/react`); see [components.json](../../components.json). |
| [primitives/](primitives) | The shared building blocks listed under [Primitives](#primitives). |
| [motion/](motion) | `Providers` (motion, tooltips, toasts) mounted by [src/app/layout.tsx](../app/layout.tsx), and the presets. |
| [app-shell/](app-shell) | The product frame: sidebar, top bar, ⌘K palette, notifications, profile and persona switch, `ScrimDialogContent` (the surface every dialog uses), `UserAvatar`, skeletons, canvas scroll restore. `*-hole.tsx` files are the streamed, viewer-dependent parts of the static `AppFrame`. |

Feature folders:

| Folder | What it holds | Used by |
| --- | --- | --- |
| `access/` | Request-access cards and `RolePicker`. | `/request-access` |
| `activity/` | The template's Activity tab. | `/[team]/templates/[templateId]/activity` |
| `audit/` | Audit log view, filters, table, Export link. | `/[team]/audit` |
| `comments/` | Review threads: `ThreadList`, gutter markers, `useReviewThreads` (barrel `index.ts`). | `workspace/`, `review/` |
| `demo/` | The Demo pill (reset, advance clock, open simulator) and "Back to Stencil". | `app-shell/app-frame.tsx`, `(simulator)/layout.tsx` |
| `import/` | Viewer for an imported template's original file (.docx, .pdf, .txt). | `preview/`, `workspace/` |
| `integration/` | Content of the SHARE integration panel: contract, sample request, responses, changes. | `workspace/workspace-share.tsx` |
| `library/` | Library view and browser, New template dialog, starter gallery, file upload. | `/[team]/library`, and under the settings dialog |
| `palette/` | ⌘K items as pure data (`commands.ts`). | `app-shell/command-palette.tsx` |
| `preview/` | The preview rail: channel and device controls, PDF, Web and Email output, pdf.js viewer, sample sets. | `workspace/`, `review/` |
| `redline/` | `RedlineDocument`, a version diff painted like the document. | `review/`, `versions/compare-panel.tsx` |
| `review/` | The approver's review screen: views, decision rail, approve and request-changes dialogs, go-live. | `/[team]/review/[templateId]/[version]` |
| `review-queue/` | Review queue tabs and rows. | `/[team]/review` |
| `settings/` | Settings dialog and nav; Team sections in `team/`, Platform sections in `platform/`. | `/[team]/settings/[section]` and its `@modal/(.)settings` intercept |
| `signature/` | `ShareRing`, the SHARE signature. | `workspace/`, `review/` |
| `submit/` | Submit-for-review dialog and its contract lines. | `workspace/workspace-actions.tsx` |
| `usage/` | Usage dashboard and the template Usage tab. | `/[team]/usage`, `/[team]/templates/[templateId]/usage` |
| `versions/` | Versions timeline, compare, sunset and revoke dialogs. Also two shared modules: `action-dialog.tsx` and `format.ts`. | `/[team]/templates/[templateId]/versions` |
| `workspace/` | The template workspace: header, tab bar, grid (`workspace-grid.ts`), Content tab (`content/`), autosave, session store, Copilot prompt, save status, SHARE. | `/[team]/templates/[templateId]` layout and Content page |

## Building blocks

### `ui/` (shadcn on Base UI)

Add a component with `npx shadcn add <name> -y`; it lands in `ui/` (and `src/hooks` when it brings a hook).
Wrap or compose it from your feature folder instead of editing the generated file. Base UI composes with
the `render` prop, not `asChild`. A link styled as a button also needs `nativeButton={false}`
([audit/audit-view.tsx](audit/audit-view.tsx)):

```tsx
<Button variant="ghost" render={<Link href={basePath as Route} scroll={false} />} nativeButton={false}>
```

Icons come from `lucide-react`. Toasts use `toast` from `sonner`; the `Toaster` is in `Providers`.

### Primitives

| Export | File | Purpose |
| --- | --- | --- |
| `StatusBadge` | [status-badge.tsx](primitives/status-badge.tsx) | The one way to show a lifecycle state (wording and tone from `src/domain/status.ts`). Server-safe. |
| `PageHeader` | [page-header.tsx](primitives/page-header.tsx) | Serif page title, optional caps eyebrow, a slot for the screen's one primary action. |
| `Stream` | [stream.tsx](primitives/stream.tsx) | The streaming boundary: `Suspense` plus `ViewTransition`, skeleton out, content in. |
| `Keycap`, `Shortcut` | [keycap.tsx](primitives/keycap.tsx) | Keyboard keycaps on a sunken fill. |
| `TemplateId` | [template-id.tsx](primitives/template-id.tsx) | A template ID with a copy button (client). |
| `LinkPending`, `LinkPendingLabel` | [link-pending.tsx](primitives/link-pending.tsx) | Acknowledge a slow link click (`useLinkStatus`) without shifting layout. |
| `StatCard` | [stat-card.tsx](primitives/stat-card.tsx) | Caps label over a big numeral. Only `/design` uses it today (see [Don't copy](#dont-copy)). |

The `/design` gallery (`src/app/(dev)/design`) imports these, so a change shows there too. It also holds mock
forks of real components on fixtures (its own `AuditTable`, `ThreadCard`, `GoLive`, preview controls, and usage
charts). Never copy from or import them. The simulator's `PageHeader` (`src/simulator/ui/bits.tsx`) is
deliberately separate: it uses the simulator's palette.

### Tokens

Raw colors live only in [src/styles/tokens.css](../styles/tokens.css): a primitive palette (`--stone-*`,
`--teal-*`; components never use it), semantic tokens, and the shadcn mapping. `@theme inline` in
[src/app/globals.css](../app/globals.css) turns them into utilities such as `bg-canvas`, `bg-surface-tinted`,
`border-hairline`, `text-text-muted`, `text-label`, `bg-selected`, `bg-brand`, `text-danger-text`, `bg-chip`,
`bg-status-review` (one set per lifecycle state; to show a state, use `StatusBadge`), and the shadcn names
(`bg-primary`, `border-border`). Light theme only: `globals.css` defines no dark theme, so don't add `dark:` classes.

- **Radius:** `rounded-md` 6px chips, `rounded-lg` 8px controls, `rounded-xl` 14px cards, `rounded-2xl` 18px
  large cards, `rounded-3xl` 22px modals, `rounded-4xl` 24px the canvas panel (`xs` 4px, `sm` 5px).
- **Fonts** ([src/styles/fonts.ts](../styles/fonts.ts)): `font-sans` Figtree (the default), `font-display` (or
  `font-heading`) Newsreader, `font-mono` Geist Mono for variable keys.
- **Utility classes:** `.display-xl` (page titles), `.display-lg` (dialog titles), `.caps-label` (tracked caps
  labels), `.numeral` (big tabular numbers). Also `shadow-pop`, `shadow-modal` (modals only; elsewhere
  borders, not shadows), `ease-soft`, and `animate-stream-in`.
- **Exceptions to "no raw colors":** `app-shell/user-avatar.tsx` computes `oklch()` tints from each person's
  stored hue; the PDF pages in `preview/pdf/` paint the paper `bg-white`; `usage/charts.tsx` sets `text-white`
  on the darkest bar. Don't add more.

### Motion

`Providers` ([motion/providers.tsx](motion/providers.tsx)) wraps the app in `MotionConfig reducedMotion="user"`
(default transition `spring.soft`) and `LazyMotion features={domMax} strict`. So:
- Animate with `m.*` from `motion/react` (`import { m } from "motion/react"`). A `motion.*` component throws
  under strict `LazyMotion`. `AnimatePresence` and the hooks are fine.
- Take timings from [motion/presets.ts](motion/presets.ts): `duration`, `ease.outSoft`, `spring.soft` (layout
  moves), `spring.pop`, `fadeRise`. They mirror the `--dur-*` and `--ease-out-soft` tokens.
- Reduced motion is global: `MotionConfig` honors the OS setting for `m.*`, and the
  `prefers-reduced-motion` block in `globals.css` cuts CSS animations and view transitions. A component that
  needs different behavior reads `useReducedMotion()` (`signature/share-ring.tsx`).

## Server and client

**Reads.** A page passes its `params` promise to an async server component here, inside `<Stream>`. That
component awaits a query from `@/server/queries/*` and hands the read model (types from `src/domain/*-types.ts`)
to a client component as props. Server components here include screen views (`audit/audit-view.tsx`,
`review/review-screen.tsx`), settings bodies (`settings/team/bodies.tsx`), the `*-hole.tsx` files, most
skeletons, and server-safe pieces such as `StatusBadge`. Names don't tell you the side
(`settings/team/inactivity-view.tsx` is a client component): look for `"use client"`.

**Permissions.** The server decides. Read models carry `PermissionResult`s (`{ ok: true } | { ok: false; reason }`)
or booleans: `m.can.remove` in `settings/team/members-table.tsx`, `data.can.approve` in
`review/review-workspace.tsx`, `canSubmit` in `workspace/workspace-tab-bar.tsx`. The settings rows render a
refused action disabled, with its `reason` in a tooltip (`settings/team/rows.tsx`).

**Mutations.** Client components import server actions from `@/server/actions/*` and call them in a transition.
Most return `ActionResult` (`src/domain/review-types.ts`): `{ ok: true, … } | { ok: false, reason }`. Show the
`reason` as written. On success the action calls `refresh()` or `revalidatePath`, so the server components
re-render with fresh props; the client doesn't refetch. The dialog pattern ([versions/action-dialog.tsx](versions/action-dialog.tsx)):

```tsx
const { pending, error, setError, submit } = useActionDialog(() => onOpenChange(false));
submit(invalid /* a known refusal, shown without sending */, () => requestChanges({ … }));
// pending: primary and Cancel are aria-disabled (focus stays), a spinner replaces the label
// error: result.reason in a role="alert" line beside the buttons; the dialog closes only on ok
```

`runAction` there turns any throw into `GENERIC_FAILURE`. Actions that redirect on success (`startDraft`,
`createTemplate`) throw the redirect instead of returning. Catch it and call `unstable_rethrow(error)` first, as
`workspace/workspace-actions.tsx` and `library/starter-gallery.tsx` do. Never pass such an action to `runAction`.

**Optimistic updates.** `comments/use-review-threads.ts` holds `useOptimistic(initial, reduceThreads)`;
`comments/thread-list.tsx` applies the mutation and calls the action in one `startTransition`. When it ends,
the list is the server's again, and a refusal shows its reason on the card.

**Other paths.** Some client code `fetch`es route handlers: autosave (`workspace/autosave/save-transport.ts`),
the preview render (`preview/render-preview.ts`), uploads (`library/upload-import.ts`), and the ⌘K palette.
State shared across subtrees is a small store read with `useSyncExternalStore` (`workspace/session/session-store.ts`).

## Copy these

| When you need to… | Copy | Notes |
| --- | --- | --- |
| Run an action from a dialog, with validation | [review/request-dialog.tsx](review/request-dialog.tsx) on [versions/action-dialog.tsx](versions/action-dialog.tsx) | Checks the field before sending. Its limit (`REASON_MAX` in `review/decision-model.ts`) duplicates the one in `src/server/actions/review.ts`; for a new limit, share a domain constant, as `access/request-access.tsx` does with `ACCESS_REASON_MAX`. |
| Show server-decided actions | [settings/team/members-table.tsx](settings/team/members-table.tsx) | Reads `m.can.*`; `rows.tsx` renders refusals. |
| Update optimistically | [comments/use-review-threads.ts](comments/use-review-threads.ts) with [thread-list.tsx](comments/thread-list.tsx) | Pure reducer in `thread-state.ts`, tested. |
| Stream a section | [versions/page.tsx](../app/(product)/[team]/templates/[templateId]/versions/page.tsx) with [versions-content.tsx](versions/versions-content.tsx) | Skeleton and content share `TOOLBAR`. |
| Stream viewer-dependent parts into a static frame | [app-shell/app-frame.tsx](app-shell/app-frame.tsx) with [sidebar-holes.tsx](app-shell/sidebar-holes.tsx) | |
| Animate a tab underline | [workspace/workspace-tabs.tsx](workspace/workspace-tabs.tsx) | `m.span` with `layoutId`, `spring.soft`, `LinkPendingLabel`, matching skeleton. |
| Load heavy code on demand | [versions/compare-dialog.tsx](versions/compare-dialog.tsx), [preview/pdf/load-pdfjs.ts](preview/pdf/load-pdfjs.ts) | `React.lazy` for a panel; dynamic `import()` for a library. |

## Don't copy

- **Segmented controls.** `preview/controls.tsx` keeps `Segmented` private, so its class strings are pasted into
  `usage/consumers-table.tsx` and `integration/contract-changes.tsx`, and restyled as a radio group in
  `access/role-picker.tsx`. Export the one in `preview/controls.tsx` (or move it to `primitives/`) instead of a fifth copy.
- **Two action runners.** `useActionRun` and `Strip` exist in both `settings/team/rows.tsx` and
  `settings/platform/ui.tsx`. Reuse one; don't write a third.
- **Copied formatters.** `plural` and `andList` exist in several `format.ts` files; `new Intl.NumberFormat("en-US")`
  in six files; "3 minutes ago" as `formatRelative` (`versions/format.ts`) and as `relativeTime`
  (`src/server/queries/format.ts`); "3 days ago" as `formatWhen` (`versions/format.ts`), `formatLastRender`
  (`usage/format.ts`), and `daysAgo` (`settings/team/format.ts`); a clipboard fallback in `primitives/template-id.tsx`
  and `integration/copy-button.tsx`. Take dates from `src/domain/dates.ts` and relative times from `versions/format.ts`.
- **Reads through server actions.** `versions/compare-panel.tsx`, `workspace/save-status.tsx`,
  `workspace/workspace-actions.tsx`, `workspace/workspace-share.tsx`, and `workspace/copilot/copilot-prompt.tsx`
  read data through `"use server"` functions. For a new read, prefer props from a server component, or a route
  handler when it must load on demand (as `app-shell/command-palette.tsx` reads `/api/palette/[space]`).
- **Permissions decided here.** `library/library-view.tsx`, `app-shell/top-bar-hole.tsx`, and
  `workspace/content/workspace-content.tsx` call `can()`; `review/decision-model.ts` hides a control when the reason
  is `REASONS.generic`; `versions/version-actions.tsx` branches on `REASONS.ownRevoke`. Have the query return the result.
- **Server code importing this folder.** `src/server/queries/submit-summary.ts` imports `preview/sample-sets/model.ts`
  and `submit/types.ts`; `src/server/actions/create-template.ts` and `src/app/api/imports/route.ts` import
  `workspace/just-created.ts`. Keep those modules free of React and directives; put new shared types in `src/domain`.
- **Stat cards.** `primitives/stat-card.tsx` is used only by `/design`. The Usage screens build theirs from
  `usage/stat.tsx`, and `settings/team/recertification-view.tsx` has a private `StatCard`.
- **Dead or off-contract.** `app-shell/page-placeholder.tsx` has no importers. `workspace/save-status.tsx` imports
  `@/editor/lib/platform`, which is not in the editor's public API.

## `src/hooks`, `src/lib`, `src/styles`

- [src/hooks/use-mobile.ts](../hooks/use-mobile.ts): shadcn's `useIsMobile` (768px), used only by `ui/sidebar.tsx`.
- [src/lib/utils.ts](../lib/utils.ts): `cn`, re-exported from the `cn` package. Import it from `@/lib/utils`.
- [src/lib/serialized-writes.ts](../lib/serialized-writes.ts): not UI. A per-process write lock for the local
  SQLite file, used by `src/server/db/client.ts` and `src/simulator/db.ts`. It imports `node:fs`: server only.
- [src/styles/tokens.css](../styles/tokens.css) (imported by `globals.css`) and [src/styles/fonts.ts](../styles/fonts.ts)
  (`next/font`; `fontVariables` goes on `<html>` in the root layout). Rebranding means editing these two files.

## Testing

- Unit tests sit next to their code as `*.test.ts(x)`. `npx vitest run src/components src/lib` runs this
  layer's 48 files in a few seconds; `npm test` runs everything.
- The default environment is `node` ([vitest.config.mts](../../vitest.config.mts)). A test that needs a DOM
  opts in with `// @vitest-environment happy-dom` on its first line.
- No Testing Library. Markup tests use `renderToStaticMarkup` (`primitives/status-badge.test.tsx`); interaction
  tests use `createRoot` and `act` under happy-dom (`comments/thread-list.test.tsx`).
- Mock server actions with `vi.mock("@/server/actions/…")`; a component that calls `unstable_rethrow` also needs
  `next/navigation` mocked (`submit/submit-dialog.test.tsx`). Fixtures: `redline/redline-fixtures.ts`, and
  `src/editor/testing/editor.ts` to mount the editor (`workspace/copilot/copilot-roundtrip.test.ts`).
- Keep logic in pure `.ts` modules so it tests without a DOM: `review/decision-model.ts`, `palette/commands.ts`,
  `comments/thread-state.ts`, `workspace/session/session-store.ts`, `workspace/autosave/autosave-scheduler.ts`.
- End-to-end: `e2e/scenario-02.spec.ts` through `e2e/scenario-10.spec.ts` follow the demo scenarios (create,
  review, go live, sunset, revoke, roles, access, import, Copilot); `e2e/phase-1.spec.ts`, `e2e/navigation.spec.ts`,
  and `e2e/principles.spec.ts` cover the shell, Back and Forward, and the settings modal. The auto fixture in
  [e2e/helpers/scenario.ts](../../e2e/helpers/scenario.ts) fails a test on any console error.
- Specs select by accessible name and by `data-slot` and `data-status` attributes: grep `e2e/` before you rename
  one. On the default port, `npm run e2e` runs `npm run db:reset` before starting the server, which resets the
  shared demo database ([playwright.config.ts](../../playwright.config.ts)).
