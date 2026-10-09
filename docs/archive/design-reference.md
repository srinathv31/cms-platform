> **Archived.** Written while the prototype was being built; it doesn't describe the current code.
> See [the current docs](../README.md).

# Design reference — Wispr Flow screenshots, written down

A text version of `reference-images/` for anyone building UI. The images are the source of truth; this file holds the measurements and the rules taken from them. **Take the feel, not the brand**: no Flow logo, names, illustrations or copy.

| File | Screen | What to take from it |
| --- | --- | --- |
| `Unknown.png` | Insights / "Your usage" | Stat cards, gauge, bars, heatmap, and the **SHARE ring** (top-right) |
| `Unknown-2.png` | Transforms (Beta) | Editorial single column, serif section heads, keycap chips, black primary, cards |
| `Unknown-3.png` | Settings → Connectors | Large centered modal, grouped left nav, tracked-caps group labels, row cards |

## Shell
- The app/window background and the sidebar are both warm stone, **#F5F3EF**.
- Content sits in one large rounded panel, **#FCFBF9**. It is inset about 12–15px from the sidebar, top and right edges, with a 24–28px radius and a 1px hairline border.
- The panel has about 48–60px of internal side padding.
- The sidebar is about 264–315px wide. Each item is a line icon (about 1.75px stroke, 20–24px) plus a label.
  - The active item is a soft **#ECE9E3** rounded pill. It has no accent bar and no color.
  - Utility links (Settings, Help) sit at the bottom under a hairline.
  - There is one dismissible card above them: white, hairline border, about 14px radius, a "—" dismiss control, and a tan **#ECE8E1** button.
- The top-right of the window has a bell and a profile circle.

## Color
- Neutrals are warm only, never cool grey:
  - Text: **#1B1B1B**, never pure black.
  - Muted text: **#6F6B65**.
  - Caps labels: **#55524C**.
  - Hairline borders: **#E6E2DB** (about 8% black).
- Cards are **#F5F3EF** on the white panel, or white on a tinted surface. No shadows. Depth comes from tonal steps: sidebar → canvas → card.
- One data accent, deep teal **#2D5A5C**. Its scale is #4F9A8F → #8CCBBE → #D2EBE6. Empty heatmap cells are taupe **#C9C3B8**.
- Positive delta pill: mint **#DFF3EA** background with green text **#2F7D5B**.
- Flow's lavender "Pro" pill is **#E6D9FA** with **#5B3A9E** text. Its black "Beta" tag is **#171717** with white text and a 6px radius.

## Type
- UI font is a humanist/geometric sans (Inter-like) in regular and medium weights only. Flow never uses bold.
- Display font is a high-contrast serif. It is used for page and section titles ("Transforms", "My Transforms", "Connectors") at about 34–38px.
- Big numerals are about 40px sans, **regular weight**, with slightly negative tracking. Use tabular figures.
- Labels are tiny uppercase with about +0.08em tracking, in a muted color. They sit over the numerals ("WORDS PER MINUTE").
- Line height is relaxed throughout.

## Components
- **Buttons**
  - Primary: solid near-black **#161616**, white text, about 8px radius.
  - Secondary: white with a hairline border.
  - Tertiary: tan fill, or a ghost text button with an icon.
- **Keycap chips** (⌥ Opt, 1): about 6px radius, #F5F3EF fill, hairline border, about 13px text.
- **Toggles**: pill shaped. Black when on; the off track is taupe **#CFCAC0**.
- **Tabs**: text only. The active tab is dark with a 2px dark underline that sits on a 1px hairline. Inactive tabs are muted.
- **Cards**: about 14–18px radius, hairline border, 24–36px padding, no shadow.
- **Settings modal**
  - About 72% of the window width, 22px radius. It has the only large soft shadow in the UI.
  - The scrim is flat grey at about 30%, with no blur.
  - The left nav (#F5F3EF) is grouped under tracked-caps labels.
  - A muted version label sits at the bottom of the nav.
- **Data viz**
  - Semicircle gauge with a thick, round-capped teal stroke.
  - Horizontal bars (6px radius) with white percent text inside and outline icons to their left.
  - GitHub-style heatmap: rounded about 4px squares, month labels, chevrons, and a More ↔ Less legend.
- **Info hints**: muted circled "i" icons.

## The signature: SHARE ring (Unknown.png, top-right of the Insights header)
- A circular badge about 100px across in the screenshot; expect about 72–80px in CSS.
- At its center is an outline share glyph (a box with an up arrow, about 1.75px stroke).
- Around the glyph runs **"SHARE · SHARE · SHARE ·"**. It is small (about 11px) semibold uppercase with very wide tracking, set on a circle that wraps the full 360°.
- The fill is a barely-there warm circle. No border, no shadow. It reads like a stamp or a seal.
- It is the only decorative element in the header.
- On hover, use a slow rotation of the ring, a slight scale (about 1.04), and lift the glyph 1px. With reduced motion, do none of this.

## Ten rules
1. Warm neutral stack: stone app background, a near-white rounded canvas, and tinted cards.
2. Borders, not shadows. Only modals get a soft shadow.
3. Radius scale:
   - Chips: 6px.
   - Controls: 8px.
   - Cards: 14px.
   - Panels and modals: 22–24px.
   - Pills and toggles: fully round.
4. Serif for display titles, sans for everything else. Regular and medium weights only.
5. Tracked-caps micro-labels over big regular-weight numerals.
6. Button hierarchy: black pill primary, white hairline secondary, tan or ghost tertiary.
7. One teal family carries all data and active states.
8. Outline icons at about 1.75px stroke, always paired with labels in navigation.
9. Generous whitespace. Use editorial single columns for reading pages and a 3-column grid for dashboards.
10. One playful moment per screen at most, and the SHARE ring is the moment.
