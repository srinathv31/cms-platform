# `src/editor`: the UCOMP document editor

A self-contained React module for authoring regulated content: a calm document page, blocks you can
drag, and typed variables that are impossible to break. Built on open-source TipTap v3 (MIT) with
shadcn/ui (Base UI) for every visible control. It knows nothing about Next.js, the database,
personas or the template lifecycle: the host passes data in and receives events out.

Status: **Phase 1 (v0)**. Editing, blocks, chips (display only), `/` menu, drag handle, format
toolbar, static first paint. Phase 2 adds the variables panel, `{{` picker, chip popover and the
required-section guard. The public API below is designed to be extended, not changed.

## Public API (`@/editor`)

```tsx
import { DocumentEditor, StaticDocument } from "@/editor";

<DocumentEditor
  content={doc}               // TipTap JSON (initial; remount with a new key to switch documents)
  variables={variables}       // Variable[]: the template's contract; chips read label/type here
  readOnly={false}            // no handles, no toolbar, no `/` menu, no placeholder
  onChange={(doc) => save(doc)} // every edit; debounce in the host. Not fired for mount-time
                                // normalization (missing block ids, trailing paragraph)
  autoFocus="first-section"   // "start" | "end" | "first-section" | false
  className="…"
/>

<StaticDocument content={doc} variables={variables} />  // server-safe, no JS, same markup
```

Props not used yet (accepted, wired in later phases): `requiredSections`, `onVariablesChange`,
`threads`, `onRequestComment`, `renderThread`. See `types.ts`.

Also exported:

| Export | What it is |
| --- | --- |
| `VariableChipView` | The presentational chip (no hooks). Reuse it anywhere a chip appears. |
| `baseExtensions(opts)` | Server-safe extension list (schema + commands). Use for `@tiptap/html`, `@tiptap/static-renderer`, import and render pipelines. |
| `editorExtensions(opts)` | Client list = base + chip NodeView, placeholder, `/` menu. `DocumentEditor` calls it. |
| `ensureBlockIds(doc)` | Adds `attrs.id` to blocks that lack one, server-side. **Seeds, import and server writes should call it** so ids are stable before the editor ever opens the document. |
| `formatValue`, `validateValue`, `toKey`, `isValidKey`, `TYPE_META`, `US_STATES` | Pure variable helpers (`model/variables.ts`). |
| Types | `DocumentEditorProps`, `StaticDocumentProps`, `Variable`, `VariableType`, `RequiredSection`, `JSONContent`, `NODE`… |

## Document contract (TipTap JSON)

- `doc` → blocks. Every block of type `paragraph`, `heading`, `bulletList`, `orderedList`,
  `listItem`, `table`, `callout`, `horizontalRule` has `attrs.id` (UniqueID). Existing ids are kept.
- `heading { level: 1|2|3, requiredKey?: string|null }`; HTML `data-required="<key>"`.
  A `requiredKey` appears at most once per document (splits and pastes can't duplicate it).
- `callout` → `paragraph+`; HTML `<div data-callout>`.
- `table` → `tableRow` → `tableHeader | tableCell` → blocks.
- Inline `variable { key }`; HTML `<span data-variable="key">Label</span>`; plain text `{{key}}`.
  The node never stores label or type.
- Marks: `bold`, `italic`, `underline`, `link { href }`.

## How it's built

| Need | Piece |
| --- | --- |
| Paragraph, H1–H3, lists, marks, link, divider, undo/redo, drop cursor, gap cursor, trailing line | `@tiptap/starter-kit` (code, code block, strike, blockquote off) |
| Tables | `@tiptap/extension-table` `TableKit` (not resizable; wrapper rendered so static = live) |
| Stable block ids | `@tiptap/extension-unique-id` |
| Variable chip | `@tiptap/extension-mention`, extended (`extensions/variable.ts`) + React NodeView |
| `/` menu | `@tiptap/suggestion` + shadcn `Command` (`extensions/slash-command.ts`, `components/slash-menu.tsx`) |
| ⋮⋮ handle | `@tiptap/extension-drag-handle-react` + our `+` button (`components/block-handle.tsx`) |
| Dragged-block highlight | `@tiptap/extension-node-range` decoration helper (`extensions/block-range-highlight.ts`) |
| Format toolbar | `BubbleMenu` from `@tiptap/react/menus` (`components/format-bubble.tsx`) |
| "Type / for blocks" | `Placeholder` from `@tiptap/extensions` |
| Server first paint | `@tiptap/static-renderer` (`components/static-document.tsx`) |
| *Custom* | `Callout` node, `RequiredSections` attribute + dedupe (guard in Phase 2), variable store |

Rendering and performance:

- `useEditor({ immediatelyRender: false, shouldRerenderOnTransaction: false })`. Typing never
  re-renders React; the toolbar reads state through `useEditorState` selectors, chips subscribe to
  their own key in a per-editor zustand store, and the `/` menu (cmdk) mounts only while open.
- The server and the hydration pass render `<StaticDocument>`; the live editor mounts after
  hydration with identical markup (`.ucomp-surface > .ucomp-doc`), so there is no visible swap.
  TipTap's injected CSS is off; `styles.css` carries the ProseMirror essentials for both.
- Survives Next's hidden-route `<Activity>`: if the editor is destroyed while hidden, it comes back
  with the latest document, not the initial one.

## Lifting it into another React app

1. **Copy** `src/editor/` as is.
2. **Dependencies** (all MIT): `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`,
   `@tiptap/extension-table`, `@tiptap/extensions`, `@tiptap/extension-unique-id`,
   `@tiptap/extension-drag-handle`, `@tiptap/extension-drag-handle-react`,
   `@tiptap/extension-node-range`, `@tiptap/extension-mention`, `@tiptap/suggestion`,
   `@tiptap/static-renderer`, plus their peers (`@floating-ui/dom`, `@tiptap/extension-collaboration`,
   `@tiptap/y-tiptap`); `react`, `react-dom`, `motion`, `zustand`, `lucide-react`.
3. **shadcn/ui** (base-nova style, Base UI) at `@/components/ui/*`: `button`, `toggle`, `input`,
   `command`, `kbd` (and what they import: `dialog`, `input-group`).
4. **Tokens**: Tailwind v4 with the UCOMP semantic theme (utilities such as `bg-surface`,
   `border-hairline`, `text-text-muted`, `bg-chip`, `border-chip-border`, `text-chip-text`,
   `text-chip-icon`, `bg-status-review*`, `shadow-pop`, `rounded-md…4xl`) and the CSS variables
   `styles.css` reads: `--text`, `--text-muted`, `--text-subtle`, `--hairline`, `--surface-tinted`,
   `--brand`, `--brand-1`, `--brand-3`, `--brand-soft`, `--radius-control`, `--radius-card`,
   `--doc-width`, `--ui-font-sans`, `--dur-fast`. Theming = changing tokens, never this folder.
   Make sure Tailwind scans the copied folder for class names.
5. **CSS**: `styles.css` is imported by the components; with a bundler that handles CSS imports
   (Next, Vite) there is nothing to do. Otherwise import it once globally.
6. **Wire the props**: pass `content` + `variables`, persist from `onChange`, set `readOnly` from
   your permissions. Run `ensureBlockIds` wherever documents are created outside the editor.
7. **Motion**: nothing to set up. The `/` menu brings its own `LazyMotion` (`domMax`, for the
   sliding highlight) and the editor sets `MotionConfig reducedMotion="user"`.

The editor imports only `react`, `@tiptap/*`, `@/components/ui/*`, `lucide-react`, `motion` and
`zustand` (enforced by ESLint in this repo).

## Files

```
index.ts                 public API
types.ts                 component contract
schema.ts                the one extension list (+ ensureBlockIds)
styles.css               document typography and editor states (tokens only)
model/                   pure TS: Variable types, formatValue/validateValue/toKey
state/variable-store.ts  per-editor zustand store (chips, Phase 2 panel)
extensions/              TipTap extensions (server-safe, except variable-view.ts)
components/              DocumentEditor, StaticDocument, chip, handle, toolbar, `/` menu
```

Tests: `npx vitest run src/editor`. Playground: `/editor-lab`.
