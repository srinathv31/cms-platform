// Where a phone cuts a push notification, as the composer warns about it. The phone, not Stencil, cuts
// the text: the full text is always sent, and each platform clamps it on screen. The measurements come
// from the rendered phone (the phone kit's `onMeasure`, at the lock screen, standard width, default
// text size); this turns them into the sentence under the field, and decides which cuts are worth one.
//
// A warning is for something that is wrong, not for how phones work:
//   - the title cut on either platform: it is the one line every screen shows, and on Android the only
//     one a locked phone shows with previews hidden;
//   - the subtitle (iPhone only) or the body cut on the iPhone lock screen, which shows four lines.
// Android's collapsed body is always one line, which is how Android works and what the expanded shade
// is for, so a cut there is no warning.

import { PLATFORM_LABELS } from "../render/errors";
import type { PushPlatform } from "./push";

/** How one field fits the screen it was measured on (the phone kit's `FieldFit`, the parts read here). */
export interface FieldCut {
  /** The screen shows the field at all. */
  shown: boolean;
  /** The platform cut it. */
  cut: boolean;
  /** What shows, without the ellipsis; it can end mid-word. */
  visibleText: string;
}

/** One platform's lock screen, measured. `subtitle` is null when there is none (or on Android). */
export interface LockScreenFit {
  platform: PushPlatform;
  title: FieldCut;
  subtitle: FieldCut | null;
  body: FieldCut;
}

/** The push's text as resolved for the measurement: where a word ends is read from it. */
export interface PushFullText {
  title: string;
  subtitle?: string;
  body: string;
}

/** The sentence under each field, or null when nothing there is cut that matters. */
export interface TruncationWarnings {
  title: string | null;
  subtitle: string | null;
  body: string | null;
}

/**
 * The warnings for a push, from each platform's lock screen as measured: "iPhone lock screen cuts after
 * “…payment of”." When both platforms cut a title at the same word, one sentence names both.
 */
export function truncationWarnings(fits: readonly LockScreenFit[], text: PushFullText): TruncationWarnings {
  const ios = fits.find((fit) => fit.platform === "ios") ?? null;
  return {
    title: cutSentence(
      fits.filter((fit) => fit.title.shown && fit.title.cut).map((fit) => ({ platform: fit.platform, visible: fit.title.visibleText })),
      text.title,
    ),
    subtitle:
      ios?.subtitle?.shown && ios.subtitle.cut
        ? cutSentence([{ platform: "ios", visible: ios.subtitle.visibleText }], text.subtitle ?? "")
        : null,
    body: ios?.body.shown && ios.body.cut ? cutSentence([{ platform: "ios", visible: ios.body.visibleText }], text.body) : null,
  };
}

function cutSentence(cuts: readonly { platform: PushPlatform; visible: string }[], full: string): string | null {
  if (cuts.length === 0) return null;
  const tails = cuts.map((cut) => ({ platform: cut.platform, tail: quotedTail(roundToWord(full, cut.visible)) }));
  if (tails.length > 1 && tails.every((t) => t.tail === tails[0]!.tail)) {
    return `${tails.map((t) => PLATFORM_LABELS[t.platform]).join(" and ")} lock screens cut after ${tails[0]!.tail}.`;
  }
  return tails.map((t) => `${PLATFORM_LABELS[t.platform]} lock screen cuts after ${t.tail}.`).join(" ");
}

/**
 * The visible text cut back to the last whole word: a reader doesn't see half a word as the place the
 * text stops. A text cut inside its first word keeps what shows.
 */
export function roundToWord(full: string, visible: string): string {
  const shown = visible.trimEnd();
  if (!full.startsWith(shown) || shown.length >= full.length) return shown;
  if (/\s/.test(full[shown.length]!)) return shown;
  const whole = shown.replace(/\S+$/u, "").trimEnd();
  return whole === "" ? shown : whole;
}

/**
 * The last two words, in quotes, with an ellipsis when there is more before them: “…payment of”. Three
 * when two are short (“…payment is due”), so the place is easy to find. A comma, colon, semicolon or
 * dash the cut leaves at the end is dropped: the sentence ends at the word.
 */
export function quotedTail(text: string): string {
  const words = text
    .replace(/[\s,;:\u2013\u2014-]+$/u, "")
    .split(/\s+/u)
    .filter(Boolean);
  const tail: string[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    tail.unshift(words[i]!);
    if (tail.length >= 3 || (tail.length === 2 && tail.join(" ").length >= 8)) break;
  }
  const more = tail.length < words.length ? "…" : "";
  return `“${more}${tail.join(" ")}”`;
}
