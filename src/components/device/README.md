# `src/components/device`: the phone kit

Draws a push notification or a text message on a phone, the way the phone shows it: a generic frame with an
iOS-style skin (`ios/`) and an Android-style one (`android/`, a current Pixel in Material 3 Expressive). Stencil's
preview rail uses it for the Push and SMS channels. Coral, the simulated consumer, is the other consumer: its
customer drawer ([customer-drawer.tsx](../../simulator/ui/customer-drawer.tsx)) shows each customer's phone with
the kit, from what `/api/v1` rendered: the push on the lock screen (or dropping in as a banner), their text thread,
and a web page on `ScreenPreview`. It is presentation only: it takes resolved plain strings (variables already
replaced with values) and knows nothing about templates, channels or versions.

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
  point or an Android dp, laid out as one CSS px; the whole phone is scaled afterwards. See Geometry.
- **Legal.** No Apple or Google assets: no bezels or UI-kit vectors, no SF font files, no SF Symbols, no Google
  logo, no Android robot, no Pixel wallpapers, no Messages or Google Messages icon, no app icons. The frame,
  status-bar glyphs, wallpaper and app mark are drawn here; interface glyphs are Lucide; the fonts shipped are
  Inter and Google Sans Flex (both OFL). Call the skins "iOS-style" and "Android-style", keep the preview out of
  external marketing, and show fictional data only.

## Using it

```tsx
import { PhoneSkeleton, PushPreview, SmsPreview, pushScreenLabel, type DeviceSettings } from "@/components/device";

const settings: DeviceSettings = {
  platform: "ios",            // "ios" | "android"
  appearance: "light",        // the phone's, not the app's
  previewsHidden: false,      // the lock screen's privacy setting: see below
  textSize: "default",        // "default" | "large" | "ax" (iOS: Large, xxxLarge, AX1; Android: 100, 130, 200%)
  width: "standard",          // "compact" | "standard" | "large" (iOS: 375, 402, 440pt; Android: 360, 412, 448dp)
};

<div className="h-full">  {/* the phone scales to fit its parent: give the parent a height */}
  <PushPreview
    settings={settings}
    screen="lock"                                    // "lock" | "banner" | "expanded"
    content={{ appName: "Coral", appMark: { monogram: "C" }, title, subtitle, body, time: "now" }}
    onScreenChange={setScreen}                       // optional: makes the notification a toggle button
    onMeasure={(m) => setFit(m)}                     // optional: truncation per field, see below
    clock={{ time: "9:41", date: "Friday, October 9" }}  // optional, this is the default
    fit={{ minScale: 0.55, room: 16 }}               // optional: the smallest scale, and px kept under the phone
  />
</div>

// While the content loads: the same phone, empty, in the same place.
<PhoneSkeleton settings={settings} fit={{ room: 16 }} />

<SmsPreview settings={settings} content={{ sender: "26725", text, time: "9:41 AM", day: "Today" }} />

// A thread: earlier texts from the same sender above the newest one, oldest first.
<SmsPreview settings={settings} content={{ sender: "26725", text, time: "2:02 PM", earlier: [{ text: first, time: "9:41 AM", day: "Yesterday" }] }} />

// Any other app's screen: the frame, status bar and home indicator around the caller's content.
<ScreenPreview settings={settings} caption="Web page from Coral">
  <iframe title="Offer terms" src={src} sandbox="" className="min-h-0 flex-1" />
</ScreenPreview>

pushScreenLabel("android", "banner")  // "Heads-up": label controls and captions with the platform's word
```

The types are in [types.ts](types.ts); everything public comes from [index.ts](index.ts), including `IOS_LINES`,
`ANDROID_LINES`, `SCREEN_SIZES` and `SIZE_UNIT` (to label widths "402pt" or "412dp"), and `frameSize` (the whole
phone at 1:1, for a box that draws it unscaled).

- **`PushContent`**: `appName`, `appMark: { monogram }` (a tile in the brand's tone, never a real icon), `title`,
  `subtitle?` (iPhone only: Android never shows it, even when set; empty means none), `body`, `time` (as printed:
  "now", "9:41 AM"). Plain text; line breaks and runs of spaces are kept.
- **`SmsContent`**: `sender` (a short code or number: a US text can't show a brand there; when it is empty the
  header shows a muted "No sender", `NO_SENDER` in [labels.ts](labels.ts), and the caption leaves out "from"),
  `text` (the whole message, footer included, as delivered), `time`, `day?` (default "Today"). Links in the text
  show underlined and
  not clickable, as a phone shows them from an unknown sender ([links.ts](links.ts)). `earlier?` holds the texts
  that came before from the same sender (`SmsMessage`: `text`, `time`, `day?`), oldest first: each prints its day
  and time when they differ from the text before ([thread.ts](thread.ts)), and the thread opens scrolled to the
  newest. Without it the text is alone, at the top.
- **`ScreenPreview`** ([screen-preview.tsx](screen-preview.tsx)): any app's screen that isn't a push or a text,
  such as a web page. It draws the frame, the status bar and the home indicator or gesture handle, and the caller's
  children fill the screen between them on the app's background. `caption` names the figure; the skin's name is
  added. Coral shows its web deliveries on it.
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

**Real size, then scaled.** The phone is laid out at its real size, one point to one CSS pixel (`pt(n)` is
`n` px), screen and bezel whole, and then the whole of it is scaled with a CSS transform to fit its container.
A transform doesn't lay text out again, so every line breaks and every field cuts exactly where it does at 1:1,
and the text stays crisp (nothing sets `will-change`, so the browser rasterises at the final scale). The scaler
is the shared `ScaledBox` ([primitives/scaled-viewport.tsx](../primitives/scaled-viewport.tsx)), the same code
as Web's Desktop page: it reserves the phone's scaled size in the layout, centred across the container and at
its top, so nothing overlaps the phone and no gap is left under it.

**Sizes** are in [geometry.ts](geometry.ts), with their sources: iPhone 375 × 812, 402 × 874 and 440 × 956pt;
Android 360 × 800, 412 × 915 and 448 × 997dp; the screen corners each phone reports (iPhone 44 and 62pt,
Pixel 39dp). The bezel is the real phones' (an iPhone 17's 14.5pt a side, a Pixel 9's 21.5dp), so the whole
phone has their proportions: 431 × 903 (0.477) and 455 × 958 (0.475). The camera cutout is iOS's Dynamic Island
(126 × 37pt) or Android's centred punch hole.

**The scale** (`phoneScale`) fits the whole phone in the container, never above 1, with two rules:

- A phone is never drawn bigger than the platform's standard phone would be in the same container, so the
  compact width reads smaller, as it is. The standard and large widths fit the container.
- Height fits down to `MIN_SCALE`, 0.55, where the 15pt notification text is about 8px, the least that reads
  comfortably. A shorter container keeps that scale and the phone runs past its bottom, for a scroller round
  it to scroll; width always fits. `fit.minScale` changes it, and `fit.room` keeps that many px under the phone
  inside its box, the space a scroller leaves at the end (a scroller's own padding doesn't follow an overflow).

What that gives, measured in the running app:

| Container | iPhone (standard) | Android (standard) |
| --- | --- | --- |
| Preview well, 1440 × 900 | 0.717, 309 × 647 | 0.675, 307 × 647 |
| Preview well, 1280 × 800 | 0.606, 261 × 547 | 0.571, 260 × 547 |
| Preview well, 1000 × 700 overlay | 0.55, the well scrolls 50px | 0.55, the well scrolls 80px |
| Review's Preview, 1440 × 900 | 0.589 | 0.555 |
| Coral's drawer, 1440 × 900 | about 0.70 | about 0.66 |

**The screen's content** is laid out for the real screen's height, where each OS puts it: iOS's date and clock
near the top and its notifications rising from the bottom, the stack just above the flashlight and camera;
Android's notifications under its clock; a home screen's full grid of tiles down to the search and the dock (six
rows on iOS, the launcher's five on Android); the shade's notification list, with Clear all, under its quick
settings; a text thread's messages under the header, and the composer at the bottom.

**Measuring** reads layout px, so the scale changes nothing: `measureField` takes the clip from the field's own
layout and each character's box from the screen, divided by the phone's scale on screen (the frame's
`getBoundingClientRect` width over its `offsetWidth`). The composer's hidden phones draw at 1:1 in a box their
own size, and report what the visible phone, at any scale, cuts.

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
| [screen-preview.tsx](screen-preview.tsx) | `ScreenPreview`: the frame and the system chrome around any app's content (Coral's web page). |
| [thread.ts](thread.ts) | A text thread: its messages oldest first, which print their time, and opening on the newest. |
| [labels.ts](labels.ts) | `pushScreenLabel` (Banner or Heads-up), the skins' names, the SMS caption and the no-sender placeholder. |
| [phone-frame.tsx](phone-frame.tsx) | The generic frame, its scale to fit (`ScaledBox`), the camera cutout, the figure. |
| [phone-skeleton.tsx](phone-skeleton.tsx) | `PhoneSkeleton`: the frame with an empty screen, for a loading state, at the size and place of the phone that replaces it. |
| [status-bar.tsx](status-bar.tsx) | Each platform's status bar and its home indicator or gesture handle, generic glyphs. |
| [wallpaper.tsx](wallpaper.tsx) | The wallpaper, drawn from `--device-wall-*`, shared by both platforms. |
| [app-mark.tsx](app-mark.tsx), [silhouette.tsx](silhouette.tsx) | The sending app's monogram tile; an unknown sender's avatar. |
| [geometry.ts](geometry.ts) | `pt()`, screen sizes per platform and width with their sources, the bezel, `frameSize`, `phoneScale` and `MIN_SCALE`. |
| [measure.ts](measure.ts) | Truncation measurement and `useMeasure`. |
| [links.ts](links.ts) | Which runs of a text message read as links. |
| [fonts.ts](fonts.ts) | Inter and Google Sans Flex (OFL) via `next/font`, scoped to the kit's root. |
| [ios/](ios) | The iOS-style skin: `LockScreen`, `Banner` (on `HomeScreen`), `Expanded`, `MessagesThread`, the notification card, its type ramp and glass. |
| [android/](android) | The Android-style skin: `AndroidLockScreen`, `HeadsUp` (on its home screen), `Shade`, `AndroidMessagesThread`, the notification card, the Material type ramp and the short date. |

A third skin would follow the same shape: its views, type ramp and line counts in a folder, its sizes in
[geometry.ts](geometry.ts), its tokens and face in tokens.css and [fonts.ts](fonts.ts), and a branch in the two
entry points.

## Testing

[measure.test.ts](measure.test.ts) (the visible-prefix search), [geometry.test.ts](geometry.test.ts) (the
proportions and the scale), [links.test.ts](links.test.ts),
[labels.test.ts](labels.test.ts), [thread.test.ts](thread.test.ts), [ios/type.test.ts](ios/type.test.ts), [android/dates.test.ts](android/dates.test.ts),
[messages-thread.test.tsx](messages-thread.test.tsx) (the sender, or "No sender", in each thread's header) and
[android/notification-card.test.tsx](android/notification-card.test.tsx) (no subtitle on Android; with previews
hidden, the title stays and only the text goes) run in node. Layout, clamping and the Range read need a real
browser: check them on the design page, whose Truncation section prints what `onMeasure` reports beside each
screen. Coral's phone, with a thread of several texts and a banner arriving, is driven end to end by
`e2e/coral-alerts.spec.ts`.
