# Review: `src/components`, `src/hooks`, `src/lib`, `src/styles`, `globals.css`

Repo: /Users/happy/Documents/CodeProjects/prototypes/cms-platform @ main 0cca665, 2026-10-12. Read-only review.
Evidence tags: `measured` (I ran something), `verified` (I read the code), `traced` (followed, not run).

Scope measured: 416 `.ts/.tsx` files, 49,967 lines under `src/components` (30,652 non-test lines outside `ui/`,
106 test files); plus `src/hooks` (1 file), `src/lib` (4 files), `src/styles` (2 files), `src/app/globals.css` (237 lines).

## 1. Summary

This is a well-built front end with an unusually consistent design language, and it is the part of the codebase a
Java team can take over with the least rework: the UI reads server-decided permissions and refusal codes, runs every
mutation through one `useActionRun`, and keeps its hardest logic (autosave, the workspace session, optimistic
comments, the review decision model) in pure TypeScript modules with thorough tests. The whole slice's 1,035 unit
tests run in 6 seconds, deterministically, with no snapshot tests and no Testing Library. Accessibility is a real
strength, not a checkbox: keyboard-navigable charts with sr-only tables, blocked buttons that stay focusable and say
why, live regions for save status and refusals, focus return after every dialog and overlay, and an e2e "principles"
suite that measures one-primary-button, zero CLS and axe on every screen as every persona.

The costs are concentration and dialect. The Content tab (`content-workspace.tsx`, 24 props, a 330-line component
function), the workspace session (`session-store.ts`, 599 lines of closure-held rules over a zustand store), the
thread list's focus machinery and the rail's Escape arbitration are each understandable, but not in ten minutes, and
they coordinate through timing (double `requestAnimationFrame`, `setTimeout(0)`, 30-frame polling) that a newcomer
will not trust. The comment style is distinctive prose in full sentences (15% of lines), which explains intent
superbly but reads slowly and never uses the JSDoc tags a Java developer scans for. Three "blocked control" idioms
coexist despite a primitive and a test meant to keep one. The pdf.js controller, the most intricate imperative code in
the slice, has no test of its own. And a few things the layer's README already admits are still true: two `can()`
calls in server components, `Date` objects crossing to client components from the settings read models, and
`src/lib` holding the SQLite write lock beside a browser fetch helper.

Honest verdict: top-quartile UI code for a prototype of this size; a Java team will maintain it well if they first
read the README and four files named below, and if the team spends one sprint splitting the two or three files that
mix concerns and retiring the timing-based coordination.

## 2. Scores

| # | Dimension | Score | One-line reason |
| --- | --- | --- | --- |
| 1 | Architecture & layering | 8 | Lint-enforced boundaries (device kit, simulator, `"use server"`, editor allowlist) and read models that carry `can` results; leaks are small and already listed (`can()` in two server components, `src/lib` grab bag, 105 cross-feature import edges). |
| 2 | Correctness & robustness | 7 | Autosave and session are state machines with 56 and 50 tests; refusals branch on codes; one-request-at-a-time guards everywhere. Held back by timing-based coordination in five files and an untested pdf.js controller. |
| 5 | UI/UX quality | 8 | Every state is designed (skeleton geometry, blocked-with-reason, error views, empty lists), accessibility is thorough and e2e-enforced; three blocked idioms, a few hidden controls and 320 `text-[Npx]` keep it off 9. |
| 6 | Readability for humans | 6 | Median file 75 lines, names are English words, every module opens with its contract; but 15 files over 300 lines, a 24-prop component, closure-held rules and prose comments make the core workspace a multi-hour read for a Java developer. |
| 7 | Test quality | 7 | 1,035 tests in 6.05 s, pure modules tested exhaustively, two meta-tests (`one-copy`, `settings-decided`) guard conventions; gaps on `pdf-controller.ts`, `content-workspace.tsx`, `approval-chains.tsx`, `message-composer.tsx`, and no coverage tooling. |
| 8 | Documentation | 8 | The layer README is long, true and layered (rules, layout, primitives table, copy/don't-copy lists); decisions 0020/0027/0030/0043/0044 record the why; one stale count (75 test files vs 106) and only two READMEs in the layer. |

## 3. Strengths

- **The action path is one path.** `useActionRun` (`src/components/primitives/use-action-run.ts`, 70 lines) is the
  only way the UI runs a server action: one at a time, in a transition, refusal sentence surfaced, Next redirects
  rethrown. `useActionDialog` in `versions/action-dialog.tsx` layers "don't send what you know will be refused" on top.
  Every dialog I read (approve, request changes, sunset, revoke, submit, settings strips) is on it. `verified`
- **Business rules stay out.** Components branch on refusal `code`, never sentences (`review/decision-model.ts:312`
  `refused.code === "generic"`); settings screens call the domain's own validators (`validateChain` in
  `settings/platform/approval-chains.tsx:93`) and `settings/settings-decided.test.tsx` feeds them read models
  deliberately at odds with the rules to prove no screen computes its own answer. `verified`
- **Autosave is a textbook state machine.** `workspace/autosave/autosave-scheduler.ts` (323 lines, no React, no fetch)
  states its nine rules in the header and `autosave-scheduler.test.ts` has 56 tests on fake timers; the React wiring
  (`use-draft-autosave.ts`, 100 lines) and the transport are separate files. `measured`
- **Accessibility is engineered, not sprinkled.** `BlockedButton` keeps a blocked action focusable with its reason as
  tooltip and accessible description; `usage/charts.tsx` makes each chart one Tab stop with arrow keys (`ChartKeys`,
  `markProps`) and follows every unprinted-value chart with an sr-only `<table>`; `ScrollRegion` takes a Tab stop
  only once it actually scrolls; gutter markers are a `role="toolbar"` with roving tabindex; 25 live regions
  (`role="status"|"alert"`, `aria-live`) across 23 files; `ActionDialog` returns focus to the primary after a refusal
  and to the opener on close. `verified`
- **The e2e principles suite enforces the UI rules the docs state.** `e2e/helpers/principles.ts` measures one primary
  button per canvas/dialog by computed background against the `--primary` token, status words only inside
  `StatusBadge`, no placeholders, axe serious/critical, and CLS = 0 via PerformanceObserver. `verified`
- **One home for shared blocks, with a test.** `primitives/one-copy.test.ts` reads the product source and fails on a
  second segmented track, hand-rolled `role="tab"`, clipboard call, stat numeral, team icon or channel label map
  (decision 0030). It passes today. `measured`
- **The device kit keeps true proportions.** `device/geometry.ts` lays phones out at 1 pt = 1 CSS px with measured
  bezels (iPhone 0.477 vs real 0.478), `phoneScale` scales down only (`containScale` caps at 1, `MIN_SCALE` 0.55 then
  the well scrolls), and lint holds the kit to `ui/`, `primitives/`, `motion/` (`eslint.config.mjs:128-141`) so Coral can
  share it. Owner's "never stretch" rule holds in code. `verified`
- **Heavy code loads late.** `pdfjs-dist` only via `await import` in `preview/pdf/load-pdfjs.ts:43`; the Compare panel
  via `lazy()`; `@react-pdf/renderer` is never imported by components (server-only). `measured`
- **Server/client split is explicit and documented.** 166 of 416 files say `"use client"`; server components await
  queries inside `<Stream>` and hand plain props down; no client file value-imports from `@/server/queries|db|clock`
  (grep found none). `measured`
- **Files that teach.** `members-table.tsx` (111 lines) shows the whole "render what the server decided" pattern in one
  screen; `decision-model.ts` and `focus-targets.ts` are pure, small and documented at the symbol.

## 4. Findings (by severity)

### High

**H-1. The pdf.js controller is the most intricate imperative code in the slice and has no test.** `measured`
Where: `src/components/preview/pdf/pdf-controller.ts` (590 lines); `pdf-viewer.test.tsx:12-24` mocks the class away.
What happens: `PdfController` owns a superseding `load()` with abort signals, a double-buffered swap (`prepare` →
`ready` → `adopt`), two IntersectionObservers for virtualization, a 2-wide render queue ordered by distance to the
viewport, idle-time text-layer fill with a 20-round busy cap, DPR and resize watchers. None of it is exercised by a
unit test; the only coverage is visual e2e. Why it matters: regressions in virtualization or the swap show as blank
pages or wrong scroll, which the approve gate (`onPdfShown` counts a PDF as viewed) then records as "viewed". Fix:
extract `visibleIndices`, `nextInQueue` ordering and the generation/key logic into pure functions with tests; test
`load/adopt/cancelIncoming` against a fake pdf.js runtime (`load-pdfjs.ts` already isolates it).

**H-2. `ContentWorkspace` mixes seven concerns in one 330-line function with 24 props.** `measured`
Where: `src/components/workspace/content/content-workspace.tsx:118-486`; props interface lines 44-100.
What happens: binding the draft, the revert/restore target with scroll preservation, review threads and composer
focus choreography (double `requestAnimationFrame` to collapse a selection, lines 262-279), live-draft creation,
message-vs-document branching, rail wiring and preview wiring all live in one component body with 14 `useCallback`s.
Decision 0043 says a file is split when it mixes concerns a reader must tell apart; this one does. Why it matters:
this is the screen authors live in; every future feature lands here. Fix: a `useContentRevert` hook (opening/shown/
keptScroll/restore target), a `useContentComments` hook (the `review` wiring, composer close, blockText/blockPosition),
and a props object per concern (`comments: {threads, canComment, viewer, now}`), mirroring how `ReviewWorkspace` was
split (H8).

### Medium

**M-1. Three idioms for "blocked, with reason" coexist; the checklist forbids two of them.** `verified`
Where: `primitives/blocked-button.tsx` (the primitive); `settings/team/rows.tsx:232-250` (native `disabled` button
wrapped in a focusable `<span tabIndex={0}>` for the tooltip); `settings/platform/ui.tsx:85-96` `Blocked` (same span
wrapper, used with `aria-disabled` buttons in `approval-chains.tsx:255-268`). The checklist says "Never the native
`disabled` on a blocked action ... `BlockedButton` does all of this." `one-copy.test.ts` has no pattern for it. Why:
the span wrapper gives the reason as a tooltip only; the button itself has no `aria-describedby`, and a screen reader
on the native-disabled button hears nothing. Fix: make `rows.tsx` and `ui.tsx` use `BlockedButton` (it takes
`variant`, `size`, `className`) and add `/tabIndex=\{0\}[^>]*>\s*<Button[^>]*disabled/` or `Blocked\b` to `one-copy.test.ts`.

**M-2. Coordination by timing in five files.** `verified`
Where: `workspace/workspace-actions.tsx:456-462` `saveFirst` awaits `setTimeout(0)` "for the host to publish the
status"; `comments/gutter-markers.tsx:561-570` polls up to 30 animation frames for the editor handle;
`content-workspace.tsx:271-279` two nested `requestAnimationFrame`s to collapse the ProseMirror selection;
`comments/thread-list.tsx:20-29,142-171` a `FocusRequest` with `frames` and `until` deadlines evaluated in an effect
with no dependency array (runs every render); `settings/platform/ui.tsx:22-34` `useFocusAfterCommit`. What happens:
each works because of a specific ordering of React commits, Base UI focus managers and TipTap's `requestAnimationFrame`
focus. Why it matters: these are the first things to break on a React or Base UI upgrade and the hardest to debug;
`saveFirst` in particular can read a stale status if the host's layout effect hasn't run after one macrotask under
load. Fix: have `session.flush()` resolve with the outcome (the scheduler's `flush` already knows `error`), so
`saveFirst` needs no wait; replace the editor-handle poll with a registration (the focus-targets pattern, decision
0027); keep the rAF dances but isolate them in one `focus-choreography.ts` with a comment per browser quirk.

**M-3. `src/lib` is a grab bag that breaks two stated rules.** `verified`
Where: `src/lib/serialized-writes.ts:3` imports `createClient` from `@libsql/client` and is the factory
`src/server/db/client.ts:5` uses, so the database client is constructed outside `src/server` ("Only `src/server`
imports the database client", architecture.md); `src/lib/fresh-database.ts:7` imports `afterAll, beforeAll, beforeEach`
from `vitest` in app source (a devDependency); `src/lib/template-reads.ts` is browser fetch code; `src/lib/utils.ts` is
`cn`. The README documents this honestly ("not UI... server only"), but a Java developer looking for "where does the
DB connection open" won't look in `lib/`. Fix: move `serialized-writes.ts` to `src/server/db/`, `fresh-database.ts`
to `src/server/testing/`, leave `cn` and `template-reads` in `lib`.

**M-4. `Date` objects still cross to client components from the settings read models.** `verified`
Where: `src/domain/access-types.ts` lines 61-67, 80-82, 98-100 (`MemberRow.addedAt: Date`, `statusChangedAt: Date | null`,
etc.), consumed by `"use client"` `settings/team/members-table.tsx:18`. Newer read models (threads, versions,
workspace) send ISO strings (`createdAt: string`, `nowIso`). React serializes `Date` across the RSC boundary, so it
works, but the Java DTOs will have one wire shape; today the UI expects two. Fix: convert the access read models to
ISO strings at the query boundary (the README's "older read models" note already marks them).

**M-5. Escape and focus arbitration in the rail depends on DOM roles and third-party class names.** `verified`
Where: `workspace/content/rail.tsx:23` `OPEN_POPUP = '[role="menu"], [role="listbox"], [role="dialog"]'`; `:61`
`.closest(".ProseMirror")?.hasAttribute("aria-controls")`; `:191-227` a capture-phase and a bubble-phase `keydown`
listener on `document` with a shared `spokenFor` flag; `:65` `getClientRects().length > 0` as "visible". Decision 0027
removed DOM queries for focus targets, but the Escape ownership logic still asks the DOM which overlay is open. Why:
a Base UI or TipTap change in roles/classes silently changes who gets Esc. Fix: an "overlay registry" on the session
(open dialogs/menus/pickers register, like focus targets) so `escapeIsSpokenFor` asks state, not the DOM.

**M-6. `approval-chains.tsx` (383 lines, `ChainEditor` 260 lines) has no unit test, and the settings meta-test skips it.**
`measured` Where: `src/components/settings/platform/approval-chains.tsx`; `settings-decided.test.tsx:46-51` imports
six section views but not this one. What happens: the confirm-label ladder (`:107-113`), the signature-reset-in-render
pattern (`:76-83`), the Esc-cancels-an-unnamed-add rule (`:136-144`) and `removeStageRefusal` wiring are untested.
Why: this editor decides who can approve; D4 in the backlog was about chains nobody could approve. Fix: add it to
`settings-decided.test.tsx` (it already mocks `saveApprovalChain`) and a focused test for `confirmLabel` and
`closeEditor` by extracting them to a pure module like `decision-model.ts`.

**M-7. Cross-feature imports show the "one folder per feature" split is porous.** `measured`
105 import edges cross feature folders (excluding `ui/`, `primitives/`, `motion/`, `device/`): `preview → workspace` 10
(`preview-pane.tsx:11` imports `PreviewDevice` from `workspace/session/session-store`), `review → preview` 7,
`review → versions` 6 (`versions/action-dialog.tsx` is the shared dialog shell for review and submit),
`settings → app-shell` 6, `versions → usage` and `versions → review-queue` 1 each (`version-entry.tsx:421,429`).
Why: a Java developer asked to change the review screen touches four folders; `action-dialog.tsx` and `scrim-dialog.tsx`
are primitives living in feature folders. Fix: promote `ActionDialog`/`useActionDialog`, `ScrimDialogContent`,
`UserAvatar` and `BreakingBadge` to `primitives/`; move `PreviewDevice`/`INITIAL_PHONE` types into `preview/`.

**M-8. `Stream`, the one streaming boundary, depends on a React API that only Next's vendored React exports.** `measured`
Where: `primitives/stream.tsx:1` `import { Suspense, ViewTransition } from "react"`. `node -e 'require("react").ViewTransition'`
is `undefined` on the installed `react@19.2.8`; only `node_modules/next/dist/compiled/react/cjs/react.production.js`
exports it, and the type comes from `@types/react/experimental.d.ts`. No unit test imports `Stream` (none could).
Why it matters: this is by design in Next 16 Cache Components (Next bundles a canary React), but it is invisible to a
reader and makes the app's one boundary untestable under vitest; a future React/Next version skew will break every
page at once. Fix: a one-line comment in `stream.tsx` naming the dependency, and a build-time check (the `npm run build`
already is one; say so in the README's Stream row).

### Low

**L-1. Hidden rather than disabled controls in two places.** `verified` `library/library-view.tsx:30` renders
`NewTemplate` only when `can(...).ok` (a Viewer sees no New template at all); `access/request-access.tsx:270-274`
hides "Request access" while a request is pending (the status box explains, so acceptable). The AGENTS rule is "show
an unavailable control disabled, with its reason, rather than hiding it." Fix: a `BlockedButton` with the permission's
reason in the Library header; leave Request access as is and note it.

**L-2. `can()` called in two server components; README admits it.** `verified` `library/library-view.tsx:23`,
`app-shell/top-bar-hole.tsx:33`. Fix: `getLibraryRows`/the space query return `can.create` and `can.requestAccess`.

**L-3. Duplicates the README lists remain.** `verified` `review/decision-model.ts:279` `REASON_MAX = 2000` duplicates
`src/server/actions/review.ts`; `access/format.ts:4` `andList` duplicates `joinWithAnd`. Small, but each is a rule in
two places for the Java port.

**L-4. `dark:` classes despite "light theme only".** `verified` `versions/action-dialog.tsx:55` `DESTRUCTIVE_PRIMARY`
carries `dark:bg-destructive dark:hover:bg-destructive/90` (copied from shadcn's button variant). Harmless, but the
README says don't add them. Fix: delete the two classes.

**L-5. Raw colours: exactly the two documented exceptions.** `measured` grep for hex/rgb/oklch outside `ui/` finds only
`app-shell/user-avatar.tsx:30-31` (`oklch()` tints from a stored hue), which the README lists. `asChild`: 0 uses. Good.

**L-6. H6 (`text-[Npx]`) is Open and growing.** `measured` 320 in `src/components` (407 repo-wide; the finding said 382),
15 distinct sizes including `12.5px`, `13.5px`, `11.5px`. Status "Open" is accurate. Fix as the finding says: `--text-*`
tokens first, then a codemod.

**L-7. Prop drilling at the preview seam.** `measured` `PreviewPane` 19 props (`preview-pane.tsx:24-74`), `PreviewView`
17, `ThreadList` 14, `PreviewSurface` 12. Fix: group into `phone: {view, onChange, senders, clock}`, `sender`, `viewed`.

**L-8. Two optimistic paths in `ThreadList`.** `verified` `comments/thread-list.tsx:106-109`: "Two ways to be optimistic:
through the hook that owns the list (`onMutate`), or on a copy of it here." The second path exists for a caller that
doesn't pass `onMutate`; both production callers do. Fix: require `onMutate` and delete the local `useOptimistic`.

**L-9. Barrels in four feature folders while the editor and domain forbid them.** `measured` `comments/index.ts`,
`redline/index.ts`, `device/index.ts`, `preview/sample-sets/index.ts`; `content-workspace.tsx:4-8` imports the comments
files directly, bypassing its barrel. Not wrong, but two conventions. Fix: pick one and say which in the README.

**L-10. README staleness.** `verified` `src/components/README.md:377` says this layer has 75 test files; there are 106
(109 with hooks and lib). The "Testing" section's "`e2e/phase-1.spec.ts` ... cover the shell" list is fine.

**L-11. `canvas-scroll.tsx` relies on the Navigation API (Chrome).** `verified` `app-shell/canvas-scroll.tsx:55`
`(window as unknown as { navigation?: NavigationApi }).navigation ?? null`; on Firefox/Safari `nav` is null and
back/forward restores to the top. Accepted by decision 0045 (desktop Chrome), but the Java team should know this is the
only `as unknown as` cast in the slice and the one browser-specific API.

**L-12. `happy-dom` is a runtime dependency.** `measured` `package.json` lists it under `dependencies`; it is used by
`src/server/import/dom.ts` and the golden content check at runtime, so this is deliberate, but tooling reviewers should
confirm it is wanted in the production bundle.

### Readability findings

**R-1 (Medium). `session-store.ts` keeps the rules in a closure around a zustand store.** `verified`
599 lines: a 40-line header, a 160-line `WorkspaceSession` interface with excellent per-method docs, then
`createWorkspaceSession` whose `held`/`waiting`/`attach`/`flush` hand-over and `revert`/`restore`/`replace`/`canRestore`
family need careful reading (`:361-520`). Decision 0044 chose this over store actions on purpose and the 50 tests name
every rule, so it is maintainable, but a Java developer expects a class with fields; budget 30 minutes, not 15.

**R-2 (Medium). The prose dialect.** 15.3% of non-test lines are comments (4,704 of 30,652); 67 of 281 files open
with a five-line-plus narrative. Comments are full English sentences that explain intent and history-free behaviour
("A re-render or a tab switch binds the same draft again; only a new version starts a session."), never JSDoc tags,
rarely types. Names are English words (`held`, `waiting`, `sink`, `flusher`, `opener`, `spokenFor`, `nowMs`); one-letter
names appear only in short callbacks (`m`, `d`, `s`, `r`). This is consistent and honest, and better than most code
comments, but it is slow to scan and a Java developer will look for `@param`/`@returns` and find none. Recommend keeping
the style and adding a one-paragraph "how to read a file here" to the README (header = contract, `/** */` on exports,
`//` for a decision at a line).

**R-3 (Low). Long functions.** `measured` `ChainEditor` 260 lines, `ValuesEditor` 259, `SubmitDialog` 177, `SubmitButton`
150, `Palette` 145, `EditableName` 140 (rough brace matching). Each is one component; none is incomprehensible, but
each exceeds a screen by 3-4x.

## 5. Backlog check (docs/handoff-review.md findings in this slice)

| Finding | Status line | Spot-check | True? |
| --- | --- | --- | --- |
| I1 (rename outside Content never saved) | Fixed | `workspace-header.tsx:52` renders `<BindDraft draft={t.draft} />` in the layout header; `content-workspace.tsx:165-167` binds the same draft; `session-store.ts:430` ignores a re-bind of the same version. `verified` | Yes |
| I2 (revert Undo overwrites later edits) | Fixed | `session-store.ts` `editGeneration` moves on every `save`; `canRestore(fields, since)` refuses when it moved; `save-status.tsx:177-199` `offerUndo` dismisses the toast on the first non-restorable change. 11 tests under "undoing one safely". `verified` | Yes |
| I6 (after a conflict the editor stays editable) | Fixed | `workspace-session.tsx:62` `useLayoutEffect(() => (stopped ? session.makeInert() : undefined))`; `autosave-scheduler.ts:139` `stopsSaving` by code; `SaveStopped` shows reason + Reload. `verified` | Yes |
| I9 (Revert to vN no pending guard) | Fixed | `save-status.tsx:230-258` `reading` ref, `useTransition`, `toast.error(result.reason)`. `verified` | Yes |
| I10 (large drafts lose last edits) | Fixed | `use-draft-autosave.ts:70-84` `beforeunload` guard while `status !== "saved"`, flushes with `keepalive`. `verified` | Yes |
| I12 (palette ships catalog / keeps last persona) | Fixed | `command-palette.tsx:102` `<Palette key={viewerId} …/>`; results from `usePaletteResults` (GET). `verified` | Yes |
| I13 (blocked decisions and charts not accessible) | Fixed | `charts.tsx` `markProps`, `ChartKeys`, `ChartTable` on heatmap, stacked bars, rate line, channel mix; `decision-rail.tsx` uses `BlockedButton` (per README; `blocked-button.tsx` read). `verified` | Yes |
| I15 (focus via DOM queries) | Fixed | `focus-targets.ts` registry; `useFocusTarget` in `workspace-session.tsx`; `focusStatusRow` waits on `statusRow` with state `in_review`. But Esc arbitration in `rail.tsx` still queries the DOM (M-5). `verified` | Yes for focus targets; the Esc path is a cousin the finding didn't cover |
| H3 (forked primitives) | Fixed | `one-copy.test.ts` passes; `Segmented`/`SegmentedRadio`, `Tabs`, `StatCard`, `copyText`, `TeamIcon` in `primitives/`. `measured` | Yes |
| H6 (no font-size tokens) | Open | 320 `text-[Npx]` in components, 407 repo-wide. `measured` | Yes (count grew from 382) |
| H8 (oversized files) | Fixed | `review-workspace.tsx` is 231 lines on six hooks; domain folders split. But `content-workspace.tsx` (486) mixes concerns (H-2) and `charts.tsx` (638) / `pdf-controller.ts` (590) / `session-store.ts` (599) remain; decision 0043 says long-but-one-concern stays, which fits three of the four. `measured` | Mostly; ContentWorkspace is the exception the status line doesn't name |
| N11 (revert toast Undo is a second black button) | Fixed | `motion/providers.tsx:29-34` `TOAST_OPTIONS.classNames.actionButton` outline classes. `verified` | Yes |
| N13 (Library status filter third style) | Fixed | `one-copy.test.ts` `PRESSED_PILL` pattern passes against the whole source. `measured` | Yes |
| N26 (phone previews not checked on a device) | Fixed (recorded as approximation) | `device/README.md` "How exact the previews are" links decision 0046. `verified` | Yes |
| N27 (sidebar leaves no room under 800px) | Fixed | `ScrollRegion` exists and is used by `rows.tsx:312`; `narrow:`/`wide:` variants in `globals.css:21-22`; `use-mobile.ts` 800. Reflow itself not verifiable without a browser. `verified` | Plausibly yes |
| I7 (no error boundaries) | Fixed | `tab-error.tsx` + `failTab` hold; `useTabFailed` greys Edit/Submit/Preview/rail toggle in `workspace-actions.tsx`. `verified` | Yes |

New, not in the backlog: H-1 (pdf-controller untested), M-1 (three blocked idioms), M-2 (timing coordination), M-3
(`src/lib` grab bag), M-7 (cross-feature edges), M-8 (`ViewTransition` from vendored React), L-4 (`dark:` classes),
L-8 (two optimistic paths), L-10 (README test count).

## 6. For the Java team

**Ports cleanly (keep as is):** the whole slice is the UI that stays. What changes under it is the import of
`@/server/actions/*` (which become BFF actions that call Spring) and the `import type` of read models from
`@/server/queries/*` (which become DTO types). Components never see SQL, Drizzle or the clock; they see `ActionResult`
(`{ ok: true } | { ok: false, code, reason }`), `PermissionResult`, ISO strings and `can` objects. Keep the refusal
`code` list stable in Spring and nothing here changes.

**Needs rethinking before or during the port:**
- The two conventions for dates (M-4): decide ISO strings everywhere and convert the access read models.
- The autosave contract: `PUT /api/drafts/[versionId]` with `rev` compare-and-set and `sessionKey` (30-minute audit
  session) is what `autosave-scheduler.ts` expects, including which refusal codes stop saving (`stopsSaving`) and which
  wait for an edit. Spring must answer the same shape and codes.
- The on-demand GET reads (`src/lib/template-reads.ts`: compare, base-version, submit-summary, copilot-prompt,
  integration) answer in the `ActionResult` shape; mirror that.
- The review approve gate: `use-viewed-outputs.ts` stores viewed outputs in `sessionStorage` per viewer/version/round
  and the approval sends the set for the server to check; Spring must validate it the same way (`outputsRefusal`).
- Client-side `Date.now()` is used for the "when you opened it" timestamp and the 30-minute session gap; the demo clock
  is a server concept. With real time these just work.
- Things a Spring developer will trip over: `"use client"` as a file-level boundary (not a class annotation);
  `useSyncExternalStore` with a server snapshot (`INITIAL_SESSION_STATE`) so SSR and hydration match; `useOptimistic`
  inside `startTransition`; the `key={shown.gen}` remount idiom for "reset this subtree"; ref callbacks that register
  with a registry; closures as state (`session-store.ts`) instead of a class; `JSON.stringify` as a dependency key
  (`use-preview-render.ts:118-119`); `data-slot` attributes as the e2e selector contract (rename one, grep `e2e/`).
- Chrome-only assumptions: Navigation API in `canvas-scroll.tsx`; `requestIdleCallback` in `pdf-controller.ts:580`.

**Read these first (in order):**
1. `src/components/README.md` (all of it, then `docs/reference/ui-checklist.md`).
2. `src/components/primitives/use-action-run.ts` and `src/components/versions/action-dialog.tsx`: how every mutation runs.
3. `src/components/settings/team/members-table.tsx` with `rows.tsx`: a screen that renders server decisions.
4. `src/components/versions/versions-content.tsx` and `version-entry.tsx`: a streamed server component passing props down.
5. `src/components/workspace/autosave/autosave-scheduler.ts` then `session/session-store.ts` and `session/workspace-session.tsx`:
   the one piece of real client state.

## 7. Models of good code / files a human will struggle with

**Models of good code**
- `workspace/autosave/autosave-scheduler.ts`: rules in the header, pure, 56 tests mirror the rules.
- `primitives/use-action-run.ts`: 70 lines, one job, the contract in the comment.
- `primitives/blocked-button.tsx`, `primitives/scroll-region.tsx`, `primitives/status-badge.tsx`, `primitives/segmented.tsx`:
  each a single idea with its accessibility reasoning written down.
- `review/decision-model.ts`: the review screen's decisions as pure functions, 24 tests.
- `workspace/session/focus-targets.ts` and `session/live-draft.ts`: small registries with clear interfaces.
- `settings/team/members-table.tsx`: a Java developer understands the permissions pattern from this one file.
- `device/geometry.ts` and `device/measure.ts`: real-world constants cited to sources; a clever DOM measurement explained.
- `review/use-viewed-outputs.ts`: storage, memory fallback and the "failed" set in 90 commented lines.

**Files a human will struggle with**
- `workspace/content/content-workspace.tsx` (486): 24 props, seven concerns, focus choreography by rAF.
- `workspace/session/session-store.ts` (599): well documented but the hand-over and revert families take 30 minutes.
- `comments/thread-list.tsx` (387): the `FocusRequest` machinery and two optimistic paths.
- `workspace/content/rail.tsx` (330): Escape arbitration across capture/bubble phases, DOM roles and TipTap classes.
- `preview/pdf/pdf-controller.ts` (590): clean, sectioned, but imperative lifecycle with no tests to lean on.
- `comments/gutter-markers.tsx` (372): measurement, hover ghost, roving tabindex and a refocus timer in one component.
- `usage/charts.tsx` (638): seven charts; readable per section, but `StackedBars`' percentage/pixel geometry needs a pencil.
- `settings/platform/approval-chains.tsx` (383) and `preview/sample-sets/values-editor.tsx` (357): 260-line component functions.

## Appendix: measurements

- Files/lines per folder (non-test source lines): workspace 60 files / 5,059; preview 46 / 3,748; review 39 / 3,287;
  ui 30 / 3,211; device 42 / 2,582; settings 25 / 2,572; app-shell 24 / 1,748; versions 18 / 1,674; comments 12 / 1,672;
  usage 16 / 1,544; library 12 / 1,177; primitives 26 / 1,097; redline 13 / 909; audit 9 / 586; integration 9 / 473;
  review-queue 8 / 397; submit 4 / 347; access 3 / 346; palette 5 / 333; import 6 / 327; demo 4 / 286; signature 1 / 241;
  activity 6 / 171; motion 2 / 76. Test lines: 18,100 (workspace 4,828, preview 2,224, review 1,844, comments 1,330).
- `"use client"`: 166 files (ui 21, review 21, workspace 18, device 18, preview 15, settings 14, app-shell 12, primitives 8).
- Tests: `npx vitest run src/components src/hooks src/lib`: 109 files, 1,035 tests, 6.05 s. 57 files under happy-dom,
  47 use `createRoot`+`act`, 24 use `renderToStaticMarkup`, 0 snapshot assertions, 0 Testing Library.
- `npx eslint src/components src/hooks src/lib`: clean. `npx tsc --noEmit` (incremental, `.next/types` present): clean.
- Rule greps (outside `ui/`): hex/rgb/oklch 2 lines (documented exception); `dark:` 1; `asChild` 0; `text-[Npx]` 320;
  `as Route` 27; `eslint-disable` 2; `@ts-expect-error` 0; `: any` 0; `as unknown as` 1; non-null `!` 37.
- Comment density 15.3%; median file 75 lines; 15 non-test files over 300 lines; 67 of 281 files open with a 5+ line comment.
- 105 cross-feature import edges; top: preview→workspace 10, review→preview 7, workspace→preview 6, workspace→comments 6.
- Dependencies in components: `motion/react` 24 files (eager, `domMax`), `sonner` 5, `zustand/vanilla` 2, `cmdk` 1 (via
  `ui/command`), `react-day-picker` 1 (via `ui/calendar`, only `versions/sunset-calendar.tsx`), `pdfjs-dist` 3 (types +
  one dynamic import), `@react-pdf/renderer` 0, `date-fns` 0, `lucide-react` 89.
