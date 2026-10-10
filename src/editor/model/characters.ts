// The character rules for text (docs/render-spec.md §3 and §4), in one place for save normalization
// (normalize.ts) and the resolver (src/domain/render/resolve.ts), which repeats them defensively.
// Explicit sets, so a Java port matches code point for code point.

import { withoutInvisible } from "./links";

/** Line break characters in text: CR LF (counted once), CR, LF, U+2028, U+2029. Each is a hard break. */
export const LINE_BREAKS = /\r\n|[\r\n\u2028\u2029]/g;

/**
 * Control characters, removed from text: U+0000–U+0008, U+000B, U+000C, U+000E–U+001F,
 * U+007F–U+009F. The tab and the line breaks are handled apart.
 */
export const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Which characters a text keeps, by where it prints (docs/render-spec.md §4):
 *   - `"document"`: a document's body and the email's subject and preheader. Control characters go, and so do the
 *     invisible characters (links.ts, INVISIBLE_CHARACTERS): the editor shows nothing for them and a PDF font
 *     can't draw most of them.
 *   - `"message"`: a push's and an SMS's fields and values. Only control characters go. The invisible
 *     characters stay, because a phone draws with them: the joiner in 👨‍👩‍👧, the emoji selector in ❤️, the
 *     tags of a subdivision flag, the non-joiner in a Persian name. An SMS's typed text is still flagged for
 *     every character outside GSM-7, these among them (src/domain/messages/gsm7.ts).
 */
export type CharacterRules = "document" | "message";

/**
 * One line's characters as a channel shows them: a tab becomes one space and control characters go; for a
 * document (the default) invisible characters go too.
 */
export function cleanCharacters(text: string, rules: CharacterRules = "document"): string {
  const visible = text.replace(/\t/g, " ").replace(CONTROL_CHARACTERS, "");
  return rules === "document" ? withoutInvisible(visible) : visible;
}
