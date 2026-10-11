# 0046. The phone previews are approximations of a customer's phone

Status: Accepted
Date: 2026-10-11

## Context

The preview rail draws a push notification or a text on an iPhone or a Pixel, and the Coral simulator draws the same
frames from what `/api/v1` rendered ([the device kit](../../src/components/device/README.md)). Its numbers come from
the platforms' published guides, not from a phone in hand: Apple's notification line counts (`IOS_LINES`) and Dynamic
Type table (`ios/type.ts`), Android's line counts (`ANDROID_LINES`) and Material 3's type roles with Android 14's
font scaling (`android/type.ts`), the points and dp the current devices report (`geometry.ts`). iOS text is set in Inter, a little
wider than SF, so a cut can move by a word. The "cut after …" warnings are built on those numbers. The handoff review
asked the owner to check them on a real iPhone and a real Pixel, at the default and the larger text sizes
([N26](../handoff-review.md#n26--low-the-phone-previews-line-counts-and-type-sizes-havent-been-checked-on-a-real-phone)).

The owner will not do that check. Devices, OS versions and the user's own text size and language change what any
phone draws, so one pair of phones would settle nothing for the next customer.

## Decision

The previews are approximations of a customer's phone, and the kit says so. They reproduce:

- **The text the customer gets, exactly.** The kit's input is the resolved plain strings the render produced, and it
  never rewords, rounds or drops any of it. What an author reviews and an approver approves is that text, and the
  sample values keep every digit (the render rules in [render-spec.md](../render-spec.md)).
- **The layout each platform's published conventions give it**: what a notification shows and where (lock screen,
  banner or heads-up, expanded), the fields it has (iOS title, subtitle, body; Android title, body), the clamps those
  conventions set, and a text thread's grouping.
- **True proportions.** The frame is the real device's shape and bezel, scaled down to fit and never stretched.

They do not promise:

- **The exact line breaks** of a given phone, or the exact point a notification is cut. A "cut after …" warning is an
  estimate to plan around.
- **The exact type size, weight or truncation on every device and OS version**, at any user text size.
- **Anything else the customer's settings decide**: grouped or summarised notifications, a focus mode, a notification
  setting the kit has no switch for. (It does have switches for hidden previews, text size and screen width.)

## Why that is acceptable

The content is what is regulated, and it is exact: it is the text that is rendered, delivered, reviewed and logged
(keys only, never values). The frame is guidance for the author about length and tone. A push that is cut earlier or
later on a customer's phone than in the preview delivers the same text; the phone cuts it, not Stencil. A preview that
claimed more than that would be the thing to worry about, so the kit's rules say what it is.

## Alternatives considered

- **Measure on devices and tune the numbers.** What N26 proposed. It gives numbers for the phones and OS versions
  measured, and every other phone drifts from them, so the claim "this is what the customer sees" would be as false as
  before, with a date on it.
- **Drop the "cut after …" warnings.** They are useful to an author writing a long push, and an approximate cut point
  is more use than none. The kit calls them estimates.
- **Say so in the UI beside each preview.** The checklist's rule is no hint text, and a note on every preview would
  be one. The device kit's README is where a developer finds this.

## Consequences

- N26 is closed without a code change. No UI copy changes.
- A change to the clamps or the type ramps still needs a source: the platform guide it follows, named in the kit's
  README. Measuring a phone is welcome when someone has one, and it adjusts the numbers, not this decision.
- A claim about what a customer sees must be about the text, not the frame.
