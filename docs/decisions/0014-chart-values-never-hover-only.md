# 0014. Chart values are never hover-only, and series differ by hue

Status: Accepted
Date: 2026-10-09

## Context

The Usage screens draw their charts by hand (`src/components/usage/charts.tsx`). Until October 2026 the stacked
bars and the failure rate line exposed only a short label to assistive technology, their numbers lived only in
hover tooltips, and the series of a stacked bar (PDF, Web, Email; or v1, v2, v3) were four lightness steps of the
one brand teal ([handoff review I13](../handoff-review.md#i13--medium-blocked-decisions-and-charts-arent-accessible)).
A keyboard user couldn't read a single value, a screen reader user got a sentence, and a reader with low contrast
sensitivity or a grey printout couldn't tell Web from Email. The heatmap already had an sr-only table of its
weeks.

## Decision

- **Every chart whose values aren't printed is followed by an sr-only table of them** (`ChartTable`): the stacked
  bars (a row per week, a column per series, and the total), the rate line (a row per day: rate and what it was
  of), the channel mix (count and share) and, as before, the heatmap (a row per week). Charts whose values are
  printed as text (the top-templates bars, the gauge's numeral) don't repeat them in a table.
- **A chart's readable marks are one Tab stop**, with arrow keys between them and Home and End to the ends
  (`ChartKeys`, a small client island around the server-rendered marks). Each mark shows its tooltip on focus as
  it does on hover, and carries an `aria-label` with the same values, so a sighted keyboard user and a screen
  reader exploring the chart both get them. In the heatmap, Up and Down are a day and Left and Right a week.
- **Series are drawn in `series-1…4`**, four hues (teal, clay, violet, rose) in that fixed order, defined in
  `tokens.css`. As a set they pass the checks of the data-viz palette validator on `surface` and `surface-tinted`:
  each in the OKLCH lightness band with chroma of at least 0.10, neighbours at least ΔE 10 apart under protanopia
  and deuteranopia (OKLab ×100), at least 17 apart for full colour vision, and at least 3:1 against the card.
  Amounts (the heatmap, single-series charts) stay on the brand teal ramp, as one hue light to dark is the right
  encoding for magnitude. The channel mix uses the same hues as "Renders over time", so a channel keeps its colour
  across the page.
- The legend stays beside each multi-series chart, its swatches the bars' own shape and hue.

## Alternatives considered

- **The sr-only tables alone.** They serve a screen reader, but a sighted keyboard user can't see them and still
  couldn't read a value. The arrow-key marks cost one Tab stop per chart.
- **Every mark its own Tab stop.** 13 weeks, 30 days and 126 squares on one page would bury the rest of it.
- **Patterns or hatching per series.** Distinct, validated hues already separate neighbours for colour-blind
  readers, and the table and per-mark labels carry identity without colour; patterns would add noise to thin
  bars and slivers (Email is about 1% of renders).
- **Keep the brand teal for the first series.** `--brand-4` has chroma 0.05 and reads as a dark grey next to
  saturated hues; the validator fails it. The series teal is the least saturated teal that passes.

## Consequences

- Rebranding (TD green) means replacing the four `--viz-*` primitives as a set and re-running the validator, not
  only swapping the teal ramp.
- A screen reader reading the chart in browse mode hears each mark's values, then the table: the same numbers
  twice, by mark and by row. Both are kept because each serves a different way of reading.
- The heatmap's svg is a labelled group of marks instead of one image.
- A version chart with more than four versions in its 13 weeks still draws the oldest ones in taupe, as before.
