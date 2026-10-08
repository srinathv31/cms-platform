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

/** One line's characters as every channel shows them: a tab becomes one space; control and invisible characters go. */
export function cleanCharacters(text: string): string {
  return withoutInvisible(text.replace(/\t/g, " ").replace(CONTROL_CHARACTERS, ""));
}
