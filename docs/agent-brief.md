# Agent brief — shared rules for every UCOMP subagent

Read this file first, then read your task. Any task that builds or changes UI also follows `docs/ui-checklist.md` (lessons from Phase 3's QA): check your screens against it before you report. Source documents:
- `docs/UCOMP Prototype — Build Plan for Claude Code.md` sets the scope. Read the sections your task names.
- `docs/UCOMP-Implementation-Plan.md` is the architecture and the phases.
- `docs/design-reference.md` covers look and feel. The source images are in `reference-images/`; open them only if your task is visual.

## Stack facts (Next.js 16.3.8 — not the Next.js you know)

Read the relevant guide in `node_modules/next/dist/docs/` before you use any Next.js API. The bundled docs beat the local skills, which are partly out of date.

- **Cache Components is on (`cacheComponents: true`).**
  - Never add `loading.tsx`.
  - Any component that reads `cookies()`, `params`, `searchParams`, or the database must render inside a `<Suspense>` boundary. Use `<Stream fallback={<Skeleton…/>}>` from `@/components/primitives/stream`.
  - Reading request data outside Suspense is a **build error**.
  - `new Date()` and `Date.now()` in a server component during prerender is also an error. Use `now()` from `@/server/clock`. It's async and calls `connection()` itself, so call it inside Suspense. A DB query that runs before any `cookies()` or `params` read also needs `await connection()` first, because libSQL resolves in microtasks during prerender.
- **Request APIs are async.** `params`, `searchParams`, `cookies()` and `headers()` return promises. Pass the `params` promise down and await it inside the Suspense child.
- **Server actions** are `"use server"` functions.
  - After a mutation, call `refresh()` (from `next/cache`) or `revalidatePath()`.
  - Use `redirect()` last.
  - Every action checks permissions first.
- **No `middleware.ts`.** It's renamed `proxy.ts`, and we don't need it.
- **shadcn here is the `base-nova` style on Base UI, not Radix.**
  - Use the `render` prop, never `asChild`. For example: `<Button render={<Link href="…" />} nativeButton={false}>`.
  - Components live in `src/components/ui/`. Don't edit them.
  - To add a missing component, run `npx shadcn add <name> -y` and tell me in your report.
- **Motion**
  - Use `motion/react` inside client components only, through the `m.*` components, because `LazyMotion` strict mode is on in `<Providers>`.
  - Presets are in `@/components/motion/presets`.
  - Reduced motion is handled globally (`MotionConfig reducedMotion="user"`).
- **Typed routes are on.** `<Link href>` must be a known route, or `as Route` for dynamic strings.

## Design rules (tokens only)

- Never use hex or rgb values in components. Use the token utilities from `src/app/globals.css` and `src/styles/tokens.css`:
  - Surfaces: `bg-app`, `bg-canvas`, `bg-surface`, `bg-surface-tinted`, `bg-surface-sunken`, `bg-selected`, `bg-hover`, `bg-tan`.
  - Lines and text: `border-hairline`, `text-text`, `text-text-muted`, `text-text-subtle`, `text-label`.
  - Accent: `bg-brand`, `text-brand`, `bg-brand-soft`, `bg-brand-1…4`, `bg-heat-empty`.
  - Feedback: `bg-positive-soft`, `text-positive`, `text-danger-text`, `bg-danger-soft`.
  - Chips: `bg-chip`, `border-chip-border`, `text-chip-text`, `text-chip-icon`.
  - Status: `bg-status-<tone>`, `text-status-<tone>-text`, `border-status-<tone>-border`.
  - Shadows: `shadow-pop` (menus), `shadow-modal` (modals only).
- **Radius**: `rounded-md` = chips (6px), `rounded-lg` = controls (8px), `rounded-xl` = cards (14px), `rounded-2xl` = large cards (18px), `rounded-3xl` = modals (22px), `rounded-4xl` = the canvas panel (24px).
- **Typography**
  - Fonts (Sri's pick, Oct 4): **Newsreader** for display, **Figtree** for the UI, **Geist Mono** for keys.
  - `font-display` (serif) is for page titles only. Use the `.display-xl` and `.display-lg` utilities.
  - Buttons: shadcn defaults for now (the primary is the black `default` variant, 8px radius). Tune as we build.
  - `.caps-label` is for tracked uppercase labels. `.numeral` is for big stat numbers.
  - Everything else is `font-sans`, in regular and medium weights only. No bold in UI chrome.
- **Do not edit** `tokens.css` or `globals.css`. If you need a token, use the closest existing one and list the missing token in your report.
- **Shared primitives** — use them, don't fork them:
  - `@/components/primitives/status-badge` (`<StatusBadge state sunsetAt?>`)
  - `page-header` (`<PageHeader title eyebrow? action?>`)
  - `keycap` (`<Keycap>`, `<Shortcut keys>`)
  - `template-id` (`<TemplateId id label?>`: the labeled "TEMPLATE ID" style with copy, Sri's pick)
  - `stream` (`<Stream>`)
- **Experience principles** (build plan): self-evident with no onboarding; no instructional hint text; one primary (black) button per screen; status is always shown with `<StatusBadge>`; explain only when an action is blocked; calm density; outline icons (lucide, about 1.75 stroke).

## Seed contract (fixed IDs other agents rely on)

- **Personas (user ids):** `maya`, `jordan`, `alex`, `priya`, `sam`, `riley`, `taylor`, `morgan`. Maya is the default persona.
- **Team slugs:** `coral-offers`, `deposits`, `card-statements`. The ids are the same as the slugs. The "All teams" space uses the slug `all`.
- **Persona cookie:** `ucomp_persona` (`@/server/viewer`: `getViewer()`, `getPersonas()`, `PERSONA_COOKIE`).
- **Clock:** `@/server/clock`: `now()` and `advanceClock(days)`.
- **Reset:** `resetDemo()` in `@/server/reset` (written by the seed agent).
- **Content type:** `disclosure`.
  - Required sections, in order: `offer_details` "Offer details", `rates_and_fees` "Rates and fees", `legal_notices` "Legal notices".
  - Channels: `pdf`, `web`, `email`.
- **Template IDs:** `UC-` followed by 6 Crockford base32 characters, for example `UC-4F7K2Q`.

## TipTap JSON contract (the editor, the seed and the renderer must all agree)

- **Document**: `{ type: "doc", content: Block[] }`. Every **top-level** block has `attrs.id`, a stable unique string (UniqueID).
- **Blocks**:
  - `paragraph`
  - `heading` `{ level: 1|2|3, id, requiredKey?: string|null }`. Required sections are H2 with `requiredKey`.
  - `bulletList` / `orderedList` → `listItem` → `paragraph`
  - `table` → `tableRow` → `tableHeader` | `tableCell` → `paragraph`
  - `callout` `{ id }` → `paragraph`+
  - `horizontalRule`
- **Inline**:
  - `text` with marks `bold`, `italic`, `underline` and `link {href}`.
  - **`variable` `{ key }`**: an inline atom. Label and type come from the version's variable list, never from the node.

## Working rules

- **File ownership.** Stay inside the files your task assigns. Several agents are working in parallel. If you must touch a shared file, stop and say so in your report instead.
- **No dev server of your own.** One dev server runs at **http://localhost:3000**. Don't start another and don't run `next build`.
- **Verify with:**
  - `npx tsc --noEmit` (run `npx next typegen` first if route types are stale).
  - `npx eslint <your paths>`.
  - `npx vitest run <your tests>`.
- **Screenshots**
  - If your task is visual, you may take screenshots of localhost:3000 with a small Playwright script (`chromium` from `@playwright/test`, viewport 1440×900).
  - Save them under `e2e/__screens__/` and look at them at reduced size. Take only what you need.
- **Don't** commit, push, install packages or change config without saying so in your report.
- **Temp files.** Put scratch scripts and outputs in a subfolder of the scratch directory named after your task (for example `<scratchpad>/u2-versions/`). Delete only files you created; never `rm` by wildcard in a shared folder.
- **Report back in text:**
  - What you built, as file paths.
  - Decisions you made.
  - Anything left unfinished, and why.
  - Missing tokens or components.
  - Check results.

  No raw logs or images.
