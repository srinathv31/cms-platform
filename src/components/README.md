# `src/components`: Stencil's React UI

Every product screen is built from this folder: the generated shadcn kit (`ui/`), shared primitives, motion,
the app shell, and one folder per feature. Route files in `src/app` stay thin and render a view from here; most
data-reading server components live here too, inside `<Stream>`. Business rules belong in `src/domain`, queries
and server actions in `src/server`. The portable editor is its own layer ([README](../editor/README.md)).

## Rules

Lint-enforced ([eslint.config.mjs](../../eslint.config.mjs)):
- Nothing under `src/components` may import the simulator (`@/simulator`, `@/server/db/schema/sim`).
- `src/editor` may import only `@/components/ui` from this folder, so `ui/` is part of the editor's surface.
- No `"use server"` here, at the top of a file or inside a function: server actions live in `src/server/actions/`.

Convention only (nothing checks these):
- Don't edit `ui/`. It is generated. The one deliberate edit is listed under [`ui/`](#ui-shadcn-on-base-ui).
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
| [app-shell/](app-shell) | The product frame: sidebar, top bar, ⌘K palette, notifications, profile and persona switch, `ScrimDialogContent` (the surface every dialog uses), `UserAvatar`, skeletons, canvas scroll restore, and the page and global error views (`route-error.tsx`, used by `src/app/(product)/error.tsx` and `src/app/global-error.tsx`). `*-hole.tsx` files are the streamed, viewer-dependent parts of the static `AppFrame`. |

Feature folders:

| Folder | What it holds | Used by |
| --- | --- | --- |
| `access/` | Request-access cards and `RolePicker`. | `/request-access` |
| `activity/` | The template's Activity tab. | `/[team]/templates/[templateId]/activity` |
| `audit/` | Audit log view, filters, table, Export link. | `/[team]/audit` |
| `comments/` | Review threads: `ThreadList`, gutter markers, `useReviewThreads` (barrel `index.ts`). | `workspace/`, `review/` |
| `demo/` | The Demo pill (reset, advance clock, open simulator) and "Back to Stencil". | `app-shell/app-frame.tsx`, `(simulator)/layout.tsx` |
| `device/` | The phone kit: a push notification or a text message on an iOS-style or Android-style phone, from resolved strings, with truncation measured from the rendered phone. Lint-held to `ui/`, `primitives/` and `motion/`, so Coral can use it ([README](device/README.md)). | `/design/device`; the preview rail and Coral's phone next |
| `import/` | Viewer for an imported template's original file (.docx, .pdf, .txt). | `preview/`, `workspace/` |
| `integration/` | Content of the SHARE integration panel: contract, sample request, responses, changes. | `workspace/workspace-share.tsx` |
| `library/` | Library view and browser, New template dialog, starter gallery, file upload. | `/[team]/library`, and under the settings dialog |
| `palette/` | ⌘K items as pure data (`commands.ts`), and the search: `usePaletteResults` asks `/api/palette/{space}` when the palette opens and as the viewer types, keeping the answers in one viewer's cache (`palette-cache.ts`). | `app-shell/command-palette.tsx` |
| `preview/` | The preview rail: channel and device controls, PDF, Web and Email output, pdf.js viewer, sample sets. | `workspace/`, `review/` |
| `redline/` | `RedlineDocument`, a version diff painted like the document, and `NameChangeLine`, a rename (the name is versioned). | `review/`, `submit/`, `versions/compare-panel.tsx` |
| `review/` | The approver's review screen: views, decision rail, approve and request-changes dialogs, go-live. | `/[team]/review/[templateId]/[version]` |
| `review-queue/` | Review queue tabs and rows. | `/[team]/review` |
| `settings/` | Settings dialog and nav; Team sections in `team/`, Platform sections in `platform/`, and the consequence strip both use (`strip.tsx`). | `/[team]/settings/[section]` and its `@modal/(.)settings` intercept |
| `signature/` | `ShareRing`, the SHARE signature. | `workspace/`, `review/` |
| `submit/` | Submit-for-review dialog and its contract lines. | `workspace/workspace-actions.tsx` |
| `usage/` | Usage dashboard and the template Usage tab. | `/[team]/usage`, `/[team]/templates/[templateId]/usage` |
| `versions/` | Versions timeline, compare, sunset and revoke dialogs. Also two shared modules: `action-dialog.tsx` and `format.ts`. | `/[team]/templates/[templateId]/versions` |
| `workspace/` | The template workspace: header, tab bar, grid (`workspace-grid.ts`), Content tab (`content/`), autosave, session store, Copilot prompt, save status, SHARE, and the error a failed tab shows (`tab-error.tsx`). | `/[team]/templates/[templateId]` layout, Content page and `error.tsx` |

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

One generated file is edited on purpose. `ui/sidebar.tsx` has no window-level ⌘B / Ctrl+B listener: shadcn's
toggled the sidebar on every Bold in the editor and wrote the `sidebar_state` cookie, though the app's sidebar is
`collapsible="none"`. `npx shadcn add sidebar` overwrites the file and brings the listener back;
[ui/sidebar.test.tsx](ui/sidebar.test.tsx) then fails. Remove the listener again
([decision 0021](../../docs/decisions/0021-the-sidebar-has-no-keyboard-shortcut.md)).

### Primitives

| Export | File | Purpose |
| --- | --- | --- |
| `StatusBadge` | [status-badge.tsx](primitives/status-badge.tsx) | The one way to show a lifecycle state (wording and tone from `src/domain/status.ts`). A Superseded version's `sunsetDay` (the read model's YYYY-MM-DD, in the business time zone) shows as "Sunset Mar 1". Server-safe. |
| `PageHeader` | [page-header.tsx](primitives/page-header.tsx) | Serif page title, optional caps eyebrow, a slot for the screen's one primary action. |
| `Stream` | [stream.tsx](primitives/stream.tsx) | The streaming boundary: `Suspense` plus `ViewTransition`, skeleton out, content in. It catches no errors; the route's `error.tsx` does ([decision 0013](../../docs/decisions/0013-errors-are-caught-per-route-not-per-stream.md)). |
| `Keycap`, `Shortcut` | [keycap.tsx](primitives/keycap.tsx) | Keyboard keycaps on a sunken fill. |
| `TemplateId` | [template-id.tsx](primitives/template-id.tsx) | A template ID with a copy button (client). |
| `LinkPending`, `LinkPendingLabel` | [link-pending.tsx](primitives/link-pending.tsx) | Acknowledge a slow link click (`useLinkStatus`) without shifting layout. |
| `useActionRun`, `runAction` | [use-action-run.ts](primitives/use-action-run.ts) | Running a server action: one at a time, in a transition, with the refusal's sentence (`error`) and `onOk` / `onRefused`. A call that throws becomes the code `failed` with the screen's sentence; Next's redirect is handed back to Next (client). |
| `BlockedButton` | [blocked-button.tsx](primitives/blocked-button.tsx) | An action the viewer can't take: in place, greyed (`data-disabled:`), still focusable, its reason a tooltip and its accessible description. The review screen's blocked Approve and Request changes, the Versions tab's passed sunset (client). |
| `Segmented`, `SegmentedRadio` | [segmented.tsx](primitives/segmented.tsx) | The one segmented control: a white 32px track, `bg-selected` under the chosen segment, icon-only segments allowed. `Segmented` is a view control (toggle buttons, `aria-pressed`: the preview's channel and device, the Usage filter, the team icon); `SegmentedRadio` is a form field (a radio group: the role in Request access). Client. |
| `Tabs`, `TabList`, `Tab`, `TabPanel`, `TabUnderline` | [tabs.tsx](primitives/tabs.tsx), [tab-styles.ts](primitives/tab-styles.ts) | View switches in the page: Base UI Tabs in the workspace tab bar's look (15px text, the 2px underline sliding on a hairline, the ring round the label). Usage, the review's Document and Preview, the review queue. Links that look like tabs (`workspace/workspace-tabs.tsx`) and skeletons take the classes from `tab-styles.ts`, which a server component can import. Client. |
| `StatCard`, `StatValue`, `StatLabel`, `StatLines`, `StatTrend` | [stat-card.tsx](primitives/stat-card.tsx) | A stat card's parts: the tinted card (the Usage screens' `Panel` is this card), the big numeral with a trend pill, the caps label with an optional "i", plain lines under a hairline. They compose, so each screen sets their order: Usage puts the numeral first, Recertification the label. Server-safe. |
| `copyText`, `useCopy` | [copy.ts](primitives/copy.ts) | Put text on the clipboard (the async API, else a hidden textarea; focus stays put) and show "Copied" for a moment only when it got there. `TemplateId`, the integration panel's Copy, the Copilot prompt. Browser only. |
| `TeamIcon`, `teamIconLabel` | [team-icon.tsx](primitives/team-icon.tsx) | A team's icon from its stored Lucide key, and the name the icon picker reads out. Typed against the domain's `TEAM_ICONS`, so a new pickable key needs an icon. Server-safe. |

A channel's name ("PDF", "Web", "Email") is `CHANNEL_LABELS` from `src/domain/render/errors.ts`, everywhere.
[primitives/one-copy.test.ts](primitives/one-copy.test.ts) fails when a component pastes a second copy of one of
these (the segmented track, a hand-rolled tablist, the clipboard, the stat numeral, the team icons, a channel label
map).

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
The one dark set is the phone kit's: `--device-*` tokens (section 4 of tokens.css) have a light set and a
`[data-appearance="dark"]` set for a phone in dark mode, read as `bg-(--device-…)` inside `device/` only.

- **Charts** (`usage/charts.tsx`): amounts use the teal ramp `brand-1…4`; series (which channel, which version)
  use `series-1…4`, four hues in a fixed order, checked as a set for colour-blind separation
  ([decision 0014](../../docs/decisions/0014-chart-values-never-hover-only.md)). No value is hover-only: a chart's
  readable marks are one Tab stop with arrow keys between them (`usage/chart-keys.tsx`), and a chart whose values
  aren't printed is followed by an sr-only table of them.

- **Radius:** `rounded-md` 6px chips, `rounded-lg` 8px controls, `rounded-xl` 14px cards, `rounded-2xl` 18px
  large cards, `rounded-3xl` 22px modals, `rounded-4xl` 24px the canvas panel (`xs` 4px, `sm` 5px).
- **Fonts** ([src/styles/fonts.ts](../styles/fonts.ts)): `font-sans` Figtree (the default), `font-display` (or
  `font-heading`) Newsreader, `font-mono` Geist Mono for variable keys. The phone kit loads its own device faces
  (Inter and Google Sans Flex, scoped to the kit) in [device/fonts.ts](device/fonts.ts).
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

**Permissions.** The server decides. Read models carry `PermissionResult`s (`{ ok: true } | { ok: false; code; reason }`)
or booleans: `m.can.remove` in `settings/team/members-table.tsx`, `data.can.approve` and `data.can.comment` in
`review/review-workspace.tsx`, `canSubmit` in `workspace/workspace-tab-bar.tsx`. The settings rows render a
refused action disabled, with its `reason` in a tooltip (`settings/team/rows.tsx`). What an action does comes the
same way: the settings read models send each strip's line as `consequences` beside `can` (`m.consequences.remove`).
A form checked as someone types calls the domain's own check with the read model's facts (`validateChain`,
`validateNewTeam`, `describeSectionsChange`, `describeRoleChange`, `describeZoneChange`), never a copy of a refusal ladder, a refusal
constant, a stand-in actor or the clock; `settings/settings-decided.test.tsx` fails on any of those under
`settings/` ([decision 0018](../../docs/decisions/0018-settings-screens-render-decisions.md)). A screen that treats
one refusal differently from the rest branches on its `code`, never its sentence: `review/decision-model.ts` hides
the decision buttons for `generic`, `versions/version-actions.tsx` keeps Confirm revoke (disabled) for `own_revoke`,
and `submit/submit-dialog.tsx` offers Refresh summary on `summary_stale`. The sentence is shown as written and can be
reworded freely ([decision 0025](../../docs/decisions/0025-refusals-carry-stable-codes.md)).

**Mutations.** Client components import server actions from `@/server/actions/*` and run them with `useActionRun`
([primitives/use-action-run.ts](primitives/use-action-run.ts)): in a transition, one at a time. Actions return
`ActionResult` (`src/domain/review-types.ts`): `{ ok: true, … } | { ok: false, code, reason }`. Show the `reason` as
written. A refusal made in the browser (the call threw, or the server couldn't be reached) has the code `failed` and
the screen's own sentence (`useActionRun("Couldn't open a draft. Try again.")`). On success the action calls
`refresh()` or `revalidatePath`, so the server components re-render with fresh props; the client doesn't refetch.
`startDraft` and `createTemplate` redirect on success: `runAction` hands Next's redirect back to Next, and returns
their refusal like any other (`EditButton` in `workspace/workspace-actions.tsx`, `library/starter-gallery.tsx`). The
dialog pattern, `useActionDialog` on `useActionRun` ([versions/action-dialog.tsx](versions/action-dialog.tsx)):

```tsx
const { pending, error, setError, submit } = useActionDialog(() => onOpenChange(false));
submit(invalid /* a known refusal, shown without sending */, () => requestChanges({ … }));
// pending: primary and Cancel are aria-disabled (focus stays), a spinner replaces the label
// error: result.reason in a role="alert" line beside the buttons; the dialog closes only on ok
```

The settings sections confirm through one `Strip` ([settings/strip.tsx](settings/strip.tsx)), which runs its action the
same way.

**Optimistic updates.** `comments/use-review-threads.ts` holds `useOptimistic(initial, reduceThreads)`;
`comments/thread-list.tsx` applies the mutation and calls the action in one `startTransition`. When it ends,
the list is the server's again, and a refusal shows its reason on the card.

**Reads on demand.** Data a dialog or a menu loads when it opens comes from a GET route, never a server action
(an action queues with the page's mutations): `readTemplate(templateId, read, params)` from
[src/lib/template-reads.ts](../lib/template-reads.ts) returns the route's `ActionResult`, and throws when there is no
answer, which the caller shows as its own failure. The Compare panel (`versions/compare-panel.tsx`), Revert to v3
(`workspace/save-status.tsx`), the submit summary (`workspace/workspace-actions.tsx`), the Copilot prompt
(`workspace/copilot/copilot-prompt.tsx`) and the SHARE panel (`workspace/workspace-share.tsx`) read this way.

**Other paths.** Some client code `fetch`es other route handlers: autosave (`workspace/autosave/save-transport.ts`),
the preview render (`preview/render-preview.ts`), uploads (`library/upload-import.ts`), and the ⌘K palette.
State shared across subtrees is a small store read with `useSyncExternalStore` (`workspace/session/session-store.ts`).
The workspace header, in the template layout, binds it to the draft it shows (`BindDraft`), so autosave runs on every
tab and a rename on Versions saves like one on Content; the Content page binds the same draft, which is one session.
The same store holds the workspace still (`makeInert`, read with `useInert`): Submit holds it from its click until its
dialog closes without submitting, and every part that edits the draft shows read-only meanwhile, without remounting.
A save the server refuses for good (a conflict) takes a hold that lasts as long as that draft is bound, and the
header's `SaveStopped` says why and offers Reload. Anything else that has to stop edits takes a hold the same way.
The session also holds the controls that code sends focus to (`session.focusTargets`): the name field, the header's
status row, the Preview toggle and the rail's Original tab register themselves while mounted (`useFocusTarget`), and
an Esc, a submit or a revert asks for them by name, or waits for one to mount, rather than querying the page by label
([decision 0027](../../docs/decisions/0027-focus-targets-register-with-the-session.md)). A new control that code
focuses registers the same way.

## Copy these

| When you need to… | Copy | Notes |
| --- | --- | --- |
| Run an action from a button | `EditButton` in [workspace/workspace-actions.tsx](workspace/workspace-actions.tsx) on [primitives/use-action-run.ts](primitives/use-action-run.ts) | `run(action, { onOk, onRefused })`; `pending` while it runs, `error` the refusal's sentence. |
| Run an action from a dialog, with validation | [review/request-dialog.tsx](review/request-dialog.tsx) on [versions/action-dialog.tsx](versions/action-dialog.tsx) | Checks the field before sending. Its limit (`REASON_MAX` in `review/decision-model.ts`) duplicates the one in `src/server/actions/review.ts`; for a new limit, share a domain constant, as `access/request-access.tsx` does with `ACCESS_REASON_MAX`. |
| Show server-decided actions | [settings/team/members-table.tsx](settings/team/members-table.tsx) | Reads `m.can.*` and `m.consequences.*`; `rows.tsx` renders refusals and strips. |
| Show an action the viewer can't take, with why | `BlockedButton` in [review/decision-rail.tsx](review/decision-rail.tsx) | Greyed and focusable; `describedBy` points at a visible reason when there is one. |
| Make a chart readable without a pointer | `StackedBars` in [usage/charts.tsx](usage/charts.tsx) | `markProps` on each hit area inside `ChartKeys`, then a `ChartTable`. |
| Update optimistically | [comments/use-review-threads.ts](comments/use-review-threads.ts) with [thread-list.tsx](comments/thread-list.tsx) | Pure reducer in `thread-state.ts`, tested. |
| Stream a section | [versions/page.tsx](../app/(product)/[team]/templates/[templateId]/versions/page.tsx) with [versions-content.tsx](versions/versions-content.tsx) | Skeleton and content share `TOOLBAR`. |
| Stream viewer-dependent parts into a static frame | [app-shell/app-frame.tsx](app-shell/app-frame.tsx) with [sidebar-holes.tsx](app-shell/sidebar-holes.tsx) | |
| Switch views with tabs | `UsageTabs` in [usage/usage-tabs.tsx](usage/usage-tabs.tsx) | `Tabs` from `primitives/tabs.tsx`, panels kept mounted, the tab in `?tab=` by `replaceState`; the skeleton uses `tab-styles.ts`. |
| Make links look like tabs | [workspace/workspace-tabs.tsx](workspace/workspace-tabs.tsx) | Routes in a `nav`: the `tab-styles.ts` classes, `TabUnderline` with a `layoutId`, `LinkPendingLabel`, matching skeleton. |
| Load heavy code on demand | [versions/compare-dialog.tsx](versions/compare-dialog.tsx), [preview/pdf/load-pdfjs.ts](preview/pdf/load-pdfjs.ts) | `React.lazy` for a panel; dynamic `import()` for a library. |
| Load data when a dialog opens | [versions/compare-panel.tsx](versions/compare-panel.tsx) | `readTemplate()` in an effect, a key per request so a late answer is dropped, Try again on failure. |

## Don't copy

- **Tabs styled by hand.** `preview/rail-header.tsx` (14px, in the rail) and `integration/sample-request.tsx` (13px,
  curl | fetch) use Base UI Tabs with their own classes at their own sizes. Build a new view switch with `Tabs` from
  `primitives/tabs.tsx`.
- **Copied helpers.** `andList` in `access/format.ts` repeats `joinWithAnd`. Dates, "3 days ago", counts and plurals
  have one home each: `formatShortDate`, `formatAgo` and the rest in `src/domain/dates.ts`, `formatCount` in
  `src/domain/numbers.ts`, `plural` in `src/domain/plural.ts`. A screen picks `formatAgo`'s options (or names them
  once, as `formatLastRender` in `usage/format.ts` does for a render's time); it never counts days itself.
- **Permissions decided here.** `library/library-view.tsx` and `app-shell/top-bar-hole.tsx` call `can()`. Have the
  query return the result.
- **Server code importing this folder.** `src/server/queries/submit-summary.ts` imports `preview/sample-sets/model.ts`
  and `submit/types.ts`; `src/server/actions/create-template.ts` and `src/app/api/imports/route.ts` import
  `workspace/just-created.ts`. Keep those modules free of React and directives; put new shared types in `src/domain`.
- **Dead or off-contract.** `app-shell/page-placeholder.tsx` has no importers. `workspace/save-status.tsx` imports
  `@/editor/lib/platform`, which is not in the editor's public API.

## `src/hooks`, `src/lib`, `src/styles`

- [src/hooks/use-mobile.ts](../hooks/use-mobile.ts): shadcn's `useIsMobile` (768px), used only by `ui/sidebar.tsx`.
- [src/lib/utils.ts](../lib/utils.ts): `cn`, re-exported from the `cn` package. Import it from `@/lib/utils`.
- [src/lib/template-reads.ts](../lib/template-reads.ts): `readTemplate()` and `templateReadUrl()`, the browser's
  side of the on-demand template reads (see [Server and client](#server-and-client)).
- [src/lib/serialized-writes.ts](../lib/serialized-writes.ts): not UI. A per-process write lock for the local
  SQLite file, used by `src/server/db/client.ts` and `src/simulator/db.ts`. It imports `node:fs`: server only.
- [src/styles/tokens.css](../styles/tokens.css) (imported by `globals.css`) and [src/styles/fonts.ts](../styles/fonts.ts)
  (`next/font`; `fontVariables` goes on `<html>` in the root layout). Rebranding means editing these two files.

## Testing

- Unit tests sit next to their code as `*.test.ts(x)`. `npx vitest run src/components src/lib` runs this
  layer's 75 files in a few seconds; `npm test` runs everything.
- The default environment is `node` ([vitest.config.mts](../../vitest.config.mts)). A test that needs a DOM
  opts in with `// @vitest-environment happy-dom` on its first line.
- No Testing Library. Markup tests use `renderToStaticMarkup` (`primitives/status-badge.test.tsx`); interaction
  tests use `createRoot` and `act` under happy-dom (`comments/thread-list.test.tsx`).
- Mock server actions with `vi.mock("@/server/actions/…")`; a component that calls `unstable_rethrow` also needs
  `next/navigation` mocked (`submit/submit-dialog.test.tsx`). For a read, stub `fetch` with `vi.stubGlobal` and
  check the URL it was given (`workspace/save-status.test.tsx`). Fixtures: `redline/redline-fixtures.ts`, and
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
