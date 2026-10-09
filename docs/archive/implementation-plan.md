> **Archived.** Written while the prototype was being built; it doesn't describe the current code.
> See [the current docs](../README.md).

# UCOMP Prototype — Implementation Plan

Oct 4, 2026 · Revision 2, after Sri's first review · No code has been written yet

**What changed in revision 2** (Sri's decisions, Oct 4; they override the build plan where the two differ)
- **npm and the machine's Node (26.8).** No pnpm, no version pinning.
- **Demo clock = the real current time**, plus an "advance N days" offset. The demo scenarios need that offset to cross the sunset and recertification deadlines.
- **Fonts**: Sri picked pairing B on the sample page: Newsreader + Figtree + Geist Mono. Template IDs use style C (a labeled "TEMPLATE ID" block with copy). The SHARE ring stays at 76px. Buttons stay as shadcn defaults and get tuned during the build.
- **TipTap off the shelf wherever possible**, including the official drag handle.
- **This is the real build, phase one of the platform, not a throwaway.**
  - The editor is production code that will be lifted straight into the production app. It's built as a self-contained, portable module (§8.1) and has its own phase (Phase 2).
  - Anything that depends on outside systems stays mocked: login, delivery, Coral.
- **See it early, iterate fast.** The risky parts of the experience are on screen at the end of Phase 1: the editor's feel, the SHARE ring, how template IDs look, and the shell. Phase 2 then ships in small increments with a quick look after each, instead of one big gate. Problems should show up in days, not two weeks.

**Inputs and precedence**
1. *UCOMP Prototype — Build Plan* sets the scope. Where it differs from the brief, the build plan wins.
2. *UCOMP Content Platform — Discovery Brief* is business background.
3. The three Wispr Flow screenshots set the look and feel. They're written down in [design-reference.md](design-reference.md).
4. Your session notes add four things:
   - shadcn/ui for every UI component.
   - `motion` for client micro-animations.
   - React Server Components with streaming through explicit `<Suspense>` boundaries, and no `loading.tsx`.
   - UX and polish above everything, for three audiences: C-suite, day-to-day business users, and engineers.

---

## 1. Summary

- **One Next.js 16 app.**
  - Cache Components (Partial Prerendering, PPR) is on, so every page sends a prerendered static shell immediately and streams the persona-specific content into Suspense holes.
  - The framework enforces this: reading cookies or the database outside a `<Suspense>` fails the build. That stops a slow, blocking page from slipping in.
- **The editor is production code and gets the most effort (about 70% of the value).**
  - It's TipTap v3, using official open-source extensions wherever they exist; custom code is written only where TipTap has nothing.
  - It lives in a portable `src/editor/` module with a props-in, events-out API. It has no Next.js, database or app imports, so it can be copied into the production app as is.
  - One shared schema serves the editor, the server first paint, import, and the render pipeline.
  - Its first paint is server-rendered HTML, so the document appears with the page and doesn't wait for JavaScript.
- **One pure-TypeScript domain layer** holds permissions, lifecycle, contract diff, render validation, formatting, redline and consequence text.
  - It has no React, Next.js or database imports, so it can be ported to Spring Boot later.
  - It has co-located tests.
  - Server actions and the render route are thin wrappers around it.
- **Design runs on tokens only.**
  - Every color, radius, font, shadow and motion duration is a CSS variable in one file.
  - shadcn components consume those variables.
  - Applying TD's style later is a token swap.
- **Motion has two layers.**
  - Stream reveals and route changes use React `<ViewTransition>` and CSS. That costs zero client JavaScript.
  - Interactive moments use `motion`: the sidebar pill, tab underline, chips, menus, drag-and-drop, the save indicator, and the SHARE ring.
- **Every phase gate is proved, not asserted.**
  - Playwright specs per demo scenario run from a fresh reset.
  - A visual-QA pass compares screenshots with the reference and the eight experience principles.
  - At each gate you get a contact sheet of screens and a gate report.
- **Open questions are in §12.** The questions that blocked Phase 1 are answered. The rest have defaults I'll use unless you say otherwise.

### Who each audience sees first

| Audience | Where the prototype has to land | What makes it land |
| --- | --- | --- |
| C-suite | Library at a glance, lifecycle badges, the go-live moment, the Usage dashboard | Calm density, big numerals, one clear story, nothing to explain |
| Business users | Editor, starter gallery, review screen | Two clicks to typing, Notion-grade blocks, chips that can't be broken, plain-language dialogs |
| Engineers | Integration panel (SHARE), the render API, simulator errors | Copyable contract and JSON schema, a real HTTP route with exact error messages, version pinning that actually works |

---

## 2. Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | **Next.js 16.3.8** App Router, React 19.2, TypeScript 5.9, Turbopack (default) | `next.config.ts`: `cacheComponents: true`, `partialPrefetching: true`, `typedRoutes: true`. No `middleware.ts`, which is now `proxy.ts`; we don't need one. |
| Runtime and package manager | **npm, with the machine's current Node (26.8)** | Sri's decision; it overrides the build plan's pnpm and Node 22. No version pinning. |
| UI kit | **shadcn/ui, `base-nova` style (Base UI primitives)**, Tailwind v4, lucide icons | Already installed. Base UI uses `render={<Link/>}`, not `asChild`. Every primitive comes from shadcn; product composites are built on top of them. |
| Motion | **`motion`** (`motion/react`) through `LazyMotion` + `m.*`, wrapped in `<MotionConfig reducedMotion="user">`; **React `<ViewTransition>`** for stream and route reveals | `ViewTransition` ships in the React canary that Next 16 bundles. No flag needed. |
| Editor | **TipTap v3, open source, off the shelf first.** See §8.1 for which extension does what. | Uses the official drag handle (`extension-drag-handle-react`, MIT since v3), Mention as the base for variable chips, Suggestion for `/` and `{{`, and UniqueID, BubbleMenu, Placeholder, TableKit, FileHandler, static-renderer and html. Custom code is written only where TipTap offers nothing free. Paid Pro extensions (Comments, the Notion template) are not used. |
| Client state | **zustand** (about 1 KB), for the workspace only | Variables, channels, save status, preview state, shared between the header, editor and panel. |
| Database | **libSQL** (`@libsql/client`, `file:./data/ucomp.db`) + **Drizzle ORM** + **drizzle-kit** migrations | `DATABASE_URL` and `DATABASE_AUTH_TOKEN` env vars, so switching to Turso later needs no code change. |
| Validation | **zod v4** | Inputs to server actions and the render route. |
| PDF output | **@react-pdf/renderer**, server only | Pure JavaScript: Letter pages, margins, page numbers, page breaks. |
| PDF display | **pdfjs-dist**, loaded on the client only when needed | The preview shows the actual PDF pages, so what the approver sees is the customer's file (§12, Q1). The same package handles PDF text extraction for import. |
| Import | **mammoth** (.docx → HTML), pdfjs-dist (PDF text), plain .txt | HTML → TipTap JSON with `@tiptap/html` on the server, using the shared schema. |
| Diff | Block diff keyed on stable block IDs, plus **jsdiff** for word-level changes inside a block | Redline and "Compare any two versions". |
| Dates | **date-fns** | All date logic reads the demo clock, never `Date.now()` in domain code. |
| Charts | Small hand-built SVG/CSS **server components** (gauge, bars, heatmap), with shadcn Tooltip and Card around them | No chart library ships to the client (§12, Q6). |
| Tests | **Vitest** (domain and editor-schema unit tests), **@playwright/test** (one spec per demo scenario plus API tests), **@axe-core/playwright**, Playwright MCP for visual QA | Chromium is already cached locally. Playwright is a dev-only tool and the app doesn't need it at runtime. |

**shadcn components to add** (base variants, through the shadcn CLI or skill):
- Layout and navigation: sidebar, tabs, separator, scroll-area, breadcrumb.
- Overlays: dialog, alert-dialog, sheet, popover, hover-card, dropdown-menu, tooltip.
- Commands: command, kbd.
- Forms: input, input-group, textarea, field, label, select, switch, checkbox, radio-group, toggle-group, calendar.
- Display: card, badge, avatar, table, item, empty, progress.
- Feedback: skeleton, spinner, sonner.

`components/ui/*` stays shadcn-owned. Styling changes go through tokens, not by editing those files.

---

## 3. Rendering, streaming and performance

The goal is for every click to feel instant. The structure stays fixed and the content fades in where it belongs, with no spinners and no layout shift.

1. **No `loading.tsx` anywhere.**
   - Anything that reads the request (the persona cookie, `params`, the database) sits in a component inside an explicit `<Suspense>`, as close to the read as possible.
   - With `cacheComponents` on, breaking this rule is a build error. The compiler enforces the architecture for us.
2. **Static shell versus streamed holes.**
   - Prerendered:
     - The root layout, fonts and tokens.
     - The app frame (stone background, inset canvas panel, sidebar frame, top-bar frame).
     - Page chrome that doesn't depend on who you are.
   - Streamed:
     - Team switcher, nav badges, sidebar card and profile menu.
     - Every page body.
   - Links use Next's default prefetching. `partialPrefetching` was planned but is **off**: in 16.3.8 it re-requests every link's route tree in a loop in this app (about 650 requests a second on the Library, found in Phase 1 QA). Revisit on a later Next release.
3. **One `<Stream>` wrapper** = `Suspense` + `ViewTransition`.
   - The skeleton has the same geometry as the real content, so there's zero CLS (layout shift).
   - The content enters with a 140ms fade and a 2px rise. Under reduced motion it's instant.
   - Every boundary uses the same wrapper, so streaming feels the same across the app.
4. **Reads.**
   - `server/queries/*` are plain async functions wrapped in `React.cache`, so each request reads once.
   - `getViewer()` (persona + memberships + platform role) is cached per request.
   - SQLite answers in under a millisecond, so I'm not adding `"use cache"` in early phases. Persona-scoped data can't share a cache anyway. If measurements show a need, the place to add it is reference data (content types), with `cacheTag` + `updateTag`.
5. **Mutations.**
   - Server actions follow one path: `assertCan` → domain transition → one database transaction → `refresh()`.
   - `useOptimistic` covers anything where waiting would be visible: resolving a comment, the required toggle, mark as read, and status changes.
6. **Autosave uses a route handler** (`PUT /api/drafts/[versionId]`), not a server action.
   - Next runs server actions one at a time per client, so a stream of autosaves would queue ahead of user actions.
   - Saves are debounced at 600ms and use `keepalive` to flush when the page is hidden.
7. **Editor first paint.**
   - The server renders the draft with `@tiptap/static-renderer`, using the shared schema and the same CSS.
   - The client editor (`immediatelyRender: false`) then mounts into the same box with no visible swap.
   - The editor appears with the HTML stream, not after the TipTap bundle loads.
8. **Client JavaScript budget.**
   - TipTap loads only on the workspace and review routes.
   - pdf.js loads on the first PDF preview.
   - @react-pdf never reaches the client.
   - Charts are server components.
   - `motion` loads through `LazyMotion` (`domAnimation`).
9. **Demo mode.**
   - Link prefetching and the full static shell only run in production builds.
   - `npm run demo` (= `build` + `start`) is for real user sessions. `npm run dev` is for building.
10. **Hidden routes stay mounted.**
    - Next 16 keeps the previous route mounted but hidden inside React `<Activity>`.
    - The editor must flush its save when hidden and survive being shown again.
    - This is my top technical risk, so I'll test it in Phase 1 with editor v0.

**Budgets I'll measure at each gate** (on the `npm run demo` build):
- The static shell paints in under 300ms on localhost.
- Streamed content arrives in under 150ms after the shell.
- CLS (layout shift) is 0 on every route.
- Keystroke to paint in the editor is under 16ms on a 3-page document.
- No console errors.

---

## 4. Design system

### Tokens (`src/styles/tokens.css`: the only file with raw color values)

| Layer | Examples |
| --- | --- |
| Primitives (palette) | `--stone-0 … --stone-900` (warm neutrals from the screenshots), `--teal-50 … --teal-900` (placeholder accent), `--amber-*`, `--red-*`, `--mint-*` |
| Semantic | `--app-bg` #F5F3EF · `--canvas` #FCFBF9 · `--surface` / `--surface-sunken` · `--hairline` #E6E2DB · `--text` #1B1B1B · `--text-muted` #6F6B65 · `--brand` (teal) + `--brand-1…4` scale · `--primary` near-black #161616 (the pill button) · `--focus-ring` |
| Status | `--status-{draft,review,changes,active,superseded,revoked}-{bg,fg,border}` |
| shadcn mapping | `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent` (shadcn's subtle hover fill, which is *not* our brand teal), `--border`, `--input`, `--ring`, `--sidebar-*` (active pill = #ECE9E3), `--chart-1…5` = teal scale |
| Shape | `--radius-chip` 6px · `--radius-control` 8px · `--radius-card` 14px · `--radius-panel` 24px · `--radius-modal` 22px |
| Elevation | `--shadow-modal` (the only big shadow) · `--shadow-pop` (a very soft one for menus and popovers) |
| Layout | `--sidebar-w` 264px · `--canvas-inset` 12px · `--canvas-pad-x` 48px · `--doc-width` 760px |
| Type | `--font-display`, `--font-sans`, `--font-mono`; a scale running display-xl 34/40 → caps-label 11/16 with tracking 0.08em |
| Motion | `--ease-out-soft` `cubic-bezier(.22,1,.36,1)` · `--dur-fast` 120ms · `--dur-base` 180ms · `--dur-slow` 320ms, mirrored in `components/motion/presets.ts` |

- Light theme only. I'll delete shadcn's `.dark` block and the dark variant.
- Fonts come from `next/font` in one module (`src/styles/fonts.ts`), so TD's fonts later mean changing one file plus `tokens.css`.
- Font pairing:
  - The `/design` sample page shows two pairings side by side on real UCOMP content: a page title, a stat card, a template row, and an editor paragraph with chips. Sri picks one.
    - **A**: Instrument Serif + Inter + Geist Mono.
    - **B**: Newsreader + Figtree + Geist Mono.
  - A query toggle switches the whole app between them for a live comparison.
  - The pairing that loses is deleted.

### Product primitives everyone reuses

- **`<StatusBadge state sunsetAt?>`** is the one and only status display.
  - Labels, tones and icons come from `domain/status.ts`, so "same badge, same color, same wording" holds by construction.
  - The six states:
    - Draft: neutral.
    - In review: amber.
    - Changes requested: neutral with a return icon.
    - Active: brand green.
    - Superseded: muted, plus "Sunset Mar 1" when a date is set.
    - Revoked: red.
- **`<PageHeader>`**: serif title, an optional tracked-caps eyebrow, and a slot for the one primary action.
- **`<Keycap>`**: the shadcn `Kbd` restyled as Flow's keycap chips. Used in the slash menu, the ⌘K hint and menus.
- **`<StatCard>`**: a tracked-caps label over a big, regular-weight tabular numeral, with an optional trend pill.
- **`<ShareRing>`**: the signature (below).

### The signature: SHARE ring (and its one reprise)

- **The ring.** An SVG `<textPath>` on a circle, about 76px across.
  - It reads "SHARE · SHARE · SHARE · ", with `textLength` set to the circumference so the text closes the full 360° without a gap.
  - At its center is the outline share glyph on a barely-there `--surface-sunken` disc.
- **On hover**: a slow 14s rotation of the ring, a 1.04 scale, and the glyph lifts 1px. Keyboard focus gives the same affordance. Reduced motion turns all of it off.
- **Where it lives.** It appears only on a template that has an Active version, in the workspace header, and it opens the Integration panel as a sheet.
- **The reprise, when a version goes live.**
  1. After Jordan approves, a centered ring reading "NOW LIVE · NOW LIVE · " draws itself around a check mark and turns once (about 1.4s).
  2. It then flies up and shrinks into the header's SHARE position (a shared `motion` `layoutId`).
  3. That is the moment the SHARE button "appears", so the celebration and the affordance are one gesture.
  4. Under reduced motion, it fades straight into place.

### Motion vocabulary (calm, fast, never in the way)

| Moment | Treatment |
| --- | --- |
| Streamed content | 140ms fade + 2px rise (ViewTransition/CSS) |
| Sidebar active pill, tab underline, review-queue tabs | Shared `layoutId` slide, 180ms |
| Menus, popovers, dialogs, sheets | Base UI `data-starting-style` transitions: 0.98 → 1 scale + fade, 140ms |
| Slash menu and `{{` picker | 4px drop-in; the highlighted row slides between items (`layoutId`) |
| Variable chip inserted | A single soft spring, 0.92 → 1 |
| Block drag | A drop-indicator line that tracks the target; the block settles into place on drop |
| Save indicator | "Saving…" crossfades to "Saved", with a check that draws itself |
| Status change | The badge color and label crossfade (they don't snap) |
| Persona switch | The canvas content crossfades, 200ms; the chrome stays put |
| Go live | SHARE ring reprise (above) |

Nothing staggers, nothing counts up, and nothing loops except the ring on hover.

---

## 5. Folder structure

```
src/
  app/
    layout.tsx                         root: fonts, tokens, <Providers> (MotionConfig, LazyMotion, Toaster)
    globals.css                        tailwind + shadcn + @import tokens.css
    (product)/
      layout.tsx                       AppFrame: static shell; persona parts in <Stream>
      page.tsx                         → viewer's default team library
      [team]/                          team slug in the URL ("all" for Platform Admin / Auditor)
        library/page.tsx
        @modal/(.)new/page.tsx         starter gallery as a large dialog (intercepted)
        @modal/(.)settings/[section]/page.tsx   settings modal (intercepted, deep-linkable)
        @modal/default.tsx
        new/page.tsx  settings/[section]/page.tsx   hard-navigation fallbacks
        templates/[templateId]/
          layout.tsx                   workspace header + tabs + SHARE
          page.tsx                     Content (editor; ?v= views a frozen version)
          versions/page.tsx  usage/page.tsx  activity/page.tsx
        review/page.tsx
        review/[templateId]/[version]/page.tsx
        usage/page.tsx
        audit/page.tsx
      request-access/page.tsx
    (simulator)/sim/                   "Coral — simulated": its own layout and palette
      layout.tsx  page.tsx  offers/[offerId]/page.tsx  customers/[deliveryId]/page.tsx
    api/
      v1/templates/route.ts                         GET search (consumers; Active only)
      v1/templates/[templateId]/route.ts            GET metadata + contract
      v1/templates/[templateId]/render/route.ts     POST render (the future Java API, shape-for-shape)
      v1/consumers/[consumerId]/notices/route.ts    GET consumer notices (new version, sunset, revoke)
      drafts/[versionId]/route.ts                   PUT autosave
      uploads/[uploadId]/route.ts                   GET original file (Compare with original)
  components/
    ui/                  shadcn-generated only
    app-shell/           sidebar, team-switcher, nav, sidebar-card, top-bar, profile-menu, persona-switcher, demo-pill
    primitives/          status-badge, page-header, keycap, stat-card, stream, empty-gallery
    signature/           share-ring, go-live-moment
    motion/              providers, presets, thin m.* wrappers (FadeIn, LayoutPill)
    library/  starters/  workspace/  variables/  preview/  versions/  review/  comments/
    usage/  integration/  settings/  audit/  notifications/  access/  command-palette/  demo/
  editor/                PORTABLE PRODUCTION MODULE (§8.1). No next/*, @/server, @/domain or @/app imports.
    index.ts             the public API: the only import path the app uses
    README.md            the contract, and how to lift the module into another React app
    model/               pure TS: Variable types, key generation, formatting by type, doc utilities
    schema.ts            THE extension list: shared by editor, static renderer, import, render
    extensions/          variable (on Mention), variable-suggestion, slash-command, required-section,
                         callout, paste-normalize (Word), comment-anchor, keymap
    components/          DocumentEditor, StaticDocument, VariablesPanel, InlineVariableField,
                         BubbleToolbar, SlashMenu, BlockHandle, VariableChip, VariablePopover, MarginThreads
    styles.css           ProseMirror content styles, tokens only
    __tests__/           Vitest (jsdom): guards, paste fixtures, insert/undo, schema round-trips
  app/(dev)/editor-lab/  dev-only playground: fixture docs (long, tables, many chips, read-only)
  domain/                PURE TypeScript: no React, Next, DB. Ports to Spring Boot.
    types.ts  status.ts  permissions.ts  lifecycle.ts  contract.ts  approval-chain.ts
    render/{resolve,validate,version-rules,errors}.ts  redline.ts
    consequences.ts  copilot-prompt.ts  access.ts
    *.test.ts            co-located
  server/                'server-only'
    db/{client.ts, schema/ucomp.ts, schema/sim.ts, migrations/}
    seed/{index.ts, rng.ts, people.ts, teams.ts, templates/*.ts, history.ts, sim.ts}
    viewer.ts            persona cookie → Viewer (React.cache)
    clock.ts             now() from the settings table
    queries/             read models per screen
    actions/             server actions per area (always assertCan first)
    render/              renderTemplate() + channels/{web.ts, email.ts, pdf.tsx}
    effects.ts           applies domain effects: audit, notifications, consumer notices
    import/{docx.ts, pdf.ts, txt.ts}
  simulator/             sim-only queries, actions and components. Reaches UCOMP only over /api/v1.
  styles/{tokens.css, fonts.ts}
e2e/                     scenario-01 … scenario-11 specs, api/*.spec.ts, phase gates, fixtures/
scripts/db-reset.ts
data/                    (gitignored) ucomp.db, uploads/
drizzle.config.ts
```

**Boundaries.** ESLint `no-restricted-imports` enforces four rules:
- `editor/` may import only React, `@tiptap/*`, `@/components/ui/*` (shadcn), lucide, motion and zustand. The app imports the editor only through `@/editor`. This keeps it portable.
- `domain/` imports nothing app-specific. `editor/model` is allowed because it's pure TypeScript.
- UCOMP code never imports `schema/sim.ts`.
- `simulator/` never imports `server/`. It talks to UCOMP through `/api/v1`, like Coral would.

**URLs.**
- The team is in the URL, so team switching is a navigation and links can be shared. The persona is in a cookie.
- On a persona switch you stay on the same URL if the new persona can see it; otherwise you go to their Library. This keeps the "switch to Jordan" moments in the demo smooth.

---

## 6. Data model

Drizzle on SQLite. JSON columns are typed with `$type<>()`. IDs are short and deterministic in the seed (a seeded PRNG). Template IDs are copy-friendly, for example `UC-4F7K2Q`.

### UCOMP tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `settings` | key, value (JSON) | `clock_offset_days`, `seed_version` |
| `users` | id, name, email, initials, avatar_hue, title, is_persona, platform_role (`platform_admin` · `auditor` · null), last_active_at | 8 switchable personas plus seeded non-switchable users. Dana Park (Legal) is seeded but not used yet. |
| `teams` | id, slug, name, description, icon | Coral Offers, Deposits, Card Statements |
| `memberships` | id, user_id, team_id, status (`active` · `suspended` · `lapsed`), added_at, added_by, status_changed_at | Recertification lapse and inactivity suspension act here, per team |
| `membership_roles` | membership_id, role (`viewer` · `author` · `approver` · `team_admin`) | Several roles per team |
| `content_types` | id, key, name, required_sections (`[{key,title}]`), allowed_channels (`Channel[]`) | Disclosure is the only type seeded. The Channel rules matrix edits `allowed_channels`. |
| `approval_stages` | id, content_type_id, position, name, approver_rule (`{kind:'team_role',role}` · `{kind:'user',userId}`) | Default: Disclosure → "Team approver" |
| `templates` | id, team_id, content_type_id, name, created_by, created_at, starter_key | A stable ID; "owner" = created_by |
| `versions` | id, template_id, number (null while draft), state, based_on_version_id, body (TipTap JSON), email_subject / email_preheader (inline TipTap JSON), channels, variables (`Variable[]`), sample_sets (`SampleSet[]`), contract_changes, current_stage, created_by / at, updated_at, rev, submitted_by / at, submit_note, activated_at, superseded_at, sunset_at, sunset_set_by, revoke (`{reason, startedBy, startedAt, confirmedBy, confirmedAt}`), import_upload_id | Partial unique indexes: at most one `draft` and at most one `active` per template. A row is frozen once its number is assigned. |
| `approvals` | id, version_id, stage_position, stage_name, actor_id, decision, reason, sample_sets_seen, decided_at | Records what the approver saw |
| `comment_threads` | id, template_id, origin_version_id, block_id, quote, status, resolved_by, resolved_at | Anchored to a stable block ID. Carried into the next draft automatically because drafts keep their block IDs. |
| `comments` | id, thread_id, author_id, body, kind (`comment` · `change_request`), created_at | The reason for a change request becomes a comment |
| `uploads` | id, template_id, filename, mime, size, path, created_by, created_at | Files live in `./data/uploads` |
| `consumers` | id, name, description, client_name | Coral (offers platform) and Deposits Online |
| `render_log` | id, at, template_id, version_id, version_number, consumer_id, channel, is_preview, correlation_id, outcome, error_code, duration_ms | **Never stores values.** Indexed on (template_id, at) and (consumer_id, at). |
| `consumer_notices` | id, consumer_id, template_id, version_id, kind (`new_version` · `sunset_scheduled` · `revoked`), payload, created_at | UCOMP's outbox to consumers. The simulator reads it over the API. |
| `audit_events` | id, at, actor_id, team_id, template_id, version_id, action, details, session_key | Draft edits merge into one row per editing session: same actor and draft, with gaps under 30 minutes |
| `notifications` | id, user_id, team_id, kind, title, body, href, created_at, read_at | |
| `access_requests` | id, user_id, team_id, role, reason, status, decided_by, decided_at, decision_note, created_at | |
| `recertifications` / `recert_items` | team_id, label, starts_at, due_at, completed_at / recert_id, user_id, decision, decided_by, decided_at | "4 of 6 confirmed" |

### Simulator tables (`sim_`; UCOMP code never reads them)

| Table | Key columns |
| --- | --- |
| `sim_offers` | id, name, headline, terms (spend, bonus, months) |
| `sim_customers` | id, first_name, last_name, email, home_state, purchase_apr, annual_fee, … (about 10, including one very long name) |
| `sim_links` | id, offer_id, template_id, template_name, pinned_version, channels, mapping (`{variableKey: field}`), linked_at |
| `sim_deliveries` | id, batch_id, offer_id, customer_id, channel, status, error, correlation_id, output (what Coral received, kept on Coral's side), at |
| `sim_notice_reads` | notice_id, read_at |

### Shared types (`domain/types.ts`)
- **Enums**:
  - `Channel` = `pdf | web | email`.
  - `VariableType` = `text | currency | percent | date | number | us_state`.
  - `VersionState` = `draft | in_review | changes_requested | active | superseded | revoked`.
  - `Role`, `PlatformRole`.
- **`Variable`** = `{key, label, type, required, sample}`. `Variable` and `VariableType` are defined in `editor/model` so the editor stays self-contained. `domain/types.ts` re-exports them.
- **`SampleSet`** = `{id, name, values}`.
- **`ContractChange`** = `{kind, key, breaking, from?, to?}`.
- **`Viewer`** = `{user, memberships, platformRole}`.
- **TipTap JSON**:
  - Every top-level block carries `attrs.id`, a stable block ID that comment anchors and the redline depend on.
  - A variable node is `{type:'variable', attrs:{key}}` and nothing more.
  - A required heading carries `attrs.requiredKey`.

### Demo clock (Sri: "can be current time")
- `now()` = the real current time + `settings.clock_offset_days`.
- The demo drawer's "Advance N days" increases the offset. Scenarios 5 and 8 need it to cross the sunset and recertification deadlines.
- Reset sets the offset back to 0.
- Only `server/clock.ts` reads the system clock. Domain functions take `now` as an argument, so they stay pure and testable.

### Seed and reset
- The seed is deterministic in structure: a seeded PRNG for IDs and data.
- Every timestamp is relative to the moment of the reset. "Sunset in 21 days", "recertification due in 30 days" and the 90 days of history always read the same, whatever day the demo runs.
- It covers:
  - Every lifecycle state on the five Coral templates.
  - Two or three templates each for Deposits and Card Statements.
  - About 90 days of render history.
  - An audit trail and notifications consistent with all of that.
  - The simulator offers, customers and links.
- `npm run db:reset` and the drawer's **Reset demo** both run the same `resetDemo()`. It drops the tables, migrates, seeds, clears seeded uploads, sets the persona back to Maya, and lands on the Library.

---

## 7. Domain layer: where the business rules live

| Module | What it does | Tested with |
| --- | --- | --- |
| `permissions.ts` | `can(viewer, action, resource) → {ok:true} \| {ok:false, reason}`. The reason is the one-line text the UI shows ("You submitted this version."). `assertCan` throws on `ok:false`. | Table-driven test that is a literal copy of the build plan's permission matrix, plus maker-checker cases |
| `lifecycle.ts` | Pure transitions: `createDraft`, `submit`, `requestChanges`, `approve` (stage-aware), `editActive`, `setSunset`, `startRevoke`, `confirmRevoke`, `sunsetPassed`. Each returns `{changes, effects}`, where effects are the audit events, notifications and consumer notices to write. `server/effects.ts` applies them inside the same transaction. | Every row of the transitions table, plus illegal moves |
| `contract.ts` | Variable-list diff, classified as breaking or non-breaking, with plain-English lines ("v2 adds required `annual_fee` (Currency)") | All breaking and non-breaking cases from the build plan |
| `approval-chain.ts` | Ordered stages; who may act on the current stage; stepper state | 1 and 2 stage chains |
| `editor/model/variables.ts` (lives in the editor module; domain re-exports it) | Label → snake_case key; formatting by type ($1,000.00 · 21.99% · March 4, 2027 · 20,000 · New Jersey); value validation; default sample sets ("Typical customer", "Long name and maximum values", "Minimum values") | Formatting fixtures |
| `render/*` | Resolves TipTap JSON + values into a channel-neutral `RenderDoc`. Validation names the problem: missing required keys, wrong type with the expected type, channel not allowed. Version rules: a superseded version still renders with a newer-version flag; sunset-passed and revoked versions return errors with exact wording ("Version 1 was sunset on March 1, 2027. Version 2 is active.") | Every error path |
| `redline.ts` | Block diff by block ID (added, removed, changed, moved), with word diffs inside changed blocks; "Changes only" filter | Fixture documents |
| `consequences.ts` | Builds dialog text from render-log aggregates ("Coral still renders v1 (last render today). It will keep working until the sunset date.") | Approve, sunset and revoke cases |
| `status.ts` | `STATUS_META`: label, tone and icon for each state, used by `<StatusBadge>` | Snapshot |
| `copilot-prompt.ts` | Builds the Copilot prompt from purpose, required sections and `{{key}}` variables | Snapshot |

---

## 8. How the key pieces work

### Personas and permissions
- The persona is a cookie (`ucomp_persona`, Maya when it's missing). No auth library.
- The persona switcher sits in the profile menu: 8 avatars, each with a one-line role summary such as "Coral Offers · Author".
- Choosing a persona runs a server action that sets the cookie and calls `refresh()`. The canvas then crossfades.
- Every server component that shows an action calls `can()`. Most blocked actions are hidden. A few are shown **disabled with the reason**: Approve on your own version, confirming your own revoke, and deciding your own access request.

### 8.1 The editor module (Phase 2: production code, built to be lifted into the real app)

**What portability means here**
- `src/editor/` is a self-contained React module. It owns:
  - Its schema.
  - Its extensions.
  - Its UI (built from shadcn components).
  - Its content styles (tokens only).
  - Its pure model types.
  - Its tests.
- It knows nothing about Next.js, the database, personas or the lifecycle.
- The host app passes data in and receives events out. Persistence, permissions, comments storage and the lifecycle all stay in the app.
- Lifting it means:
  1. Copy the folder.
  2. Make sure the target app has the same shadcn components and tokens.
  3. Wire the props.

  `editor/README.md` documents exactly that.

**Public API** (from `@/editor`; this is the shape, and the exact names may change)
```ts
<DocumentEditor
  content={JSONContent}                 // TipTap JSON; blocks carry stable ids
  variables={Variable[]}                // the template's variable list (the contract)
  requiredSections={{key, title}[]}     // from the content type
  readOnly={boolean}
  onChange={(doc: JSONContent) => void}                 // the host debounces and saves
  onVariablesChange={(vars: Variable[]) => void}
  threads?={ThreadAnchor[]}  onRequestComment?={(anchor) => void}
  renderThread?={(thread) => ReactNode}                 // margin threads drawn by the host
/>
<VariablesPanel />  <InlineVariableField />           // panel and email subject/preheader; share the editor context
<StaticDocument content variables />                  // server-safe first paint (@tiptap/static-renderer)
```

**Off the shelf first.** Everything below is official, open-source TipTap v3 unless marked *custom*.

| Need | TipTap piece |
| --- | --- |
| Paragraph, H1–H3, lists, bold, italic, underline, link, divider, undo/redo, drop cursor, trailing node | `StarterKit` |
| Tables | `TableKit` |
| Stable block IDs (comment anchors, redline) | `UniqueID` |
| ⋮⋮ drag handle | `DragHandle` / `extension-drag-handle-react` (MIT). We add the + button next to it. |
| Floating format toolbar | `BubbleMenu` (`@tiptap/react/menus`) |
| `/` block menu and `{{` variable picker | `@tiptap/suggestion` (the same engine Mention uses) |
| Variable chips (inline atom with a trigger) | `Mention`, extended into a `variable` node with a React NodeView |
| "Type / for blocks" | `Placeholder` |
| Dropping or pasting a .docx onto the page (feeds Import in Phase 7) | `FileHandler` |
| Server first paint | `@tiptap/static-renderer` |
| HTML → JSON on the server (import, paste fixtures) | `@tiptap/html` |
| *Custom* (TipTap has nothing free): | required-section guard; Callout node; Word list and style normalizer; comment anchors and margin layout (TipTap Comments is a paid Pro feature) |

TipTap's free UI components and its "Simple Editor" template are a source of patterns and hooks. We don't adopt their SCSS. Everything visible is shadcn, styled through tokens.

**Iterating fast.** `/editor-lab` is a dev-only page that mounts the editor on fixture documents:
- A long disclosure.
- Tables.
- 30 chips.
- Read-only.
- An empty Blank document.

That lets us judge and tune the feel without clicking through the app's lifecycle each time.

**Behavior**
- **One schema** (`editor/schema.ts`) is used by the client editor, the server static renderer, import, and the render resolver, so the four can't drift apart.
- **Blocks**: StarterKit v3 (paragraph, H1–H3, lists, bold, italic, underline, link, divider, undo/redo, dropcursor) + TableKit + a custom **Callout**. UniqueID gives every block a stable ID.
- **Required sections**
  - Headings with `requiredKey` are locked. A `filterTransaction` guard rejects any step that would delete, rename, or reorder them. That covers select-all-delete, cut, paste-over, and dragging them away.
  - When a step is rejected, a small inline note ("Required for disclosures") appears at the heading for about 2s.
  - Their content is free, and blocks can move between sections.
  - Blank still includes the three headings, with the cursor in the first section.
- **Variables**
  - An inline atom node (extended from Mention) with a React NodeView chip: type icon + label. The label comes from the variable list in the editor's own store, so renaming a label updates every chip instantly.
  - Clicking the chip opens a popover with label, key, type, sample value and where else it's used. Backspace removes the whole chip.
  - Three ways to insert:
    - Drag from the panel (HTML5 drag, with our own MIME type dropped at the ProseMirror position).
    - Type `{{` to open a picker, built with `@tiptap/suggestion` and shadcn Command, with "Create variable" pinned at the bottom.
    - Click in the panel to insert at the last caret position.
  - Every insertion is a document transaction, so undo and redo cover it.
- **Slash menu**: `/` opens a shadcn Command list with keycap chips (⌘⌥1 for H1, and so on). Fully keyboard-driven.
- **Block handle** (official DragHandle): a ⋮⋮ grip and a + appear on hover.
  - ⋮⋮ drags. Alt+Shift+↑/↓ moves the block from the keyboard.
  - + inserts a block below and opens the slash menu.
  - Required headings have no grip.
- **Bubble toolbar**: Bold, Italic, Underline, Link. On the review screen, **Comment** is added.
- **Placeholder**: only "Type / for blocks", only on an empty focused line.
- **Pasting from Word**
  - `transformPastedHTML` strips `mso-*` styles, classes, spans and fonts.
  - It turns Word's fake lists (`MsoListParagraph` + `mso-list`) into real lists.
  - It keeps H1–H3, tables and bold.
  - `{{key}}` text becomes chips; unknown keys are created as Text variables.
  - All of this is covered by fixture tests built from real Word clipboard HTML.
- **Read-only mode**:
  - `editable:false`.
  - No toolbar, handles, or panel editing.
  - "View only" badge in the header.
- **Email subject and preheader**: two single-line mini editors, using the same Variable node and `{{` picker.
- **Autosave** (in the host app; the editor only emits `onChange`):
  - Debounced `PUT /api/drafts/:id` with `{rev, body?, variables?, channels?, email?, sampleSets?, name?}`.
  - The indicator shows Saved, then Saving…, then Saved.
  - Each save merges into the current editing session's audit row.
- **Margin comments**: threads line up beside their blocks (positions recalculate on update or resize). Authors resolve them where they are.

### Render pipeline (Phase 3)
`renderTemplate({templateId, version, channel, values, consumerId, preview, encoding})` runs these steps:
1. Load the version.
2. Apply the version rules.
3. Check the channel against the content type.
4. Validate the values.
5. Resolve the document.
6. Run the channel adapter:
   - **web**: responsive HTML.
   - **email**: `{subject, preheader, html, text}`.
   - **pdf**: @react-pdf Letter pages, as a Buffer.
7. Write a `render_log` entry. No values; previews are tagged as previews.

**Route**: `POST /api/v1/templates/{id}/render` with `{version, channel, values, encoding?}`.
- Headers: `X-Consumer-Id` and `X-Correlation-Id`.
- Responses:
  - PDF: binary `application/pdf`.
  - Web: `text/html`.
  - Email: JSON.
  - `encoding: "base64"` is the opt-in.
- Errors are JSON `{error:{code, message, details}}`:
  - 422: validation or channel.
  - 404: unknown.
  - 410: sunset or revoked.
- A superseded version adds an `X-UCOMP-Newer-Version` header and an email JSON flag.

The editor preview, the review screen and the simulator all call this same route, so what the approver sees is exactly what the customer gets.

### The simulator boundary
- The simulator has its own route group and its own palette (a cooler, deliberately foreign look, with a dashed "Coral — simulated" banner) and its own `sim_*` tables.
- It calls the UCOMP API like Coral would:
  - Search (Active versions only).
  - Render with `X-Consumer-Id: coral`.
  - Read notices.

---

## 9. Phases and review gates

How every phase ends:
1. `npm run typecheck && npm run lint && npm test && npm run build` are all green (the build is what enforces the streaming rules).
2. The phase's Playwright scenario specs pass from a fresh `npm run db:reset` on the `npm run demo` build.
3. A visual-QA pass, with fixes applied.
4. I send you a gate report, a contact sheet of the key screens at 1280 and 1440px, and a short screen recording of the interactions.
5. I stop for your review before starting the next phase.

**Quick looks between gates.** Inside a phase, when something you can see lands, you get a short recording and 3–5 screenshots: the editor's feel, the SHARE ring, a new screen. React in a few minutes and we fix it before building on top of it. The goal is to catch "this doesn't feel right" in days.

### Phase 1: Foundation and first look
The build plan's foundation, plus an early look at the riskiest parts of the experience (the editor's feel, the SHARE ring, how template IDs look), built from real components and not a mock.

**What gets built**
1. **Tooling**
   - npm, with the current Node.
   - `next.config` flags.
   - ESLint boundaries, including the editor's portability rule.
   - Vitest, Playwright and axe.
   - Scripts: `dev`, `demo`, `test`, `e2e`, `db:generate`, `db:migrate`, `db:reset`, `typecheck`.
2. **Design**
   - `tokens.css`, `fonts.ts`, the shadcn theme mapping, and the shadcn components we'll use.
   - `<StatusBadge>`, `<PageHeader>`, `<Keycap>`, `<StatCard>`, `<Stream>`, `<ShareRing>`.
   - A **`/design` sample page** with:
     - **Font pairings A and B** side by side on real UCOMP content, plus an app-wide toggle.
     - **Two or three template-ID styles** to choose from, for example `UC-4F7K2Q` in a mono chip with copy, a quieter inline ID, or a longer form.
     - Every status badge, the buttons, keycaps and the SHARE ring.
3. **Data**
   - The full Drizzle schema up front, so later phases don't need migrations.
   - The libSQL client, the deterministic seed (people, teams, memberships, content type, chain, templates in every state with realistic bodies), `resetDemo()`, and the clock (real time + offset).
4. **Domain**: `permissions.ts` with the full matrix test, `status.ts`, `types.ts`.
5. **Shell**
   - Inset sidebar:
     - Team switcher (with "All teams" for Platform Admin and Auditor).
     - Library, Review (with badge), Usage, and Audit (only for roles that can see it).
     - Settings, Help, and the dismissible card slot.
   - Top bar: ⌘K trigger, a bell popover frame, and the profile menu with the persona switcher.
   - The settings modal frame, with nav grouped by role.
   - The demo pill and drawer: reset with confirm, "+1 day / +15 days / custom", and a simulator link placeholder.
6. **Library, read-only**: rows with name, status badge, active version, last edited and owner. Morgan gets routed to a request-access placeholder.
7. **First look**
   - **Workspace header** on the seeded templates: name, template ID, status badge, version label, and the **live SHARE ring** on Active templates. It has its hover motion and opens a stub sheet.
   - **`<DocumentEditor>` v0** on the seeded bodies:
     - Built from off-the-shelf extensions only: StarterKit, TableKit, UniqueID, Placeholder, the official DragHandle with +, BubbleMenu, and the `/` menu on Suggestion.
     - Variables render as chips through the Mention-based node, display only for now.
     - Editable for Maya, read-only for Sam.
     - Mounted in the app *and* in `/editor-lab`.
     - Tested under Next's hidden-route `<Activity>` behavior here, because that's my top technical risk.

**How I'll meet the gate.** The build plan's gate is that the shell feels like the screenshots and that switching personas changes teams and navigation. I'm adding a first-look sign-off.
- `e2e/phase-1.spec.ts`: for every persona, switch and then check:
  - The team switcher entries.
  - The nav items (Audit for Alex, Riley and Taylor only).
  - Whether Settings is visible.
  - That the Library rows belong only to the persona's teams.
  - That Morgan goes to request access.
  - Card Statements content never appears for Coral personas.
- The visual-QA agent compares the shell, the settings modal and `/design` with design-reference.md:
  - Warm neutral stack.
  - Hairlines, not shadows.
  - Radius scale.
  - Serif page titles.
  - A pill-shaped active state.
- Performance: the shell paints in under 300ms, CLS is 0, and the build has no blocking-route errors.
- **Your picks on `/design`**: the font pairing, the template-ID style, and the SHARE ring's size and motion.
- **The editor first look** comes with a recording of typing, the slash menu, drag-reorder, the bubble toolbar and read-only mode. Your notes feed straight into Phase 2.

**Subagents**
- I write the schema, tokens, domain types and the editor's public API myself, because everything else depends on them.
- After that, these run in parallel on separate files:
  - **Sonnet**: seed and reset.
  - **Opus**: the permission module and its tests.
  - **Sonnet**: the shell UI and the `/design` page.
  - **Opus**: editor v0 and `/editor-lab`.
- **Haiku** adds the shadcn components.
- **Sonnet** runs visual QA.

### Phase 2: The editor (its own phase; production grade)
This is the code that goes into the production app. It's built in four increments, with a quick look after each. The build plan's gate (scenario 2, steps 1–3, effortless) comes at the end.

**2.1 Variables** (the core of "impossible to break")
- The Mention-based `variable` node, complete:
  - The chip popover: label, key, type, sample value, and where else it's used.
  - Backspace removes the whole chip.
  - Renaming a label updates every chip.
- Three ways to insert:
  - Drag from the panel.
  - Type `{{` to open the picker, with "Create variable".
  - Click in the panel.
- Undo and redo cover every insertion.
- `<VariablesPanel>`:
  - Type icon, label, monospace key, required toggle and usage count. Unused variables are muted.
  - New variable is an inline row: the snake_case key is generated, then editable.
  - Deleting a variable that's in use asks whether to remove its chips.
  - The contract-change flag shows on templates that have an Active version.

**2.2 Structure and creation**
- Required sections:
  - The guard: no delete, rename or reorder, including cut, paste-over and select-all.
  - The inline note "Required for disclosures".
  - Required headings have no grip.
- The Callout block and table polish.
- The + button opens the slash menu below. Alt+Shift+↑/↓ moves a block.
- **Library, complete**:
  - Search and status filters.
  - **New template** as the only primary button.
  - The starter gallery dialog: Blank first, then Card offer terms, Rate change notice, Fee schedule. The same gallery is the empty state.
- **Two clicks to typing**: you land in the editor with the name selected, and Enter moves to the first required section.
- Workspace tabs: Content, Versions, Usage, Activity. The last three are placeholders for now.

**2.3 Robustness**
- Autosave in the host (`PUT /api/drafts/:id`) with the Saved / Saving… indicator.
- The static first paint, with no visible swap when the editor mounts.
- Read-only mode with the "View only" badge.
- Word paste normalization, covered by fixtures built from real Word clipboard HTML.
- `{{key}}` in pasted text becomes chips.
- `<InlineVariableField>`, the shared field used later for the email subject and preheader.
- Full keyboard navigation and visible focus.
- An axe-clean pass.
- Typing latency under 16ms on a long document.

**2.4 Ready to lift**
- The public API is frozen and `editor/README.md` is written: the contract, the props, and how to lift the module into another app.
- The boundary lint is clean.
- Unit tests cover every custom extension.
- `/editor-lab` proves the editor runs with no app imports.

**How I'll meet the gate.** The gate: scenario 2, steps 1–3, feels effortless.
- `e2e/scenario-02a.spec.ts`:
  - It asserts **exactly two clicks** from the Library to a focused, editable name.
  - It renames the template, writes text, drags `first_name` from the panel, types `{{` to add `purchase_apr`, and creates `offer_end_date` (Date) inline.
  - Deleting "Legal notices" is blocked with the inline note.
  - Undo and redo cover the chip insertions.
- A keyboard-only run of the same flow, plus an axe scan.
- Visual QA on the editor states:
  - An empty line showing "Type / for blocks".
  - The slash menu.
  - The handle on hover.
  - The chip popover.
  - The panel with a muted unused variable.
  - The blocked-delete note.
  - Read-only Priya on Deposits.
- Expect several rounds of your feedback here. The quick looks after each increment are meant to absorb most of them.

**Subagents**
- **Opus** owns the editor module from start to finish: the node, guards, paste, and API. The work is sequenced because it all shares `schema.ts`.
- **Sonnet** builds the Library, gallery, workspace and autosave host in parallel, in app folders only.
- **Sonnet** writes the e2e specs and runs visual QA after each increment.

### Phase 3: Preview and render
**What gets built**
1. The `domain/render/*` modules and `variables.ts` formatting.
2. The channel adapters:
   - Web: HTML.
   - Email: subject, preheader, HTML and text.
   - PDF: @react-pdf Letter pages with margins, page numbers and page breaks.
3. The render route, with validation, exact error messages, version rules and the render log.
4. **Preview split view**
   - Editor on the left, rendered output on the right.
   - Channel tabs and a sample-set switcher.
   - Web gets a desktop/mobile toggle.
   - Email gets a client frame (sender, subject, preheader, body).
   - PDF shows real pages through pdf.js, with **Download PDF**.
   - Opening the preview flushes the pending save first.
5. **Sample sets**: three defaults generated from the variables; editable, and you can add more.
6. **Email**: turning Email on adds the Email details group to the top of the panel (subject and preheader, both with chips).
7. A **minimal Submit**: Draft → In review as v1, so scenario 2 can finish here. The full submit dialog with the contract diff comes in Phase 4. See §12, Q3.

**How I'll meet the gate.** The gate: scenario 2 is complete.
- `e2e/scenario-02.spec.ts`: steps 1–5 end to end, including PDF, Web and Email previews with the "Typical" and "Long name" sets, and `{{first_name}}` in the email subject.
- `e2e/api/render.spec.ts` covers:
  - Each channel's content type.
  - base64 opt-in.
  - Missing required variables (listed by key).
  - Wrong type (named).
  - A channel that isn't allowed (422).
  - That previews are tagged.
  - That **no values ever appear in `render_log`**.
- Visual QA on the three previews and the long-name layout.

**Subagents**
- **Opus**: the render domain and the PDF adapter.
- **Sonnet**: the preview UI and the sample-set editor.
- **Sonnet**: the API specs.

### Phase 4: Lifecycle and review
**What gets built**
1. **Submit dialog**: the version number about to be assigned, enabled channels, sample sets, contract changes against the Active version, an optional note, and a **Submit v2** button.
2. **Review queue**: tabs for Waiting on me, Submitted by me, and Recently decided. The sidebar badge shows the count. Rows show template, version, author, submitted, stage, and a "Breaking change" badge.
3. **Review screen**
   - Left side:
     - Rendered output, with channel tabs and sample sets.
     - A **redline** toggle: block diff with green underline and red strike, plus "Changes only".
   - Right side, the decision panel:
     - The chain stepper.
     - Contract changes.
     - Threads.
     - **Approve** and **Request changes**.
4. **Comments**: on a block or a text selection, with replies and resolve. The author sees them in the editor margin.
5. **Request changes**: the reason is required and becomes a comment. A new draft is created that carries the threads.
6. **Approve dialog**
   - Shows the consequences from render-log data.
   - Has an optional sunset date for the previous version.
   - Leads into the **go-live moment**, after which the SHARE ring settles into the header.
7. **Maker-checker**: Approve is shown disabled with "You submitted this version."
8. **Versions tab**
   - A timeline of versions.
   - Compare any two.
   - Set sunset.
   - **Two-person revoke**: one approver starts it, a different approver confirms. The first can't confirm.
9. The per-template **Activity** tab (that template's audit events). Audit events and notifications are emitted from this phase on.

**How I'll meet the gate.** The gate: scenarios 3 and 6.
- `e2e/scenario-03.spec.ts`:
  - Maya sees Approve disabled.
  - Jordan comments and requests changes.
  - The new draft carries the margin comment.
  - Maya resolves it and resubmits as v2.
  - Jordan approves, the go-live moment plays, and SHARE appears.
- `e2e/scenario-06.spec.ts`:
  - Jordan starts a revoke on Balance Transfer v1 and can't confirm it.
  - Alex confirms.
  - Rendering v1 as Coral fails with the revoke message. This is checked against the API here; the simulator check comes in Phase 5.
  - The **Activity tab** shows both steps. See §12, Q3: the full Audit page arrives in Phase 6.
- Domain tests cover every lifecycle row.
- Visual QA on the queue, the review screen, the redline and the dialogs.

**Subagents**
- **Opus**: lifecycle and the redline domain, plus the server actions.
- **Sonnet**: queue and review UI.
- **Sonnet**: comments and margin threads.
- **Sonnet**: Versions tab.
- The UI agents run in parallel on separate folders.

### Phase 5: Going live
**What gets built**
1. **Consumer simulator** at `/sim`, opened from the demo drawer:
   - Offers.
   - Link a template, found through UCOMP search (Active only; the link pins the version).
   - Map values. Unmapped required variables block sending, and the block names them.
   - Send to customers, with a results grid.
   - Customer view: a phone frame, an inbox, or the PDF.
   - Notices: "v2 available" plus its contract changes.
   - Relink, which walks through mapping any new required variables.
   - Failures after a sunset or revoke show the exact render error.
2. **Usage dashboard** (Flow's Insights layout):
   - Stat cards: renders this month with a trend pill, active templates, consumers, versions nearing sunset.
   - A teal calendar heatmap with a More/Less legend.
   - Horizontal bars of renders by consumer.
   - A consumers table with tags ("On superseded v1 · sunset in 6 days").
   - A per-template Usage tab.
3. 90 days of seeded render history.
4. The **Integration panel** (a sheet opened by SHARE):
   - ID, Active version, channels.
   - The contract as a table and as copyable JSON Schema.
   - A sample request (curl and fetch).
   - Response formats.
   - "What changed since vN".
   - Copy buttons on everything.

**How I'll meet the gate.** The gate: scenarios 4 and 5 end to end.
- `e2e/scenario-04.spec.ts`:
  - Link and pin v2, then map.
  - Send to five customers; all are Delivered.
  - Open one in the phone frame and one as a PDF. The long-name layout holds.
  - Usage counts go up.
  - A database assertion that `render_log` holds no customer values.
- `e2e/scenario-05.spec.ts`:
  - v3 adds `annual_fee` and is flagged as breaking.
  - Approving v3 sets v2's sunset 14 days out, and the consequence text names Coral.
  - The simulator shows "v3 available" and still sends on v2.
  - +15 days: sending fails with the sunset message.
  - Relinking asks for `annual_fee`, and the send succeeds.
- Scenario 6 is re-run with the simulator's send failure.
- Visual QA on the dashboard against Unknown.png, and on the simulator's "outside system" look.

**Subagents**
- **Sonnet**: the simulator.
- **Sonnet**: Usage and the charts.
- **Sonnet**: the Integration panel.
- **Haiku**: the seed history generator, with the spec handed to it.
- **Sonnet**: QA.

### Phase 6: Access and admin
**What gets built**
1. **Request access** for Morgan:
   - The teams, each with a one-line description and its admin.
   - Pick a role, write a reason, submit. A pending state replaces the form.
   - Denial shows the admin's note.
2. **Settings, Team group**:
   - **Members**: edit roles, remove.
   - **Access requests**: approve or deny with a note, never your own.
   - **Recertification**: Keep or Remove per member, "4 of 6 confirmed", and lapse at the deadline (demo clock).
   - **Inactivity**: flagged at 90 days, then suspended (§12, Q5).
3. **Settings, Platform group**:
   - **Teams**: create a team and its first Team Admin.
   - **Content types**: required sections and channels.
   - **Channel rules**: the content type × channel matrix.
   - **Approval chains**: ordered stages. Dana Park and a Legal stage can be demoed here.
4. **Auditor**: "All teams" and read-only everywhere.
5. **Audit page**: filters for team, person, action and date, with demo-clock times, plus CSV export if time allows.
6. **Notifications**: unread dot, mark as read, and every event type.
7. **Sidebar cards**: "Recertification due" and "Access request pending".

**How I'll meet the gate.** The gate: scenarios 7 and 8.
- `e2e/scenario-07.spec.ts`:
  - Priya edits in Coral and gets View only, with no toolbar, in Deposits.
  - Sam can use SHARE but can't edit.
  - Riley changes a channel rule and gets a read-only editor.
  - Taylor sees the whole story in the Audit page.
- `e2e/scenario-08.spec.ts`:
  - Morgan requests access; Alex sees the card and the notification and approves; Morgan sees the Library.
  - Recertification leaves one member unconfirmed; advance the clock past the deadline and that member has lost access.
- Visual QA on the settings modal against Unknown-3.png.

**Subagents**
- **Sonnet**: access and team settings.
- **Sonnet**: platform settings and approval chains.
- **Sonnet**: audit and notifications.
- **Opus** reviews `access.ts` and the clock-driven lapses.

### Phase 7: Import and polish
**What gets built**
1. **Import** of .docx, .pdf or .txt:
   - The file is stored in `./data/uploads`, converted to TipTap JSON with the shared schema, and `{{placeholders}}` become Text chips.
   - **Compare with original** shows the source file beside the draft.
2. **Copy prompt for Copilot**: a dialog with the generated prompt and a copy button. Pasting the result back turns `{{key}}` into chips through the Phase 2 paste path.
3. The **⌘K palette**: search templates and jump between pages. It's cheap with shadcn Command, so I may pull it into Phase 2.
4. **A full UX pass**, checked against the experience principles:
   - Remove stray hint text.
   - Audit badges and wording.
   - Exactly one primary button per screen.
   - Focus states.
   - Reduced motion.
   - Empty states that are actions, not instructions.
5. Stretch items, if there's time: draft requests and audit CSV export.

**How I'll meet the gate.** The gate: scenarios 1–11.
- `e2e/scenario-09.spec.ts` (import) and `scenario-10.spec.ts` (Copilot).
- The full script, scenarios 1–11, runs **serially from a fresh reset** in one Playwright run, with zero console errors.
- Automated principle checks run on every route:
  - At most one primary button inside the canvas.
  - Every status label rendered through `<StatusBadge>`.
  - No placeholder text other than "Type / for blocks".
  - axe clean.
  - CLS of 0.
- A final contact sheet of every screen, and a short recorded walkthrough (a Playwright video) of the demo script.

---

## 10. QA and visual verification

- **Automated.**
  - Vitest covers domain and schema logic.
  - Playwright scenario specs run serially against `npm run demo`, with a global setup that runs `resetDemo()`.
  - API specs cover the render route.
  - axe runs on the key screens.
  - A `prefers-reduced-motion` pass runs.
  - A performance probe (PerformanceObserver for LCP and CLS) runs on each route.
- **The visual loop** (per your request, kept light on context):
  - After each UI slice, a Sonnet QA subagent drives Playwright MCP at 1280×800 and 1440×900.
  - It compares against `reference-images/` and `design-reference.md`, plus the eight principles.
  - It returns a short list of findings in text. Fixes go back to the implementing agent.
  - Screenshots are saved under `e2e/__screens__/phase-N/` for your contact sheet.
- **What the principles become as checks**:
  - The two-click creation test.
  - The single `<StatusBadge>`.
  - The one-primary-button assertion.
  - Disabled actions must carry a reason.
  - Consequence dialogs must name the affected consumers.
  - A copy lint that fails on instructional text.

---

## 11. How I'll run the subagents

- **I'm the architect and integrator.** I own this plan, the schema, the domain interfaces, the tokens and the gate reviews. I keep the main context light: research, big file reads and screenshots go to subagents, and they report back in text.
- **Model tiers**, following your global rules:
  - **Opus**: the editor core, the domain layer and the render pipeline.
  - **Sonnet**: screens, simulator, dashboards, e2e specs, visual QA.
  - **Haiku**: mechanical work such as adding shadcn components, seed copy, and wording audits.
- **Running in parallel.** Agents run in parallel only when the files they own don't overlap (the folders in §5). Anything touching `editor/schema.ts`, `domain/types.ts` or the DB schema goes through me.
- **Every brief includes**:
  - The relevant section of this plan and the build plan.
  - `design-reference.md`.
  - The AGENTS.md reminder to read `node_modules/next/dist/docs` first. The local Next skills are partly out of date: for example, `revalidateTag` now needs a second argument, and the skill's `proxyConfig` is just `config` in the docs.
  - The definition of done: typecheck, lint, tests, and a screenshot check.

---

## 12. Open questions

**Answered Oct 4**
- npm with the current Node, no pinning.
- The clock is real time + an "advance" offset.
- Fonts are chosen on a sample page.
- TipTap off the shelf, including the official drag handle.
- The editor gets its own production-grade phase.
- See it early.

The static editor mock I'd proposed is gone. Phase 1 now shows the real editor instead.

**Still open. I'll use these defaults unless you say otherwise:**
1. **PDF preview.**
   - Default: real PDF pages through pdf.js, so the approver sees the exact file. It costs about 300 KB of JavaScript, loaded only on the first PDF preview.
   - The alternative is an HTML "paper" approximation, which is lighter but not identical to the download.
2. **Required sections.**
   - Default:
     - The headings stay in fixed order and can't be dragged.
     - Content can move freely between sections.
     - An opening block *above* the first required section is allowed, for example a "Hi {{first_name}}," greeting.
   - Is that right for production too?
3. **Gate dependencies in the build plan.**
   - Scenario 2 (Phase 3 gate) ends with Submit, but submitting is a Phase 4 feature.
   - Scenario 6 (Phase 4 gate) needs the Audit log (Phase 6) and Coral sends (Phase 5).
   - Default:
     - Build a minimal Submit in Phase 3.
     - In Phase 4, prove scenario 6 through the template's Activity tab and the render API.
     - Re-run scenario 6 in full at Phases 5 and 6.
4. **Demo mode.**
   - Default: use `npm run demo` (production build) for user sessions. Prefetching and the instant shell only run in production builds.
5. **Inactivity.**
   - The build plan says members are flagged at 90 days with no login, *then suspended*, but doesn't say when.
   - Default: flag at 90 days; the Team Admin can suspend or keep; automatic suspension at 120 days.
6. **Charts.**
   - shadcn's Chart is Recharts (about 100 KB, client-side), and Flow's gauge and heatmap aren't Recharts shapes anyway.
   - Default: small server-rendered SVG charts inside shadcn Cards and Tooltips.
7. **Simulator presentation.**
   - Default: a full-page route in the same tab, with an "← Back to UCOMP" pill.
   - The alternative is opening it in a new browser tab, which feels more like a separate system.
8. **Help link.**
   - Default: a popover with keyboard shortcuts and the status-badge legend. No tours.
9. **Brief-only features.**
   - These stay out of scope for now:
     - Cloning from a base template.
     - Preset required variables.
     - Retention and review-by dates.
     - Batch render.
     - Shared templates across teams.
     - Notification and Banner content types.
   - The data model leaves room for them: content types and channels are data, not code.
10. **Git.**
    - Everything is on `main` with uncommitted scaffold changes.
    - Default: create a `prototype` branch, and commit at each gate after you approve it. I only commit when you say so.
