# 0030. Shared UI building blocks have one home, and a test keeps it so

Status: Accepted
Date: 2026-10-09
Amended 2026-10-11: the Library's status filter is a `Segmented` too, and the test also catches a pressed pill
([handoff review N13](../handoff-review.md#n13--low-the-librarys-status-filter-is-a-third-selected-style)). The
bullets that say so are marked "Library" below.

## Context

The segmented control was private to the preview rail, so its classes were pasted into the Usage filter, the
integration panel's version picker and the team icon picker, and restyled as a radio group in Request access. Two
screens hand-rolled a tablist beside the three that used Base UI Tabs. The stat card lived in three places, the
clipboard fallback in three, a channel label map in four, and a team icon map in two
([handoff review H3](../handoff-review.md#h3--medium-forked-primitives)). The copies had already drifted: the role
picker's segments were wider and had a different focus ring, and the Copilot prompt never tried the textarea
fallback.

## Decision

- **One home each, in `src/components/primitives/`:** `Segmented` and `SegmentedRadio`, `Tabs` (with `tab-styles.ts`
  for links and skeletons), the stat card's parts, `copyText` and `useCopy`, and `TeamIcon`. A channel's name is
  data, so it stays in the domain: `CHANNEL_LABELS` in `src/domain/render/errors.ts`.
- **Two semantics, one look, for the segmented control.** A view control (the preview's channel and device, the
  Usage filter, the team icon) is toggle buttons with `aria-pressed`, as it was. A form field (the role in Request
  access) stays a radio group, Tab landing on the chosen role and the arrows moving the choice. Both draw the same
  track and segments, the toggle's focus ring included. The role picker converged on that look: 10px segment padding
  where it had 12px, and the toggle's ring where it had its own.
- **Library: the status filter is a `Segmented`.** It had been a row of pills with no track, filled `bg-selected`
  when pressed, with the classes written inline: a third selected style beside the segmented control and the tabs.
  It picks one of a few, so it is the segmented control, a view control with `aria-pressed`. A count is part of an
  option's label ("Draft 3", "All 12"), in the label's own colour. Pressing the chosen status again no longer clears
  it: All is the way back, as the other `Segmented` controls have no unchosen state either.
- **Tabs are Base UI's.** The two hand-rolled tablists (Usage, the review's Document and Preview) and the review queue
  use `Tabs`. The review's panels are cells of the review grid, not children of the tab bar, so its tabs pass their
  own `id` and `aria-controls`. Arrow keys choose as they move, and Home and End now work too. The Usage tabs gain
  the sliding underline the others had.
- **The stat card composes.** `StatCard`, `StatValue`, `StatLabel`, `StatLines` and `StatTrend` are parts, not one
  component with props, because the screens order them differently: Usage puts the numeral over its label,
  Recertification its two labels over their numerals. The card is the Usage screens' `Panel`.
- **A copy confirms only what got there.** "Copied" and the check mark show only when the async clipboard or the
  textarea fallback worked; focus goes back where it was after the fallback. The Copilot prompt tries the fallback
  before it says it couldn't copy.
- **A test holds it.** `src/components/primitives/one-copy.test.ts` reads the product's source and fails on a second
  copy: the segmented track's classes, a hand-rolled `role="tab"`, `navigator.clipboard` or `execCommand`, the stat
  numeral, the team icons, or a channel label map. Library: it also fails on a pill written inline that fills
  `bg-selected` when pressed (`rounded-full` with `aria-pressed:bg-selected`, or `data-pressed:bg-selected`).

## Alternatives considered

- **One segmented semantics.** Toggle buttons everywhere would drop the radio group a form field wants; radios
  everywhere would change the roles the preview's controls have had (and that the e2e specs select by).
- **Library: keep the pills, as a primitive of their own.** Nothing else in the product picks one of a few with
  pills, and a second look for the same job is the drift this record is about.
- **Keep the rail header's and the sample request's tabs on the shared `Tabs`.** They are Base UI already, at their
  own sizes (14px in the rail, 13px in the integration sheet). Folding them in needs size variants; they stay as they
  are and the components README lists them under "Don't copy".
- **A single `StatCard` with props.** It would need an order switch and slots for each screen's extras (the channel
  mix, the gauge, the progress bar), which is the composition with more steps.

## Consequences

- A new picker, view switch, stat, copy button or team icon starts from the primitive, and the test says so if it
  doesn't.
- The simulator keeps its own channel label map: it may not import `src/domain`, and it has its own look on purpose.
- Each of the role picker's segments is 4px narrower, and its focus ring is the lighter toggle ring. Everything else
  on the screens that use these looks as it did.
