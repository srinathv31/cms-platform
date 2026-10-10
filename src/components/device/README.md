# `src/components/device`: the phone kit

Draws a push notification or a text message on a phone, the way the phone shows it: a generic frame, an
iOS-style skin (`ios/`) and, next, an Android-style one (`android/`). Stencil's preview rail uses it for the Push
and SMS channels, and Coral's phone will use it too. It is presentation only: it takes resolved plain strings
(variables already replaced with values) and knows nothing about templates, channels or versions.

The design page is [/design/device](../../app/(dev)/design/device/page.tsx): every view at 1:1, in light and dark,
at each text size and width, inside the tightest preview well, and a working mock of the rail's controls.

## Rules

- **Boundary** (lint-enforced in [eslint.config.mjs](../../../eslint.config.mjs)): no `@/domain`, `@/server`,
  `@/editor`, `@/app` or simulator imports, and from `src/components` only `ui/`, `primitives/` and `motion/`.
  Coral reaches Stencil only over `/api/v1`, so the kit can't depend on Stencil's internals.
- **Tokens only.** Every colour is a `--device-*` token in [tokens.css](../../styles/tokens.css) (section 4), with
  a light set and a `[data-appearance="dark"]` set. No raw colours here, no `dark:` classes.
- **Sizes in points.** Write every size as `pt(n)` ([geometry.ts](geometry.ts)), never in px. See Geometry.
- **Legal.** No Apple or Google assets: no bezels or UI-kit vectors, no SF font files, no SF Symbols, no
  wallpapers, app icons or logos. The frame, status-bar glyphs, wallpaper and app mark are drawn here; interface
  glyphs are Lucide; the only font shipped is Inter (OFL). Call the skins "iOS-style" and "Android-style", keep the
  preview out of external marketing, and show fictional data only.

## Using it

```tsx
import { PushPreview, SmsPreview, type DeviceSettings } from "@/components/device";

const settings: DeviceSettings = {
  platform: "ios",            // "android" draws a blank screen until android/ lands
  appearance: "light",        // the phone's, not the app's
  previewsHidden: false,      // "Show previews: When unlocked" on a locked phone: the lock screen only
  textSize: "default",        // "default" | "large" | "ax" (iOS: Large, xxxLarge, AX1)
  width: "standard",          // "compact" | "standard" | "large" (iOS: 375, 402, 440 pt)
};

<div className="h-full">  {/* the kit fills its parent's height: give the parent one */}
  <PushPreview
    settings={settings}
    screen="lock"                                    // "lock" | "banner" | "expanded"
    content={{ appName: "Coral", appMark: { monogram: "C" }, title, subtitle, body, time: "now" }}
    onScreenChange={setScreen}                       // optional: makes the notification a toggle button
    onMeasure={(m) => setFit(m)}                     // optional: truncation per field, see below
    clock={{ time: "9:41", date: "Friday, October 9" }}  // optional, this is the default
  />
</div>

<SmsPreview settings={settings} content={{ sender: "26725", text, time: "9:41 AM", day: "Today" }} />
```

The types are in [types.ts](types.ts); everything public comes from [index.ts](index.ts).

- **`PushContent`**: `appName`, `appMark: { monogram }` (a tile in the brand's tone, never a real icon), `title`,
  `subtitle?` (iPhone only; empty means none), `body`, `time` (as printed: "now", "9:41 AM"). Plain text; line
  breaks and runs of spaces are kept.
- **`SmsContent`**: `sender` (a short code or number: a US text can't show a brand there), `text` (the whole
  message, footer included, as delivered), `time`, `day?` (default "Today"). Links in the text show underlined and
  not clickable, as a phone shows them from an unknown sender ([links.ts](links.ts)).
- **`onScreenChange`**: without it the notification is static. With it, the notification is a `<button>` with
  `aria-expanded`: on the lock screen or a banner it asks for `"expanded"`; on the expanded view it (or the blurred
  backdrop) asks for the screen it came from.
- **`previewsHidden`** changes the lock screen only (the app and "Notification"). A banner arrives on an unlocked
  phone and the expanded view opens after Face ID, so both still show the content.

## Truncation: `onMeasure`

The text is never shortened in the data: the OS cuts it on screen, and the kit cuts it the same way, with
`line-clamp` at iOS's line counts (`IOS_LINES` in [ios/notification-card.tsx](ios/notification-card.tsx): lock
screen title 1 and body 4, banner body 2, expanded title 2 and body 7). [measure.ts](measure.ts) then reads the
rendered phone: each clamped field is `[data-field][data-max-lines]`, and a DOM Range finds the last character
before the ellipsis. `onMeasure` gets a `PushMeasure`:

```ts
{ platform, screen, title: FieldFit, subtitle: FieldFit | null /* no subtitle */, body: FieldFit }
// FieldFit: { shown, cut, visibleText, lines, fullLines, maxLines }
//   shown: false when the screen leaves the field out (previews hidden on the lock screen)
//   visibleText: what shows, without the ellipsis or trailing spaces; it can end mid-word
//   fullLines: the lines the whole text needs, so "needs 8, shows 4"
```

It is called after a render whose settings, screen or content changed, on a resize, and when a web font
finishes loading, and only when the result differs from the last. Measuring happens at the chosen width and text
size, so a warning built from it ("Lock screen cuts after '…payment of'") matches what the phone draws. On
Windows the face is Inter, slightly wider than SF, so a cut can move by a word there.

## Geometry

The preview is a `<figure>` that fills its parent. The figure is a size container; the phone inside is its
platform's exact width in points plus the bezel, and `--pt` (registered in tokens.css, so it computes once) is
`min(1px, 100cqw / frame width)`. While the phone fits, a point is a pixel; in a narrower container the whole
phone shrinks evenly, so it wraps text exactly as at 1:1. The phone is as tall as the container, up to the real
screen's height: like Web → Mobile, it is a window onto the top of the screen, and content is anchored to the
top. Bottom furniture (the lock screen's buttons, the dock, the composer) sits on the frame's bottom edge and
gives way first when the frame is short.

At 1:1 the standard iPhone frame is 422px wide (402 + 2 × 10 bezel): it fits the 1440 well (531px inside the
well's inset) and the 1280 well (437px) at 1:1; the large width scales to about 0.95 in the 1280 well.

## Glass and the Backdrop Root

The notification material is a real `backdrop-filter` on the glass element itself ([ios/glass.ts](ios/glass.ts)).
A backdrop-filter sees only what is painted inside its Backdrop Root: the nearest ancestor with opacity below 1,
a filter, a mask, a clip-path, a mix-blend-mode or a backdrop-filter. So:

- Never fade or filter a wrapper of glass. An enter animation fades the glass element itself
  ([ios/lock-screen.tsx](ios/lock-screen.tsx)); the home screen appears without a fade.
- The screen clips with `clip-path`, which makes it the Backdrop Root: the wallpaper and the glass share it, so a
  fading wrapper outside the kit (the preview pane's channel fade) can't take the wallpaper away from the blur.
  The clip-path is also what keeps a composited blur inside the screen's rounded corners in Chrome.
- Playwright's default headless shell composites backdrop-filter wrongly (siblings show through sharp).
  Screenshot with `channel: "chromium"`.

## Motion

Views fade-rise in with `fadeRise` from [motion/presets.ts](../motion/presets.ts), on each element. The banner
drops in once, when the view opens, with `spring.soft`; a keystroke doesn't replay it. Under reduced motion
`MotionConfig` skips the transforms, so the banner is still.

## Accessibility

The figure's caption names the view ("Lock screen, iOS-style preview"). Inside, the frame, status bar, camera
cutout, clock, home screen and composer are `aria-hidden`; the notification reads app (the mark is an image named
for the app), title, subtitle, body, time, and a text message reads sender, "Text Message • SMS", the time and the
text. Nothing is a live region. The clickable notification takes the app's focus ring; a long text message
scrolls in a focusable region.

## Layout

| Path | What it holds |
| --- | --- |
| [index.ts](index.ts) | The public surface. |
| [types.ts](types.ts) | Settings, content and measurement types. |
| [push-preview.tsx](push-preview.tsx), [sms-preview.tsx](sms-preview.tsx) | The two entry points: the frame, then the platform's skin. |
| [phone-frame.tsx](phone-frame.tsx) | The generic frame, the `--pt` setup, the camera cutout, the figure. |
| [status-bar.tsx](status-bar.tsx) | Status bar and home indicator, generic glyphs. |
| [wallpaper.tsx](wallpaper.tsx) | The wallpaper, drawn from `--device-wall-*`. |
| [app-mark.tsx](app-mark.tsx) | The sending app's monogram tile. |
| [geometry.ts](geometry.ts) | `pt()`, screen sizes per platform and width, the bezel. |
| [measure.ts](measure.ts) | Truncation measurement and `useMeasure`. |
| [links.ts](links.ts) | Which runs of a text message read as links. |
| [fonts.ts](fonts.ts) | Inter (OFL) via `next/font`, scoped to the kit's root. |
| [ios/](ios) | The iOS-style skin: `LockScreen`, `Banner` (on `HomeScreen`), `Expanded`, `MessagesThread`, the notification card, its type ramp and glass. |

## Adding the Android skin

Make `android/` beside `ios/` with the same shape: its views, its type ramp (Material 3), its line counts, and a
`--font-device-android` face (Google Sans Flex, then Roboto Flex, both OFL) loaded in [fonts.ts](fonts.ts) and set
in tokens.css beside `--font-device-ios`. Replace the placeholder Android sizes in [geometry.ts](geometry.ts), add
Android-specific tokens to the device section of tokens.css, and branch on `settings.platform` in the two entry
points (they draw a blank screen for `"android"` now). The frame, status bar, wallpaper, app mark, measurement and
links are shared. Android's lock screen keeps the title when previews are hidden, and never shows a subtitle.

## Testing

[measure.test.ts](measure.test.ts) (the visible-prefix search), [links.test.ts](links.test.ts) and
[ios/type.test.ts](ios/type.test.ts) run in node. Layout, clamping and the Range read need a real browser: check
them on the design page, whose Truncation section prints what `onMeasure` reports beside each screen.
