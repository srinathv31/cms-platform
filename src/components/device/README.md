# `src/components/device`: the phone kit

Draws a push notification or a text message on a phone, the way the phone shows it: a generic frame with an
iOS-style skin (`ios/`) and an Android-style one (`android/`, a current Pixel in Material 3 Expressive). Stencil's
preview rail uses it for the Push and SMS channels, and Coral's phone will use it too. It is presentation only: it
takes resolved plain strings (variables already replaced with values) and knows nothing about templates, channels
or versions.

The design page is [/design/device](../../app/(dev)/design/device/page.tsx): iPhone and Android side by side, every
view at 1:1 in light and dark, at each text size and width, inside the tightest preview well, and a working mock
of the rail's controls.

## Rules

- **Boundary** (lint-enforced in [eslint.config.mjs](../../../eslint.config.mjs)): no `@/domain`, `@/server`,
  `@/editor`, `@/app` or simulator imports, and from `src/components` only `ui/`, `primitives/` and `motion/`.
  Coral reaches Stencil only over `/api/v1`, so the kit can't depend on Stencil's internals.
- **Tokens only.** Every colour is a `--device-*` token in [tokens.css](../../styles/tokens.css) (section 4), with
  a light set and a `[data-appearance="dark"]` set. Android's Material 3 roles are `--device-m3-*`, tonal to the
  brand teal, as a Pixel tints its UI from the wallpaper. No raw colours here, no `dark:` classes.
- **Sizes in points.** Write every size as `pt(n)` ([geometry.ts](geometry.ts)), never in px. One `pt` is an iOS
  point or an Android dp. See Geometry.
- **Legal.** No Apple or Google assets: no bezels or UI-kit vectors, no SF font files, no SF Symbols, no Google
  logo, no Android robot, no Pixel wallpapers, no Messages or Google Messages icon, no app icons. The frame,
  status-bar glyphs, wallpaper and app mark are drawn here; interface glyphs are Lucide; the fonts shipped are
  Inter and Google Sans Flex (both OFL). Call the skins "iOS-style" and "Android-style", keep the preview out of
  external marketing, and show fictional data only.

## Using it

```tsx
import { PushPreview, SmsPreview, pushScreenLabel, type DeviceSettings } from "@/components/device";

const settings: DeviceSettings = {
  platform: "ios",            // "ios" | "android"
  appearance: "light",        // the phone's, not the app's
  previewsHidden: false,      // the lock screen's privacy setting: see below
  textSize: "default",        // "default" | "large" | "ax" (iOS: Large, xxxLarge, AX1; Android: 100, 130, 200%)
  width: "standard",          // "compact" | "standard" | "large" (iOS: 375, 402, 440pt; Android: 360, 412, 448dp)
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

pushScreenLabel("android", "banner")  // "Heads-up": label controls and captions with the platform's word
```

The types are in [types.ts](types.ts); everything public comes from [index.ts](index.ts), including `IOS_LINES`,
`ANDROID_LINES`, `SCREEN_SIZES` and `SIZE_UNIT` (to label widths "402pt" or "412dp").

- **`PushContent`**: `appName`, `appMark: { monogram }` (a tile in the brand's tone, never a real icon), `title`,
  `subtitle?` (iPhone only: Android never shows it, even when set; empty means none), `body`, `time` (as printed:
  "now", "9:41 AM"). Plain text; line breaks and runs of spaces are kept.
- **`SmsContent`**: `sender` (a short code or number: a US text can't show a brand there), `text` (the whole
  message, footer included, as delivered), `time`, `day?` (default "Today"). Links in the text show underlined and
  not clickable, as a phone shows them from an unknown sender ([links.ts](links.ts)).
- **`PushScreen`** is one set of values for both platforms. `banner` is iOS's banner and Android's heads-up;
  `expanded` is iOS's long press and Android's notification shade. Show the platform's word with
  `pushScreenLabel`.
- **`onScreenChange`**: without it the notification is static. With it, the notification is a `<button>` with
  `aria-expanded`: on the lock screen or a banner it asks for `"expanded"`; on the expanded view it (or the
  backdrop) asks for the screen it came from.
- **`previewsHidden`** changes the lock screen only, the way each platform does it. iOS ("Show previews: When
  unlocked") shows the app and "Notification": nothing of the message. Android ("hide sensitive content") still
  shows the app, its name **and the title**, and replaces only the text with "Contents hidden": on Android the
  title is what a bystander reads, so it must never carry anything private. A banner or heads-up arrives on an
  unlocked phone, and the expanded view opens unlocked, so both still show the content.

## Truncation: `onMeasure`

The text is never shortened in the data: the OS cuts it on screen, and the kit cuts it the same way, with
`line-clamp` at each platform's line counts:

| | Lock screen | Banner / heads-up | Expanded |
| --- | --- | --- | --- |
| iOS (`IOS_LINES`, [ios/notification-card.tsx](ios/notification-card.tsx)) | title 1, subtitle 1, body 4 | title 1, subtitle 1, body 2 | title 2, subtitle 2, body 7 |
| Android (`ANDROID_LINES`, [android/notification-card.tsx](android/notification-card.tsx)) | title 1, body 1 | title 1, body 1 | title 1, body 8 |

[measure.ts](measure.ts) then reads the rendered phone: each clamped field is `[data-field][data-max-lines]`, and
a DOM Range finds the last character before the ellipsis. `onMeasure` gets a `PushMeasure`:

```ts
{ platform, screen, title: FieldFit, subtitle: FieldFit | null /* none, or Android */, body: FieldFit }
// FieldFit: { shown, cut, visibleText, lines, fullLines, maxLines }
//   shown: false when the screen leaves the field out (iOS: title and body with previews hidden;
//          Android: the body only, the title still shows)
//   visibleText: what shows, without the ellipsis or trailing spaces; it can end mid-word
//   fullLines: the lines the whole text needs, so "needs 8, shows 4"
```

It is called after a render whose settings, screen or content changed, on a resize, and when a web font
finishes loading, and only when the result differs from the last. It measures the screen on show, at the chosen
platform, width and text size, so a warning built from it ("Android cuts after '…payment of'") matches what that
phone draws. Off Apple devices the iOS face is Inter, slightly wider than SF, so an iOS cut can move by a word.

## Geometry

The preview is a `<figure>` that fills its parent. The figure is a size container; the phone inside is its
platform's exact width plus the bezel, and `--pt` (registered in tokens.css, so it computes once) is
`min(1px, 100cqw / frame width)`. While the phone fits, a point is a pixel; in a narrower container the whole
phone shrinks evenly, so it wraps text exactly as at 1:1. The phone is as tall as the container, up to the real
screen's height: like Web → Mobile, it is a window onto the top of the screen, and content is anchored to the
top. Bottom furniture (the lock screen's buttons, the dock, the composer) sits on the frame's bottom edge and
gives way first when the frame is short.

At 1:1 the standard frames are 422px (iPhone, 402 + 2 × 10 bezel) and 432px (Android, 412 + 20): both fit the 1440
well (531px inside the well's inset) and the 1280 well (437px) at 1:1. The large ones scale to about 0.95 (iPhone)
and 0.94 (Android) in the 1280 well. The camera cutout is iOS's pill or Android's centred punch hole.

## Glass and the Backdrop Root

The iOS notification material is a real `backdrop-filter` on the glass element itself ([ios/glass.ts](ios/glass.ts));
Android's cards are flat tonal surfaces, and only its shade blurs. A backdrop-filter sees only what is painted
inside its Backdrop Root: the nearest ancestor with opacity below 1, a filter, a mask, a clip-path, a
mix-blend-mode or a backdrop-filter. So:

- Never fade or filter a wrapper of glass. An enter animation fades the glass element itself
  ([ios/lock-screen.tsx](ios/lock-screen.tsx)); the home screens appear without a fade.
- The screen clips with `clip-path`, which makes it the Backdrop Root: the wallpaper and the glass share it, so a
  fading wrapper outside the kit (the preview pane's channel fade) can't take the wallpaper away from the blur.
  The clip-path is also what keeps a composited blur inside the screen's rounded corners in Chrome.
- Playwright's default headless shell composites backdrop-filter wrongly (siblings show through sharp).
  Screenshot with `channel: "chromium"`.

## Motion

Views fade-rise in with `fadeRise` from [motion/presets.ts](../motion/presets.ts), on each element. The banner
and the heads-up drop in once, when the view opens, with `spring.soft`; a keystroke doesn't replay it. Under
reduced motion `MotionConfig` skips the transforms, so they are still.

## Accessibility

The figure's caption names the view in the platform's words ("Heads-up, Android-style preview"). Inside, the
frame, status bar, camera cutout, clock, home screen, quick settings and composer are `aria-hidden`; the
notification reads app, title, subtitle (iOS), body, time (the time comes last in the DOM; the grid places it), and
a text message reads sender, "Text Message • SMS" or "Text message", the time and the text. Nothing is a live
region. The clickable notification takes the app's focus ring; a long text message scrolls in a focusable region.

## Layout

| Path | What it holds |
| --- | --- |
| [index.ts](index.ts) | The public surface. |
| [types.ts](types.ts) | Settings, content and measurement types. |
| [push-preview.tsx](push-preview.tsx), [sms-preview.tsx](sms-preview.tsx) | The two entry points: the frame, then the platform's skin. |
| [labels.ts](labels.ts) | `pushScreenLabel` (Banner or Heads-up) and the skins' names. |
| [phone-frame.tsx](phone-frame.tsx) | The generic frame, the `--pt` setup, the camera cutout, the figure. |
| [status-bar.tsx](status-bar.tsx) | Each platform's status bar and its home indicator or gesture handle, generic glyphs. |
| [wallpaper.tsx](wallpaper.tsx) | The wallpaper, drawn from `--device-wall-*`, shared by both platforms. |
| [app-mark.tsx](app-mark.tsx), [silhouette.tsx](silhouette.tsx) | The sending app's monogram tile; an unknown sender's avatar. |
| [geometry.ts](geometry.ts) | `pt()`, screen sizes per platform and width, the bezel. |
| [measure.ts](measure.ts) | Truncation measurement and `useMeasure`. |
| [links.ts](links.ts) | Which runs of a text message read as links. |
| [fonts.ts](fonts.ts) | Inter and Google Sans Flex (OFL) via `next/font`, scoped to the kit's root. |
| [ios/](ios) | The iOS-style skin: `LockScreen`, `Banner` (on `HomeScreen`), `Expanded`, `MessagesThread`, the notification card, its type ramp and glass. |
| [android/](android) | The Android-style skin: `AndroidLockScreen`, `HeadsUp` (on its home screen), `Shade`, `AndroidMessagesThread`, the notification card, the Material type ramp and the short date. |

A third skin would follow the same shape: its views, type ramp and line counts in a folder, its sizes in
[geometry.ts](geometry.ts), its tokens and face in tokens.css and [fonts.ts](fonts.ts), and a branch in the two
entry points.

## Testing

[measure.test.ts](measure.test.ts) (the visible-prefix search), [links.test.ts](links.test.ts),
[labels.test.ts](labels.test.ts), [ios/type.test.ts](ios/type.test.ts), [android/dates.test.ts](android/dates.test.ts)
and [android/notification-card.test.tsx](android/notification-card.test.tsx) (no subtitle on Android; with previews
hidden, the title stays and only the text goes) run in node. Layout, clamping and the Range read need a real
browser: check them on the design page, whose Truncation section prints what `onMeasure` reports beside each
screen.
