# 0074. The logo's decorations are sized in em and stroked per size, behind one config value

Status: Accepted
Date: 2026-10-19

## Context

We are exploring decorations for the sidebar's logo: a pen line over the wordmark, a stack of sheets behind the
mark, and a hybrid of the two (a concept sheet set the mood). The logo is a mark and a live-text wordmark. The
wordmark's width changes with font loading, the operating system's text rendering and zoom. The logo has to look
right at two sizes: 32px in the sidebar and 80px on a page of its own. Many users have 1x Windows screens at 100% and
125% scaling. TD's crest isn't in the repo yet: the mark is a stand-in tile, so the decorations are built against a
square, not against the crest.

## Decision

- **One font-size sets the lockup.** The lockup's font-size is the mark's side (`text-[2rem]` for `nav`,
  `text-[5rem]` for `hero`). The wordmark is 0.6875em (22px beside a 32px mark), the gap 0.375em, and every
  decoration is placed in em. Both fractions are exact, so the sidebar's mark and wordmark land where they did, on
  whole pixels. Geometry is written in units of 1/32 em: a pixel at `nav`, so a straight line on a half unit is
  sharp on a 1x screen.
- **Decorations are absolute SVG layers.** They never take part in layout, so no variant moves the header. They are
  `aria-hidden`, `focusable="false"` and `pointer-events: none`. A layer that follows the wordmark's width is
  anchored to both edges and stretches its viewBox sideways (`preserveAspectRatio="none"`). Anything with a shape
  that must not stretch, like the pen, is a separate layer anchored to the wordmark's end. The pen line is two
  layers that meet where the line is level, the one direction a sideways stretch can't bend.
- **Stroke weight belongs to the size, not to the scale.** Every shape draws with
  `vector-effect: non-scaling-stroke`, and `STROKE` in `src/components/brand/sketch.tsx` sets the weights in CSS
  pixels per size: 1px ink and a 1.5px accent at `nav`, 1.5px and 2.5px at `hero`. Scaled with the lockup, a 1.5px
  nav line would be 3.75px at hero: a marker, not a pen. The non-scaling stroke is also what keeps a stretched line
  even. Browser zoom still scales the strokes, since it scales the CSS pixel.
- **`nav` is simpler than `hero`.** At `nav`: straight edges, fewer sheets, no motion ticks, and a solid
  silhouette for the pen. At `hero`: bowed edges that overshoot their corners, a tilted back sheet, the nib's slit
  and breather hole, and motion ticks.
- **Colour comes from five tokens** in `tokens.css` (`--logo-accent`, `--logo-ink`, `--logo-paper`, `--logo-paper-used`,
  `--logo-wash`).
  The accent follows the brand placeholder, so it turns TD green with the rest of the app. In forced colours they
  become `CanvasText` and `Canvas`, and the wash goes.
- **The stack fans out on hover, in CSS.** Hovering the logo, or hovering or keyboard-focusing the link around it,
  takes a registered custom property, `--logo-fan`, from 0 to 1 over `--dur-slow`. Each sheet behind the front one
  computes its own translate and turn from it. That is one trigger on the lockup, a server component still, and
  the repo's token timings, like the other hover transitions. The front sheet stays put, so a pen line leaving from
  its dog-ear stays attached.
- **The pen draws its line on hover, in CSS.** On the fan's trigger, keyframes in `globals.css` move the pen,
  its own layer, through 15 points on the curve. They wipe each part of the line in with `clip-path: inset()` up to
  the pen's tip. `PenLine` works out the points in em and in percentages of the lockup's width, so the pen
  follows the stretched rise at any wordmark width. At rest the line is whole, and reduced motion skips the draw.
  It is timed as a micro-interaction:
  - 60ms of hover intent comes first.
  - The pen's 500ms is spaced on an ease-out, so it responds at once and slows to land. It settles about its tip
    as it lands.
  - In the Ultimates the underline overlaps the landing rather than queueing after it, and everything is done
    within 720ms.
- **The v2 sheets are drawn by hand from fixed numbers.** Template Stack v2, Hybrid v2 and Ultimate v2 rule each
  edge with a wobble that overshoots its corners, and add a lighter second pass at `hero`. The wobble comes from
  an integer hash of a per-sheet seed, so every render, server or client, in any browser, draws the same path.
  Their watercolour is flat fills multiplied over the lines, and their pen strokes taper as filled shapes at
  `hero`. Nothing is a raster, a gradient or a filter.
- **The header shows `HEADER_LOGO_VARIANT`**, in `src/components/brand/logo-config.ts`, which is `"none"` (the logo as
  it was) until a concept is picked. `/logo-lab` compares them all in `next dev`.

## Consequences

- Trying a concept in the app is one value. Removing one is its file and its row in `DECORATIONS`.
- When TD's crest lands, it replaces the tile in `LogoMark` at 1em square, and the decorations stay where they are.
  If the crest isn't square, the sheets need placing again.
- Some layers hang over the link's box: the stack by up to 2.5px above its hover fill, the pen line by under a pixel.
  The sidebar header's padding holds them, and nothing above the header clips.
- While fanned, the turned sheets are antialiased even at 1x, and the back sheet reaches about 5px further left. It
  stays inside the sidebar's padding. At rest they are sharp again.
- The draw costs a repaint of a few small SVGs and the layout of one absolutely placed one per frame, for under
  three quarters of a second, only while hovered.
- At 125% scaling nothing is pixel-aligned, so the 1px sheet edges are a little soft. They stay legible. We checked
  at 1x, 1.25x and 2x.

## Alternatives considered

- **Strokes that scale with the lockup.** Simpler (no `vector-effect`), but the hero is heavy and a stretched line
  thins where it rises.
- **One stretched SVG for the whole pen line.** The pen distorts, and its angle to the line changes with the
  wordmark's width.
- **Sizing from the container, or measuring the wordmark in script.** Both shift layout when the font loads, and the
  logo would need a client component.
- **A pen tip leading the line**, the line entering the back of the nib as on the concept sheet. It reads as a dart
  in flight. Here the line ends at the nib's tip, so the pen has just drawn it.
- **Sheets offset up and to the right.** They crowd the gap between the mark and the wordmark at `nav`.
- **A wash offset behind the stack.** It reads as a drop shadow. A tinted sheet inside the stack carries the colour
  instead.
- **The fan with `motion/react`.** The logo would become a client component that tracks hover, for a transition
  CSS already does. Per-sheet `group-hover` transforms would repeat the triggers (lockup hover, link hover, link
  focus) on every sheet.
- **`stroke-dashoffset` for the draw.** It can't reveal a brush stroke, which is a fill. It also measures along
  each part's length, so the pen and the line drift apart when the rise stretches.
- **CSS `offset-path` (or SMIL `animateMotion`) for the pen.** A path in the stretched layer's units squashes the
  pen with it. `offset-path: shape()` could take percentages, but it ties the logo to the newest browsers for what
  15 sampled points already do.
- **The draw in script** (`requestAnimationFrame`, `motion/react`). The logo would become a client component, for an
  animation the browser runs without one.
- **An SVG filter for the rough look** (`feTurbulence` with `feDisplacementMap`). It gives real ink bleed at
  `hero`, but at `nav` it breaks a 1px line into dots, and a filter is rasterized per frame while the stack fans.
- **`Math.random()` or trig for the wobble.** Random paths differ between the server and the client, and a
  floating-point hash can differ in its last bits between browsers.
- **`shape-rendering="crispEdges"` for the nav sheets.** Sharp at every scale, but at 125% the edges come out 1px or
  2px thick at random.
