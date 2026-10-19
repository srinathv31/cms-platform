# Brand

The product's logo: the mark, the "Stencil" wordmark, and the decorations being explored for it. The sidebar's
`HomeLink` ([app-shell/home-link.tsx](../app-shell/home-link.tsx)) shows the variant named in
[logo-config.ts](logo-config.ts); `/logo-lab` (in `next dev`) shows every variant in the sidebar's header and at both
sizes. Why it is built this way: [decision 0074](../../../docs/decisions/0074-the-logo-decorations-are-sized-in-em-and-stroked-per-size.md).

```tsx
<StencilLogo variant="hybrid" size="nav" />
```

| Variant        | Component                 | What it draws                                                                                                                                     |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`         |                           | The logo as it was, undecorated. The default, and what the sidebar shows today.                                                                   |
| `arc`          | `CreativeArcDecoration`   | A pen line from the mark's top corner over the wordmark, ending at the tip of a nib. `tool="pencil"` and `from="wordmark"` vary it.               |
| `stack`        | `TemplateStackDecoration` | Sheets stacked behind the mark, offset up and left, the front one dog-eared and the middle one tinted.                                            |
| `hybrid`       | `HybridDecoration`        | Two closer sheets, and a finer pen line that leaves from the front sheet's dog-ear.                                                               |
| `hybrid-stack` | `HybridStackDecoration`   | Hybrid's pen line on Template Stack's sheets: the tinted sheet, and the third sheet and the tilt at `hero`.                                       |
| `ultimate`     | `UltimateDecoration`      | Hybrid Stack with Underline's stroke under the wordmark, which draws in as the pen lands.                                                         |
| `stack-v2`     | `StackV2Decoration`       | A used stack: three sheets larger than the mark, fanned at rest, ruled by hand, the back one dog-eared; a watercolour wash, and sparks at `hero`. |
| `hybrid-v2`    | `HybridV2Decoration`      | Stack v2, and a pen line from the back sheet's dog-ear, brushed at `hero`.                                                                        |
| `ultimate-v2`  | `UltimateV2Decoration`    | Hybrid v2 over Underline's stroke, brushed at `hero`, which draws in as the pen lands.                                                            |
| `underline`    | `UnderlineDecoration`     | An extra: one pen stroke under the wordmark.                                                                                                      |
| `crop`         | `CropMarksDecoration`     | An extra: printer's crop marks at the mark's corners, and a registration target at `hero`.                                                        |

## Files

| File                                             | What it holds                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [stencil-logo.tsx](stencil-logo.tsx)             | `StencilLogo`, the variant list and the map from variant to decoration, `LogoLockup` (the mark and wordmark with any decoration as children), and `LogoMark`.                                                                                                                                                                                                                                                     |
| [logo-config.ts](logo-config.ts)                 | `HEADER_LOGO_VARIANT`, the one value that puts a variant in the sidebar.                                                                                                                                                                                                                                                                                                                                          |
| [sketch.tsx](sketch.tsx)                         | The units, the lockup's geometry, `STROKE`, `Layer` (one positioned SVG) and `edge` (a hand-bowed line).                                                                                                                                                                                                                                                                                                          |
| [pen.tsx](pen.tsx), [pen-line.tsx](pen-line.tsx) | The nib and the pencil, and the pen line both Creative Arc and Hybrid draw.                                                                                                                                                                                                                                                                                                                                       |
| [rough.ts](rough.ts)                             | `wobble` (a fixed number per seed, integer arithmetic), `roughLine` (a ruled line drawn by hand), `brush` and `swell` (a tapered stroke as a filled shape).                                                                                                                                                                                                                                                       |
| [rugged-stack.tsx](rugged-stack.tsx)             | `RuggedStack` and `RUGGED_SHEETS`, the v2 variants' used stack, its `DogEar`, `Wash` and `Sparks`.                                                                                                                                                                                                                                                                                                                |
| [page-stack.tsx](page-stack.tsx)                 | `SheetStack`, which draws the sheets and fans them, and `TINTED_SHEETS`, Template Stack's sheets, which Hybrid Stack draws too.                                                                                                                                                                                                                                                                                   |
| One file per decoration                          | [creative-arc.tsx](creative-arc.tsx), [template-stack.tsx](template-stack.tsx), [hybrid.tsx](hybrid.tsx), [hybrid-stack.tsx](hybrid-stack.tsx), [ultimate.tsx](ultimate.tsx) (Hybrid Stack and Underline together), [stack-v2.tsx](stack-v2.tsx), [hybrid-v2.tsx](hybrid-v2.tsx), [ultimate-v2.tsx](ultimate-v2.tsx) (Hybrid v2 and Underline), [underline.tsx](underline.tsx), [crop-marks.tsx](crop-marks.tsx). |

## How it is built

- **Size.** `size` is a prop, never measured. It sets the lockup's font-size, which is the mark's side: 32px for
  `nav`, 80px for `hero`. The wordmark is 0.6875em, the gap 0.375em, and the decorations are placed in em, so
  changing the font-size (a `text-[…]` class through `className`) scales the whole lockup.
- **Units.** Geometry is written in units of 1/32 em (`U`): a CSS pixel at `nav`. The mark is the square 0..32 and
  the wordmark starts at 44. Straight `nav` lines sit on half units, so they are sharp on a 1x screen.
- **Layers.** Every decoration is one or more `Layer`s: an absolute SVG, `aria-hidden`, `focusable="false"`,
  `pointer-events: none`, never clipped (`overflow: visible`). A `behind` layer paints under the mark: the lockup is
  `isolate`, so it stays above whatever the lockup sits on. A layer placed with `left` and `right` stretches with
  the wordmark (`stretch`). The pen line is three layers: it rises in a stretching layer, falls in a fixed one
  anchored to the wordmark's end, and the pen is a layer of its own with its tip at the line's end, so it never
  distorts.
- **Strokes.** Every shape draws with `vector-effect: non-scaling-stroke`. The weights in `STROKE` are CSS pixels per
  size, not scaled with it: 1px ink and a 1.5px accent at `nav`, 1.5px and 2.5px at `hero`.
- **Detail.** At `nav`: straight edges, two sheets, a silhouette for the pen, no ticks. At `hero`: hand-bowed edges
  that overshoot their corners, a tilted back sheet, the nib's slit and breather hole, and motion ticks. The bows
  and tilts are constants: the drawing is the same on every render.
- **Colour.** The accent is the SVG's `currentColor` (`text-logo-accent`). Ink, paper and wash are
  `stroke-logo-ink`, `fill-logo-paper` and `fill-logo-wash`. The five tokens are in
  [tokens.css](../../styles/tokens.css): the accent follows the brand placeholder (TD green later). In forced colours
  they become the system's `CanvasText` and `Canvas`, and the wash goes.
- **The v2 drawing.** The v2 sheets are drawn the way a sketch is, and every mark is still fixed geometry:
  - Each edge is a `roughLine`. It wobbles through its thirds, and starts before its corner and runs past it, so
    corners cross. At `hero` a lighter second pass runs beside part of each edge.
  - The wobble comes from `wobble(seed, i)`, which uses integer arithmetic only. The server, the client and every
    browser draw the same bits, and there is no randomness.
  - The sheets are turned at rest, and the back one is dog-eared with a curled, tinted flap.
  - The `Wash` is two flat pools of the wash colour with `mix-blend-mode: multiply`. The lines show through it,
    and the colour deepens where the pools overlap.
  - At `hero` the pen line and the underline can be `brush` strokes: filled shapes that start fine, swell and
    tail off. Across a stretching layer their width is measured straight down, so the stretch never thins them.
    `nav` keeps the even, non-scaling line, and has no sparks.
  - The v2 sheets use `--logo-paper-used`, a warmer paper than fresh white.
- **The fan.** While the logo is hovered, or the link around it is hovered or focused from the keyboard, the lockup
  takes `--logo-fan` from 0 to 1 (`--dur-slow`, `--ease-out-soft`), and every sheet with a `fan` swings out:
  translated and turned about a point below the mark, the back sheet furthest. The front sheet has no `fan`, so
  the pen line that leaves from its dog-ear stays attached. `--logo-fan` is registered as a number in
  [globals.css](../../app/globals.css) (`@property`), which is what lets a custom property animate. The swing is a
  transform, so it never moves layout; under reduced motion it is instant.
- **The draw.** On the same hover or focus, the pen draws its line again, and in the Ultimates the underline
  follows. It is timed as a micro-interaction:
  - Nothing starts for the first 60ms, so a pointer passing over doesn't blank the line.
  - The pen takes 500ms. Its stops are spaced on an ease-out, so it leaves at once, crosses the rise in about
    200ms, and slows to land. It leans back a little while it travels, and as it lands it settles past upright
    and back, turning about its tip.
  - The underline (`drawn`) overlaps the landing. It sweeps in from 400ms to 620ms and its second pass from 450ms
    to 660ms, both easing out like `--ease-out-soft`. Everything is still within 720ms of the hover.
  - The keyframes are in [globals.css](../../app/globals.css): `logo-pen`, `logo-draw-rise`, `logo-draw-fall`,
    `logo-underline` and `logo-underline-2`. The pen's three share one timeline of 15 stops, nine along the rise
    and six along the fall.
  - At each stop the pen layer's `left` and `top` move it to a point on the curve, and each line layer's
    `clip-path: inset()` wipes it in to that point. The line is revealed exactly as far as the pen has gone.
  - `PenLine` works out the stops (`--pen-x-N`, `--pen-y-N`, set inline). Along the rise they are a share of the
    stretch (`calc(em + (100% - em) * q)`), so the pen follows the line at any wordmark width; along the fall they
    are em from the wordmark's end. `pointAtX` finds the curve's height at each.
  - The wipes are left to right, which works because both curves run left to right. They clip strokes and brush
    fills alike, and the line is whole at rest.
  - It is CSS only: nothing runs in script, and nothing runs until hover. Under reduced motion there is no draw.

## Changing it

- **Put a concept in the app:** set `HEADER_LOGO_VARIANT`.
- **Remove a concept:** delete its file and its entry in `STENCIL_LOGO_VARIANTS` and `DECORATIONS`. The decorations
  made of others are Ultimate (Hybrid Stack and Underline) and Ultimate v2 (Hybrid v2 and Underline): remove one
  of those before its parts.
- **TD's crest:** it replaces the tile in `LogoMark` as an `<img>` at `size-[1em]` with `alt=""` (the link around the
  logo names it). The decorations are placed against that 1em square.
- **Check a change** at `/logo-lab`, in the sidebar's header at nav size, with "Fallback face" (Georgia, the wider
  word before Newsreader loads), "Fanned" (every stack held where hover takes it) and "Boxes" (each layer's box).
